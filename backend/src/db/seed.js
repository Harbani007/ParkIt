// Seeds one facility, a few slots and a dev admin account. Safe to re-run.
import { randomBytes } from 'node:crypto';
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
    `INSERT INTO facilities (id, name, address) VALUES (1, 'ParkIt Residency', 'Block A, Lajpat Nagar II')
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

  const spaces = await seedDemoSpaces();
  console.log(`seeded facility ${facilityId}, ${slots.length} slots, admin ${ADMIN_EMAIL}, ${spaces} demo spaces`);
}

// Demo marketplace (D22): homes across Delhi NCR listing their empty parking for the hours they
// are away. The demo hosts get a random password nobody knows, so they cannot be signed in to.
const DEMO_SPACES = [
  // [host name, email, space name, house address, locality, city, opens, closes, type, slots, hourly, daily]
  ['Ritu Sharma', 'host.saket@parkit.local', 'Sharma house driveway', 'House 14, J Block', 'Saket', 'New Delhi', '09:00', '19:00', 'car', 1, 30, 200],
  ['Aman Verma', 'host.hauzkhas@parkit.local', 'Verma family garage', 'B-7, near Deer Park gate', 'Hauz Khas', 'New Delhi', '08:00', '20:00', 'car', 2, 40, 250],
  ['Neha Gupta', 'host.karolbagh@parkit.local', 'Gupta building stilt parking', '16/42, Ajmal Khan Road', 'Karol Bagh', 'New Delhi', '10:00', '21:00', 'car', 2, 35, 220],
  ['Vikram Singh', 'host.cp@parkit.local', 'Office basement bay', 'Block F, Inner Circle', 'Connaught Place', 'New Delhi', '08:00', '22:00', 'car', 3, 60, 400],
  ['Pooja Mehta', 'host.dwarka@parkit.local', 'Mehta society visitor spot', 'Flat 302, Sector 10', 'Dwarka', 'New Delhi', '07:00', '19:00', 'car', 1, 25, 150],
  ['Rahul Jain', 'host.noida@parkit.local', 'Jain bike corner', 'C-118, Sector 18', 'Noida Sector 18', 'Noida', '09:00', '21:00', 'bike', 3, 10, 60],
  ['Simran Kaur', 'host.rajouri@parkit.local', 'Kaur house front porch', 'J-12, Rajouri Garden', 'Rajouri Garden', 'New Delhi', '08:30', '18:30', 'car', 1, 30, 180],
];

async function seedDemoSpaces() {
  const unusable = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  let created = 0;
  for (const [hostName, email, name, address, locality, city, opens, closes, type, count, hourly, daily] of DEMO_SPACES) {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'customer')
       ON CONFLICT (email) DO NOTHING`,
      [hostName, email, unusable],
    );
    const { rows: hosts } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    const { rows } = await pool.query(
      `INSERT INTO facilities (name, address, locality, city, opens_at, closes_at, owner_id)
       SELECT $1, $2, $3, $4, $5, $6, $7
        WHERE NOT EXISTS (SELECT 1 FROM facilities WHERE owner_id = $7 AND name = $1)
       RETURNING id`,
      [name, address, locality, city, opens, closes, hosts[0].id],
    );
    if (!rows[0]) continue;
    created++;
    for (let i = 1; i <= count; i++) {
      await pool.query(
        `INSERT INTO slots (facility_id, code, vehicle_type, hourly_rate, daily_rate) VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, `P${i}`, type, hourly, daily],
      );
    }
  }
  return created;
}

seed()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
