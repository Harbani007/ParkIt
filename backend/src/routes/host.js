import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/tx.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { timeToMinutes } from '../lib/time.js';
import { findSpace, hostSpace, listOwnedSpaces } from '../services/facility.js';
import { hostManageRouter } from './admin/index.js';

// Hosts are customers who list spaces (D22). Their own spaces, then the management routes (D24).
export const hostRouter = Router();
hostRouter.use(requireAuth, requireRole('customer'));

const hhmm = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, 'Time must be HH:00 or HH:30, from 00:00 to 23:30');
const rate = z.union([z.number(), z.string()]).transform(String)
  .refine((s) => /^\d{1,6}(\.\d{1,2})?$/.test(s) && Number(s) > 0, 'Must be a positive amount with up to 2 decimals');

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(300),
  locality: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100).default('New Delhi'),
  opens_at: hhmm,
  closes_at: hhmm,
  vehicle_type: z.enum(['car', 'bike']),
  slots: z.number().int().min(1).max(10).default(1),
  hourly_rate: rate,
  daily_rate: rate,
});

hostRouter.get('/spaces', async (req, res) => {
  const rows = await listOwnedSpaces(req.user.id);
  res.json({ spaces: rows.map(hostSpace) });
});

hostRouter.post('/spaces', validate({ body: createBody }), async (req, res) => {
  const b = req.valid.body;
  if (timeToMinutes(b.closes_at) <= timeToMinutes(b.opens_at)) throw new HttpError(400, 'closes_at must be after opens_at');
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO facilities (name, address, locality, city, opens_at, closes_at, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [b.name, b.address, b.locality, b.city, b.opens_at, b.closes_at, req.user.id],
    );
    for (let i = 1; i <= b.slots; i++) {
      await client.query(
        `INSERT INTO slots (facility_id, code, vehicle_type, hourly_rate, daily_rate) VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, `P${i}`, b.vehicle_type, b.hourly_rate, b.daily_rate],
      );
    }
    return rows[0].id;
  });
  res.status(201).json(hostSpace(await findSpace(id)));
});

hostRouter.use(hostManageRouter);
