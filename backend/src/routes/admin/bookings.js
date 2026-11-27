import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../middleware/errors.js';
import { isValidDate } from '../../lib/time.js';
import {
  cancelBooking,
  checkInBooking,
  checkOutBooking,
  findBookingByCode,
  listForDay,
  parseBookingCode,
  toBookingJson,
} from '../../services/bookings.js';

// Mounted under the admin or host scope (admin/index.js): req.space is the space managed.
export const adminBookingsRouter = Router();

const listQuery = z.object({
  space_id: z.string().optional(),
  date: z.string().refine(isValidDate, 'Must be a date as YYYY-MM-DD'),
  status: z.enum(['confirmed', 'checked_in', 'completed', 'cancelled', 'missed']).optional(),
});

// A booking code at another space is a 404 (D24); the admin without space_id sees every space.
async function inScope(req) {
  const row = await findBookingByCode(parseBookingCode(req.params.code));
  if (!row || (!req.scopeAll && row.space_id !== req.space.id)) throw new HttpError(404, 'Booking not found');
  return row;
}

const manager = (req) => ({ id: req.user.id, role: 'admin' });
const json = (row, req, now) => toBookingJson(row, { viewer: manager(req), now, includeCustomer: true });

adminBookingsRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const { date, status } = req.valid.query;
  const now = new Date();
  const rows = await listForDay({ date, status, now, facilityId: req.allSpaces ? null : req.space.id });
  res.json({ date, bookings: await Promise.all(rows.map((r) => json(r, req, now))) });
});

adminBookingsRouter.get('/:code', async (req, res) => {
  res.json(await json(await inScope(req), req, new Date()));
});

adminBookingsRouter.post('/:code/check-in', async (req, res) => {
  const now = new Date();
  await inScope(req);
  res.json(await json(await checkInBooking({ code: req.params.code, now }), req, now));
});

adminBookingsRouter.post('/:code/check-out', async (req, res) => {
  const now = new Date();
  await inScope(req);
  res.json(await json(await checkOutBooking({ code: req.params.code, now }), req, now));
});

// Admin rules for cancelling (D8): until the booking ends, with a refund.
adminBookingsRouter.post('/:code/cancel', async (req, res) => {
  const now = new Date();
  await inScope(req);
  res.json(await json(await cancelBooking({ code: req.params.code, viewer: manager(req), now }), req, now));
});
