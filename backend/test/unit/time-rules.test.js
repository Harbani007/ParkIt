import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatHHMM,
  isValidDate,
  istParts,
  istToUtc,
  istToday,
  timeToMinutes,
} from '../../src/lib/time.js';
import { checkBookingWindow } from '../../src/lib/rules.js';
import { HttpError } from '../../src/middleware/errors.js';

describe('time helpers', () => {
  it('istParts shifts by +05:30', () => {
    expect(istParts(new Date('2026-12-01T04:30:00Z'))).toEqual({ date: '2026-12-01', minutes: 600 });
  });

  it('istParts maps 02:00 IST (previous UTC date) correctly', () => {
    expect(istParts(new Date('2026-12-04T20:30:00Z'))).toEqual({ date: '2026-12-05', minutes: 120 });
  });

  it('istToday rolls over at 18:30 UTC', () => {
    expect(istToday(new Date('2026-12-01T18:29:00Z'))).toBe('2026-12-01');
    expect(istToday(new Date('2026-12-01T18:30:00Z'))).toBe('2026-12-02');
  });

  it('istToUtc converts IST wall time to UTC, accepting HH:MM:SS', () => {
    expect(istToUtc('2026-12-01', '10:00').toISOString()).toBe('2026-12-01T04:30:00.000Z');
    expect(istToUtc('2026-12-05', '02:00:00').toISOString()).toBe('2026-12-04T20:30:00.000Z');
  });

  it('addDays handles month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('timeToMinutes / formatHHMM', () => {
    expect(timeToMinutes('06:00')).toBe(360);
    expect(timeToMinutes('23:30:00')).toBe(1410);
    expect(formatHHMM('06:00:00')).toBe('06:00');
    expect(formatHHMM(1410)).toBe('23:30');
  });

  it('isValidDate', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-2-3')).toBe(false);
    expect(isValidDate('nope')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
});

describe('checkBookingWindow', () => {
  const facility = { opens_at: '06:00:00', closes_at: '23:00:00', max_advance_days: 30 };
  const now = new Date('2026-12-01T04:40:00Z'); // 10:10 IST
  const check = (startsAt, hours, f = facility, n = now) =>
    checkBookingWindow({ startsAt, hours, facility: f, now: n });
  const rejects = (startsAt, hours, f, n) => {
    try {
      check(startsAt, hours, f, n);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect(e.status).toBe(400);
      return e.message;
    }
    throw new Error('expected rejection');
  };

  it('accepts a normal booking and returns UTC dates', () => {
    const r = check('2026-12-02T10:00:00+05:30', 3);
    expect(r.startsAt.toISOString()).toBe('2026-12-02T04:30:00.000Z');
    expect(r.endsAt.toISOString()).toBe('2026-12-02T07:30:00.000Z');
  });

  it('treats +05:30 and Z offsets identically', () => {
    const a = check('2026-12-01T10:00:00+05:30', 2);
    const b = check('2026-12-01T04:30:00Z', 2);
    expect(a.startsAt.getTime()).toBe(b.startsAt.getTime());
    expect(a.endsAt.getTime()).toBe(b.endsAt.getTime());
  });

  it('accepts a :30 start', () => {
    expect(() => check('2026-12-02T10:30:00+05:30', 1)).not.toThrow();
  });

  it('rejects a :15 start', () => {
    rejects('2026-12-02T10:15:00+05:30', 1);
  });

  it('rejects non-zero seconds', () => {
    rejects('2026-12-02T10:00:30+05:30', 1);
  });

  it('rejects zero, fractional and negative hours', () => {
    rejects('2026-12-02T10:00:00+05:30', 0);
    rejects('2026-12-02T10:00:00+05:30', 1.5);
    rejects('2026-12-02T10:00:00+05:30', -1);
  });

  it('rejects an unparseable start', () => {
    rejects('garbage', 1);
  });

  it('rejects a 05:30 start (before opening)', () => {
    rejects('2026-12-02T05:30:00+05:30', 1);
  });

  it('accepts a 06:00 start for 17 h (ends 23:00)', () => {
    const r = check('2026-12-02T06:00:00+05:30', 17);
    expect(r.endsAt.toISOString()).toBe('2026-12-02T17:30:00.000Z');
  });

  it('rejects 06:00 + 18 h and 22:00 + 2 h (ends after closing)', () => {
    rejects('2026-12-02T06:00:00+05:30', 18);
    rejects('2026-12-02T22:00:00+05:30', 2);
  });

  it('accepts 22:00 + 1 h (ends exactly at closing)', () => {
    expect(() => check('2026-12-02T22:00:00+05:30', 1)).not.toThrow();
  });

  it('keeps a booking within one IST date when closing is 23:30', () => {
    const late = { ...facility, closes_at: '23:30' };
    expect(() => check('2026-12-02T22:30:00+05:30', 1, late)).not.toThrow();
    rejects('2026-12-02T23:00:00+05:30', 1, late);
  });

  it('maps 02:00 IST (previous UTC date) correctly', () => {
    const night = { ...facility, opens_at: '00:00' };
    const r = check('2026-12-05T02:00:00+05:30', 2, night);
    expect(r.startsAt.toISOString()).toBe('2026-12-04T20:30:00.000Z');
    // Same instant written in UTC is judged on its IST clock (02:00), not the UTC date.
    expect(() => check('2026-12-04T20:30:00Z', 2, night)).not.toThrow();
    rejects('2026-12-04T20:30:00Z', 1); // 02:00 IST is before 06:00 opening
  });

  it('D7: at 10:10 IST a 10:00 start is accepted and 09:30 rejected', () => {
    expect(() => check('2026-12-01T10:00:00+05:30', 1)).not.toThrow();
    rejects('2026-12-01T09:30:00+05:30', 1);
  });

  it('D7: at exactly 10:30:00 IST a 10:00 start is rejected, 10:30 accepted', () => {
    const n = new Date('2026-12-01T05:00:00Z');
    rejects('2026-12-01T10:00:00+05:30', 1, facility, n);
    expect(() => check('2026-12-01T10:30:00+05:30', 1, facility, n)).not.toThrow();
  });

  it('D7: at 10:29:59.999 IST a 10:00 start is still accepted', () => {
    const n = new Date('2026-12-01T04:59:59.999Z');
    expect(() => check('2026-12-01T10:00:00+05:30', 1, facility, n)).not.toThrow();
  });

  it('D7: IST date exactly max_advance_days ahead accepted, +1 rejected', () => {
    expect(() => check('2026-12-31T10:00:00+05:30', 1)).not.toThrow();
    rejects('2027-01-01T10:00:00+05:30', 1);
  });

  it('D7: max_advance_days uses the IST date of now, not the UTC date', () => {
    // 2026-12-01T20:00Z is 2026-12-02 01:30 IST, so the last day is 2027-01-01.
    const n = new Date('2026-12-01T20:00:00Z');
    expect(() => check('2027-01-01T10:00:00+05:30', 1, facility, n)).not.toThrow();
    rejects('2027-01-02T10:00:00+05:30', 1, facility, n);
  });
});
