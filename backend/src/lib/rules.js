import { HttpError } from '../middleware/errors.js';
import { addDays, formatHHMM, istParts, timeToMinutes } from './time.js';

const MIN_MS = 60_000;

/**
 * Validate a booking window against D2, D6 and D7 and return the UTC range.
 * facility: { opens_at, closes_at, max_advance_days } (times as 'HH:MM' or 'HH:MM:SS').
 * startsAt: ISO 8601 string with an offset, or a Date. Throws HttpError(400) on any violation.
 */
export function checkBookingWindow({ startsAt, hours, facility, now }) {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Invalid start time');

  // D2: whole hours, start on :00 or :30 IST.
  if (!Number.isInteger(hours) || hours < 1) {
    throw new HttpError(400, 'Duration must be a whole number of hours, at least 1');
  }
  const startParts = istParts(start);
  if (
    start.getUTCSeconds() !== 0 ||
    start.getUTCMilliseconds() !== 0 ||
    startParts.minutes % 30 !== 0
  ) {
    throw new HttpError(400, 'Start time must be on the hour or half hour');
  }

  // D6: inside one day's opening window. Closing time is at most 24:00 (same date).
  const opens = timeToMinutes(facility.opens_at);
  const closes = timeToMinutes(facility.closes_at);
  const endMinutes = startParts.minutes + hours * 60;
  if (startParts.minutes < opens) {
    throw new HttpError(400, `Start time is before opening time (${formatHHMM(opens)})`);
  }
  if (endMinutes > closes) {
    throw new HttpError(
      400,
      `Booking must end by closing time (${formatHHMM(closes)}) on the same day`,
    );
  }

  // D7: not before the start of the current IST half hour, not beyond max_advance_days.
  const nowParts = istParts(now);
  const halfHourStart = new Date(
    now.getTime() - (nowParts.minutes % 30) * MIN_MS - (now.getUTCSeconds() * 1000 + now.getUTCMilliseconds()),
  );
  if (start.getTime() < halfHourStart.getTime()) {
    throw new HttpError(400, 'Start time is in the past');
  }
  if (startParts.date > addDays(nowParts.date, facility.max_advance_days)) {
    throw new HttpError(
      400,
      `Bookings can be made at most ${facility.max_advance_days} days ahead`,
    );
  }

  return { startsAt: start, endsAt: new Date(start.getTime() + hours * 60 * MIN_MS) };
}
