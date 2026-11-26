import { describe, it, expect } from 'vitest';
import { formatINR } from './money.js';

describe('formatINR', () => {
  it('formats zero and small amounts', () => {
    expect(formatINR('0.00')).toBe('₹0.00');
    expect(formatINR('280.00')).toBe('₹280.00');
  });
  it('groups thousands and lakhs the Indian way', () => {
    expect(formatINR('4560.00')).toBe('₹4,560.00');
    expect(formatINR('123456.50')).toBe('₹1,23,456.50');
    expect(formatINR('10000000.00')).toBe('₹1,00,00,000.00');
  });
  it('always shows two decimals', () => {
    expect(formatINR('40')).toBe('₹40.00');
    expect(formatINR('40.5')).toBe('₹40.50');
    expect(formatINR(300)).toBe('₹300.00');
  });
  it('shows a dash for missing or invalid values', () => {
    expect(formatINR(null)).toBe('—');
    expect(formatINR(undefined)).toBe('—');
    expect(formatINR('abc')).toBe('—');
  });
});
