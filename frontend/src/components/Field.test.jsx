import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Field from './Field.jsx';

describe('Field', () => {
  it('wires label to the generated input id', () => {
    render(<Field label="Email" />);
    const input = screen.getByLabelText('Email');
    expect(input.tagName).toBe('INPUT');
    expect(input.id).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('uses an explicit id', () => {
    render(<Field label="Plate" id="plate" />);
    expect(screen.getByLabelText('Plate').id).toBe('plate');
  });

  it('describes the control by hint', () => {
    render(<Field label="Phone" id="p" hint="10 digits" />);
    const input = screen.getByLabelText('Phone');
    expect(input.getAttribute('aria-describedby')).toBe('p-hint');
    expect(document.getElementById('p-hint').textContent).toBe('10 digits');
  });

  it('marks invalid and links the error, after the hint', () => {
    render(<Field label="Phone" id="p" hint="10 digits" error="Too short" />);
    const input = screen.getByLabelText('Phone');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('p-hint p-error');
    expect(document.getElementById('p-error').textContent).toBe('Too short');
  });

  it('shows a required marker hidden from assistive tech', () => {
    render(<Field label="Name" required />);
    expect(screen.getByLabelText(/Name/).required).toBe(true);
    expect(document.querySelector('label [aria-hidden="true"]').textContent).toContain('*');
  });

  it('passes control props through and supports select with options', () => {
    render(
      <Field
        label="Type"
        as="select"
        defaultValue="bike"
        options={[
          <option key="c" value="car">Car</option>,
          <option key="b" value="bike">Bike</option>,
        ]}
      />,
    );
    const select = screen.getByLabelText('Type');
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('bike');
  });

  it('enhances a child control and keeps its own aria-describedby', () => {
    render(
      <Field label="Notes" id="n" error="Bad">
        <textarea aria-describedby="extra" />
      </Field>,
    );
    const ta = screen.getByLabelText('Notes');
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta.id).toBe('n');
    expect(ta.getAttribute('aria-describedby')).toBe('extra n-error');
    expect(ta.getAttribute('aria-invalid')).toBe('true');
  });
});
