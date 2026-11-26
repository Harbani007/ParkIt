// IST helpers. Asia/Kolkata is a fixed UTC+05:30 offset with no DST (assumption A1), so we
// shift by 330 minutes and read the result with getUTC* methods. No timezone library needed.

export const IST_OFFSET_MIN = 330;
const MIN_MS = 60_000;
const DAY_MIN = 24 * 60;

const pad = (n) => String(n).padStart(2, '0');

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** IST calendar date and minutes since IST midnight for an instant. */
export function istParts(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * MIN_MS);
  const iso = shifted.toISOString();
  return {
    date: iso.slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** 'HH:MM' or 'HH:MM:SS' -> minutes since midnight. */
export function timeToMinutes(t) {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(t));
  if (!m) throw new Error(`Invalid time: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight -> 'HH:MM'. A 'HH:MM[:SS]' string is normalised to 'HH:MM'. */
export function formatHHMM(value) {
  const minutes = typeof value === 'number' ? value : timeToMinutes(value);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** IST wall-clock date + 'HH:MM[:SS]' -> UTC Date. */
export function istToUtc(dateStr, hhmm) {
  if (!isValidDate(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
  const minutes = timeToMinutes(hhmm);
  const midnightUtc = Date.parse(`${dateStr}T00:00:00Z`);
  return new Date(midnightUtc + (minutes - IST_OFFSET_MIN) * MIN_MS);
}

/** Today's IST date (YYYY-MM-DD) at instant `now`. */
export function istToday(now) {
  return istParts(now).date;
}

/** Calendar-date arithmetic on YYYY-MM-DD. */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export { DAY_MIN };
