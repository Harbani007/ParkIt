import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbUp, pool, tracker, ensureFacility, createUser, createSlot, insertBookingRow } from './helpers.js';

// Past dates hold completed/missed/checked_in rows (missed needs ends_at <= now); 2031 holds upcoming.
const PAST = { from: '2020-03-09', to: '2020-03-11', day: '2020-03-10' };
const FUTURE = { from: '2031-03-09', to: '2031-03-11', day: '2031-03-10' };
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);

describe.skipIf(!dbUp)('GET /api/admin/summary', () => {
  const app = createApp();
  let admin;
  let customer;
  let slot;
  const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
  const summary = (params, user = admin) =>
    request(app).get('/api/admin/summary').query(params).set(auth(user));

  beforeAll(async () => {
    await ensureFacility();
    admin = await createUser({ role: 'admin' });
    customer = await createUser();
    slot = await createSlot();
  });

  afterAll(async () => {
    await tracker.cleanup();
    await pool.end();
  });

  const row = (day, from, to, status, amount, extra = {}) =>
    insertBookingRow({
      userId: customer.user.id, slotId: slot.id, startsAt: at(day, from), endsAt: at(day, to), status, amount, ...extra,
    });

  it('counts each booking once, revenue excludes refunds, by_day has one row per date', async () => {
    const before = (await summary(PAST)).body;
    const futureBefore = (await summary(FUTURE)).body;

    // Past range, all on PAST.day: completed 100, missed 50, checked_in 30, cancelled 70 (refunded).
    await row(PAST.day, '08:00', '09:00', 'completed', '100.00', { checkedInAt: at(PAST.day, '08:00'), checkedOutAt: at(PAST.day, '09:00') });
    await row(PAST.day, '10:00', '11:00', 'confirmed', '50.00');
    await row(PAST.day, '12:00', '13:00', 'checked_in', '30.00', { checkedInAt: at(PAST.day, '12:00') });
    await row(PAST.day, '14:00', '16:00', 'cancelled', '70.00');
    // Future range: upcoming 80 and a cancelled one.
    await row(FUTURE.day, '10:00', '12:00', 'confirmed', '80.00');
    await row(FUTURE.day, '14:00', '15:00', 'cancelled', '40.00');

    const res = await summary(PAST);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b).toMatchObject({ from: PAST.from, to: PAST.to });
    expect(b.by_day).toHaveLength(3);
    expect(b.by_day.map((d) => d.date)).toEqual(['2020-03-09', '2020-03-10', '2020-03-11']);

    const delta = (k) => b.counts[k] - before.counts[k];
    expect(delta('completed')).toBe(1);
    expect(delta('missed')).toBe(1);
    expect(delta('checked_in')).toBe(1);
    expect(delta('cancelled')).toBe(1);
    expect(delta('upcoming')).toBe(0);
    expect(Number(b.revenue) - Number(before.revenue)).toBeCloseTo(180, 2); // refunded 70 excluded
    expect(b.revenue).toMatch(/^\d+\.\d{2}$/);

    const day = b.by_day.find((d) => d.date === PAST.day);
    const dayBefore = before.by_day.find((d) => d.date === PAST.day);
    expect(Number(day.revenue) - Number(dayBefore.revenue)).toBeCloseTo(180, 2);
    expect(day.bookings - dayBefore.bookings).toBe(3); // cancelled excluded
    expect(b.by_day.find((d) => d.date === '2020-03-09').bookings).toBe(before.by_day[0].bookings);

    // Occupancy: 3 booked hours over all slots x 17 open hours (default 06:00-23:00).
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM slots WHERE facility_id = 1');
    const { rows: fac } = await pool.query(
      'SELECT (EXTRACT(EPOCH FROM (closes_at - opens_at)) / 3600)::float8 AS h FROM facilities WHERE id = 1',
    );
    const openHours = fac[0].h;
    if (dayBefore.bookings === 0) {
      expect(day.occupancy_pct).toBe(Math.round(((3 / (rows[0].n * openHours)) * 1000)) / 10);
    } else {
      expect(day.occupancy_pct).toBeGreaterThan(dayBefore.occupancy_pct);
    }
    expect(day.occupancy_pct).toBeLessThanOrEqual(100);
    expect(b.occupancy_pct).toBeGreaterThan(0);
    expect(b.occupancy_pct).toBeLessThanOrEqual(100);

    const f = (await summary(FUTURE)).body;
    expect(f.counts.upcoming - futureBefore.counts.upcoming).toBe(1);
    expect(f.counts.cancelled - futureBefore.counts.cancelled).toBe(1);
    expect(f.counts.missed - futureBefore.counts.missed).toBe(0);
    expect(Number(f.revenue) - Number(futureBefore.revenue)).toBeCloseTo(80, 2);
  });

  it('attributes a late-evening IST booking to its IST date', async () => {
    // 23:30 IST is 18:00 UTC the same day; 00:00 IST would be the previous UTC date.
    const day = '2021-06-15';
    const before = (await summary({ from: day, to: day })).body;
    await row(day, '22:00', '23:00', 'completed', '10.00');
    const after = (await summary({ from: day, to: day })).body;
    expect(after.by_day).toHaveLength(1);
    expect(after.by_day[0].bookings - before.by_day[0].bookings).toBe(1);
  });

  it('a single day range returns one by_day row', async () => {
    const res = await summary({ from: '2030-01-01', to: '2030-01-01' });
    expect(res.status).toBe(200);
    expect(res.body.by_day).toHaveLength(1);
  });

  it('accepts a 366-day range', async () => {
    const res = await summary({ from: '2028-01-01', to: '2028-12-31' }); // leap year: 366 days
    expect(res.status).toBe(200);
    expect(res.body.by_day).toHaveLength(366);
  });

  it('400 for to < from, range over 366 days, bad or missing dates', async () => {
    for (const params of [
      { from: '2030-02-02', to: '2030-02-01' },
      { from: '2028-01-01', to: '2029-01-01' },
      { from: '2030-02-30', to: '2030-03-01' },
      { from: 'abc', to: '2030-03-01' },
      { from: '2030-03-01' },
      {},
    ]) {
      const res = await summary(params);
      expect(res.status, JSON.stringify(params)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
  });

  it('401 without a token, 403 for a customer', async () => {
    const params = { from: '2030-01-01', to: '2030-01-02' };
    expect((await request(app).get('/api/admin/summary').query(params)).status).toBe(401);
    expect((await summary(params, customer)).status).toBe(403);
  });
});
