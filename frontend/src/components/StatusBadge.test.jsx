import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge.jsx';

describe('StatusBadge', () => {
  it.each([
    ['confirmed', 'Confirmed'],
    ['checked_in', 'Checked in'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled'],
    ['missed', 'Missed'],
  ])('renders %s as "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Overstayed')).toBeNull();
  });

  it('uses danger tone for missed', () => {
    render(<StatusBadge status="missed" />);
    expect(screen.getByText('Missed').className).toContain('badge-danger');
  });

  it('accepts a booking object', () => {
    render(<StatusBadge booking={{ status: 'checked_in', overstayed: false }} />);
    expect(screen.getByText('Checked in')).toBeTruthy();
  });

  it('shows an extra Overstayed badge when overstayed', () => {
    render(<StatusBadge booking={{ status: 'checked_in', overstayed: true }} />);
    expect(screen.getByText('Checked in')).toBeTruthy();
    expect(screen.getByText('Overstayed').className).toContain('badge-warning');
  });

  it('overstayed prop overrides the booking field', () => {
    render(<StatusBadge status="checked_in" overstayed />);
    expect(screen.getByText('Overstayed')).toBeTruthy();
  });
});
