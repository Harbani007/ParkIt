// Seeds one facility, a few slots and a dev admin account. Safe to re-run.
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

const DEV_ADMIN_PASSWORD = 'admin12345';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'admin@parkit.local').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD;
const isDev = ['development', 'test'].includes(process.env.NODE_ENV);

async function seed() {
  // The development password is in this file, so it must never reach a shared environment.
  if (!isDev && (!process.env.ADMIN_PASSWORD || ADMIN_PASSWORD === DEV_ADMIN_PASSWORD)) {
    throw new Error('Set ADMIN_PASSWORD (not the development default) to seed outside development');
  }

  const { rows } = await pool.query(
    `INSERT INTO facilities (id, name, address) VALUES (1, 'ParkIt Residency', 'New Delhi')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const facilityId = rows[0].id;
  // An explicit id does not advance the SERIAL sequence; move it past the seeded row so the next
  // plain INSERT does not collide with id 1.
  await pool.query(
    `SELECT setval(pg_get_serial_sequence('facilities', 'id'), (SELECT max(id) FROM facilities))`,
  );

  const slots = [
    ['A-01', 'car', 40, 300],
    ['A-02', 'car', 40, 300],
    ['A-03', 'car', 40, 300],
    ['B-01', 'bike', 15, 100],
  ];
  for (const [code, type, hourly, daily] of slots) {
    await pool.query(
      `INSERT INTO slots (facility_id, code, vehicle_type, hourly_rate, daily_rate)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (facility_id, code) DO NOTHING`,
      [facilityId, code, type, hourly, daily],
    );
  }

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Owner', $1, $2, 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [ADMIN_EMAIL, hash],
  );

  console.log(`seeded facility ${facilityId}, ${slots.length} slots, admin ${ADMIN_EMAIL}`);
}

seed()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
