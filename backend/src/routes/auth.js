import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';

const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());

const registerBody = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  phone: z.string().regex(/^\d{10,15}$/, 'Phone must be 10-15 digits').optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine((p) => Buffer.byteLength(p) <= 72, 'Password must be at most 72 bytes'),
});

const loginBody = z.object({ email, password: z.string().min(1).max(1000) });

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });
const USER_COLS = 'id, name, email, phone, role';

// Compared against when the email is unknown, so timing does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function createAuthRouter({ max = config.authRateLimitMax, windowMs = 60_000 } = {}) {
  const router = Router();
  const limiter = rateLimit({ windowMs, max });

  router.post('/register', limiter, validate({ body: registerBody }), async (req, res, next) => {
    try {
      const { name, email: addr, phone, password } = req.valid.body;
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, 'customer')
         RETURNING ${USER_COLS}`,
        [name, addr, phone ?? null, hash],
      );
      res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', limiter, validate({ body: loginBody }), async (req, res, next) => {
    try {
      const { email: addr, password } = req.valid.body;
      const { rows } = await pool.query(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = $1`, [addr]);
      const u = rows[0];
      const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
      if (!u || !ok) throw new HttpError(401, 'Invalid email or password');
      res.json({ token: signToken(u), user: publicUser(u) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.user.id]);
      if (!rows[0]) throw new HttpError(401, 'Invalid or expired token');
      res.json({ user: publicUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const authRouter = createAuthRouter();
