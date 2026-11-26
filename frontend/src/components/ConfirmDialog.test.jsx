import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog.jsx';

// jsdom has no showModal/close; emulate the open attribute and the close event.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function setup(props = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog
      open={false}
      title="Cancel booking?"
      confirmLabel="Cancel booking"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    >
      This cannot be undone.
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel, ...utils };
}

describe('ConfirmDialog', () => {
  it('is closed until open is true, then opens and is labelled by its title', () => {
    const { rerender, onConfirm, onCancel } = setup();
    const dlg = document.querySelector('dialog');
    expect(dlg.hasAttribute('open')).toBe(false);

    rerender(
      <ConfirmDialog open title="Cancel booking?" onConfirm={onConfirm} onCancel={onCancel}>
        This cannot be undone.
      </ConfirmDialog>,
    );
    expect(dlg.hasAttribute('open')).toBe(true);
    const heading = screen.getByRole('heading', { name: 'Cancel booking?', hidden: true });
    expect(dlg.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
  });

  it('closes when open goes back to false without calling onCancel', () => {
    const { rerender, onConfirm, onCancel } = setup({ open: true });
    const dlg = document.querySelector('dialog');
    expect(dlg.hasAttribute('open')).toBe(true);
    rerender(
      <ConfirmDialog open={false} title="x" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(dlg.hasAttribute('open')).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onConfirm and onCancel from the buttons', () => {
    const { onConfirm, onCancel } = setup({ open: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking', hidden: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep', hidden: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and marks confirm busy while busy', () => {
    const { onConfirm, onCancel } = setup({ open: true, busy: true });
    const keep = screen.getByRole('button', { name: 'Keep', hidden: true });
    const confirm = screen.getByRole('button', { name: /Cancel booking/, hidden: true });
    expect(keep.disabled).toBe(true);
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(keep);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('prevents the Escape cancel event while busy but not otherwise', () => {
    const { rerender, onConfirm, onCancel } = setup({ open: true, busy: true });
    const dlg = document.querySelector('dialog');
    const busyEvt = new Event('cancel', { cancelable: true });
    dlg.dispatchEvent(busyEvt);
    expect(busyEvt.defaultPrevented).toBe(true);

    rerender(<ConfirmDialog open title="x" onConfirm={onConfirm} onCancel={onCancel} />);
    const idleEvt = new Event('cancel', { cancelable: true });
    dlg.dispatchEvent(idleEvt);
    expect(idleEvt.defaultPrevented).toBe(false);
  });

  it('calls onCancel when the dialog fires close while open (Escape)', () => {
    const { onCancel } = setup({ open: true });
    document.querySelector('dialog').dispatchEvent(new Event('close'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
