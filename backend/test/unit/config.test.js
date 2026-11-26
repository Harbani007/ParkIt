import { describe, it, expect } from 'vitest';
import { intFromEnv } from '../../src/config.js';

describe('intFromEnv', () => {
  it('parses valid non-negative integers', () => {
    expect(intFromEnv('4000', 1)).toBe(4000);
    expect(intFromEnv(' 2 ', 0)).toBe(2);
    expect(intFromEnv('0', 5)).toBe(0);
  });

  it('falls back when blank, missing or not an integer', () => {
    for (const bad of [undefined, '', '   ', 'abc', '-1', '1.5', '1e3', '0x10', 'NaN', '99999999999999999999']) {
      expect(intFromEnv(bad, 7), String(bad)).toBe(7);
    }
  });

  it('honours the minimum (positive for FACILITY_ID and AUTH_RATE_LIMIT_MAX)', () => {
    expect(intFromEnv('0', 1, { min: 1 })).toBe(1);
    expect(intFromEnv('3', 1, { min: 1 })).toBe(3);
  });
});
