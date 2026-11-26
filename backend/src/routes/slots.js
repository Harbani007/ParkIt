import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { checkBookingWindow } from '../lib/rules.js';
import { priceFor } from '../lib/pricing.js';
import { facilityId, getFacility } from '../services/facility.js';

export const slotsRouter = Router();

const availabilityQuery = z.object({
  starts_at: z.string().datetime({ offset: true, message: 'Must be an ISO 8601 time with an offset' }),
  hours: z.string().regex(/^\d{1,3}$/, 'Must be a whole number of hours').transform(Number),
  vehicle_type: z.enum(['car', 'bike']).optional(),
});

slotsRouter.get('/availability', validate({ query: availabilityQuery }), async (req, res) => {
  const q = req.valid.query;
  const facility = await getFacility();
  const { startsAt, endsAt } = checkBookingWindow({
    startsAt: q.starts_at,
    hours: q.hours,
    facility,
    now: new Date(),
  });
  const { rows } = await pool.query(
    `SELECT s.id, s.code, s.vehicle_type, s.hourly_rate, s.daily_rate,
            NOT EXISTS (
              SELECT 1 FROM bookings b
               WHERE b.slot_id = s.id
                 AND b.status IN ('confirmed', 'checked_in')
                 AND tstzrange(b.starts_at, b.ends_at) && tstzrange($2::timestamptz, $3::timestamptz)
            ) AS available
       FROM slots s
      WHERE s.facility_id = $1 AND NOT s.is_blocked
        AND ($4::text IS NULL OR s.vehicle_type = $4::text)
      ORDER BY s.code`,
    [facilityId(), startsAt, endsAt, q.vehicle_type ?? null],
  );
  res.json({
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    hours: q.hours,
    slots: rows.map((s) => ({
      id: s.id,
      code: s.code,
      vehicle_type: s.vehicle_type,
      hourly_rate: s.hourly_rate,
      daily_rate: s.daily_rate,
      available: s.available,
      amount: priceFor(q.hours, s.hourly_rate, s.daily_rate),
    })),
  });
});
