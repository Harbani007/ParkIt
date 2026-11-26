import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createAuthRouter } from '../src/routes/auth.js';
import { rateLimit } from '../src/middleware/rateLimit.js';
import { errorHandler, notFound } from '../src/middleware/errors.js';
import { dbUp, pool, createUser, tracker, uniq } from './helpers.js';

// Own app so many logins do not hit the production 10/min limit.
function appWith(opts, setup) {
  const app = express();
  setup?.(app);
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(opts));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('rateLimit', () => {
  const run = (limiter, ip) =>
    new Promise((resolve) => limiter({ ip }, {}, (err) => resolve(err?.status ?? 200)));

  it('blocks after max and keeps separate buckets per IP', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    expect(await run(limiter, '1.1.1.1')).toBe(200);
    expect(await run(limiter, '1.1.1.1')).toBe(200);
    expect(await run(limiter, '1.1.1.1')).toBe(429);
    expect(await run(limiter, '2.2.2.2')).toBe(200);
  });

  it('resets after the window', async () => {
    let t = 0;
    const limiter = rateLimit({ windowMs: 1000, max: 1, now: () => t });
    expect(await run(limiter, 'a')).toBe(200);
    expect(await run(limiter, 'a')).toBe(429);
    t = 1001;
    expect(await run(limiter, 'a')).toBe(200);
  });

  it('keys on the client IP from X-Forwarded-For when trust proxy is 2', async () => {
    const app = appWith({ max: 1 }, (a) => a.set('trust proxy', 2));
    const hit = (xff) => request(app).post('/api/auth/login').set('X-Forwarded-For', xff).send({});
    expect((await hit('1.2.3.4, 5.6.7.8')).status).toBe(400);
    expect((await hit('1.2.3.4, 9.9.9.9')).status).toBe(429); // same client, different proxy
    expect((await hit('8.8.8.8, 5.6.7.8')).status).toBe(400); // other client
  });
});

describe.skipIf(!dbUp)('auth routes', () => {
  const app = appWith({ max: 1000 });
  const email = `Reg-${uniq()}@Example.com`;

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email.toLowerCase()]);
    await tracker.cleanup();
    await pool.end();
  });

  const valid = { name: 'Asha Verma', email, phone: '9876543210', password: 'password123' };

  it('register creates a customer, lowercases email, ignores role, hides the hash', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...valid, role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ name: 'Asha Verma', email: email.toLowerCase(), phone: '9876543210', role: 'customer' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('register 400 for short password, bad email, bad phone, missing name', async () => {
    const bad = [
      { ...valid, email: `a-${uniq()}@example.com`, password: 'short' },
      { ...valid, email: 'not-an-email' },
      { ...valid, email: `b-${uniq()}@example.com`, phone: '12ab' },
      { ...valid, email: `c-${uniq()}@example.com`, name: '' },
    ];
    for (const body of bad) {
      const res = await request(app).post('/api/auth/register').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.length).toBeGreaterThan(0);
    }
  });

  it('register 400 for a password over 72 bytes (40 multi-byte characters)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...valid, email: `d-${uniq()}@example.com`, password: 'é'.repeat(40) });
    expect(res.status).toBe(400);
  });

  it('register 409 for a duplicate email in a different case', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...valid, email: email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already registered');
  });

  it('login 200 with token and user, case-insensitive email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: email.toUpperCase(), password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email.toLowerCase());
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('login 401 with the same message for unknown email and wrong password', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: `nobody-${uniq()}@example.com`, password: 'password123' });
    const b = await request(app).post('/api/auth/login').send({ email, password: 'wrongpassword' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.error).toBe('Invalid email or password');
  });

  it('login 400 when a field is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email });
    expect(res.status).toBe(400);
  });

  it('me returns the user; 401 without a token or with garbage', async () => {
    const { user, token } = await createUser();
    const ok = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id: user.id, email: user.email, role: 'customer' });
    expect(JSON.stringify(ok.body)).not.toMatch(/password/i);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('the 11th login in a minute from one IP gets 429 (fresh limiter, default max)', async () => {
    const limited = appWith({ max: 10 });
    const { user, password } = await createUser();
    for (let i = 0; i < 10; i++) {
      const res = await request(limited).post('/api/auth/login').send({ email: user.email, password: i % 2 ? 'x'.repeat(10) : password });
      expect([200, 401]).toContain(res.status);
    }
    const res = await request(limited).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too many attempts, try again in a minute');
    // register shares the same limiter
    expect((await request(limited).post('/api/auth/register').send(valid)).status).toBe(429);
  });
});
