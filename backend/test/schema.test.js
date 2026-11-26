// Integration tests for the database constraints (migrations 001 + 002).
// Cases 1-8 run in a transaction that is rolled back; case 9 commits for real and cleans up.
// Uses DATABASE_URL (same default as src/config.js: the local Docker DB on port 5433).
// The suite is skipped when the database cannot be reached.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { config } from '../src/config.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 4,
  connectionTimeoutMillis: 5000,
});

let dbUp = false;
try {
  await pool.query('SELECT 1 FROM bookings LIMIT 0');
  dbUp = true;
} catch (err) {
  // In CI the database is part of the job, so a missing one is a failure, not a reason to skip.
  if (process.env.CI) throw new Error(`schema tests need the CI database: ${err.message}`);
  console.warn(`schema tests skipped: database not ready (${err.message}). Run "npm run migrate".`);
  await pool.end();
}

const HOUR = 3600 * 1000;
const base = new Date('2030-01-01T10:00:00Z').getTime();
const at = (h) => new Date(base + h * HOUR).toISOString();
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function createFixture(db, slotCount = 1) {
  const f = await db.query(`INSERT INTO facilities (name) VALUES ('Test facility') RETURNING id`);
  const u = await db.query(
    `INSERT INTO users (name, email, password_hash) VALUES ('Tester', $1, 'x') RETURNING id`,
    [`t-${uniq()}@example.com`],
  );
  const slotIds = [];
  for (let i = 0; i < slotCount; i++) {
    const s = await db.query(
      `INSERT INTO slots (facility_id, code, hourly_rate, daily_rate) VALUES ($1, $2, 40, 300) RETURNING id`,
      [f.rows[0].id, `T-${uniq()}`],
    );
    slotIds.push(s.rows[0].id);
  }
  return { facilityId: f.rows[0].id, userId: u.rows[0].id, slotIds };
}

function insertBooking(db, { userId, slotId, vehicle, from, to, status = 'confirmed' }) {
  return db.query(
    `INSERT INTO bookings (booking_code, user_id, slot_id, vehicle_number, starts_at, ends_at, amount, status)
     VALUES ($1, $2, $3, $4, $5, $6, 40, $7) RETURNING id`,
    [`PK-${uniq()}`, userId, slotId, vehicle, at(from), at(to), status],
  );
}

// Runs a statement inside a savepoint so an expected error does not abort the transaction.
// Returns the pg error (code and constraint name), or null when the statement succeeded.
async function pgError(db, fn) {
  await db.query('SAVEPOINT sp');
  try {
    await fn();
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT sp');
    return { code: err.code, constraint: err.constraint };
  }
  await db.query('RELEASE SAVEPOINT sp');
  return null;
}
const errorCode = async (db, fn) => (await pgError(db, fn))?.code ?? null;

