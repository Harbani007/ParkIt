import { describe, it, expect } from 'vitest';
import {
  normaliseBookingCode, isValidBookingCode, normaliseVehicleNumber, isValidVehicleNumber,
} from './codes.js';

describe('normaliseBookingCode', () => {
  it('uppercases and trims', () => {
    expect(normaliseBookingCode('  pk-7kq2xm ')).toBe('PK-7KQ2XM');
  });
  it('adds the missing dash', () => {
    expect(normaliseBookingCode('pk7kq2xm')).toBe('PK-7KQ2XM');
  });
  it('removes inner spaces', () => {
    expect(normaliseBookingCode('pk 7kq 2xm')).toBe('PK-7KQ2XM');
  });
  it('leaves other input cleaned but unchanged', () => {
    expect(normaliseBookingCode('abc')).toBe('ABC');
    expect(normaliseBookingCode(null)).toBe('');
  });
  it('validates against the server alphabet', () => {
    expect(isValidBookingCode('PK-7KQ2XM')).toBe(true);
    expect(isValidBookingCode('PK-7KQ2XI')).toBe(false); // I excluded
    expect(isValidBookingCode('PK-7KQ2X0')).toBe(false); // 0 excluded
    expect(isValidBookingCode('PK-7KQ2X')).toBe(false);
  });
});

describe('vehicle numbers', () => {
  it('normalises like the server', () => {
    expect(normaliseVehicleNumber('dl 3c ab-1234')).toBe('DL3CAB1234');
    expect(normaliseVehicleNumber(undefined)).toBe('');
  });
  it('validates 4-12 alphanumerics', () => {
    expect(isValidVehicleNumber('DL3CAB1234')).toBe(true);
    expect(isValidVehicleNumber('AB1')).toBe(false);
    expect(isValidVehicleNumber('A'.repeat(13))).toBe(false);
    expect(isValidVehicleNumber('AB_123')).toBe(false);
    expect(isValidVehicleNumber('')).toBe(false);
  });
});
