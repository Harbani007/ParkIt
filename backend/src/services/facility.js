import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';

const hhmm = (t) => String(t).slice(0, 5);

export function facilityId() {
  return config.facilityId ?? 1;
}

// The API serves one facility (A2). Times are returned as HH:MM. Only Asia/Kolkata is supported (A1).
export async function getFacility(db = pool) {
  const { rows } = await db.query(
    `SELECT id, name, address, opens_at, closes_at, timezone, max_advance_days
       FROM facilities WHERE id = $1`,
    [facilityId()],
  );
  if (!rows[0]) throw new HttpError(500, 'Facility not configured');
  const f = rows[0];
  if (f.timezone !== 'Asia/Kolkata') throw new HttpError(500, `Unsupported facility timezone: ${f.timezone}`);
  return { ...f, opens_at: hhmm(f.opens_at), closes_at: hhmm(f.closes_at) };
}
