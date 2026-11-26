import { HttpError } from '../middleware/errors.js';

export const CONSTRAINTS = {
  SLOT_OVERLAP: 'bookings_no_slot_overlap',
  VEHICLE_OVERLAP: 'bookings_no_vehicle_overlap',
  USER_EMAIL: 'users_email_key',
  SLOT_CODE: 'slots_facility_id_code_key',
  BOOKING_CODE: 'bookings_booking_code_key',
  PAYMENT_BOOKING: 'payments_booking_id_key',
  BOOKING_SLOT_FK: 'bookings_slot_id_fkey',
};

// Maps a Postgres error to an HttpError; returns the error unchanged when it is not one we map.
// Branches on err.constraint only, never on the message text.
export function mapPgError(err) {
  if (!err || typeof err.code !== 'string' || err instanceof HttpError) return err;
  const c = err.constraint;
  switch (err.code) {
    case '23P01':
      if (c === CONSTRAINTS.VEHICLE_OVERLAP) return new HttpError(409, 'This vehicle already has a booking at that time');
      if (c === CONSTRAINTS.SLOT_OVERLAP) return new HttpError(409, 'This slot was just booked for that time');
      return err;
    case '23505':
      if (c === CONSTRAINTS.USER_EMAIL) return new HttpError(409, 'Email already registered');
      if (c === CONSTRAINTS.SLOT_CODE) return new HttpError(409, 'Slot code already used');
      return new HttpError(409, 'Already exists');
    case '23503':
      if (c === CONSTRAINTS.BOOKING_SLOT_FK) return new HttpError(409, 'Slot has bookings; block it instead');
      return err;
    case '23514':
      return new HttpError(400, 'Invalid data');
    default:
      return err;
  }
}