describe.skipIf(!dbUp)('database schema constraints', () => {
  afterAll(async () => {
    await pool.end();
  });

  describe('inside a rolled-back transaction', () => {
    let db;
    let fx;

    beforeEach(async () => {
      db = await pool.connect();
      await db.query('BEGIN');
      fx = await createFixture(db, 2);
    });

    afterEach(async () => {
      await db.query('ROLLBACK');
      db.release();
    });

    it('1. rejects overlapping confirmed bookings on the same slot (23P01)', async () => {
      const slotId = fx.slotIds[0];
      await insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0001', from: 0, to: 2 });
      const err = await pgError(db, () =>
        insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0002', from: 1, to: 3 }),
      );
      expect(err).toEqual({ code: '23P01', constraint: 'bookings_no_slot_overlap' });
    });

    it('1b. a checked_in booking also holds the slot; a completed one frees it', async () => {
      const slotId = fx.slotIds[0];
      await insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0001', from: 0, to: 2, status: 'checked_in' });
      const blocked = await pgError(db, () =>
        insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0002', from: 1, to: 3 }),
      );
      expect(blocked?.constraint).toBe('bookings_no_slot_overlap');

      await insertBooking(db, { userId: fx.userId, slotId: fx.slotIds[1], vehicle: 'KA01AA0003', from: 0, to: 2, status: 'completed' });
      const freed = await pgError(db, () =>
        insertBooking(db, { userId: fx.userId, slotId: fx.slotIds[1], vehicle: 'KA01AA0003', from: 1, to: 3 }),
      );
      expect(freed).toBeNull();
    });

    it('2. allows an overlap with a cancelled booking', async () => {
      const slotId = fx.slotIds[0];
      await insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0001', from: 0, to: 2, status: 'cancelled' });
      const code = await errorCode(db, () =>
        insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0002', from: 1, to: 3 }),
      );
      expect(code).toBeNull();
    });

    it('3. allows back-to-back bookings', async () => {
      const slotId = fx.slotIds[0];
      await insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0001', from: 0, to: 2 });
      const code = await errorCode(db, () =>
        insertBooking(db, { userId: fx.userId, slotId, vehicle: 'KA01AA0002', from: 2, to: 4 }),
      );
      expect(code).toBeNull();
    });

    it('4. rejects a second payment for the same booking (23505)', async () => {
      const { rows } = await insertBooking(db, { userId: fx.userId, slotId: fx.slotIds[0], vehicle: 'KA01AA0001', from: 0, to: 1 });
      const pay = () => db.query('INSERT INTO payments (booking_id, amount) VALUES ($1, 40)', [rows[0].id]);
      expect(await errorCode(db, pay)).toBeNull();
      expect(await errorCode(db, pay)).toBe('23505');
    });

    it('5. rejects a mixed-case email (23514)', async () => {
      const code = await errorCode(db, () =>
        db.query(`INSERT INTO users (name, email, password_hash) VALUES ('X', $1, 'x')`, [`Mixed-${uniq()}@Example.com`]),
      );
      expect(code).toBe('23514');
    });

    it('6. rejects closes_at <= opens_at (23514)', async () => {
      const insert = (opens, closes) => () =>
        db.query(`INSERT INTO facilities (name, opens_at, closes_at) VALUES ('Bad', $1, $2)`, [opens, closes]);
      expect(await errorCode(db, insert('10:00', '10:00'))).toBe('23514');
      expect(await errorCode(db, insert('10:00', '09:00'))).toBe('23514');
      expect(
        await errorCode(db, () => db.query(`UPDATE facilities SET closes_at = '05:00' WHERE id = $1`, [fx.facilityId])),
      ).toBe('23514');
    });

    it('7. rejects the same vehicle on two slots at overlapping times (23P01)', async () => {
      await insertBooking(db, { userId: fx.userId, slotId: fx.slotIds[0], vehicle: 'KA01AA0001', from: 0, to: 2 });
      const err = await pgError(db, () =>
        insertBooking(db, { userId: fx.userId, slotId: fx.slotIds[1], vehicle: 'KA01AA0001', from: 1, to: 3 }),
      );
      expect(err).toEqual({ code: '23P01', constraint: 'bookings_no_vehicle_overlap' });
    });

    it('8. rejects vehicle numbers with lowercase letters or spaces (23514)', async () => {
      for (const vehicle of ['ka01aa0001', 'KA 01 AA 0001', 'AB1']) {
        const code = await errorCode(db, () =>
          insertBooking(db, { userId: fx.userId, slotId: fx.slotIds[0], vehicle, from: 0, to: 1 }),
        );
        expect(code, vehicle).toBe('23514');
      }
    });

    it('8b. rejects an end before the start and negative amounts (23514)', async () => {
      const backwards = await errorCode(db, () =>
        insertBooking(db, { userId: fx.userId, slotId: fx.slotIds[0], vehicle: 'KA01AA0001', from: 2, to: 1 }),
      );
      expect(backwards).toBe('23514');
      const negative = await pgError(db, () =>
        db.query(
          `INSERT INTO bookings (booking_code, user_id, slot_id, vehicle_number, starts_at, ends_at, amount)
           VALUES ($1, $2, $3, 'KA01AA0001', $4, $5, -1)`,
          [`PK-${uniq()}`, fx.userId, fx.slotIds[0], at(0), at(1)],
        ),
      );
      expect(negative).toEqual({ code: '23514', constraint: 'bookings_amount_nonnegative' });
      const advance = await pgError(db, () =>
        db.query('UPDATE facilities SET max_advance_days = 0 WHERE id = $1', [fx.facilityId]),
      );
      expect(advance).toEqual({ code: '23514', constraint: 'facilities_max_advance_days_range' });
    });
  });

  describe('real concurrency', () => {
    let fx;

    beforeAll(async () => {
      fx = await createFixture(pool);
    });

    afterAll(async () => {
      // bookings first (slot_id and user_id are RESTRICT), then the facility cascades to slots.
      await pool.query('DELETE FROM bookings WHERE user_id = $1', [fx.userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [fx.userId]);
      await pool.query('DELETE FROM facilities WHERE id = $1', [fx.facilityId]);
    });

    it('9. two simultaneous overlapping bookings: one commits, the other gets 23P01', async () => {
      const slotId = fx.slotIds[0];
      const attempt = async (vehicle) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await insertBooking(c, { userId: fx.userId, slotId, vehicle, from: 0, to: 2 });
          await c.query('COMMIT');
          return { ok: true };
        } catch (err) {
          await c.query('ROLLBACK');
          return { ok: false, code: err.code, constraint: err.constraint };
        } finally {
          c.release();
        }
      };

      const results = await Promise.all([attempt('KA01BB0001'), attempt('KA01BB0002')]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const failed = results.filter((r) => !r.ok);
      expect(failed).toHaveLength(1);
      expect(failed[0].code).toBe('23P01');
      expect(failed[0].constraint).toBe('bookings_no_slot_overlap');
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM bookings WHERE slot_id = $1', [slotId]);
      expect(rows[0].n).toBe(1);
    });
  });
});
