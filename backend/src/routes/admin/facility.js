import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import { getFacility, facilityId } from '../../services/facility.js';
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
  })
  .partial();

adminFacilityRouter.patch('/', validate({ body }), async (req, res, next) => {
  try {
    const merged = { ...(await getFacility()), ...req.valid.body };
    if (timeToMinutes(merged.closes_at) <= timeToMinutes(merged.opens_at)) {
      throw new HttpError(400, 'closes_at must be after opens_at');
    }
    await pool.query(
      `UPDATE facilities SET name = $2, address = $3, opens_at = $4, closes_at = $5, max_advance_days = $6
        WHERE id = $1`,
      [facilityId(), merged.name, merged.address, merged.opens_at, merged.closes_at, merged.max_advance_days],
    );
    res.json(await getFacility());
  } catch (err) {
    next(err);
  }
});
