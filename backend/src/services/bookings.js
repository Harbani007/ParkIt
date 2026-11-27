import { pool } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { CONSTRAINTS, mapPgError } from '../db/errors.js';
import { HttpError } from '../middleware/errors.js';
import { checkBookingWindow } from '../lib/rules.js';
import { priceFor } from '../lib/pricing.js';
import { normaliseVehicleNumber } from '../lib/vehicle.js';
import { generateBookingCode } from '../lib/bookingCode.js';
import { canCancel, deriveStatus, isOverstayed, isValidBookingCode } from '../lib/bookingState.js';
import { addDays, istToUtc } from '../lib/time.js';
import { prepareQr } from './qr.js';
import { getStorage } from './storage.js';

export const MAX_ACTIVE_BOOKINGS = 3; // D20
const CODE_ATTEMPTS = 5;
export const DEADLOCK_RETRIES = 3;
// Namespace for pg_advisory_xact_lock(int, int); the second key is the facility id.
const FACILITY_LOCK_NS = 7001;

const notFound = () => new HttpError(404, 'Booking not found');

/** Booking codes in URLs are case-insensitive; anything malformed is a 404 (A8). */
export function parseBookingCode(param) {
  const code = String(param ?? '').toUpperCase();
  if (!isValidBookingCode(code)) throw notFound();
  return code;
}

// ---------------------------------------------------------------- reading

const BOOKING_SELECT = `
  SELECT b.*, s.code AS slot_code, s.vehicle_type AS slot_vehicle_type,
         p.amount AS payment_amount, p.status AS payment_status, p.provider AS payment_provider,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         f.id AS space_id, f.name AS space_name, f.locality AS space_locality, f.city AS space_city,
         f.address AS space_address
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    JOIN facilities f ON f.id = s.facility_id
    JOIN users u ON u.id = b.user_id
    LEFT JOIN payments p ON p.booking_id = b.id`;

