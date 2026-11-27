import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getFacility } from '../services/facility.js';
import {
  cancelBooking,
  createBooking,
  getBookingFor,
  listMine,
  toBookingJson,
} from '../services/bookings.js';
import { sendBookingEmail } from '../services/notify.js';

export const bookingsRouter = Router();

const createBody = z
  .object({
    space_id: z.number().int().positive().nullish(),
    slot_id: z.number().int().positive().nullish(),
    vehicle_type: z.enum(['car', 'bike']).nullish(),
    starts_at: z.string().datetime({ offset: true, message: 'Must be an ISO 8601 time with an offset' }),
    hours: z.number().int().min(1).max(24),
    vehicle_number: z.string().min(1).max(30),
  })
  .refine((b) => b.slot_id != null || b.vehicle_type != null, {
    message: 'Provide slot_id or vehicle_type',
    path: ['vehicle_type'],
  });

const mineQuery = z.object({ scope: z.enum(['active', 'past']).default('active') });

bookingsRouter.post('/', requireAuth, requireRole('customer'), validate({ body: createBody }), async (req, res) => {
  const b = req.valid.body;
  const now = new Date();
  const row = await createBooking({
    facility: await getFacility(b.space_id ?? undefined),
    userId: req.user.id,
    slotId: b.slot_id ?? undefined,
    vehicleType: b.vehicle_type ?? undefined,
    startsAt: b.starts_at,
    hours: b.hours,
    vehicleNumber: b.vehicle_number,
    now,
  });
  res.status(201).json(await toBookingJson(row, { viewer: req.user, now }));
  sendBookingEmail('confirmed', row); // after the response; never fails the booking (D21)
});

// Declared before '/:code' so "mine" is not read as a booking code.
bookingsRouter.get('/mine', requireAuth, requireRole('customer'), validate({ query: mineQuery }), async (req, res) => {
  const now = new Date();
  const rows = await listMine({ userId: req.user.id, scope: req.valid.query.scope, now });
  res.json({ bookings: await Promise.all(rows.map((r) => toBookingJson(r, { viewer: req.user, now }))) });
});

bookingsRouter.get('/:code', requireAuth, async (req, res) => {
  const now = new Date();
  const row = await getBookingFor(req.params.code, req.user);
  res.json(await toBookingJson(row, { viewer: req.user, now, includeCustomer: req.user.role === 'admin' }));
});

bookingsRouter.post('/:code/cancel', requireAuth, async (req, res) => {
  const now = new Date();
  const row = await cancelBooking({ code: req.params.code, viewer: req.user, now });
  res.json(await toBookingJson(row, { viewer: req.user, now, includeCustomer: req.user.role === 'admin' }));
  sendBookingEmail('cancelled', row);
});
