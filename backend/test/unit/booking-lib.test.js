import { describe, expect, it } from 'vitest';
import { normaliseVehicleNumber } from '../../src/lib/vehicle.js';
import { generateBookingCode, CODE_ALPHABET } from '../../src/lib/bookingCode.js';
import {
  canCancel,
  deriveStatus,
  isOverstayed,
  isValidBookingCode,
} from '../../src/lib/bookingState.js';
import { HttpError } from '../../src/middleware/errors.js';

describe('normaliseVehicleNumber (D9)', () => {
  it('strips spaces and uppercases', () => {
    expect(normaliseVehicleNumber('DL 3C AB 1234')).toBe('DL3CAB1234');
  });
  it('strips dashes', () => {
    expect(normaliseVehicleNumber('dl-3c-ab-1234')).toBe('DL3CAB1234');
  });
  it('accepts the 4 and 12 character limits', () => {
    expect(normaliseVehicleNumber('AB12')).toBe('AB12');
    expect(normaliseVehicleNumber('ABCDEFGH1234')).toBe('ABCDEFGH1234');
  });
  it.each(['AB1', 'DL3C@1234', 'ABCDEFGH12345', '', '   ', undefined, null])('rejects %j with 400', (v) => {
    try {
      normaliseVehicleNumber(v);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect(e.status).toBe(400);
      return;
    }
    throw new Error('expected rejection');
  });
});

describe('generateBookingCode (D14)', () => {
  it('alphabet has 32 characters and no I, O, 0, 1', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[IO01]/);
  });
  it('1000 generated codes all match the pattern', () => {
    for (let i = 0; i < 1000; i++) expect(generateBookingCode()).toMatch(/^PK-[A-HJ-NP-Z2-9]{6}$/);
  });
  it('injected bytes give a known code', () => {
    const code = generateBookingCode(() => Buffer.from([0, 1, 2, 31, 32, 255]));
    // indexes 0,1,2,31,0,31 -> A B C 9 A 9
    expect(code).toBe('PK-ABC9A9');
  });
  it('asks the generator for bytes', () => {
    let asked = 0;
    generateBookingCode((n) => {
      asked = n;
      return Buffer.alloc(n);
    });
    expect(asked).toBeGreaterThanOrEqual(6);
  });
});

describe('isValidBookingCode', () => {
  it('accepts valid and rejects invalid codes', () => {
    expect(isValidBookingCode('PK-7KQ2XM')).toBe(true);
    expect(isValidBookingCode('pk-7kq2xm')).toBe(false); // callers uppercase first
    expect(isValidBookingCode('PK-7KQ2X0')).toBe(false);
    expect(isValidBookingCode('PK-7KQ2XI')).toBe(false);
    expect(isValidBookingCode('PK-7KQ2X')).toBe(false);
    expect(isValidBookingCode('PK-7KQ2XMM')).toBe(false);
    expect(isValidBookingCode(undefined)).toBe(false);
  });
});

