import { useState } from 'react';
import Field from '../Field.jsx';
import Spinner from '../Spinner.jsx';

const RATE_RE = /^\d{1,8}(\.\d{1,2})?$/;

function validate(v) {
  const errors = {};
  const code = v.code.trim();
  if (!code) errors.code = 'Enter a slot code.';
  else if (code.length > 20) errors.code = 'Use 20 characters or fewer.';
  for (const key of ['hourly_rate', 'daily_rate']) {
    const raw = v[key].trim();
    if (!raw) errors[key] = 'Enter a rate.';
    else if (!RATE_RE.test(raw)) errors[key] = 'Use a number of 0 or more with at most 2 decimals.';
  }
  return errors;
}

// Create / edit form for a slot. `slot` null = create. onSubmit(values) receives
// { code, vehicle_type, hourly_rate: number, daily_rate: number } and returns a promise;
// the parent shows API errors (via `error`) and decides when to close.
export default function SlotForm({ slot = null, busy = false, error = '', onSubmit, onCancel }) {
  const [values, setValues] = useState({
    code: slot?.code ?? '',
    vehicle_type: slot?.vehicle_type ?? 'car',
    hourly_rate: slot?.hourly_rate ?? '',
    daily_rate: slot?.daily_rate ?? '',
  });
  const [errors, setErrors] = useState({});

  function set(key) {
    return (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  }

  function submit(e) {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    onSubmit({
      code: values.code.trim(),
      vehicle_type: values.vehicle_type,
      hourly_rate: Number(values.hourly_rate),
      daily_rate: Number(values.daily_rate),
    });
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label={slot ? `Edit slot ${slot.code}` : 'Add slot'}>
      <h2>{slot ? `Edit slot ${slot.code}` : 'Add slot'}</h2>
      {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
      <div className="field-row">
        <Field label="Code" required value={values.code} onChange={set('code')} error={errors.code}
          maxLength={20} autoComplete="off" placeholder="A-01" />
        <Field label="Vehicle type" as="select" value={values.vehicle_type} onChange={set('vehicle_type')}
          options={[
            <option key="car" value="car">Car</option>,
            <option key="bike" value="bike">Bike</option>,
          ]} />
      </div>
      <div className="field-row">
        <Field label="Hourly rate (₹)" required inputMode="decimal" value={values.hourly_rate}
          onChange={set('hourly_rate')} error={errors.hourly_rate} hint="Up to 2 decimals, for example 40.00" />
        <Field label="Daily rate (₹)" required inputMode="decimal" value={values.daily_rate}
          onChange={set('daily_rate')} error={errors.daily_rate} hint="Up to 2 decimals, for example 300.00" />
      </div>
      <p className="field-hint">Price = hours × hourly rate, capped at the daily rate per booking.</p>
      <p className="muted">Rate changes apply to new bookings only; existing bookings keep their price.</p>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? <Spinner inline /> : null}
          {slot ? 'Save changes' : 'Add slot'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
