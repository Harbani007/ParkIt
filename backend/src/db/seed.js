// Seeds one facility, a few slots and a dev admin account. Safe to re-run.
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

const ADMIN_EMAIL = 'admin@parkit.local';
const ADMIN_PASSWORD = 'admin12345'; // dev only; change on any shared environment

async function seed() {
  const { rows } = await pool.query(
    `INSERT INTO facilities (id, name, address) VALUES (1, 'ParkIt Residency', 'New Delhi')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const facilityId = rows[0].id;

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
