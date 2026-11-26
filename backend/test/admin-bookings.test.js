import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { generateBookingCode } from '../src/lib/bookingCode.js';
import { istParts } from '../src/lib/time.js';
import { createUser, createSlot, dbUp, ensureFacility, insertBookingRow, istIso, pool, tracker } from './helpers.js';

// Own facility (config.facilityId is switched for the file) so the day lists hold only our rows.
describe.skipIf(!dbUp)('admin bookings', () => {
  const app = createApp();
  const originalFacility = config.facilityId;
  const originalDir = config.uploadsDir;
  const facilityIds = [];
  let tmp;
  let facilityId;
  let admin;
  let customer;
  const H = 3_600_000;
  const MIN = 60_000;

  const as = (u) => ({ Authorization: `Bearer ${u.token}` });
  const get = (u, qs) => request(app).get(`/api/admin/bookings${qs}`).set(as(u));
  const act = (u, code, what) => request(app).post(`/api/admin/bookings/${code}/${what}`).set(as(u));
  const slot = (extra = {}) => createSlot({ facilityId, ...extra });
  const row = async (startMs, endMs, extra = {}) =>
    insertBookingRow({
      userId: customer.user.id, slotId: (await slot()).id, startsAt: new Date(startMs), endsAt: new Date(endMs),
      bookingCode: generateBookingCode(), ...extra,
    });
  const istDate = (ms) => istParts(new Date(ms)).date;

  async function newFacility() {
    const { rows } = await pool.query(
      `INSERT INTO facilities (name, opens_at, closes_at) VALUES ('Test ' || $1::text, '00:00', '23:30') RETURNING id`,
      [randomBytes(4).toString('hex')],
    );
    facilityIds.push(rows[0].id);
    return rows[0].id;
  }

  beforeAll(async () => {
    await ensureFacility();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parkit-adm-'));
    config.uploadsDir = tmp;
    facilityId = await newFacility();
    config.facilityId = facilityId;
    admin = await createUser({ role: 'admin' });
    customer = await createUser({ name: 'Asha Verma' });
    await pool.query('UPDATE users SET phone = $2 WHERE id = $1', [customer.user.id, '9876543210']);
  });

  afterAll(async () => {
    config.facilityId = originalFacility;
    config.uploadsDir = originalDir;
    await tracker.cleanup();
    await pool.query('DELETE FROM facilities WHERE id = ANY($1::int[])', [facilityIds]);
    fs.rmSync(tmp, { recursive: true, force: true });
    await pool.end();
  });

  describe('GET /api/admin/bookings', () => {
    it('lists the bookings starting on an IST date, ordered, with the customer and derived status', async () => {
      const day = istIso(9, '00:00'); // IST midnight of the day, as UTC
      const at = (hhmm) => new Date(istIso(9, hhmm)).getTime();
      const late = await row(at('15:00'), at('16:00'));
      const early = await row(at('09:00'), at('10:00'), { status: 'cancelled' });
      const mid = await row(at('11:00'), at('12:00'));
      await row(at('00:00') - 1, at('00:00') + H - 1); // starts the previous IST day
      await row(new Date(istIso(10, '00:00')).getTime(), new Date(istIso(10, '00:00')).getTime() + H); // next day
      const other = await createSlot({ facilityId: await newFacility() });
      await insertBookingRow({
        userId: customer.user.id, slotId: other.id, startsAt: istIso(9, '13:00'), endsAt: istIso(9, '14:00'),
      }); // another facility

      const date = istDate(new Date(day).getTime() + H);
      const res = await get(admin, `?date=${date}`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.date).toBe(date);
      expect(res.body.bookings.map((b) => b.booking_code)).toEqual(
        [early, mid, late].map((b) => b.booking_code),
      );
      expect(res.body.bookings[0]).toMatchObject({
        status: 'cancelled',
        customer: { name: 'Asha Verma', email: customer.user.email, phone: '9876543210' },
        slot: { vehicle_type: 'car' },
      });
      expect(res.body.bookings[1].status).toBe('confirmed');
      expect(res.body.bookings[1].can_cancel).toBe(true);

      const filtered = await get(admin, `?date=${date}&status=cancelled`);
      expect(filtered.body.bookings.map((b) => b.booking_code)).toEqual([early.booking_code]);
    });

    it('status=missed is applied after derivation (stored as confirmed)', async () => {
      const now = Date.now();
      const missed = await row(now - 3 * H, now - 1 * H);
      const date = istDate(now - 3 * H);
      const res = await get(admin, `?date=${date}&status=missed`);
      expect(res.status).toBe(200);
      expect(res.body.bookings.map((b) => b.booking_code)).toContain(missed.booking_code);
      expect(res.body.bookings.every((b) => b.status === 'missed')).toBe(true);
      const confirmed = await get(admin, `?date=${date}&status=confirmed`);
      expect(confirmed.body.bookings.map((b) => b.booking_code)).not.toContain(missed.booking_code);
    });

    it('flags an overstaying checked-in booking in the list', async () => {
      const now = Date.now();
      const over = await row(now - 3 * H, now - 1 * H, { status: 'checked_in', checkedInAt: new Date(now - 3 * H) });
      const res = await get(admin, `?date=${istDate(now - 3 * H)}&status=checked_in`);
      expect(res.body.bookings.find((b) => b.booking_code === over.booking_code)).toMatchObject({ overstayed: true });
    });

    it('400 for a missing, malformed or impossible date and an unknown status', async () => {
      for (const qs of ['', '?date=2026-13-01', '?date=2026-02-30', '?date=1-2-3', '?date=2026-12-01&status=lost']) {
        const res = await get(admin, qs);
        expect(res.status, qs).toBe(400);
        expect(res.body.details).toBeInstanceOf(Array);
      }
    });

    it('401 without a token and 403 for a customer', async () => {
      expect((await request(app).get('/api/admin/bookings?date=2026-12-01')).status).toBe(401);
      expect((await get(customer, '?date=2026-12-01')).status).toBe(403);
    });
  });

  describe('POST /api/admin/bookings/:code/check-in', () => {
    it('200 at start - 10 min, and any time during the booking', async () => {
      const now = Date.now();
      const soon = await row(now + 10 * MIN, now + 70 * MIN);
      const res = await act(admin, soon.booking_code.toLowerCase(), 'check-in');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        booking_code: soon.booking_code, status: 'checked_in', checked_in_at: expect.stringMatching(/Z$/),
        can_cancel: false, overstayed: false,
      });
      const running = await row(now - 1 * H, now + 1 * H);
      expect((await act(admin, running.booking_code, 'check-in')).status).toBe(200);
    });

    it('409 too early at start - 20 min, with the api.md message', async () => {
      const now = Date.now();
      const b = await row(now + 20 * MIN, now + 80 * MIN);
      const res = await act(admin, b.booking_code, 'check-in');
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Too early: check-in opens 15 minutes before the start');
      const { rows } = await pool.query('SELECT status FROM bookings WHERE id = $1', [b.id]);
      expect(rows[0].status).toBe('confirmed');
    });

    it('409 for a missed, already checked-in, completed or cancelled booking', async () => {
      const now = Date.now();
      const missed = await row(now - 3 * H, now - 1 * H);
      const inn = await row(now - 1 * H, now + 1 * H, { status: 'checked_in', checkedInAt: new Date(now - H) });
      const done = await row(now - 5 * H, now - 3 * H, { status: 'completed' });
      const gone = await row(now, now + H, { status: 'cancelled' });
      const res = await act(admin, missed.booking_code, 'check-in');
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/missed/);
      for (const b of [inn, done, gone]) expect((await act(admin, b.booking_code, 'check-in')).status).toBe(409);
    });

    it('404 for unknown and malformed codes; 401 and 403', async () => {
      expect((await act(admin, 'PK-ZZZZZZ', 'check-in')).status).toBe(404);
      expect((await act(admin, 'garbage', 'check-in')).status).toBe(404);
      const b = await row(Date.now(), Date.now() + H);
      expect((await request(app).post(`/api/admin/bookings/${b.booking_code}/check-in`)).status).toBe(401);
      expect((await act(customer, b.booking_code, 'check-in')).status).toBe(403);
    });

    it('two simultaneous check-ins: one 200, one 409', async () => {
      const b = await row(Date.now() - H, Date.now() + H);
      const res = await Promise.all([act(admin, b.booking_code, 'check-in'), act(admin, b.booking_code, 'check-in')]);
      expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });

  describe('POST /api/admin/bookings/:code/check-out', () => {
    it('200 completes the booking; overstayed false before ends_at', async () => {
      const now = Date.now();
      const b = await row(now - H, now + H, { status: 'checked_in', checkedInAt: new Date(now - H) });
      const res = await act(admin, b.booking_code, 'check-out');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'completed', overstayed: false, checked_out_at: expect.stringMatching(/Z$/),
      });
    });

    it('overstayed true when checking out after ends_at', async () => {
      const now = Date.now();
      const b = await row(now - 3 * H, now - 1 * H, { status: 'checked_in', checkedInAt: new Date(now - 3 * H) });
      const res = await act(admin, b.booking_code, 'check-out');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'completed', overstayed: true });
    });

    it('409 when confirmed, completed or cancelled; 404 unknown; 401; 403', async () => {
      const now = Date.now();
      const confirmed = await row(now - H, now + H);
      const done = await row(now - 5 * H, now - 3 * H, { status: 'completed' });
      const gone = await row(now, now + H, { status: 'cancelled' });
      for (const b of [confirmed, done, gone]) expect((await act(admin, b.booking_code, 'check-out')).status).toBe(409);
      expect((await act(admin, 'PK-ZZZZZZ', 'check-out')).status).toBe(404);
      expect((await request(app).post(`/api/admin/bookings/${confirmed.booking_code}/check-out`)).status).toBe(401);
      expect((await act(customer, confirmed.booking_code, 'check-out')).status).toBe(403);
    });

    it('full flow: check-in then check-out, then the customer sees it as past', async () => {
      const now = Date.now();
      const b = await row(now + 5 * MIN, now + 65 * MIN);
      expect((await act(admin, b.booking_code, 'check-in')).status).toBe(200);
      const active = await request(app).get('/api/bookings/mine').set(as(customer));
      expect(active.body.bookings.map((x) => x.booking_code)).toContain(b.booking_code);
      expect((await act(admin, b.booking_code, 'check-out')).status).toBe(200);
      const past = await request(app).get('/api/bookings/mine?scope=past').set(as(customer));
      expect(past.body.bookings.find((x) => x.booking_code === b.booking_code).status).toBe('completed');
    });
  });
});
