import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../middleware/errors.js';
import { addDays, isValidDate, istToUtc } from '../../lib/time.js';

export const adminSummaryRouter = Router();

const date = z.string().refine(isValidDate, 'Must be a date as YYYY-MM-DD');
const summaryQuery = z.object({ from: date, to: date });

const MAX_DAYS = 366;
const dayCount = (from, to) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
const pct = (hours, capacity) =>
  capacity > 0 ? Math.min(100, Math.round((hours / capacity) * 1000) / 10) : 0;

// D15 / A7. Revenue: payments still paid for bookings starting in the range. Occupancy: booked
// hours of non-cancelled bookings over all slots x current opening hours, capped at 100.
adminSummaryRouter.get('/', validate({ query: summaryQuery }), async (req, res) => {
  const { from, to } = req.valid.query;
  const days = dayCount(from, to);
  if (days < 1) throw new HttpError(400, '"to" must not be before "from"');
  if (days > MAX_DAYS) throw new HttpError(400, `Range must be at most ${MAX_DAYS} days`);

  const now = new Date();
  const facility = req.space;
  // null = every space (admin, space_id=all); timezone is the same Asia/Kolkata for all (D1).
  const fid = req.allSpaces ? null : facility.id;
  const rangeStart = istToUtc(from, '00:00');
  const rangeEnd = istToUtc(addDays(to, 1), '00:00');

  const [{ rows: capRows }, { rows: dayRows }, { rows: countRows }] = await Promise.all([
    // Capacity per day = sum over spaces of (slots x that space's opening hours).
    pool.query(
      `SELECT COALESCE(SUM(c.n * EXTRACT(EPOCH FROM (f.closes_at - f.opens_at)) / 3600), 0)::float8 AS hours
         FROM facilities f
         JOIN (SELECT facility_id, count(*) AS n FROM slots GROUP BY facility_id) c ON c.facility_id = f.id
        WHERE ($1::int IS NULL OR f.id = $1)`,
      [fid],
    ),
    pool.query(
      `SELECT to_char(d.day::date, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0)::numeric(14, 2)::text AS revenue,
              COALESCE(SUM(EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 3600)
                       FILTER (WHERE b.status <> 'cancelled'), 0)::float8 AS hours,
              (COUNT(b.id) FILTER (WHERE b.status <> 'cancelled'))::int AS bookings
         FROM generate_series($1::timestamp, $2::timestamp, interval '1 day') AS d(day)
         LEFT JOIN (bookings b JOIN slots s ON s.id = b.slot_id AND ($3::int IS NULL OR s.facility_id = $3))
                ON (b.starts_at AT TIME ZONE $4)::date = d.day::date
         LEFT JOIN payments p ON p.booking_id = b.id
        GROUP BY d.day
        ORDER BY d.day`,
      [from, to, fid, facility.timezone],
    ),
    pool.query(
      `SELECT (COUNT(*) FILTER (WHERE b.status = 'confirmed' AND b.ends_at > $4))::int AS upcoming,
              (COUNT(*) FILTER (WHERE b.status = 'confirmed' AND b.ends_at <= $4))::int AS missed,
              (COUNT(*) FILTER (WHERE b.status = 'checked_in'))::int AS checked_in,
              (COUNT(*) FILTER (WHERE b.status = 'completed'))::int AS completed,
              (COUNT(*) FILTER (WHERE b.status = 'cancelled'))::int AS cancelled
         FROM bookings b JOIN slots s ON s.id = b.slot_id
        WHERE ($1::int IS NULL OR s.facility_id = $1) AND b.starts_at >= $2 AND b.starts_at < $3`,
      [fid, rangeStart, rangeEnd, now],
    ),
  ]);

  const dayCapacity = capRows[0].hours;
  let revenuePaise = 0;
  let totalHours = 0;
  const byDay = dayRows.map((r) => {
    revenuePaise += Math.round(Number(r.revenue) * 100);
    totalHours += r.hours;
    return { date: r.date, revenue: r.revenue, occupancy_pct: pct(r.hours, dayCapacity), bookings: r.bookings };
  });

  res.json({
    from,
    to,
    revenue: `${Math.floor(revenuePaise / 100)}.${String(revenuePaise % 100).padStart(2, '0')}`,
    occupancy_pct: pct(totalHours, dayCapacity * days),
    counts: countRows[0],
    by_day: byDay,
  });
});
