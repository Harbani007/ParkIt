import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import { getFacility, hostSpace, findSpace } from '../../services/facility.js';
import { timeToMinutes } from '../../lib/time.js';

export const adminFacilityRouter = Router();

// D2: HH:MM on :00 or :30, 00:00 to 23:30.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, 'Time must be HH:00 or HH:30, from 00:00 to 23:30');

const body = z
  .object({
    opens_at: hhmm,
    closes_at: hhmm,
    max_advance_days: z.number().int().min(1).max(365),
    name: z.string().trim().min(1).max(100),
    address: z.string().trim().min(1).max(300),
    locality: z.string().trim().min(1).max(100),
    city: z.string().trim().min(1).max(100),
    is_listed: z.boolean(),
  })
  .partial();

// The space being managed, with its address (admin or its host).
adminFacilityRouter.get('/', async (req, res) => {
  res.json(hostSpace(await findSpace(req.space.id)));
});

adminFacilityRouter.patch('/', validate({ body }), async (req, res, next) => {
  try {
    const merged = { ...(await getFacility(req.space.id)), ...req.valid.body };
    if (timeToMinutes(merged.closes_at) <= timeToMinutes(merged.opens_at)) {
      throw new HttpError(400, 'closes_at must be after opens_at');
    }
    await pool.query(
      `UPDATE facilities SET name = $2, address = $3, opens_at = $4, closes_at = $5, max_advance_days = $6,
              locality = $7, city = $8, is_listed = $9
        WHERE id = $1`,
      [req.space.id, merged.name, merged.address, merged.opens_at, merged.closes_at, merged.max_advance_days,
       merged.locality, merged.city, merged.is_listed],
    );
    res.json(hostSpace(await findSpace(req.space.id)));
  } catch (err) {
    next(err);
  }
});
