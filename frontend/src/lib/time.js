// Time helpers. Asia/Kolkata is a fixed UTC+05:30 (no DST), so IST arithmetic is a
// 330-minute shift plus getUTC* (assumption F1). Dates are 'YYYY-MM-DD', times 'HH:MM'.
// Everything is pure: callers pass `now`. Display strings are built by hand (not Intl) so
// they are identical in every browser and Node build.

const IST_OFFSET_MIN = 330;
const MIN = 60 * 1000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

function toDate(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// IST wall-clock parts of an instant.
function istParts(value) {
  const d = toDate(value);
  if (!d) return null;
  const s = new Date(d.getTime() + IST_OFFSET_MIN * MIN);
  return {
    date: `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`,
    time: `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`,
    weekday: DAY_NAMES[s.getUTCDay()],
    day: s.getUTCDate(),
    month: MONTH_NAMES[s.getUTCMonth()],
    year: s.getUTCFullYear(),
  };
}

export function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(mins) {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** Today's IST date as 'YYYY-MM-DD'. */
export function todayIST(now = new Date()) {
  return istParts(now).date;
}

/** Add n days (may be negative) to a 'YYYY-MM-DD' date. */
export function addDaysIST(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Latest bookable date: today (IST) + max_advance_days. */
export function maxDateIST(facility, now = new Date()) {
  return addDaysIST(todayIST(now), facility.max_advance_days);
}

/** 'YYYY-MM-DD' + 'HH:MM' -> 'YYYY-MM-DDTHH:MM:00+05:30'. */
export function startsAtISO(date, hhmm) {
  return `${date}T${hhmm}:00+05:30`;
}

/**
 * Valid start times ('HH:MM') on `date`: every :00/:30 from opens_at to closes_at - 1 h.
 * For today only those at or after the start of the current half hour (D7).
 * Past dates give [].
 */
export function startTimeOptions(facility, date, now = new Date()) {
  const today = todayIST(now);
  if (date < today) return [];
  const first = timeToMinutes(facility.opens_at);
  const last = timeToMinutes(facility.closes_at) - 60;
  let from = first;
  if (date === today) {
    const nowMin = timeToMinutes(istParts(now).time);
    from = Math.max(first, nowMin - (nowMin % 30));
  }
  const out = [];
  for (let m = from; m <= last; m += 30) out.push(minutesToTime(m));
  return out;
}

/** Whole-hour durations that end by closing time: [1 .. floor((closes_at - start) / 60)]. */
export function hourOptions(facility, startHHMM) {
  if (!startHHMM) return [];
  const left = Math.floor((timeToMinutes(facility.closes_at) - timeToMinutes(startHHMM)) / 60);
  return Array.from({ length: Math.max(left, 0) }, (_, i) => i + 1);
}

/** 'HH:MM' end time for a start and a number of whole hours. */
export function endTimeLabel(startHHMM, hours) {
  return minutesToTime(timeToMinutes(startHHMM) + hours * 60);
}

/** True when the booking starts less than 2 hours from now (customer cannot cancel, D8). */
export function isWithinCancelWindow(startsAt, now = new Date()) {
  const s = toDate(startsAt);
  const n = toDate(now);
  if (!s || !n) return false;
  return s.getTime() - n.getTime() < 2 * 60 * MIN;
}

/** 'Tue, 1 Dec 2026' (IST). Accepts an ISO string or a Date. */
export function formatDate(value) {
  const p = istParts(value);
  return p ? `${p.weekday}, ${p.day} ${p.month} ${p.year}` : '—';
}

/** '10:00 IST'. */
export function formatTime(value) {
  const p = istParts(value);
  return p ? `${p.time} IST` : '—';
}

/** 'Tue, 1 Dec 2026 · 10:00 IST'. */
export function formatDateTime(value) {
  const p = istParts(value);
  return p ? `${formatDate(value)} · ${p.time} IST` : '—';
}

/** 'Tue, 1 Dec 2026 · 10:00 – 13:00 IST'; adds the end date if it differs. */
export function formatTimeRange(starts, ends) {
  const a = istParts(starts);
  const b = istParts(ends);
  if (!a || !b) return '—';
  if (a.date === b.date) return `${formatDate(starts)} · ${a.time} – ${b.time} IST`;
  return `${formatDate(starts)} · ${a.time} – ${formatDate(ends)} · ${b.time} IST`;
}