/** Booking joined with slot, payment and customer, or undefined. `db` is the pool or a client. */
export async function findBookingByCode(code, db = pool) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.booking_code = $1`, [code]);
  return rows[0];
}

const iso = (t) => (t == null ? null : new Date(t).toISOString());

/** Booking JSON exactly as docs/api.md. viewer = { id, role }. */
export async function toBookingJson(row, { viewer, now = new Date(), includeCustomer = false }) {
  const status = deriveStatus(row, now);
  const qrUrl = row.status === 'cancelled' || !row.qr_key ? null : await getStorage().getUrl(row.qr_key);
  const json = {
    booking_code: row.booking_code,
    status,
    slot: { id: row.slot_id, code: row.slot_code, vehicle_type: row.slot_vehicle_type },
    space: {
      id: row.space_id,
      name: row.space_name,
      locality: row.space_locality,
      city: row.space_city,
      address: row.space_address,
    },
    vehicle_number: row.vehicle_number,
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    hours: Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 3_600_000),
    amount: row.amount,
    can_cancel: canCancel(row, viewer, now),
    overstayed: isOverstayed(row, now),
    payment: row.payment_status
      ? { amount: row.payment_amount, status: row.payment_status, provider: row.payment_provider }
      : null,
    qr_url: qrUrl,
    checked_in_at: iso(row.checked_in_at),
    checked_out_at: iso(row.checked_out_at),
    cancelled_at: iso(row.cancelled_at),
    created_at: iso(row.created_at),
  };
  if (includeCustomer) {
    json.customer = { name: row.customer_name, email: row.customer_email, phone: row.customer_phone };
  }
  return json;
}

// "Active" for the customer list (A8): confirmed and not ended, or still checked in.
const ACTIVE_PREDICATE = `(b.status = 'checked_in' OR (b.status = 'confirmed' AND b.ends_at > $2::timestamptz))`;

export async function listMine({ userId, scope, now }) {
  const sql =
    scope === 'past'
      ? `${BOOKING_SELECT} WHERE b.user_id = $1 AND NOT ${ACTIVE_PREDICATE} ORDER BY b.starts_at DESC, b.id DESC`
      : `${BOOKING_SELECT} WHERE b.user_id = $1 AND ${ACTIVE_PREDICATE} ORDER BY b.starts_at ASC, b.id ASC`;
  const { rows } = await pool.query(sql, [userId, now]);
  return rows;
}

/** Bookings starting on an IST date, optionally filtered by (derived) status. facilityId null = every space. */
export async function listForDay({ date, status, now, facilityId }) {
  const from = istToUtc(date, '00:00');
  const to = istToUtc(addDays(date, 1), '00:00');
  const { rows } = await pool.query(
    `${BOOKING_SELECT}
      WHERE ($1::int IS NULL OR s.facility_id = $1) AND b.starts_at >= $2 AND b.starts_at < $3
      ORDER BY b.starts_at, b.id`,
    [facilityId ?? null, from, to],
  );
  return status ? rows.filter((r) => deriveStatus(r, now) === status) : rows;
}

// ---------------------------------------------------------------- creating

/**
 * D18: the free, unblocked slot of the type with the fewest non-cancelled bookings starting in
 * [now - 30 days, now); ties by code. `excludeIds` are slots already tried. Returns a slot row or undefined.
 */
export async function pickFreeSlot(client, { facilityId, vehicleType, startsAt, endsAt, excludeIds = [], now }) {
  const { rows } = await client.query(
    `SELECT s.id, s.code, s.vehicle_type, s.hourly_rate, s.daily_rate
       FROM slots s
      WHERE s.facility_id = $1 AND s.vehicle_type = $2 AND NOT s.is_blocked
        AND NOT (s.id = ANY($5::int[]))
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
           WHERE b.slot_id = s.id AND b.status IN ('confirmed', 'checked_in')
             AND tstzrange(b.starts_at, b.ends_at) && tstzrange($3::timestamptz, $4::timestamptz))
      ORDER BY (SELECT count(*) FROM bookings u
                 WHERE u.slot_id = s.id AND u.status <> 'cancelled'
                   AND u.starts_at >= $6::timestamptz - interval '30 days'
                   AND u.starts_at < $6::timestamptz),
               s.code
      LIMIT 1`,
    [facilityId, vehicleType, startsAt, endsAt, excludeIds, now],
  );
  return rows[0];
}

// Runs fn inside a savepoint so a failed statement does not abort the whole transaction.
// Savepoint names are constants, never user input.
async function withSavepoint(client, name, fn) {
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    throw err;
  }
}

// Inserts the booking with the pre-drawn code. A code clash surfaces as 23505 on
// bookings_booking_code_key; createBooking then draws a new code (and QR) and starts over (D14).
export async function insertBooking(client, { code, userId, slotId, vehicleNumber, startsAt, endsAt, amount }) {
  const { rows } = await client.query(
    `INSERT INTO bookings (booking_code, user_id, slot_id, vehicle_number, starts_at, ends_at, amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, booking_code`,
    [code, userId, slotId, vehicleNumber, startsAt, endsAt, amount],
  );
  return rows[0];
}

const isCodeClash = (err) => err.code === '23505' && err.constraint === CONSTRAINTS.BOOKING_CODE;

// Re-reads the chosen slot inside the transaction and shares-locks it, so a concurrent admin
// block / type change / rate change cannot slip in between the checks and the insert (D12, D16).
async function loadExplicitSlot(client, { facilityId, slotId, vehicleType }) {
  const { rows } = await client.query(
    `SELECT id, code, vehicle_type, hourly_rate, daily_rate, is_blocked
       FROM slots WHERE id = $1 AND facility_id = $2 FOR SHARE`,
    [slotId, facilityId],
  );
  const slot = rows[0];
  if (!slot) throw new HttpError(404, 'Slot not found');
  if (slot.is_blocked) throw new HttpError(409, 'Slot is blocked');
  if (vehicleType && vehicleType !== slot.vehicle_type) {
    throw new HttpError(400, `Slot ${slot.code} is for ${slot.vehicle_type}s, not ${vehicleType}s`);
  }
  return slot;
}

/**
 * Creates the booking, its simulated paid payment and its QR.
 * Returns the booking row (joined, see findBookingByCode). Throws HttpError.
 * `insert` is a test seam for the booking INSERT (default: insertBooking).
 */
export async function createBooking({
  facility,
  userId,
  slotId,
  vehicleType,
  startsAt,
  hours,
  vehicleNumber,
  now = new Date(),
  generateCode = generateBookingCode,
  insert = insertBooking,
}) {
  const window = checkBookingWindow({ startsAt, hours, facility, now });
  const plate = normaliseVehicleNumber(vehicleNumber);
  const explicit = slotId != null;
  if (!explicit && !vehicleType) throw new HttpError(400, 'Choose a slot or a vehicle type');
  if (facility.owner_id != null && String(facility.owner_id) === String(userId)) {
    throw new HttpError(409, 'You cannot book your own space'); // D24
  }

  // The QR holds the booking code, so the code is drawn first and the PNG is rendered and stored
  // before the transaction: no storage I/O happens while row or advisory locks are held.
  // A code clash (D14) discards that QR and starts over with a new code.
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const qrKey = await prepareQr(code);
    try {
      return await runCreate({ code, qrKey, facility, userId, slotId, vehicleType, window, hours, plate, now, explicit, insert });
    } catch (err) {
      await getStorage().delete(qrKey).catch(() => {}); // best effort; an orphan file is harmless
      if (isCodeClash(err)) continue;
      throw mapPgError(err);
    }
  }
  throw new HttpError(500, 'Could not generate a unique booking code');
}

function runCreate({ code, qrKey, facility, userId, slotId, vehicleType, window, hours, plate, now, explicit, insert }) {
  return withTransaction(async (client) => {
    // Bookings of one facility are serialized for the few ms of this transaction. Concurrent
    // auto-pick inserts otherwise deadlock inside Postgres (exclusion constraints insert their
    // index entry before checking). Fine for a single facility; with many facilities the lock is
    // per facility id, so they would not block each other.
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [FACILITY_LOCK_NS, facility.id]);

    // D20: lock the customer row so concurrent bookings by one customer queue up and the
    // count below cannot be raced past the limit.
    const locked = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!locked.rows[0]) throw new HttpError(401, 'Account no longer exists');
    const active = await client.query(
      `SELECT count(*)::int AS n FROM bookings
        WHERE user_id = $1 AND status = 'confirmed' AND ends_at > $2::timestamptz`,
      [userId, now],
    );
    if (active.rows[0].n >= MAX_ACTIVE_BOOKINGS) {
      throw new HttpError(409, `You already have ${MAX_ACTIVE_BOOKINGS} active bookings`);
    }

    const fixedSlot = explicit ? await loadExplicitSlot(client, { facilityId: facility.id, slotId, vehicleType }) : null;

    // The slot is the explicit one, or the best free candidate. Under the facility lock a
    // candidate should not be lost to another booking; the 23P01 / 40P01 handling stays as a
    // backstop (e.g. for bookings inserted by other means). A deadlock loser is retried.
    const tried = [];
    let deadlocks = 0;
    let inserted;
    for (;;) {
      const slot =
        fixedSlot ??
        (await pickFreeSlot(client, {
          facilityId: facility.id,
          vehicleType,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          excludeIds: tried,
          now,
        }));
      if (!slot) throw new HttpError(409, 'No free slot of that type');
      try {
        inserted = await withSavepoint(client, 'sp_slot', () =>
          insert(client, {
            code,
            userId,
            slotId: slot.id,
            vehicleNumber: plate,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            amount: priceFor(hours, slot.hourly_rate, slot.daily_rate),
          }),
        );
        break;
      } catch (err) {
        if (err.code === '40P01') {
          if (++deadlocks > DEADLOCK_RETRIES) throw new HttpError(409, 'Slot is busy, please try again');
          continue;
        }
        if (!explicit && err.code === '23P01' && err.constraint === CONSTRAINTS.SLOT_OVERLAP) {
          tried.push(slot.id);
          continue;
        }
        throw err; // includes code clashes and bookings_no_vehicle_overlap, never retried here
      }
    }

    await client.query(
      `INSERT INTO payments (booking_id, amount, status, provider)
       SELECT id, amount, 'paid', 'simulated' FROM bookings WHERE id = $1`,
      [inserted.id],
    );
    await client.query('UPDATE bookings SET qr_key = $2 WHERE id = $1', [inserted.id, qrKey]);
    return findBookingByCode(inserted.booking_code, client);
  });
}

// ---------------------------------------------------------------- state changes
// Each change is one conditional UPDATE (WHERE status = ...), so two racing requests cannot both win.
// When it matches nothing, the row is re-read to explain why (404 or 409).

const ownsOrAdmin = (row, viewer) => viewer.role === 'admin' || String(row.user_id) === String(viewer.id);

/** Loads a booking for a viewer; someone else's booking is a 404 (D19). */
export async function getBookingFor(code, viewer, db = pool) {
  const row = await findBookingByCode(parseBookingCode(code), db);
  if (!row || !ownsOrAdmin(row, viewer)) throw notFound();
  return row;
}

function cancelRefusal(row, viewer, now) {
  if (row.status !== 'confirmed') return new HttpError(409, 'Only confirmed bookings can be cancelled');
  if (new Date(row.ends_at) <= now) return new HttpError(409, 'This booking was missed and can no longer be cancelled');
  if (viewer.role !== 'admin') {
    return new HttpError(409, 'Bookings can be cancelled until 2 hours before the start');
  }
  return new HttpError(409, 'This booking can no longer be cancelled');
}

/** D8: customer until starts_at - 2 h; admin until ends_at. Refunds the payment. Returns the booking row. */
export async function cancelBooking({ code, viewer, now = new Date() }) {
  const before = await getBookingFor(code, viewer);
  const isAdmin = viewer.role === 'admin';
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = $2::timestamptz
        WHERE id = $1 AND status = 'confirmed' AND ends_at > $2::timestamptz
          AND ($3::boolean OR starts_at >= $2::timestamptz + interval '2 hours')`,
      [before.id, now, isAdmin],
    );
    if (rowCount === 0) {
      const current = (await findBookingByCode(before.booking_code, client)) ?? before;
      throw cancelRefusal(current, viewer, now);
    }
    await client.query(
      `UPDATE payments SET status = 'refunded', refunded_at = $2::timestamptz
        WHERE booking_id = $1 AND status = 'paid'`,
      [before.id, now],
    );
    return findBookingByCode(before.booking_code, client);
  });
}

