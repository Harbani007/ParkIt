import { Router } from 'express';
import { getNotifier } from '../services/notify.js';

export const configRouter = Router();

// What the frontend needs to know about this deployment (docs/api.md). No secrets here.
configRouter.get('/', (_req, res) => {
  res.json({ email_notifications: Boolean(getNotifier().enabled) });
});
