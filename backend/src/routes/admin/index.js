import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { adminSlotsRouter } from './slots.js';
import { adminBookingsRouter } from './bookings.js';
import { adminSummaryRouter } from './summary.js';
import { adminFacilityRouter } from './facility.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));
adminRouter.use('/slots', adminSlotsRouter);
adminRouter.use('/bookings', adminBookingsRouter);
adminRouter.use('/summary', adminSummaryRouter);
adminRouter.use('/facility', adminFacilityRouter);
