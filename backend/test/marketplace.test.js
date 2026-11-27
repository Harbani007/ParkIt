import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUser, dbUp, ensureFacility, istIso, pool, tracker } from './helpers.js';

// D22-D24: hosts list spaces, drivers search by locality, hosts manage only their own spaces.
describe.skipIf(!dbUp)('marketplace', () => {
  const app = createApp();
  const originalDir = config.uploadsDir;
  const spaceIds = [];
  const tag = randomBytes(3).toString('hex');
  const locality = `Testnagar ${tag}`;
  let tmp;
  let host;
  let other;
  let driver;
  let admin;
  let space;

  const as = (u) => ({ Authorization: `Bearer ${u.token}` });
  const plate = () => `V${randomBytes(4).toString('hex').toUpperCase()}`;
  const listing = (extra = {}) => ({
    name: `Sharma driveway ${tag}`,
    address: 'House 12, Block C',
    locality,
    opens_at: '00:00',
    closes_at: '23:30',
    vehicle_type: 'car',
    slots: 2,
    hourly_rate: 30,
    daily_rate: 200,
    ...extra,
  });
  const createSpace = async (u, extra) => {
    const res = await request(app).post('/api/host/spaces').set(as(u)).send(listing(extra));
    if (res.status === 201) spaceIds.push(res.body.id);
    return res;
  };

  beforeAll(async () => {
    await ensureFacility();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parkit-market-'));
    config.uploadsDir = tmp;
    host = await createUser({ name: 'Host' });
    other = await createUser({ name: 'Other host' });
    driver = await createUser({ name: 'Driver' });
    admin = await createUser({ role: 'admin' });
    space = (await createSpace(host)).body;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM payments WHERE booking_id IN (SELECT b.id FROM bookings b JOIN slots s ON s.id = b.slot_id
        WHERE s.facility_id = ANY($1::int[]))`,
      [spaceIds],
    );
    await pool.query(
      'DELETE FROM bookings WHERE slot_id IN (SELECT id FROM slots WHERE facility_id = ANY($1::int[]))',
      [spaceIds],
    );
    await pool.query('DELETE FROM slots WHERE facility_id = ANY($1::int[])', [spaceIds]);
    await pool.query('DELETE FROM facilities WHERE id = ANY($1::int[])', [spaceIds]);
    await tracker.cleanup();
    config.uploadsDir = originalDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('a customer lists a space with slots P1..Pn and sees it under their spaces', async () => {
    expect(space).toMatchObject({
      name: `Sharma driveway ${tag}`,
      address: 'House 12, Block C',
      locality,
      city: 'New Delhi',
      opens_at: '00:00',
      closes_at: '23:30',
      slot_count: 2,
      vehicle_types: ['car'],
      from_hourly_rate: '30.00',
      is_listed: true,
    });
    const slots = await pool.query('SELECT code FROM slots WHERE facility_id = $1 ORDER BY code', [space.id]);
    expect(slots.rows.map((r) => r.code)).toEqual(['P1', 'P2']);
    const mine = await request(app).get('/api/host/spaces').set(as(host));
    expect(mine.body.spaces.map((s) => s.id)).toEqual([space.id]);
  });

  it('400 for a bad listing, 401 without a token, 403 for an admin', async () => {
    expect((await createSpace(host, { closes_at: '06:00', opens_at: '08:00' })).status).toBe(400);
    expect((await createSpace(host, { slots: 0 })).status).toBe(400);
    expect((await request(app).post('/api/host/spaces').send(listing())).status).toBe(401);
    expect((await createSpace(admin)).status).toBe(403);
  });

  it('search by locality finds the space without its house address; unlisted spaces are hidden', async () => {
    const res = await request(app).get('/api/spaces').query({ q: locality.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.spaces.map((s) => s.id)).toEqual([space.id]);
    expect(res.body.spaces[0]).not.toHaveProperty('address');
    expect(res.body.spaces[0]).not.toHaveProperty('owner_id');
    expect((await request(app).get('/api/spaces').query({ q: locality, vehicle_type: 'bike' })).body.spaces).toEqual([]);
    expect((await request(app).get('/api/spaces').query({ q: '%' })).status).toBe(200);

    const one = await request(app).get(`/api/spaces/${space.id}`);
    expect(one.status).toBe(200);
    expect(one.body).not.toHaveProperty('address');
    expect((await request(app).get('/api/spaces/999999999')).status).toBe(404);

    await pool.query('UPDATE facilities SET is_listed = false WHERE id = $1', [space.id]);
    expect((await request(app).get('/api/spaces').query({ q: locality })).body.spaces).toEqual([]);
    expect((await request(app).get(`/api/spaces/${space.id}`)).status).toBe(404);
    await pool.query('UPDATE facilities SET is_listed = true WHERE id = $1', [space.id]);
  });

  it('a driver books at the space and sees its address; the host cannot book their own space', async () => {
    const starts = istIso(3, '10:00');
    const avail = await request(app).get('/api/slots/availability').query({ space_id: space.id, starts_at: starts, hours: 2 });
    expect(avail.status).toBe(200);
    expect(avail.body.slots.map((s) => s.code)).toEqual(['P1', 'P2']);
    expect(avail.body.slots[0].amount).toBe('60.00');

    const body = { space_id: space.id, vehicle_type: 'car', starts_at: starts, hours: 2, vehicle_number: plate() };
    const res = await request(app).post('/api/bookings').set(as(driver)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.space).toEqual({
      id: space.id, name: space.name, locality, city: 'New Delhi', address: 'House 12, Block C',
    });
    expect(res.body.amount).toBe('60.00');

    const own = await request(app).post('/api/bookings').set(as(host)).send({ ...body, vehicle_number: plate() });
    expect(own.status).toBe(409);
    expect(own.body.error).toBe('You cannot book your own space');
  });

  it('a host manages only their own space: 400 without space_id, 404 for another space', async () => {
    expect((await request(app).get('/api/host/slots').set(as(host))).status).toBe(400);
    expect((await request(app).get('/api/host/slots').query({ space_id: space.id }).set(as(other))).status).toBe(404);
    expect((await request(app).get('/api/host/slots').query({ space_id: 1 }).set(as(host))).status).toBe(404);
    const slots = await request(app).get('/api/host/slots').query({ space_id: space.id }).set(as(host));
    expect(slots.status).toBe(200);
    expect(slots.body.slots.map((s) => s.code)).toEqual(['P1', 'P2']);

    const fac = await request(app).get('/api/host/facility').query({ space_id: space.id }).set(as(host));
    expect(fac.body.address).toBe('House 12, Block C');
    const renamed = await request(app)
      .patch('/api/host/facility').query({ space_id: space.id }).set(as(host)).send({ closes_at: '22:00' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.closes_at).toBe('22:00');
  });

  it('a host sees and checks in bookings at their space only; the admin reaches any space', async () => {
    const date = istIso(3, '10:00');
    const day = new Date(Date.parse(date) + 330 * 60000).toISOString().slice(0, 10);
    const list = await request(app).get('/api/host/bookings').query({ space_id: space.id, date }).set(as(host));
    expect(list.status).toBe(400); // date must be YYYY-MM-DD
    const ok = await request(app).get('/api/host/bookings').query({ space_id: space.id, date: day }).set(as(host));
    expect(ok.status).toBe(200);
    expect(ok.body.bookings).toHaveLength(1);
    const code = ok.body.bookings[0].booking_code;
    expect(ok.body.bookings[0].customer.name).toBe('Driver');

    const lookup = await request(app).get(`/api/host/bookings/${code}`).query({ space_id: space.id }).set(as(host));
    expect(lookup.status).toBe(200);
    const early = await request(app).post(`/api/host/bookings/${code}/check-in`).query({ space_id: space.id }).set(as(host));
    expect(early.status).toBe(409); // too early: rules unchanged

    // Another host's space cannot reach this booking.
    const otherSpace = (await createSpace(other, { locality: `Elsewhere ${tag}` })).body;
    const cross = await request(app).get(`/api/host/bookings/${code}`).query({ space_id: otherSpace.id }).set(as(other));
    expect(cross.status).toBe(404);

    const viaAdmin = await request(app).get('/api/admin/bookings').query({ space_id: space.id, date: day }).set(as(admin));
    expect(viaAdmin.body.bookings.map((b) => b.booking_code)).toEqual([code]);

    const cancelled = await request(app).post(`/api/host/bookings/${code}/cancel`).query({ space_id: space.id }).set(as(host));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
  });
});
