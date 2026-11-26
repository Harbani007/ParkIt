import { Router } from 'express';
import { query } from '../db/pool.js';

export const healthRouter = Router();

// Used by the EC2 health check and the CI smoke test.
healthRouter.get('/', async (_req, res) => {
  let db = 'down';
  try {
    await query('SELECT 1');
    db = 'up';
  } catch {
    // report but don't fail: the API process itself is alive
  }
  res.json({ status: 'ok', db, time: new Date().toISOString() });
});
