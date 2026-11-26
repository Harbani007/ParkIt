import { useEffect, useMemo, useState } from 'react';
import { getFacility, updateFacility } from '../../api/parkit.js';
import Alert from '../../components/Alert.jsx';
import Field from '../../components/Field.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';
import { minutesToTime, timeToMinutes } from '../../lib/time.js';

const TIMES = Array.from({ length: 48 }, (_, i) => minutesToTime(i * 30));
const FIELDS = ['name', 'address', 'opens_at', 'closes_at', 'max_advance_days'];

function toForm(f) {
  return {
    name: f.name ?? '',
    address: f.address ?? '',
    opens_at: f.opens_at,
    closes_at: f.closes_at,
    max_advance_days: String(f.max_advance_days),
  };
}

function validate(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Enter a facility name.';
  else if (form.name.trim().length > 100) errors.name = 'Name must be 100 characters or fewer.';
  const days = Number(form.max_advance_days);
  if (form.max_advance_days === '' || !Number.isInteger(days) || days < 1 || days > 365) {
    errors.max_advance_days = 'Enter a whole number from 1 to 365.';
  }
  if (timeToMinutes(form.closes_at) <= timeToMinutes(form.opens_at)) {
    errors.closes_at = 'Closing time must be after opening time.';
  }
  return errors;
}

const timeOptions = TIMES.map((t) => <option key={t} value={t}>{t}</option>);

export default function Settings() {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => { document.title = 'Settings | ParkIt'; }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError('');
    getFacility({ signal: ctrl.signal })
      .then((f) => { setSaved(f); setForm(toForm(f)); setLoading(false); })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setLoadError(e.message || 'Could not load settings.');
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [reload]);

  const clientErrors = useMemo(() => (form ? validate(form) : {}), [form]);
  const changed = useMemo(() => {
    if (!form || !saved) return {};
    const base = toForm(saved);
    const out = {};
    for (const k of FIELDS) {
      if (form[k] !== base[k]) {
        if (k === 'max_advance_days') out[k] = Number(form[k]);
        else if (k === 'name' || k === 'address') out[k] = form[k].trim();
        else out[k] = form[k];
      }
    }
    return out;
  }, [form, saved]);
  const dirty = Object.keys(changed).length > 0;

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setServerErrors((s) => ({ ...s, [key]: undefined }));
    setAlert(null);
  }

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    setAlert(null);
    if (Object.keys(clientErrors).length) return;
    if (!dirty) {
      setAlert({ tone: 'info', text: 'No changes to save.' });
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      const f = await updateFacility(changed);
      setSaved(f);
      setForm(toForm(f));
      setTouched(false);
      setAlert({ tone: 'success', text: 'Settings saved.' });
    } catch (err) {
      const fieldErrs = {};
      if (Array.isArray(err.details)) {
        for (const d of err.details) {
          const key = String(d.path ?? '').split('.').pop();
          if (FIELDS.includes(key) && !fieldErrs[key]) fieldErrs[key] = d.message;
        }
      }
      setServerErrors(fieldErrs);
      setAlert({ tone: 'danger', text: err.message || 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  }

  const err = (k) => (touched ? clientErrors[k] : undefined) || serverErrors[k];

  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle="Facility details and booking hours." />

      {loading ? <Spinner label="Loading settings" /> : null}
      {loadError ? (
        <Alert tone="danger">
          <p>{loadError}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReload((n) => n + 1)}>Retry</button>
        </Alert>
      ) : null}

      {form ? (
        <form className="card stack form-narrow" onSubmit={submit} noValidate>
          <Field label="Facility name" required value={form.name} maxLength={100} autoComplete="off"
            error={err('name')} onChange={(e) => set('name', e.target.value)} />
          <Field label="Address" value={form.address} autoComplete="off"
            error={err('address')} onChange={(e) => set('address', e.target.value)} />

          <div className="field-row">
            <Field label="Opens at (IST)" as="select" value={form.opens_at} error={err('opens_at')}
              onChange={(e) => set('opens_at', e.target.value)} options={timeOptions} />
            <Field label="Closes at (IST)" as="select" value={form.closes_at} error={err('closes_at')}
              onChange={(e) => set('closes_at', e.target.value)} options={timeOptions} />
          </div>

          <Field label="Max advance booking (days)" type="number" inputMode="numeric" min={1} max={365} step={1}
            value={form.max_advance_days} error={err('max_advance_days')}
            hint="How far ahead customers can book, from 1 to 365 days."
            onChange={(e) => set('max_advance_days', e.target.value)} />

          <div className="field">
            <span className="label">Timezone</span>
            <p className="m-0">Asia/Kolkata (IST)</p>
            <p className="field-hint">Fixed for this facility.</p>
          </div>

          <Alert tone="info">
            Changes apply to new bookings and searches only. Existing bookings are unaffected.
          </Alert>

          {alert ? <Alert tone={alert.tone}>{alert.text}</Alert> : null}

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving || undefined}>
              {saving ? <Spinner inline label="Saving" /> : null}
              Save settings
            </button>
            <button type="button" className="btn btn-ghost" disabled={saving || !dirty}
              onClick={() => { setForm(toForm(saved)); setServerErrors({}); setAlert(null); setTouched(false); }}>
              Reset
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