/** D10 check-in: confirmed and starts_at - 15 min <= now < ends_at. */
export async function checkInBooking({ code, now = new Date() }) {
  const parsed = parseBookingCode(code);
  const { rowCount } = await pool.query(
    `UPDATE bookings SET status = 'checked_in', checked_in_at = $2::timestamptz
      WHERE booking_code = $1 AND status = 'confirmed'
        AND starts_at - interval '15 minutes' <= $2::timestamptz AND ends_at > $2::timestamptz`,
    [parsed, now],
  );
  const row = await findBookingByCode(parsed);
  if (!row) throw notFound();
  if (rowCount === 0) {
    if (row.status !== 'confirmed') throw new HttpError(409, 'Only confirmed bookings can be checked in');
    if (new Date(row.ends_at) <= now) throw new HttpError(409, 'This booking was missed and can no longer be checked in');
    throw new HttpError(409, 'Too early: check-in opens 15 minutes before the start');
  }
  return row;
}

/** D10 check-out: any checked_in booking; overstay is derived from checked_out_at. */
export async function checkOutBooking({ code, now = new Date() }) {
  const parsed = parseBookingCode(code);
  const { rowCount } = await pool.query(
    `UPDATE bookings SET status = 'completed', checked_out_at = $2::timestamptz
      WHERE booking_code = $1 AND status = 'checked_in'`,
    [parsed, now],
  );
  const row = await findBookingByCode(parsed);
  if (!row) throw notFound();
  if (rowCount === 0) throw new HttpError(409, 'Only checked-in bookings can be checked out');
  return row;
}
