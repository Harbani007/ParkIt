import { useCallback, useEffect, useRef, useState } from 'react';
import { adminSlots, createSlot, updateSlot, deleteSlot } from '../../api/parkit.js';
import PageHeader from '../../components/PageHeader.jsx';
import Alert from '../../components/Alert.jsx';
import Spinner from '../../components/Spinner.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import SlotForm from '../../components/admin/SlotForm.jsx';
import { formatINR } from '../../lib/money.js';

const isAbort = (e) => e?.name === 'AbortError';

export default function Slots() {
  const [slots, setSlots] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null); // null | 'new' | slot object
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }
  const [blockTarget, setBlockTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);
  const addRef = useRef(null);

  const load = useCallback(async (signal) => {
    setLoadError('');
    try {
      const res = await adminSlots({ signal });
      setSlots(res.slots);
    } catch (err) {
      if (isAbort(err)) return;
      setLoadError(err.message || 'Could not load slots.');
      setSlots((s) => s ?? []);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  async function save(values) {
    setSaving(true);
    setFormError('');
    try {
      if (form === 'new') {
        const created = await createSlot(values);
        setNotice({ tone: 'success', text: `Slot ${created.code} added.` });
      } else {
        const changes = {};
        if (values.code !== form.code) changes.code = values.code;
        if (values.vehicle_type !== form.vehicle_type) changes.vehicle_type = values.vehicle_type;
        if (values.hourly_rate !== Number(form.hourly_rate)) changes.hourly_rate = values.hourly_rate;
        if (values.daily_rate !== Number(form.daily_rate)) changes.daily_rate = values.daily_rate;
        if (Object.keys(changes).length === 0) {
          setForm(null);
          setNotice({ tone: 'info', text: 'No changes to save.' });
          return;
        }
        const updated = await updateSlot(form.id, changes);
        setNotice({
          tone: 'success',
          text: `Slot ${updated.code} saved.${changes.hourly_rate !== undefined || changes.daily_rate !== undefined ? ' New rates apply to new bookings only.' : ''}`,
        });
      }
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err.message || 'Could not save the slot.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleBlock() {
    const slot = blockTarget;
    setBusy(true);
    try {
      await updateSlot(slot.id, { is_blocked: !slot.is_blocked });
      setNotice({ tone: 'success', text: `Slot ${slot.code} ${slot.is_blocked ? 'unblocked' : 'blocked'}.` });
      setBlockTarget(null);
      await load();
    } catch (err) {
      setBlockTarget(null);
      setNotice({ tone: 'danger', text: err.message || 'Could not update the slot.' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const slot = deleteTarget;
    setBusy(true);
    setDeleteError('');
    try {
      await deleteSlot(slot.id);
      setNotice({ tone: 'success', text: `Slot ${slot.code} deleted.` });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      // Keep the dialog open so the 409 explanation sits next to the "Block instead" option.
      setDeleteError(err.message || 'Could not delete the slot.');
    } finally {
      setBusy(false);
    }
  }

  function blockInstead() {
    const slot = deleteTarget;
    setDeleteTarget(null);
    setDeleteError('');
    setBlockTarget(slot);
  }

  function openForm(target) {
    setNotice(null);
    setFormError('');
    setForm(target);
  }

  return (
    <div className="container stack-lg">
      <PageHeader
        title="Slots"
        subtitle="Add, edit, block or remove parking slots."
        actions={
          <button type="button" ref={addRef} className="btn btn-primary" onClick={() => openForm('new')} disabled={form === 'new'}>
            Add slot
          </button>
        }
      />

      <Alert tone="info">
        Rate changes apply to new bookings only. Blocking a slot stops new bookings; bookings it already has are kept.
      </Alert>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {form ? (
        <SlotForm
          key={form === 'new' ? 'new' : form.id}
          slot={form === 'new' ? null : form}
          busy={saving}
          error={formError}
          onSubmit={save}
          onCancel={() => { setForm(null); setFormError(''); }}
        />
      ) : null}

      {slots === null ? (
        <Spinner label="Loading slots" />
      ) : loadError ? (
        <div className="stack">
          <div className="alert alert-danger" role="alert">{loadError}</div>
          <div><button type="button" className="btn btn-secondary" onClick={() => { setSlots(null); load(); }}>Try again</button></div>
        </div>
      ) : slots.length === 0 ? (
        <EmptyState
          title="No slots yet"
          message="Add your first parking slot so customers can book."
          action={<button type="button" className="btn btn-primary" onClick={() => openForm('new')}>Add slot</button>}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">All parking slots</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">Hourly</th>
                <th scope="col" className="num">Daily</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id}>
                  <td data-label="Code"><strong>{s.code}</strong></td>
                  <td data-label="Type">{s.vehicle_type === 'bike' ? 'Bike' : 'Car'}</td>
                  <td data-label="Hourly" className="num">{formatINR(s.hourly_rate)}</td>
                  <td data-label="Daily" className="num">{formatINR(s.daily_rate)}</td>
                  <td data-label="Status">
                    {s.is_blocked
                      ? <span className="badge badge-danger">Blocked</span>
                      : <span className="badge badge-success">Active</span>}
                  </td>
                  <td data-label="Actions" className="actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openForm(s)} aria-label={`Edit slot ${s.code}`}>Edit</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBlockTarget(s)} aria-label={`${s.is_blocked ? 'Unblock' : 'Block'} slot ${s.code}`}>
                      {s.is_blocked ? 'Unblock' : 'Block'}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => { setDeleteError(''); setDeleteTarget(s); }} aria-label={`Delete slot ${s.code}`}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(blockTarget)}
        title={blockTarget?.is_blocked ? `Unblock slot ${blockTarget?.code}?` : `Block slot ${blockTarget?.code}?`}
        confirmLabel={blockTarget?.is_blocked ? 'Unblock' : 'Block slot'}
        cancelLabel="Cancel"
        tone={blockTarget?.is_blocked ? 'primary' : 'danger'}
        busy={busy}
        onConfirm={toggleBlock}
        onCancel={() => setBlockTarget(null)}
      >
        {blockTarget?.is_blocked
          ? <p>Customers will be able to book this slot again.</p>
          : <p>New bookings will not be given this slot. Bookings it already has are kept and are not cancelled.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete slot ${deleteTarget?.code}?`}
        confirmLabel="Delete slot"
        cancelLabel="Keep"
        busy={busy}
        onConfirm={remove}
        onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
      >
        <p>This cannot be undone. A slot that has any bookings cannot be deleted; block it instead.</p>
        {deleteError ? (
          <div className="stack">
            <div className="alert alert-danger" role="alert">{deleteError}</div>
            <div>
              <button type="button" className="btn btn-secondary" onClick={blockInstead}>Block instead</button>
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
