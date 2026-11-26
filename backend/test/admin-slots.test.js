import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbUp, pool, tracker, uniq, ensureFacility, createUser, createSlot, insertBookingRow, istIso } from './helpers.js';

describe.skipIf(!dbUp)('admin slots', () => {
  const app = createApp();
  let admin;
  let customer;
  const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
  const code = () => `X-${uniq()}`.slice(0, 20);

  beforeAll(async () => {
    await ensureFacility();
    admin = await createUser({ role: 'admin' });
    customer = await createUser({ role: 'customer' });
  });

  afterAll(async () => {
    await tracker.cleanup();
    await pool.end();
  });

  const create = async (body) => {
    const res = await request(app).post('/api/admin/slots').set(auth(admin)).send(body);
    if (res.status === 201) tracker.slotIds.push(res.body.id);
    return res;
  };

  it('lists slots ordered by code, blocked included', async () => {
    const a = await createSlot({ code: `ZZ-${uniq()}`.slice(0, 20), isBlocked: true });
    const b = await createSlot({ code: `ZY-${uniq()}`.slice(0, 20) });
    const res = await request(app).get('/api/admin/slots').set(auth(admin));
    expect(res.status).toBe(200);
    const codes = res.body.slots.map((s) => s.code);
    // Postgres orders by the database collation; check the response is in that same order.
    const { rows } = await pool.query('SELECT code FROM slots WHERE facility_id = 1 ORDER BY code');
    expect(codes).toEqual(rows.map((r) => r.code));
    expect(codes.indexOf(b.code)).toBeLessThan(codes.indexOf(a.code));
    expect(res.body.slots.find((s) => s.id === a.id)).toEqual({
      id: a.id, code: a.code, vehicle_type: 'car', hourly_rate: '40.00', daily_rate: '300.00', is_blocked: true,
    });
  });

  it('creates a slot (201)', async () => {
    const c = code();
    const res = await create({ code: c, vehicle_type: 'bike', hourly_rate: 15, daily_rate: 100.5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: c, vehicle_type: 'bike', hourly_rate: '15.00', daily_rate: '100.50', is_blocked: false });
  });

  it('rejects bad create bodies (400)', async () => {
    const ok = { code: code(), vehicle_type: 'car', hourly_rate: 10, daily_rate: 50 };
    for (const bad of [
      { ...ok, hourly_rate: -1 },
      { ...ok, daily_rate: -5 },
      { ...ok, vehicle_type: 'truck' },
      { ...ok, code: '' },
      { ...ok, code: 'x'.repeat(21) },
      { ...ok, hourly_rate: '10' },
      { ...ok, hourly_rate: 1.234 },
      { code: ok.code },
    ]) {
      const res = await create(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(Array.isArray(res.body.details)).toBe(true);
    }
  });

  it('409 on a duplicate code (create and patch)', async () => {
    const s = await createSlot();
    const dup = await create({ code: s.code, vehicle_type: 'car', hourly_rate: 1, daily_rate: 2 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('Slot code already used');
    const other = await createSlot();
    const res = await request(app).patch(`/api/admin/slots/${other.id}`).set(auth(admin)).send({ code: s.code });
    expect(res.status).toBe(409);
  });

  it('patches rates and is_blocked (200)', async () => {
    const s = await createSlot();
    const res = await request(app)
      .patch(`/api/admin/slots/${s.id}`)
      .set(auth(admin))
      .send({ hourly_rate: 55, daily_rate: 400, is_blocked: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: s.id, hourly_rate: '55.00', daily_rate: '400.00', is_blocked: true, code: s.code });
  });

  it('vehicle_type: 409 while a confirmed or checked_in booking is still running, else allowed', async () => {
    const patch = (s, body) => request(app).patch(`/api/admin/slots/${s.id}`).set(auth(admin)).send(body);
    const msg = 'Slot has active bookings; its type cannot change';
    const base = { userId: customer.user.id };
    const day = 24 * 3_600_000;

    const confirmed = await createSlot();
    await insertBookingRow({ ...base, slotId: confirmed.id, startsAt: istIso(5, '10:00'), endsAt: istIso(5, '11:00') });
    const res = await patch(confirmed, { vehicle_type: 'bike' });
    expect([res.status, res.body.error]).toEqual([409, msg]);
    expect((await patch(confirmed, { vehicle_type: 'car' })).status).toBe(200); // unchanged type is fine
    expect((await patch(confirmed, { hourly_rate: 50 })).status).toBe(200);

    const inUse = await createSlot();
    await insertBookingRow({
      ...base, slotId: inUse.id, status: 'checked_in', checkedInAt: new Date(),
      startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000),
    });
    expect((await patch(inUse, { vehicle_type: 'bike' })).status).toBe(409);

    const idle = await createSlot();
    await insertBookingRow({ ...base, slotId: idle.id, status: 'cancelled', startsAt: istIso(5, '10:00'), endsAt: istIso(5, '11:00') });
    await insertBookingRow({ ...base, slotId: idle.id, status: 'completed', startsAt: new Date(Date.now() - 2 * day), endsAt: new Date(Date.now() - 2 * day + 3_600_000) });
    const ok = await patch(idle, { vehicle_type: 'bike' });
    expect([ok.status, ok.body.vehicle_type]).toEqual([200, 'bike']);
  });

  it('patch: 400 for empty body or bad id/value, 404 for unknown slot', async () => {
    const s = await createSlot();
    expect((await request(app).patch(`/api/admin/slots/${s.id}`).set(auth(admin)).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/admin/slots/${s.id}`).set(auth(admin)).send({ hourly_rate: -1 })).status).toBe(400);
    expect((await request(app).patch('/api/admin/slots/abc').set(auth(admin)).send({ is_blocked: true })).status).toBe(400);
    const res = await request(app).patch('/api/admin/slots/999999999').set(auth(admin)).send({ is_blocked: true });
    expect(res.status).toBe(404);
  });

  it('rate change leaves an existing booking amount untouched (D16)', async () => {
    const s = await createSlot({ hourlyRate: 40, dailyRate: 300 });
    const b = await insertBookingRow({
      userId: customer.user.id, slotId: s.id, startsAt: istIso(5, '10:00'), endsAt: istIso(5, '13:00'), amount: '120.00',
    });
    const res = await request(app).patch(`/api/admin/slots/${s.id}`).set(auth(admin)).send({ hourly_rate: 99 });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      'SELECT b.amount AS b_amount, p.amount AS p_amount FROM bookings b JOIN payments p ON p.booking_id = b.id WHERE b.id = $1',
      [b.id],
    );
    expect(rows[0]).toEqual({ b_amount: '120.00', p_amount: '120.00' });
  });

  it('deletes an unbooked slot (204) and 404s afterwards', async () => {
    const s = await createSlot();
    const res = await request(app).delete(`/api/admin/slots/${s.id}`).set(auth(admin));
    expect(res.status).toBe(204);
    expect((await request(app).delete(`/api/admin/slots/${s.id}`).set(auth(admin))).status).toBe(404);
  });

  it('409 when deleting a slot that has bookings (D13)', async () => {
    const s = await createSlot();
    await insertBookingRow({
      userId: customer.user.id, slotId: s.id, startsAt: istIso(6, '10:00'), endsAt: istIso(6, '11:00'), status: 'cancelled',
    });
    const res = await request(app).delete(`/api/admin/slots/${s.id}`).set(auth(admin));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Slot has bookings; block it instead');
  });

  it('401 without a token and 403 for a customer on every verb', async () => {
    const calls = [
      (r) => r.get('/api/admin/slots'),
      (r) => r.post('/api/admin/slots').send({ code: 'Q', vehicle_type: 'car', hourly_rate: 1, daily_rate: 1 }),
      (r) => r.patch('/api/admin/slots/1').send({ is_blocked: true }),
      (r) => r.delete('/api/admin/slots/1'),
    ];
    for (const call of calls) {
      expect((await call(request(app))).status).toBe(401);
      expect((await call(request(app)).set(auth(customer))).status).toBe(403);
    }
  });
});
