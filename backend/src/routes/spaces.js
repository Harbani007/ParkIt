import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { findSpace, publicSpace, searchSpaces } from '../services/facility.js';

export const spacesRouter = Router();

const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  vehicle_type: z.enum(['car', 'bike']).optional(),
});
const idParams = z.object({ id: z.string().regex(/^\d{1,9}$/, 'Must be a positive integer').transform(Number) });

// D23: search by locality, city or name. Never returns the house address.
spacesRouter.get('/', validate({ query: searchQuery }), async (req, res) => {
  const { q, vehicle_type: vehicleType } = req.valid.query;
  const rows = await searchSpaces({ q: q || undefined, vehicleType });
  res.json({ spaces: rows.map(publicSpace) });
});

spacesRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  const row = await findSpace(req.valid.params.id);
  if (!row || !row.is_listed) throw new HttpError(404, 'Space not found');
  res.json(publicSpace(row));
});
