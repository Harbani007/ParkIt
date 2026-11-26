import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { isValidDate } from '../../lib/time.js';
import { facilityId } from '../../services/facility.js';
import { checkInBooking, checkOutBooking, listForDay, toBookingJson } from '../../services/bookings.js';

// Mounted under requireAuth + requireRole('admin') in admin/index.js.
export const adminBookingsRouter = Router();

const listQuery = z.object({
  date: z.string().refine(isValidDate, 'Must be a date as YYYY-MM-DD'),
  status: z.enum(['confirmed', 'checked_in', 'completed', 'cancelled', 'missed']).optional(),
});

adminBookingsRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const { date, status } = req.valid.query;
  const now = new Date();
  const rows = await listForDay({ date, status, now, facilityId: facilityId() });
  const viewer = req.user;
  res.json({
    date,
    bookings: await Promise.all(rows.map((r) => toBookingJson(r, { viewer, now, includeCustomer: true }))),
  });
});

adminBookingsRouter.post('/:code/check-in', async (req, res) => {
  const now = new Date();
  const row = await checkInBooking({ code: req.params.code, now });
  res.json(await toBookingJson(row, { viewer: req.user, now }));
});

adminBookingsRouter.post('/:code/check-out', async (req, res) => {
  const now = new Date();
  const row = await checkOutBooking({ code: req.params.code, now });
  res.json(await toBookingJson(row, { viewer: req.user, now }));
});
