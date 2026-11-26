import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { errorHandler } from '../../src/middleware/errors.js';
import { requireAuth, requireRole, signToken } from '../../src/middleware/auth.js';
import { validate } from '../../src/middleware/validate.js';
import { mapPgError } from '../../src/db/errors.js';

function testApp() {
  const app = express();
  app.use(express.json());
  app.get('/me', requireAuth, (req, res) => res.json(req.user));
  app.get('/admin', requireAuth, requireRole('admin'), (_req, res) => res.json({ ok: true }));
  app.post(
    '/v/:id',
    validate({
      params: z.object({ id: z.coerce.number().int() }),
      query: z.object({ n: z.coerce.number().int().min(1) }),
      body: z.object({ email: z.string().email() }),
    }),
    (req, res) => res.json(req.valid),
  );
  app.use(errorHandler);
  return app;
}

describe('auth middleware', () => {
  const app = testApp();
  const token = signToken({ id: 7, role: 'customer' });

  it('401 without a header or with a non-Bearer header', async () => {
    expect((await request(app).get('/me')).status).toBe(401);
    expect((await request(app).get('/me').set('Authorization', `Basic ${token}`)).status).toBe(401);
  });

  it('401 for a bad signature', async () => {
    const bad = jwt.sign({ role: 'admin' }, 'another-secret', { subject: '1' });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it('401 for an expired token', async () => {
    const old = jwt.sign({ role: 'customer' }, config.jwtSecret, { subject: '1', expiresIn: -10 });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${old}`);
    expect(res.status).toBe(401);
  });

  it('401 for garbage', async () => {
    expect((await request(app).get('/me').set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  it('sets req.user from a valid token', async () => {
    const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, role: 'customer' });
  });

  it('403 for the wrong role, 200 for the right one', async () => {
    const res = await request(app).get('/admin').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    const admin = signToken({ id: 1, role: 'admin' });
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${admin}`)).status).toBe(200);
  });
});

describe('validate middleware', () => {
  const app = testApp();

  it('400 with details for each invalid part', async () => {
    const res = await request(app).post('/v/abc?n=0').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    const paths = res.body.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['params.id', 'query.n', 'body.email']));
    expect(res.body.details[0]).toEqual({ path: expect.any(String), message: expect.any(String) });
  });

  it('puts parsed values on req.valid', async () => {
    const res = await request(app).post('/v/5?n=2').send({ email: 'a@b.co' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { id: 5 }, query: { n: 2 }, body: { email: 'a@b.co' } });
  });
});

describe('mapPgError', () => {
  const pg = (code, constraint) => Object.assign(new Error('pg'), { code, constraint });
  const map = (code, constraint) => {
    const e = mapPgError(pg(code, constraint));
    return [e.status, e.message];
  };

  it('maps exclusion violations by constraint', () => {
    expect(map('23P01', 'bookings_no_vehicle_overlap')).toEqual([409, 'This vehicle already has a booking at that time']);
    expect(map('23P01', 'bookings_no_slot_overlap')).toEqual([409, 'This slot was just booked for that time']);
  });

  it('maps unique violations', () => {
    expect(map('23505', 'users_email_key')).toEqual([409, 'Email already registered']);
    expect(map('23505', 'slots_facility_id_code_key')).toEqual([409, 'Slot code already used']);
    expect(map('23505', 'bookings_booking_code_key')).toEqual([409, 'Already exists']);
  });

  it('maps the slot foreign key and check violations', () => {
    expect(map('23503', 'bookings_slot_id_fkey')).toEqual([409, 'Slot has bookings; block it instead']);
    expect(map('23514', 'bookings_check')[0]).toBe(400);
  });

  it('leaves other errors untouched', () => {
    const other = pg('42P01');
    expect(mapPgError(other)).toBe(other);
    const plain = new Error('boom');
    expect(mapPgError(plain)).toBe(plain);
    const unknownExclusion = pg('23P01', 'something_else');
    expect(mapPgError(unknownExclusion)).toBe(unknownExclusion);
  });

  it('the error handler applies it', async () => {
    const app = express();
    app.get('/x', (_req, _res, next) => next(pg('23505', 'users_email_key')));
    app.use(errorHandler);
    const res = await request(app).get('/x');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Email already registered' });
  });
});

describe('app wiring', () => {
  const app = createApp();

  it('sets Cache-Control: no-store on /api responses, including 404s', async () => {
    expect((await request(app).get('/api/health')).headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/nope')).headers['cache-control']).toBe('no-store');
  });

  it('returns JSON 404 under the public mounts', async () => {
    for (const path of ['/api/auth/x', '/api/facility/x', '/api/slots/x', '/api/bookings/x', '/api/files/x']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error).toMatch(/Not found/);
    }
  });

  it('guards every /api/admin path: 401 without a token, 403 for a customer', async () => {
    const customer = signToken({ id: 2, role: 'customer' });
    for (const path of ['/api/admin/slots', '/api/admin/whatever']) {
      expect((await request(app).get(path)).status, path).toBe(401);
      expect((await request(app).get(path).set('Authorization', `Bearer ${customer}`)).status, path).toBe(403);
    }
    const admin = signToken({ id: 1, role: 'admin' });
    expect((await request(app).get('/api/admin/whatever').set('Authorization', `Bearer ${admin}`)).status).toBe(404);
  });
});
