import { Router } from 'express';
import { getFacility } from '../services/facility.js';

export const facilityRouter = Router();

facilityRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getFacility());
  } catch (err) {
    next(err);
  }
});
