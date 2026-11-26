import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { generateBookingCode } from '../src/lib/bookingCode.js';
import { createUser, createSlot, dbUp, ensureFacility, insertBookingRow, istIso, pool, tracker } from './helpers.js';

// Runs against its own facility (config.facilityId is switched for the file), so seeded slots
// never change which slot an auto-pick booking lands on.
describe.skipIf(!dbUp)('bookings (customer)', () => {
  const app = createApp();
  const originalDir = config.uploadsDir;
  const originalFacility = config.facilityId;
  const facilityIds = [];
  let tmp;
  let facilityId;
  let admin;

  const plate = () => `V${randomBytes(4).toString('hex').toUpperCase()}`;
  const as = (u) => ({ Authorization: `Bearer ${u.token}` });
  const post = (u, body) => request(app).post('/api/bookings').set(as(u)).send(body);
  const body = (extra = {}) => ({
    vehicle_type: 'car', starts_at: istIso(5, '10:00'), hours: 2, vehicle_number: plate(), ...extra,
  });
  const slot = (extra = {}) => createSlot({ facilityId, ...extra });
  const row = async (u, s, startMs, endMs, extra = {}) =>
    insertBookingRow({
      userId: u.user.id, slotId: s.id, startsAt: new Date(startMs), endsAt: new Date(endMs),
      bookingCode: generateBookingCode(), ...extra,
    });
  const H = 3_600_000;

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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parkit-bk-'));
    config.uploadsDir = tmp;
    facilityId = await newFacility();
    config.facilityId = facilityId;
    admin = await createUser({ role: 'admin' });
  });

  afterAll(async () => {
    config.facilityId = originalFacility;
    config.uploadsDir = originalDir;
    await tracker.cleanup();
    await pool.query('DELETE FROM facilities WHERE id = ANY($1::int[])', [facilityIds]);
    fs.rmSync(tmp, { recursive: true, force: true });
    await pool.end();
  });

  describe('POST /api/bookings', () => {
    it('201 with the full Booking shape and a fetchable QR, with slot_id', async () => {
      const u = await createUser();
      const s = await slot({ hourlyRate: 40, dailyRate: 300 });
      const res = await post(u, body({ slot_id: s.id, vehicle_number: 'dl 3c-ab 1234', hours: 3 }));
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        booking_code: expect.stringMatching(/^PK-[A-HJ-NP-Z2-9]{6}$/),
        status: 'confirmed',
        slot: { id: s.id, code: s.code, vehicle_type: 'car' },
        vehicle_number: 'DL3CAB1234',
        starts_at: istIso(5, '10:00'),
        ends_at: istIso(5, '13:00'),
        hours: 3,
        amount: '120.00',
        can_cancel: true,
        overstayed: false,
        payment: { amount: '120.00', status: 'paid', provider: 'simulated' },
        qr_url: expect.stringMatching(/^\/api\/files\/qr\/[a-f0-9]{32}\.png$/),
        checked_in_at: null,
        checked_out_at: null,
        cancelled_at: null,
        created_at: expect.stringMatching(/Z$/),
      });
      expect(res.body.qr_url).not.toContain(res.body.booking_code.slice(3).toLowerCase());
      const png = await request(app).get(res.body.qr_url);
      expect(png.status).toBe(200);
      expect(png.headers['content-type']).toMatch(/^image\/png/);
    });

    it('201 without slot_id picks a free slot of the type; accepts an IST offset', async () => {
      const u = await createUser();
      const bike = await slot({ vehicleType: 'bike', hourlyRate: 15, dailyRate: 100 });
      const res = await post(u, body({ vehicle_type: 'bike', starts_at: '2000-01-01T10:00:00+05:30' }));
      expect(res.status).toBe(400); // past, parsed fine
      const ok = await post(u, body({ vehicle_type: 'bike', starts_at: `${istIso(6, '10:00').slice(0, 11)}04:30:00+00:00`, hours: 3 }));
      expect(ok.status).toBe(201);
      expect(ok.body.slot.id).toBe(bike.id);
      expect(ok.body.amount).toBe('45.00');
    });

    it('400 for rule violations, bad vehicle, type mismatch, bad body', async () => {
      const u = await createUser();
      const car = await slot();
      const bike = await slot({ vehicleType: 'bike' });
      const cases = [
        body({ slot_id: car.id, starts_at: istIso(5, '10:15') }),
        body({ slot_id: car.id, starts_at: istIso(5, '23:30'), hours: 1 }), // ends after closing
        body({ slot_id: car.id, starts_at: istIso(5, '22:00'), hours: 20 }),
        body({ slot_id: car.id, starts_at: istIso(60, '10:00') }),
        body({ slot_id: car.id, vehicle_number: 'AB' }),
        body({ slot_id: car.id, vehicle_number: 'DL3C@1234' }),
        body({ slot_id: bike.id, vehicle_type: 'car' }),
        body({ slot_id: car.id, hours: 0 }),
        body({ slot_id: car.id, hours: 25 }),
        body({ slot_id: car.id, hours: 1.5 }),
        body({ slot_id: car.id, starts_at: 'tomorrow' }),
        body({ slot_id: car.id, starts_at: '2030-01-01T10:00:00' }), // no offset
        body({ slot_id: car.id, vehicle_type: 'truck' }),
        body({ vehicle_type: undefined }),
        body({ slot_id: '1' }),
      ];
      for (const c of cases) {
        const res = await post(u, c);
        expect(res.status, JSON.stringify(c)).toBe(400);
        expect(res.body.error).toBeTruthy();
      }
      expect((await post(u, body({ slot_id: car.id, hours: 0 }))).body.details[0].path).toBe('body.hours');
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM bookings WHERE user_id = $1', [u.user.id]);
      expect(rows[0].n).toBe(0);
    });

    it('401 without a token, 403 for an admin token, 404 unknown slot', async () => {
      const u = await createUser();
      expect((await request(app).post('/api/bookings').send(body())).status).toBe(401);
      expect((await post(admin, body())).status).toBe(403);
      expect((await post(u, body({ slot_id: 2_000_000_000 }))).status).toBe(404);
    });

    it('409 for a blocked slot, a vehicle overlap and a taken slot', async () => {
      const u = await createUser();
      const u2 = await createUser();
      const blocked = await slot({ isBlocked: true });
      const s = await slot();
      const s2 = await slot();
      const v = plate();
      expect(await post(u, body({ slot_id: blocked.id }))).toMatchObject({ status: 409, body: { error: 'Slot is blocked' } });
      expect((await post(u, body({ slot_id: s.id, vehicle_number: v }))).status).toBe(201);
      expect(await post(u2, body({ slot_id: s.id }))).toMatchObject({
        status: 409, body: { error: 'This slot was just booked for that time' },
      });
      expect(await post(u2, body({ slot_id: s2.id, vehicle_number: v.toLowerCase() }))).toMatchObject({
        status: 409, body: { error: 'This vehicle already has a booking at that time' },
      });
      // back to back on the same slot is fine
      expect((await post(u2, body({ slot_id: s.id, starts_at: istIso(5, '12:00') }))).status).toBe(201);
    });

    it('409 when the customer already has 3 active bookings', async () => {
      const u = await createUser();
      for (let d = 5; d < 8; d++) {
        await slot();
        expect((await post(u, body({ starts_at: istIso(d, '10:00') }))).status).toBe(201);
      }
      expect(await post(u, body({ starts_at: istIso(8, '10:00') }))).toMatchObject({
        status: 409, body: { error: 'You already have 3 active bookings' },
      });
    });

    it('two simultaneous POSTs for the same slot and time: exactly one 201', async () => {
      const s = await slot();
      const [u1, u2] = [await createUser(), await createUser()];
      const res = await Promise.all([post(u1, body({ slot_id: s.id })), post(u2, body({ slot_id: s.id })).then((r) => r)]);
      expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(res.find((r) => r.status === 409).body.error).toBe('This slot was just booked for that time');
    });

    it('two simultaneous auto-pick POSTs on a one-slot facility: one 201, one "No free slot"', async () => {
      const f = await newFacility();
      config.facilityId = f;
      try {
        await createSlot({ facilityId: f });
        const [u1, u2] = [await createUser(), await createUser()];
        const res = await Promise.all([post(u1, body()), post(u2, body())]);
        expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
        expect(res.find((r) => r.status === 409).body.error).toBe('No free slot of that type');
      } finally {
        config.facilityId = facilityId;
      }
    });
  });

  describe('GET /api/bookings/mine', () => {
    it('splits active and past: missed in past, checked_in past ends_at still active', async () => {
      const u = await createUser();
      const now = Date.now();
      const later = await row(u, await slot(), now + 72 * H, now + 73 * H);
      const soon = await row(u, await slot(), now + 24 * H, now + 25 * H);
      const running = await row(u, await slot(), now - 3 * H, now + 1 * H);
      const overdue = await row(u, await slot(), now - 5 * H, now - 1 * H, { status: 'checked_in', checkedInAt: new Date(now - 5 * H) });
      const missed = await row(u, await slot(), now - 6 * H, now - 4 * H);
      const done = await row(u, await slot(), now - 30 * H, now - 28 * H, {
        status: 'completed', checkedInAt: new Date(now - 30 * H), checkedOutAt: new Date(now - 28 * H),
      });
      const cancelled = await row(u, await slot(), now + 48 * H, now + 49 * H, { status: 'cancelled' });
      const other = await createUser();
      await row(other, await slot(), now + 24 * H, now + 25 * H);

      const active = await request(app).get('/api/bookings/mine').set(as(u));
      expect(active.status).toBe(200);
      expect(active.body.bookings.map((b) => b.booking_code)).toEqual(
        [overdue, running, soon, later].map((b) => b.booking_code),
      );
      expect(active.body.bookings[0]).toMatchObject({ status: 'checked_in', overstayed: true });
      const explicit = await request(app).get('/api/bookings/mine?scope=active').set(as(u));
      expect(explicit.body.bookings).toHaveLength(4);

      const pastRes = await request(app).get('/api/bookings/mine?scope=past').set(as(u));
      expect(pastRes.body.bookings.map((b) => [b.booking_code, b.status])).toEqual([
        [cancelled.booking_code, 'cancelled'],
        [missed.booking_code, 'missed'],
        [done.booking_code, 'completed'],
      ]);
      expect(pastRes.body.bookings[0]).toMatchObject({ qr_url: null, can_cancel: false });
    });

    it('400 for a bad scope, 401 without a token, 403 for an admin token', async () => {
      const u = await createUser();
      expect((await request(app).get('/api/bookings/mine?scope=all').set(as(u))).status).toBe(400);
      expect((await request(app).get('/api/bookings/mine')).status).toBe(401);
      expect((await request(app).get('/api/bookings/mine').set(as(admin))).status).toBe(403);
    });
  });

  describe('GET /api/bookings/:code', () => {
    it('200 for the owner and an admin, 404 for another customer and unknown or malformed codes', async () => {
      const owner = await createUser();
      const stranger = await createUser();
      await slot();
      const created = (await post(owner, body())).body;
      const get = (u, code) => request(app).get(`/api/bookings/${code}`).set(as(u));

      const mine = await get(owner, created.booking_code);
      expect(mine.status).toBe(200);
      expect(mine.body).toEqual(created);
      expect((await get(owner, created.booking_code.toLowerCase())).status).toBe(200);
      expect((await get(admin, created.booking_code)).status).toBe(200);

      const other = await get(stranger, created.booking_code);
      const unknown = await get(stranger, 'PK-ZZZZZZ');
      expect(other.status).toBe(404);
      expect(other.body).toEqual(unknown.body); // indistinguishable from an unknown code
      expect((await get(owner, 'not-a-code')).status).toBe(404);
      expect((await get(owner, 'mine2')).status).toBe(404);
      expect((await request(app).get(`/api/bookings/${created.booking_code}`)).status).toBe(401);
    });
  });

  describe('POST /api/bookings/:code/cancel', () => {
    const cancel = (u, code) => request(app).post(`/api/bookings/${code}/cancel`).set(as(u));

    it('200 refunds the payment and hides the QR; a second cancel is 409; the slot is free again', async () => {
      const u = await createUser();
      const s = await slot();
      const created = (await post(u, body({ slot_id: s.id }))).body;
      const res = await cancel(u, created.booking_code);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        status: 'cancelled', can_cancel: false, qr_url: null, payment: { status: 'refunded', amount: created.amount },
        cancelled_at: expect.stringMatching(/Z$/),
      });
      const { rows } = await pool.query(
        `SELECT p.status, p.refunded_at FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.booking_code = $1`,
        [created.booking_code],
      );
      expect(rows[0].status).toBe('refunded');
      expect(rows[0].refunded_at).toBeInstanceOf(Date);
      expect((await cancel(u, created.booking_code)).status).toBe(409);
      expect((await post(await createUser(), body({ slot_id: s.id }))).status).toBe(201);
    });

    it('customer: 409 inside 2 hours with the exact message; admin may cancel it', async () => {
      const u = await createUser();
      const now = Date.now();
      const near = await row(u, await slot(), now + 1 * H, now + 3 * H);
      const res = await cancel(u, near.booking_code);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Bookings can be cancelled until 2 hours before the start');
      const view = await request(app).get(`/api/bookings/${near.booking_code}`).set(as(u));
      expect(view.body.can_cancel).toBe(false);
      const adminView = await request(app).get(`/api/bookings/${near.booking_code}`).set(as(admin));
      expect(adminView.body.can_cancel).toBe(true);
      const byAdmin = await cancel(admin, near.booking_code);
      expect(byAdmin.status).toBe(200);
      expect(byAdmin.body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
    });

    it('customer: allowed just outside the 2 hour limit', async () => {
      const u = await createUser();
      const now = Date.now();
      const edge = await row(u, await slot(), now + 2 * H + 60_000, now + 4 * H);
      expect((await cancel(u, edge.booking_code)).status).toBe(200);
    });

    it('409 for a missed booking (admin too) and for checked_in and completed ones; payment untouched', async () => {
      const u = await createUser();
      const now = Date.now();
      const missed = await row(u, await slot(), now - 3 * H, now - 1 * H);
      const inn = await row(u, await slot(), now - 1 * H, now + 1 * H, { status: 'checked_in', checkedInAt: new Date(now - H) });
      const done = await row(u, await slot(), now - 6 * H, now - 4 * H, { status: 'completed' });
      for (const b of [missed, inn, done]) {
        expect((await cancel(admin, b.booking_code)).status).toBe(409);
        expect((await cancel(u, b.booking_code)).status).toBe(409);
      }
      expect((await cancel(admin, missed.booking_code)).body.error).toMatch(/missed/);
      const { rows } = await pool.query(
        `SELECT status FROM payments WHERE booking_id = ANY($1::int[])`, [[missed.id, inn.id, done.id]],
      );
      expect(rows.map((r) => r.status)).toEqual(['paid', 'paid', 'paid']);
    });

    it('404 for another customer, unknown code; 401 without a token; admin can cancel any customer booking', async () => {
      const owner = await createUser();
      const stranger = await createUser();
      await slot();
      const created = (await post(owner, body())).body;
      expect((await cancel(stranger, created.booking_code)).status).toBe(404);
      expect((await cancel(owner, 'PK-ZZZZZZ')).status).toBe(404);
      expect((await request(app).post(`/api/bookings/${created.booking_code}/cancel`)).status).toBe(401);
      const still = await request(app).get(`/api/bookings/${created.booking_code}`).set(as(owner));
      expect(still.body.status).toBe('confirmed');
      expect((await cancel(admin, created.booking_code)).status).toBe(200);
    });

    it('two simultaneous cancels: one 200, one 409', async () => {
      const u = await createUser();
      await slot();
      const created = (await post(u, body())).body;
      const res = await Promise.all([cancel(u, created.booking_code), cancel(u, created.booking_code)]);
      expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });
});
