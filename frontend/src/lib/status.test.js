import { describe, it, expect } from 'vitest';
import { statusLabel, statusTone } from './status.js';

describe('status', () => {
  it('labels all five statuses', () => {
    expect(['confirmed', 'checked_in', 'completed', 'cancelled', 'missed'].map(statusLabel))
      .toEqual(['Confirmed', 'Checked in', 'Completed', 'Cancelled', 'Missed']);
  });
  it('maps tones', () => {
    expect(statusTone('missed')).toBe('danger');
    expect(statusTone('checked_in')).toBe('info');
    expect(statusTone('completed')).toBe('success');
    expect(statusTone('cancelled')).toBe('neutral');
    expect(statusTone('confirmed')).toBe('info');
  });
  it('falls back for unknown values', () => {
    expect(statusTone('weird')).toBe('neutral');
    expect(statusLabel('weird')).toBe('weird');
  });
});