describe('booking state', () => {
  const start = new Date('2026-12-01T10:00:00Z');
  const end = new Date('2026-12-01T12:00:00Z');
  const at = (iso) => new Date(iso);
  const row = (over = {}) => ({
    status: 'confirmed',
    user_id: 7,
    starts_at: start,
    ends_at: end,
    checked_out_at: null,
    ...over,
  });

  describe('deriveStatus (D11)', () => {
    it('confirmed before ends_at stays confirmed', () => {
      expect(deriveStatus(row(), at('2026-12-01T11:59:59.999Z'))).toBe('confirmed');
    });
    it('confirmed exactly at ends_at is missed', () => {
      expect(deriveStatus(row(), at('2026-12-01T12:00:00Z'))).toBe('missed');
    });
    it('confirmed after ends_at is missed', () => {
      expect(deriveStatus(row(), at('2026-12-02T00:00:00Z'))).toBe('missed');
    });
    it('other statuses are never changed', () => {
      const late = at('2027-01-01T00:00:00Z');
      for (const status of ['checked_in', 'completed', 'cancelled']) {
        expect(deriveStatus(row({ status }), late)).toBe(status);
      }
    });
    it('accepts ISO strings', () => {
      expect(
        deriveStatus(row({ ends_at: '2026-12-01T12:00:00.000Z' }), at('2026-12-01T12:00:00Z')),
      ).toBe('missed');
    });
  });

  describe('isOverstayed (D10)', () => {
    it('completed: checkout after ends_at is overstayed', () => {
      const r = row({ status: 'completed', checked_out_at: at('2026-12-01T12:00:01Z') });
      expect(isOverstayed(r, at('2026-12-02T00:00:00Z'))).toBe(true);
    });
    it('completed: checkout exactly at ends_at is not', () => {
      const r = row({ status: 'completed', checked_out_at: at('2026-12-01T12:00:00Z') });
      expect(isOverstayed(r, at('2026-12-02T00:00:00Z'))).toBe(false);
    });
    it('completed: checkout before ends_at is not', () => {
      const r = row({ status: 'completed', checked_out_at: at('2026-12-01T11:00:00Z') });
      expect(isOverstayed(r, at('2026-12-02T00:00:00Z'))).toBe(false);
    });
    it('checked_in: before ends_at no, at and after ends_at yes', () => {
      const r = row({ status: 'checked_in' });
      expect(isOverstayed(r, at('2026-12-01T11:59:59.999Z'))).toBe(false);
      expect(isOverstayed(r, at('2026-12-01T12:00:00Z'))).toBe(true);
      expect(isOverstayed(r, at('2026-12-01T13:00:00Z'))).toBe(true);
    });
    it('confirmed and cancelled are never overstayed', () => {
      const late = at('2027-01-01T00:00:00Z');
      expect(isOverstayed(row(), late)).toBe(false);
      expect(isOverstayed(row({ status: 'cancelled' }), late)).toBe(false);
    });
  });

  describe('canCancel (D8 / A5)', () => {
    const owner = { id: 7, role: 'customer' };
    const other = { id: 8, role: 'customer' };
    const admin = { id: 1, role: 'admin' };
    const twoHoursBefore = '2026-12-01T08:00:00Z';

    it('customer owner: allowed exactly 2 h before start, not 1 ms later', () => {
      expect(canCancel(row(), owner, at(twoHoursBefore))).toBe(true);
      expect(canCancel(row(), owner, at('2026-12-01T08:00:00.001Z'))).toBe(false);
      expect(canCancel(row(), owner, at('2026-12-01T07:00:00Z'))).toBe(true);
    });
    it('customer: not after start or when not the owner', () => {
      expect(canCancel(row(), owner, at('2026-12-01T10:30:00Z'))).toBe(false);
      expect(canCancel(row(), other, at('2026-12-01T00:00:00Z'))).toBe(false);
    });
    it('customer owner id may be a string', () => {
      expect(canCancel(row({ user_id: '7' }), owner, at('2026-12-01T00:00:00Z'))).toBe(true);
    });
    it('admin: allowed until ends_at (exclusive), even inside 2 h', () => {
      expect(canCancel(row(), admin, at('2026-12-01T09:00:00Z'))).toBe(true);
      expect(canCancel(row(), admin, at('2026-12-01T11:59:59.999Z'))).toBe(true);
      expect(canCancel(row(), admin, at('2026-12-01T12:00:00Z'))).toBe(false);
    });
    it('nobody can cancel a non-confirmed booking', () => {
      const early = at('2026-12-01T00:00:00Z');
      for (const status of ['checked_in', 'completed', 'cancelled']) {
        expect(canCancel(row({ status }), owner, early)).toBe(false);
        expect(canCancel(row({ status }), admin, early)).toBe(false);
      }
    });
    it('a missed booking cannot be cancelled by admin', () => {
      expect(canCancel(row(), admin, at('2026-12-02T00:00:00Z'))).toBe(false);
    });
  });
});
