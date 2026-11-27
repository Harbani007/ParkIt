import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbUp, pool, ensureFacility, createUser, tracker } from './helpers.js';

describe.skipIf(!dbUp)('facility routes', () => {
  const app = createApp();
  let original;
  let admin;
  let customer;

  beforeAll(async () => {
    await ensureFacility();
    const { rows } = await pool.query('SELECT * FROM facilities WHERE id = 1');
    original = rows[0];
    admin = await createUser({ role: 'admin' });
    customer = await createUser();
  });

  afterAll(async () => {
    await pool.query(
      `UPDATE facilities SET name=$1, address=$2, opens_at=$3, closes_at=$4, max_advance_days=$5 WHERE id = 1`,
      [original.name, original.address, original.opens_at, original.closes_at, original.max_advance_days],
    );
    await tracker.cleanup();
    await pool.end();
  });

  const patch = (body, token = admin.token) => {
    const r = request(app).patch('/api/admin/facility');
    return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
  };

  it('GET returns the facility with HH:MM times, no auth needed', async () => {
    const res = await request(app).get('/api/facility');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, timezone: 'Asia/Kolkata' });
    expect(res.body.opens_at).toMatch(/^\d\d:\d\d$/);
    expect(res.body.closes_at).toMatch(/^\d\d:\d\d$/);
    expect(Object.keys(res.body).sort()).toEqual(
      ['address', 'city', 'closes_at', 'id', 'locality', 'max_advance_days', 'name', 'opens_at', 'timezone'],
    );
  });

  it('PATCH partially updates and returns the facility', async () => {
    const res = await patch({ opens_at: '07:30', max_advance_days: 14 });
    expect(res.status).toBe(200);
    expect(res.body.opens_at).toBe('07:30');
    expect(res.body.max_advance_days).toBe(14);
    expect(res.body.closes_at).toBe(String(original.closes_at).slice(0, 5));
    const get = await request(app).get('/api/admin/facility').set('Authorization', `Bearer ${admin.token}`);
    expect(get.body).toEqual(res.body);
    const named = await patch({ name: 'Renamed', address: 'Elsewhere' });
    expect(named.body).toMatchObject({ name: 'Renamed', address: 'Elsewhere', opens_at: '07:30' });
  });

  it('PATCH 400 when closes_at is not after opens_at (merged values)', async () => {
    await patch({ opens_at: '08:00', closes_at: '20:00' });
    for (const body of [{ closes_at: '08:00' }, { closes_at: '07:30' }, { opens_at: '20:00' }, { opens_at: '22:00' }]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('PATCH 400 for out-of-range or malformed values', async () => {
    for (const body of [
      { max_advance_days: 0 },
      { max_advance_days: 366 },
      { max_advance_days: 1.5 },
      { opens_at: '25:00' },
      { opens_at: '06:15' },
      { closes_at: '24:00' },
      { closes_at: '23:59' },
      { name: '' },
    ]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('PATCH 401 without a token and 403 for a customer', async () => {
    expect((await patch({ name: 'x' }, null)).status).toBe(401);
    expect((await patch({ name: 'x' }, customer.token)).status).toBe(403);
  });

  it('restores nothing by accident: facility row still valid', async () => {
    const { rows } = await pool.query('SELECT closes_at > opens_at AS ok FROM facilities WHERE id = 1');
    expect(rows[0].ok).toBe(true);
  });
});
