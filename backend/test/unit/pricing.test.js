import { describe, expect, it } from 'vitest';
import { priceFor } from '../../src/lib/pricing.js';

describe('priceFor (D5)', () => {
  it('car 7 h is hourly total', () => expect(priceFor(7, '40.00', '300.00')).toBe('280.00'));
  it('car 8 h is capped by the daily rate', () => expect(priceFor(8, '40.00', '300.00')).toBe('300.00'));
  it('car 17 h is capped by the daily rate', () => expect(priceFor(17, '40.00', '300.00')).toBe('300.00'));
  it('bike 3 h', () => expect(priceFor(3, '15.00', '100.00')).toBe('45.00'));
  it('car 3 h is 120.00', () => expect(priceFor(3, '40.00', '300.00')).toBe('120.00'));

  it('accepts numbers and short strings', () => {
    expect(priceFor(2, 40, 300)).toBe('80.00');
    expect(priceFor(1, '12.5', '100')).toBe('12.50');
  });

  it('is exact in paise (no float drift)', () => {
    expect(priceFor(3, '0.10', '10.00')).toBe('0.30');
    expect(priceFor(7, '19.99', '1000.00')).toBe('139.93');
  });

  it('rejects malformed money', () => {
    expect(() => priceFor(1, 'abc', '10')).toThrow();
    expect(() => priceFor(1, '-5', '10')).toThrow();
  });
});
