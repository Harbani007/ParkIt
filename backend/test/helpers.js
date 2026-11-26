// Shared helpers for DB-backed integration tests. Importing this module probes the database;
// tests use `describe.skipIf(!dbUp)`. In CI a missing database is a failure, not a skip.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';
import { signToken } from '../src/middleware/auth.js';

export { pool };

export let dbUp = false;
try {
  await pool.query('SELECT 1 FROM bookings LIMIT 0');
  dbUp = true;
} catch (err) {
  if (process.env.CI) throw new Error(`integration tests need the CI database: ${err.message}`);
  console.warn(`integration tests skipped: database not ready (${err.message}). Run "npm run migrate".`);
  await pool.end();
}

export const uniq = () => `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

// Rows created through the helpers are tracked so cleanup() can delete them.
export const tracker = {
  userIds: [],
  slotIds: [],
  bookingIds: [],
  // FK-safe order: payments, bookings (slot_id and user_id are RESTRICT), then users and slots.
  async cleanup() {
    const { userIds, slotIds, bookingIds } = this;
    await pool.query(
      `DELETE FROM payments WHERE booking_id IN (
         SELECT id FROM bookings WHERE id = ANY($1::int[]) OR user_id = ANY($2::int[]) OR slot_id = ANY($3::int[]))`,
      [bookingIds, userIds, slotIds],
    );
    await pool.query(
      `DELETE FROM bookings WHERE id = ANY($1::int[]) OR user_id = ANY($2::int[]) OR slot_id = ANY($3::int[])`,
      [bookingIds, userIds, slotIds],
    );
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
    await pool.query('DELETE FROM slots WHERE id = ANY($1::int[])', [slotIds]);
    this.userIds = [];
    this.slotIds = [];
    this.bookingIds = [];
  },
};

// Same as the seed: facility 1 exists, and the id sequence is moved past it.
export async function ensureFacility() {
  await pool.query(
    `INSERT INTO facilities (id, name, address) VALUES (1, 'ParkIt Residency', 'New Delhi')
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(
    `SELECT setval(pg_get_serial_sequence('facilities', 'id'), (SELECT max(id) FROM facilities))`,
  );
  return 1;
}

export async function createUser({ role = 'customer', password = 'password123', name = 'Test User' } = {}) {
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role`,
    [name, `t-${uniq()}@example.com`, hash, role],
  );
  const user = rows[0];
  tracker.userIds.push(user.id);
  return { user, token: signToken(user), password };
}

export async function createSlot({
  facilityId = 1,
  vehicleType = 'car',
  hourlyRate = 40,
  dailyRate = 300,
  isBlocked = false,
  code,
} = {}) {
  const { rows } = await pool.query(
    `INSERT INTO slots (facility_id, code, vehicle_type, hourly_rate, daily_rate, is_blocked)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [facilityId, code ?? `T-${randomBytes(4).toString('hex').toUpperCase()}`, vehicleType, hourlyRate, dailyRate, isBlocked],
  );
  tracker.slotIds.push(rows[0].id);
  return rows[0];
}

// Inserts a booking and its payment directly. startsAt/endsAt are Date or ISO strings.
export async function insertBookingRow({
  userId,
  slotId,
  vehicleNumber = `KA${randomBytes(4).toString('hex').toUpperCase()}`,
  startsAt,
  endsAt,
  status = 'confirmed',
  amount = '40.00',
  paymentStatus = status === 'cancelled' ? 'refunded' : 'paid',
  bookingCode,
  checkedInAt = null,
  checkedOutAt = null,
}) {
  const code = bookingCode ?? `PK-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
  const { rows } = await pool.query(
    `INSERT INTO bookings (booking_code, user_id, slot_id, vehicle_number, starts_at, ends_at, amount, status,
                           checked_in_at, checked_out_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [code, userId, slotId, vehicleNumber, startsAt, endsAt, amount, status, checkedInAt, checkedOutAt],
  );
  const booking = rows[0];
  tracker.bookingIds.push(booking.id);
  await pool.query('INSERT INTO payments (booking_id, amount, status) VALUES ($1, $2, $3)', [
    booking.id,
    amount,
    paymentStatus,
  ]);
  return booking;
}

// ISO (UTC) string for `HH:MM` IST on the IST date `daysAhead` days from today.
export function istIso(daysAhead, hhmm, now = new Date()) {
  const shifted = new Date(now.getTime() + 330 * 60000);
  shifted.setUTCDate(shifted.getUTCDate() + daysAhead);
  const date = shifted.toISOString().slice(0, 10);
  return new Date(`${date}T${hhmm}:00+05:30`).toISOString();
}
