import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbUp, pool, tracker, ensureFacility, createUser, createSlot, insertBookingRow, istIso } from './helpers.js';

describe.skipIf(!dbUp)('GET /api/slots/availability', () => {
  const app = createApp();
  let customer;
  let car;
  let bike;
  let blocked;
  const start = istIso(5, '10:00');
  const end3 = istIso(5, '13:00');

  const query = (params) => request(app).get('/api/slots/availability').query(params);
  const find = (res, slot) => res.body.slots.find((s) => s.id === slot.id);
  const book = (slot, from, to, extra = {}) =>
    insertBookingRow({ userId: customer.user.id, slotId: slot.id, startsAt: istIso(5, from), endsAt: istIso(5, to), ...extra });

  beforeAll(async () => {
    await ensureFacility();
    customer = await createUser();
    car = await createSlot({ vehicleType: 'car', hourlyRate: 40, dailyRate: 300 });
    bike = await createSlot({ vehicleType: 'bike', hourlyRate: 15, dailyRate: 100 });
    blocked = await createSlot({ isBlocked: true });
  });

  afterAll(async () => {
    await tracker.cleanup();
    await pool.end();
  });

  it('free slot is available with the right amount and UTC times', async () => {
    const res = await query({ starts_at: start, hours: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ starts_at: start, ends_at: end3, hours: 3 });
    expect(find(res, car)).toEqual({
      id: car.id, code: car.code, vehicle_type: 'car', hourly_rate: '40.00', daily_rate: '300.00', available: true, amount: '120.00',
    });
    expect(find(res, bike)).toMatchObject({ available: true, amount: '45.00' });
  });

  it('applies the daily cap and accepts an IST offset', async () => {
    const eight = await query({ starts_at: start, hours: 8 });
    expect(find(eight, car).amount).toBe('300.00');
    const ist = await query({ starts_at: '2000-01-01T10:00:00+05:30', hours: 1 });
    expect(ist.status).toBe(400); // parsed fine, rejected as past
    expect(ist.body.error).toBe('Start time is in the past');
  });

  it('blocked slots are absent', async () => {
    const res = await query({ starts_at: start, hours: 3 });
    expect(find(res, blocked)).toBeUndefined();
  });

  it('an overlapping confirmed or checked_in booking makes the slot unavailable', async () => {
    const s1 = await createSlot();
    const s2 = await createSlot();
    await book(s1, '11:00', '12:00');
    await book(s2, '09:00', '11:00', { status: 'checked_in', checkedInAt: new Date() });
    const res = await query({ starts_at: start, hours: 3 });
    expect(find(res, s1).available).toBe(false);
    expect(find(res, s2).available).toBe(false);
  });

  it('a back-to-back booking does not make the slot unavailable', async () => {
    const s = await createSlot();
    await book(s, '08:00', '10:00');
    await book(s, '13:00', '14:00');
    const res = await query({ starts_at: start, hours: 3 });
    expect(find(res, s).available).toBe(true);
  });

  it('a cancelled or completed overlapping booking does not count', async () => {
    const s = await createSlot();
    await book(s, '10:00', '13:00', { status: 'cancelled' });
    await book(s, '10:00', '13:00', { status: 'completed', checkedInAt: new Date(), checkedOutAt: new Date() });
    const res = await query({ starts_at: start, hours: 3 });
    expect(find(res, s).available).toBe(true);
  });

  it('vehicle_type filters', async () => {
    const bikes = await query({ starts_at: start, hours: 3, vehicle_type: 'bike' });
    expect(find(bikes, bike)).toBeDefined();
    expect(find(bikes, car)).toBeUndefined();
    expect(bikes.body.slots.every((s) => s.vehicle_type === 'bike')).toBe(true);
    const cars = await query({ starts_at: start, hours: 3, vehicle_type: 'car' });
    expect(find(cars, car)).toBeDefined();
    expect(find(cars, bike)).toBeUndefined();
  });

  it('400 for rule violations and bad input', async () => {
    const cases = {
      'not on :00/:30': { starts_at: istIso(5, '10:15'), hours: 1 },
      'before opening': { starts_at: istIso(5, '05:30'), hours: 1 },
      'ends after closing': { starts_at: istIso(5, '22:00'), hours: 2 },
      'past day': { starts_at: istIso(-1, '10:00'), hours: 1 },
      'too far ahead': { starts_at: istIso(400, '10:00'), hours: 1 },
      'missing hours': { starts_at: start },
      'zero hours': { starts_at: start, hours: 0 },
      'fractional hours': { starts_at: start, hours: '1.5' },
      'missing starts_at': { hours: 1 },
      'no offset': { starts_at: '2030-01-01T10:00:00', hours: 1 },
      'bad type': { starts_at: start, hours: 1, vehicle_type: 'truck' },
    };
    for (const [name, params] of Object.entries(cases)) {
      const res = await query(params);
      expect(res.status, name).toBe(400);
      expect(res.body.error, name).toBeTruthy();
    }
  });

  it('is public and not cached', async () => {
    const res = await query({ starts_at: start, hours: 1 });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
