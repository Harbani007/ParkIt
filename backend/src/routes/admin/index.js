import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { getFacility } from '../../services/facility.js';
import { adminSlotsRouter } from './slots.js';
import { adminBookingsRouter } from './bookings.js';
import { adminSummaryRouter } from './summary.js';
import { adminFacilityRouter } from './facility.js';

const spaceIdOf = (req) => {
  const raw = req.query.space_id;
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d{1,9}$/.test(String(raw))) throw new HttpError(400, 'space_id must be a positive integer');
  return Number(raw);
};

// Admin: any space (default: the configured facility). Booking codes are not limited to a space
// unless space_id is given.
async function adminScope(req, _res, next) {
  try {
    const id = spaceIdOf(req);
    req.space = await getFacility(id);
    req.scopeAll = id === undefined;
    next();
  } catch (err) {
    next(err);
  }
}

// Host (D24): space_id required and owned by the caller; anything else is a 404.
async function hostScope(req, _res, next) {
  try {
    const id = spaceIdOf(req);
    if (id === undefined) throw new HttpError(400, 'space_id is required');
    const space = await getFacility(id).catch(() => null);
    if (!space || space.owner_id !== req.user.id) throw new HttpError(404, 'Space not found');
    req.space = space;
    req.scopeAll = false;
    next();
  } catch (err) {
    next(err);
  }
}

function manageRouter(scope) {
  const router = Router();
  router.use(scope);
  router.use('/slots', adminSlotsRouter);
  router.use('/bookings', adminBookingsRouter);
  router.use('/summary', adminSummaryRouter);
  router.use('/facility', adminFacilityRouter);
  return router;
}

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'), manageRouter(adminScope));

/** Mounted after the host's own /spaces routes in routes/host.js. */
export const hostManageRouter = manageRouter(hostScope);
