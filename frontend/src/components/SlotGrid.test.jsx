import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SlotGrid, { ANY_SLOT, anySlotPrice } from './SlotGrid.jsx';

const slots = [
  { id: 1, code: 'A1', available: true, amount: '40.00' },
  { id: 2, code: 'A2', available: false, amount: '40.00' },
  { id: 3, code: 'A3', available: true, amount: '60.00' },
];

describe('anySlotPrice', () => {
  it('returns null when nothing is free', () => {
    expect(anySlotPrice([{ id: 1, available: false, amount: '10.00' }])).toBeNull();
  });
  it('shows the common price when all free slots agree', () => {
    expect(anySlotPrice([slots[0], slots[1]]).text).toBe('₹40.00');
  });
  it('shows "from <lowest>" when free slots differ', () => {
    expect(anySlotPrice(slots).text).toBe('from ₹40.00');
  });
});

describe('SlotGrid', () => {
  it('renders the Any free slot tile first, then slots in order', () => {
    render(<SlotGrid slots={slots} value={null} onChange={() => {}} />);
    const codes = Array.from(document.querySelectorAll('.slot-code')).map((e) => e.textContent);
    expect(codes).toEqual(['Any free slot', 'A1', 'A2', 'A3']);
    expect(screen.getByText('from ₹40.00')).toBeTruthy();
  });

  it('disables unavailable tiles and says why in text', () => {
    render(<SlotGrid slots={slots} value={null} onChange={() => {}} />);
    const a2 = screen.getByLabelText(/A2/);
    expect(a2.disabled).toBe(true);
    expect(screen.getByText('Booked for this time')).toBeTruthy();
    expect(screen.getByLabelText(/A1/).disabled).toBe(false);
  });

  it('disables the any tile with "None free" when nothing is available', () => {
    const none = slots.map((s) => ({ ...s, available: false }));
    render(<SlotGrid slots={none} value={null} onChange={() => {}} />);
    expect(screen.getByLabelText(/Any free slot/).disabled).toBe(true);
    expect(screen.getByText('None free')).toBeTruthy();
  });

  it('calls onChange with a slot id or ANY_SLOT', () => {
    const onChange = vi.fn();
    render(<SlotGrid slots={slots} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/A3/));
    expect(onChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByLabelText(/Any free slot/));
    expect(onChange).toHaveBeenLastCalledWith(ANY_SLOT);
  });

  it('reflects the selected value', () => {
    render(<SlotGrid slots={slots} value={3} onChange={() => {}} />);
    expect(screen.getByLabelText(/A3/).checked).toBe(true);
    expect(screen.getByLabelText(/A1/).checked).toBe(false);
    expect(screen.getByLabelText(/A3/).closest('label').className).toContain('is-selected');
  });

  it('disables every tile when disabled', () => {
    render(<SlotGrid slots={slots} value={null} onChange={() => {}} disabled />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios.every((r) => r.disabled)).toBe(true);
  });
});
