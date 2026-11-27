import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';

const hhmm = (t) => String(t).slice(0, 5);

/** The default space (the original single facility), used when a request names none. */
export function facilityId() {
  return config.facilityId ?? 1;
}

const COLUMNS = `id, name, address, locality, city, owner_id, is_listed, opens_at, closes_at, timezone, max_advance_days`;

function shape(f) {
  if (f.timezone !== 'Asia/Kolkata') throw new HttpError(500, `Unsupported facility timezone: ${f.timezone}`);
  return { ...f, opens_at: hhmm(f.opens_at), closes_at: hhmm(f.closes_at) };
}

/**
 * A space (facility) with every column, including the house address and owner. Times as HH:MM.
 * Only Asia/Kolkata is supported (A1). Unknown id → 404 (500 for the configured default).
 */
export async function getFacility(id = facilityId(), db = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM facilities WHERE id = $1`, [id]);
  if (!rows[0]) {
    if (Number(id) === Number(facilityId())) throw new HttpError(500, 'Facility not configured');
    throw new HttpError(404, 'Space not found');
  }
  return shape(rows[0]);
}

const SPACE_SELECT = `
  SELECT f.id, f.name, f.address, f.locality, f.city, f.owner_id, f.is_listed, f.opens_at, f.closes_at,
         f.timezone, f.max_advance_days,
         count(s.id) FILTER (WHERE NOT s.is_blocked)::int AS slot_count,
         COALESCE(array_agg(DISTINCT s.vehicle_type) FILTER (WHERE NOT s.is_blocked), '{}') AS vehicle_types,
         min(s.hourly_rate) FILTER (WHERE NOT s.is_blocked)::text AS from_hourly_rate
    FROM facilities f
    LEFT JOIN slots s ON s.facility_id = f.id`;

/** Public space JSON (D23): never the house address or the owner. */
export function publicSpace(row) {
  const f = shape(row);
  return {
    id: f.id,
    name: f.name,
    locality: f.locality,
    city: f.city,
    opens_at: f.opens_at,
    closes_at: f.closes_at,
    timezone: f.timezone,
    max_advance_days: f.max_advance_days,
    slot_count: f.slot_count ?? 0,
    vehicle_types: [...(f.vehicle_types ?? [])].sort(),
    from_hourly_rate: f.from_hourly_rate ?? null,
  };
}

/** Host / admin space JSON: the public fields plus the address and listing flag. */
export function hostSpace(row) {
  return { ...publicSpace(row), address: row.address, is_listed: row.is_listed };
}

/** D23: listed spaces with at least one unblocked slot, matching `q` on locality, city or name. */
export async function searchSpaces({ q, vehicleType }) {
  const term = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await pool.query(
    `${SPACE_SELECT}
      WHERE f.is_listed
        AND ($1::text IS NULL OR f.locality ILIKE $1 OR f.city ILIKE $1 OR f.name ILIKE $1)
      GROUP BY f.id
     HAVING count(s.id) FILTER (WHERE NOT s.is_blocked AND ($2::text IS NULL OR s.vehicle_type = $2)) > 0
      ORDER BY f.locality NULLS LAST, f.name`,
    [term, vehicleType ?? null],
  );
  return rows;
}

/** One space with its slot summary, or undefined. */
export async function findSpace(id) {
  const { rows } = await pool.query(`${SPACE_SELECT} WHERE f.id = $1 GROUP BY f.id`, [id]);
  return rows[0];
}

export async function listOwnedSpaces(ownerId) {
  const { rows } = await pool.query(`${SPACE_SELECT} WHERE f.owner_id = $1 GROUP BY f.id ORDER BY f.id`, [ownerId]);
  return rows;
}
