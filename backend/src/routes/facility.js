import { Router } from 'express';
import { getFacility } from '../services/facility.js';

export const facilityRouter = Router();

facilityRouter.get('/', async (_req, res, next) => {
  try {
    const f = await getFacility();
    // The default facility's public fields (kept for the single-facility pages).
    const { owner_id: _owner, is_listed: _listed, ...pub } = f;
    res.json(pub);
  } catch (err) {
    next(err);
  }
});
