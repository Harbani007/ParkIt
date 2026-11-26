import { useEffect, useId, useRef } from 'react';
import Spinner from './Spinner.jsx';

// Controlled native <dialog>. showModal() when `open` becomes true; Escape or the cancel button
// calls onCancel; focus returns to the element focused before opening. While `busy`, both buttons
// are disabled and Escape is ignored.
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Keep',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);
  const returnTo = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      returnTo.current = document.activeElement;
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    } else if (!open && dlg.open) {
      if (typeof dlg.close === 'function') dlg.close();
      else dlg.removeAttribute('open');
      restoreFocus();
    }
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    return () => {
      if (dlg?.open && typeof dlg.close === 'function') dlg.close();
    };
  }, []);

  function restoreFocus() {
    const el = returnTo.current;
    returnTo.current = null;
    if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
  }

  // Fired by Escape (after the cancel event) or dialog.close().
  function handleClose() {
    restoreFocus();
    if (open) onCancel?.();
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={handleClose}
      onCancel={(e) => { if (busy) e.preventDefault(); }}
    >
      <h2 id={titleId}>{title}</h2>
      <div>{children}</div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={() => onCancel?.()} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => onConfirm?.()}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? <Spinner inline /> : null}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
