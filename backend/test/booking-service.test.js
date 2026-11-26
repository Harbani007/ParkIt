import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { HttpError } from '../src/middleware/errors.js';
import { generateBookingCode } from '../src/lib/bookingCode.js';
import {
  cancelBooking,
  checkInBooking,
  checkOutBooking,
  createBooking,
  findBookingByCode,
  pickFreeSlot,
} from '../src/services/bookings.js';
import { createUser, createSlot, dbUp, ensureFacility, insertBookingRow, istIso, pool, tracker } from './helpers.js';

// Every test works in its own facility, so seeded and other tests' slots never interfere.
describe.skipIf(!dbUp)('booking service', () => {
  const facilityIds = [];
  const originalDir = config.uploadsDir;
  let tmp;
  const startsAt = istIso(5, '10:00');
  const endsAt = istIso(5, '12:00');
  const plate = () => `V${randomBytes(4).toString('hex').toUpperCase()}`;

  async function newFacility() {
    const { rows } = await pool.query(
      `INSERT INTO facilities (name, opens_at, closes_at) VALUES ('Test ' || $1::text, '00:00', '23:30')
       RETURNING id, opens_at, closes_at, max_advance_days`,
      [randomBytes(4).toString('hex')],
    );
    facilityIds.push(rows[0].id);
    return { ...rows[0], opens_at: '00:00', closes_at: '23:30' };
  }
  const slotIn = (facility, code, extra = {}) => createSlot({ facilityId: facility.id, code, ...extra });
  const book = (facility, user, extra = {}) =>
    createBooking({
      facility,
      userId: user.user.id,
      vehicleType: 'car',
      startsAt,
      hours: 2,
      vehicleNumber: plate(),
      ...extra,
    });
  const count = async (facility) =>
    Number(
      (
        await pool.query(
          'SELECT count(*) FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE s.facility_id = $1',
          [facility.id],
        )
      ).rows[0].count,
    );
  const past = (user, slot, daysAgo, extra = {}) =>
    insertBookingRow({
      userId: user.user.id,
      slotId: slot.id,
      startsAt: new Date(Date.now() - daysAgo * 86_400_000),
      endsAt: new Date(Date.now() - daysAgo * 86_400_000 + 3_600_000),
      status: 'completed',
      ...extra,
    });

  beforeAll(async () => {
    await ensureFacility();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parkit-svc-'));
    config.uploadsDir = tmp;
  });

  afterAll(async () => {
    await tracker.cleanup();
    await pool.query('DELETE FROM facilities WHERE id = ANY($1::int[])', [facilityIds]);
    config.uploadsDir = originalDir;
    fs.rmSync(tmp, { recursive: true, force: true });
    await pool.end();
  });

  describe('pickFreeSlot (D18)', () => {
    const pick = (facility, extra = {}) =>
      pickFreeSlot(pool, {
        facilityId: facility.id,
        vehicleType: 'car',
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        now: new Date(),
        ...extra,
      });

    it('picks the least used slot of the last 30 days', async () => {
      const f = await newFacility();
      const u = await createUser();
      const a = await slotIn(f, 'A1');
      const b = await slotIn(f, 'A2');
      const c = await slotIn(f, 'A3');
      await past(u, a, 3);
      await past(u, a, 4);
      await past(u, b, 5);
      await past(u, c, 6);
      await past(u, c, 7);
      expect((await pick(f)).id).toBe(b.id);
    });

    it('breaks ties by code; ignores cancelled, older than 30 days and future bookings', async () => {
      const f = await newFacility();
      const u = await createUser();
      const a = await slotIn(f, 'B1');
      const b = await slotIn(f, 'B2');
      expect((await pick(f)).id).toBe(a.id); // no history: lowest code
      await past(u, a, 3, { status: 'cancelled' });
      await past(u, a, 40);
      await insertBookingRow({
        userId: u.user.id, slotId: a.id, startsAt: istIso(20, '10:00'), endsAt: istIso(20, '11:00'),
      });
      expect((await pick(f)).id).toBe(a.id); // none of those count
      await past(u, a, 2);
      expect((await pick(f)).id).toBe(b.id); // one real booking tips it
    });

    it('skips blocked, busy and wrong-type slots and honours excludeIds', async () => {
      const f = await newFacility();
      const u = await createUser();
      const blocked = await slotIn(f, 'C1', { isBlocked: true });
      const busy = await slotIn(f, 'C2');
      const bike = await slotIn(f, 'C3', { vehicleType: 'bike' });
      const free = await slotIn(f, 'C4');
      const free2 = await slotIn(f, 'C5');
      await insertBookingRow({ userId: u.user.id, slotId: busy.id, startsAt: istIso(5, '11:00'), endsAt: istIso(5, '13:00') });
      expect((await pick(f)).id).toBe(free.id);
      expect((await pick(f, { excludeIds: [free.id] })).id).toBe(free2.id);
      expect(await pick(f, { excludeIds: [free.id, free2.id] })).toBeUndefined();
      expect([blocked.id, bike.id]).not.toContain((await pick(f)).id);
      // back-to-back with the busy slot is free again
      expect((await pick(f, { startsAt: new Date(istIso(5, '13:00')), endsAt: new Date(istIso(5, '14:00')), excludeIds: [free.id, free2.id] })).id).toBe(busy.id);
    });
  });

  describe('createBooking', () => {
    it('creates booking, payment and qr_key together', async () => {
      const f = await newFacility();
      const u = await createUser();
      const slot = await slotIn(f, 'D1', { hourlyRate: 40, dailyRate: 300 });
      const row = await book(f, u, { vehicleNumber: 'dl 3c-ab 1234' });
      expect(row).toMatchObject({
        slot_id: slot.id, vehicle_number: 'DL3CAB1234', status: 'confirmed', amount: '80.00',
        payment_status: 'paid', payment_amount: '80.00', payment_provider: 'simulated',
      });
      expect(row.booking_code).toMatch(/^PK-[A-HJ-NP-Z2-9]{6}$/);
      expect(row.qr_key).toMatch(/^qr\/[a-f0-9]{32}\.png$/);
      expect(fs.existsSync(path.join(tmp, row.qr_key))).toBe(true);
    });

    it('explicit slot: 404 unknown, 409 blocked, 400 type mismatch, 400 rule violation', async () => {
      const f = await newFacility();
      const u = await createUser();
      const other = await newFacility();
      const blocked = await slotIn(f, 'E1', { isBlocked: true });
      const bike = await slotIn(f, 'E2', { vehicleType: 'bike' });
      const foreign = await slotIn(other, 'E3');
      const status = async (extra) => (await book(f, u, extra).catch((e) => e)).status;
      expect(await status({ slotId: 999999999 })).toBe(404);
      expect(await status({ slotId: foreign.id })).toBe(404); // another facility's slot
      expect(await status({ slotId: blocked.id })).toBe(409);
      expect(await status({ slotId: bike.id, vehicleType: 'car' })).toBe(400);
      expect(await status({ slotId: bike.id, vehicleType: undefined, hours: 0 })).toBe(400);
      expect(await status({ vehicleType: undefined })).toBe(400);
      expect(await status({ vehicleNumber: 'a1' })).toBe(400);
      expect(await count(f)).toBe(0);
      // matching type or omitted type is fine
      expect((await book(f, u, { slotId: bike.id, vehicleType: undefined })).slot_id).toBe(bike.id);
    });

    it('two concurrent auto-pick bookings on 2 slots both succeed on different slots', async () => {
      const f = await newFacility();
      await slotIn(f, 'F1');
      await slotIn(f, 'F2');
      const [u1, u2] = [await createUser(), await createUser()];
      const rows = await Promise.all([book(f, u1), book(f, u2)]);
      expect(new Set(rows.map((r) => r.slot_id)).size).toBe(2);
    });

    it('two concurrent bookings on 1 slot: one succeeds, one gets "No free slot of that type"', async () => {
      const f = await newFacility();
      await slotIn(f, 'G1');
      const [u1, u2] = [await createUser(), await createUser()];
      const results = await Promise.allSettled([book(f, u1), book(f, u2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected').reason;
      expect(failed).toBeInstanceOf(HttpError);
      expect(failed.status).toBe(409);
      expect(failed.message).toBe('No free slot of that type');
      expect(await count(f)).toBe(1);
    });

    it('two concurrent bookings of the same explicit slot: one succeeds, one gets the slot 409', async () => {
      const f = await newFacility();
      const slot = await slotIn(f, 'G2');
      const [u1, u2] = [await createUser(), await createUser()];
      const results = await Promise.allSettled([book(f, u1, { slotId: slot.id }), book(f, u2, { slotId: slot.id })]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected').reason;
      expect([failed.status, failed.message]).toEqual([409, 'This slot was just booked for that time']);
    });

    it('three concurrent bookings on 3 slots all succeed on different slots', async () => {
      const f = await newFacility();
      for (const code of ['H1', 'H2', 'H3']) await slotIn(f, code);
      const users = [await createUser(), await createUser(), await createUser()];
      const rows = await Promise.all(users.map((u) => book(f, u)));
      expect(new Set(rows.map((r) => r.slot_id)).size).toBe(3);
      expect(await count(f)).toBe(3);
    });

    it('the same vehicle overlapping gets the vehicle 409 and is not retried on another slot', async () => {
      const f = await newFacility();
      await slotIn(f, 'I1');
      await slotIn(f, 'I2');
      const [u1, u2] = [await createUser(), await createUser()];
      const v = plate();
      await book(f, u1, { vehicleNumber: v });
      const err = await book(f, u2, { vehicleNumber: v }).catch((e) => e);
      expect([err.status, err.message]).toEqual([409, 'This vehicle already has a booking at that time']);
      expect(await count(f)).toBe(1);
      // the same vehicle later the same day is fine
      const later = await book(f, u2, { vehicleNumber: v, startsAt: istIso(5, '12:00') });
      expect(later.status).toBe('confirmed');
    });

    it('retries on a booking-code clash and still succeeds', async () => {
      const f = await newFacility();
      const u = await createUser();
      const s = await slotIn(f, 'J1');
      const taken = generateBookingCode();
      await insertBookingRow({
        userId: u.user.id, slotId: s.id, startsAt: istIso(9, '10:00'), endsAt: istIso(9, '11:00'), bookingCode: taken,
      });
      let calls = 0;
      const generateCode = () => (++calls <= 2 ? taken : 'PK-ZZZZZZ');
      const row = await book(f, u, { generateCode });
      expect(row.booking_code).toBe('PK-ZZZZZZ');
      expect(calls).toBe(3);
      expect(row.payment_status).toBe('paid');
    });

    it('gives up after 5 clashing codes and leaves nothing behind', async () => {
      const f = await newFacility();
      const u = await createUser();
      const s = await slotIn(f, 'J2');
      const taken = generateBookingCode();
      await insertBookingRow({
        userId: u.user.id, slotId: s.id, startsAt: istIso(9, '10:00'), endsAt: istIso(9, '11:00'), bookingCode: taken,
      });
      const err = await book(f, u, { generateCode: () => taken }).catch((e) => e);
      expect(err.status).toBe(500);
      expect(await count(f)).toBe(1); // only the pre-inserted row
    });

    it('rolls back booking and payment when the QR cannot be stored', async () => {
      const f = await newFacility();
      const u = await createUser();
      await slotIn(f, 'K1');
      const original = config.storageDriver;
      config.storageDriver = 's3'; // getStorage() throws "not implemented"
      try {
        await expect(book(f, u)).rejects.toThrow();
      } finally {
        config.storageDriver = original;
      }
      expect(await count(f)).toBe(0);
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.user_id = $1',
        [u.user.id],
      );
      expect(rows[0].n).toBe(0);
    });

    it('D20: a 4th active booking gets 409; ended and cancelled ones do not count', async () => {
      const f = await newFacility();
      const u = await createUser();
      for (const code of ['L1', 'L2', 'L3', 'L4']) await slotIn(f, code);
      await past(u, await slotIn(f, 'L5'), 1, { status: 'confirmed' }); // missed (ended), not active
      await insertBookingRow({
        userId: u.user.id, slotId: (await slotIn(f, 'L6')).id, startsAt: istIso(8, '10:00'), endsAt: istIso(8, '11:00'), status: 'cancelled',
      });
      for (const day of [5, 6, 7]) await book(f, u, { startsAt: istIso(day, '10:00') });
      const err = await book(f, u, { startsAt: istIso(8, '10:00') }).catch((e) => e);
      expect([err.status, err.message]).toEqual([409, 'You already have 3 active bookings']);
    });

    it('D20: concurrent bookings by one customer cannot pass the limit', async () => {
      const f = await newFacility();
      const u = await createUser();
      for (const code of ['M1', 'M2', 'M3', 'M4', 'M5']) await slotIn(f, code);
      const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => book(f, u)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect(r.reason.message).toBe('You already have 3 active bookings');
      }
    });
  });

  describe('state changes', () => {
    const admin = { id: 0, role: 'admin' };

    async function confirmed(extra = {}) {
      const u = await createUser();
      const s = await createSlot();
      const row = await insertBookingRow({
        userId: u.user.id, slotId: s.id, startsAt: istIso(5, '10:00'), endsAt: istIso(5, '12:00'),
        bookingCode: generateBookingCode(), ...extra,
      });
      return { u, row };
    }

    it('concurrent cancels: exactly one wins and the payment is refunded once', async () => {
      const { u, row } = await confirmed();
      const viewer = { id: u.user.id, role: 'customer' };
      const results = await Promise.allSettled([
        cancelBooking({ code: row.booking_code, viewer }),
        cancelBooking({ code: row.booking_code, viewer }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected').reason.status).toBe(409);
      const b = await findBookingByCode(row.booking_code);
      expect([b.status, b.payment_status]).toEqual(['cancelled', 'refunded']);
    });

    it('concurrent check-ins: exactly one wins', async () => {
      const now = new Date();
      const { row } = await confirmed({
        startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() + 3_600_000),
      });
      const results = await Promise.allSettled([
        checkInBooking({ code: row.booking_code }),
        checkInBooking({ code: row.booking_code }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected').reason.status).toBe(409);
    });

    it('concurrent check-outs: exactly one wins', async () => {
      const now = new Date();
      const { row } = await confirmed({
        startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() + 3_600_000),
        status: 'checked_in', checkedInAt: now,
      });
      const results = await Promise.allSettled([
        checkOutBooking({ code: row.booking_code }),
        checkOutBooking({ code: row.booking_code }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('cancel races with check-in: the loser gets 409 and the payment matches the winner', async () => {
      const now = new Date();
      const { row } = await confirmed({
        startsAt: new Date(now.getTime() - 600_000), endsAt: new Date(now.getTime() + 3_600_000),
      });
      const results = await Promise.allSettled([
        cancelBooking({ code: row.booking_code, viewer: admin }),
        checkInBooking({ code: row.booking_code }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const b = await findBookingByCode(row.booking_code);
      expect(b.payment_status).toBe(b.status === 'cancelled' ? 'refunded' : 'paid');
    });

    it('malformed codes are 404', async () => {
      await expect(checkInBooking({ code: 'nope' })).rejects.toMatchObject({ status: 404 });
      await expect(checkOutBooking({ code: 'PK-000000' })).rejects.toMatchObject({ status: 404 });
    });
  });
});
