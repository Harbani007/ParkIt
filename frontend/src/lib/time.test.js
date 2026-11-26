import { describe, it, expect } from 'vitest';
import {
  todayIST, addDaysIST, maxDateIST, startsAtISO, startTimeOptions, hourOptions, endTimeLabel,
  isWithinCancelWindow, formatDate, formatTime, formatDateTime, formatTimeRange,
} from './time.js';

const fac = { opens_at: '06:00', closes_at: '23:00', max_advance_days: 30 };
// 10:10 IST on 1 Dec 2026 = 04:40 UTC
const at1010 = new Date('2026-12-01T04:40:00Z');

describe('todayIST', () => {
  it('maps a UTC instant near midnight to the IST date', () => {
    expect(todayIST(new Date('2026-12-01T18:29:00Z'))).toBe('2026-12-01'); // 23:59 IST
    expect(todayIST(new Date('2026-12-01T18:30:00Z'))).toBe('2026-12-02'); // 00:00 IST
    expect(todayIST(new Date('2026-12-01T00:10:00Z'))).toBe('2026-12-01');
  });
});

describe('addDaysIST / maxDateIST', () => {
  it('crosses month and year ends', () => {
    expect(addDaysIST('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIST('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIST('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('adds max_advance_days to today', () => {
    expect(maxDateIST(fac, at1010)).toBe('2026-12-31');
  });
});

describe('startsAtISO', () => {
  it('builds an IST offset timestamp', () => {
    expect(startsAtISO('2026-12-01', '10:00')).toBe('2026-12-01T10:00:00+05:30');
  });
});

describe('startTimeOptions', () => {
  it('today at 10:10 starts at 10:00', () => {
    const o = startTimeOptions(fac, '2026-12-01', at1010);
    expect(o[0]).toBe('10:00');
    expect(o[1]).toBe('10:30');
    expect(o.at(-1)).toBe('22:00');
  });
  it('a future date lists the whole day', () => {
    const o = startTimeOptions(fac, '2026-12-02', at1010);
    expect(o[0]).toBe('06:00');
    expect(o.at(-1)).toBe('22:00');
    expect(o).toHaveLength(33);
  });
  it('honours opens_at 06:30', () => {
    const o = startTimeOptions({ ...fac, opens_at: '06:30' }, '2026-12-02', at1010);
    expect(o[0]).toBe('06:30');
  });
  it('closes_at 23:00 gives last start 22:00; 23:30 gives 22:30', () => {
    expect(startTimeOptions(fac, '2026-12-02', at1010).at(-1)).toBe('22:00');
    expect(startTimeOptions({ ...fac, closes_at: '23:30' }, '2026-12-02', at1010).at(-1)).toBe('22:30');
  });
  it('today before opening starts at opening', () => {
    const early = new Date('2026-11-30T23:00:00Z'); // 04:30 IST on 1 Dec
    expect(startTimeOptions(fac, '2026-12-01', early)[0]).toBe('06:00');
  });
  it('today after the last start is empty; past dates are empty', () => {
    const late = new Date('2026-12-01T17:00:00Z'); // 22:30 IST
    expect(startTimeOptions(fac, '2026-12-01', late)).toEqual([]);
    expect(startTimeOptions(fac, '2026-11-30', at1010)).toEqual([]);
  });
  it('uses the IST date, not the UTC date, for "today"', () => {
    const now = new Date('2026-12-01T18:40:00Z'); // 00:10 IST on 2 Dec
    expect(startTimeOptions(fac, '2026-12-02', now)[0]).toBe('06:00');
    expect(startTimeOptions(fac, '2026-12-01', now)).toEqual([]);
  });
});

describe('hourOptions', () => {
  it('lists 1..hours left until closing', () => {
    expect(hourOptions(fac, '06:00')).toHaveLength(17);
    expect(hourOptions(fac, '20:00')).toEqual([1, 2, 3]);
  });
  it('shrinks near closing', () => {
    expect(hourOptions(fac, '22:00')).toEqual([1]);
    expect(hourOptions(fac, '22:30')).toEqual([]);
    expect(hourOptions({ ...fac, closes_at: '23:30' }, '22:30')).toEqual([1]);
  });
  it('is empty without a start', () => {
    expect(hourOptions(fac, '')).toEqual([]);
  });
});

describe('endTimeLabel', () => {
  it('adds whole hours', () => {
    expect(endTimeLabel('10:00', 3)).toBe('13:00');
    expect(endTimeLabel('10:30', 2)).toBe('12:30');
  });
});

describe('isWithinCancelWindow', () => {
  const now = new Date('2026-12-01T04:30:00Z');
  it('true under 2 hours', () => {
    expect(isWithinCancelWindow('2026-12-01T06:29:00Z', now)).toBe(true);
    expect(isWithinCancelWindow('2026-12-01T04:00:00Z', now)).toBe(true);
  });
  it('false at exactly 2 hours or more', () => {
    expect(isWithinCancelWindow('2026-12-01T06:30:00Z', now)).toBe(false);
    expect(isWithinCancelWindow('2026-12-02T06:30:00Z', now)).toBe(false);
  });
  it('accepts IST offset strings', () => {
    expect(isWithinCancelWindow('2026-12-01T11:00:00+05:30', now)).toBe(true); // 05:30Z
  });
});

describe('formatting', () => {
  it('formats date, time and date-time in IST', () => {
    expect(formatDate('2026-12-01T04:30:00.000Z')).toBe('Tue, 1 Dec 2026');
    expect(formatTime('2026-12-01T04:30:00.000Z')).toBe('10:00 IST');
    expect(formatDateTime('2026-12-01T04:30:00.000Z')).toBe('Tue, 1 Dec 2026 · 10:00 IST');
  });
  it('uses the IST date for late-evening UTC instants', () => {
    expect(formatDate('2026-12-01T20:00:00.000Z')).toBe('Wed, 2 Dec 2026');
  });
  it('formats a range', () => {
    expect(formatTimeRange('2026-12-01T04:30:00.000Z', '2026-12-01T07:30:00.000Z'))
      .toBe('Tue, 1 Dec 2026 · 10:00 – 13:00 IST');
  });
  it('shows both dates when the range crosses midnight', () => {
    expect(formatTimeRange('2026-12-01T17:00:00.000Z', '2026-12-01T19:00:00.000Z'))
      .toBe('Tue, 1 Dec 2026 · 22:30 – Wed, 2 Dec 2026 · 00:30 IST');
  });
  it('returns a dash for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatTime('nope')).toBe('—');
    expect(formatTimeRange(null, null)).toBe('—');
  });
});
