import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createHostSpace, myHostSpaces } from '../../api/parkit.js';
import Alert from '../../components/Alert.jsx';
import Field from '../../components/Field.jsx';
import Icon from '../../components/Icon.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';
import { formatINR } from '../../lib/money.js';
import { minutesToTime, timeToMinutes } from '../../lib/time.js';

const TIMES = Array.from({ length: 48 }, (_, i) => minutesToTime(i * 30));
const timeOptions = TIMES.map((t) => <option key={t} value={t}>{t}</option>);
const EMPTY = {
  name: '',
  address: '',
  locality: '',
  city: 'New Delhi',
  opens_at: '09:00',
  closes_at: '18:00',
  vehicle_type: 'car',
  slots: '1',
  hourly_rate: '30',
  daily_rate: '200',
};
const isMoney = (v) => /^\d{1,6}(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0;

function check(f) {
  const e = {};
  if (!f.name.trim()) e.name = 'Give your space a name, e.g. "Sharma house driveway".';
  if (!f.address.trim()) e.address = 'Enter the house address. Only drivers who book will see it.';
  if (!f.locality.trim()) e.locality = 'Enter the locality drivers will search for.';
  if (!f.city.trim()) e.city = 'Enter the city.';
  if (timeToMinutes(f.closes_at) <= timeToMinutes(f.opens_at)) e.closes_at = 'Must be after the start time.';
  const n = Number(f.slots);
  if (!Number.isInteger(n) || n < 1 || n > 10) e.slots = 'From 1 to 10.';
  if (!isMoney(f.hourly_rate)) e.hourly_rate = 'Enter a positive amount.';
  if (!isMoney(f.daily_rate)) e.daily_rate = 'Enter a positive amount.';
  return e;
}

/** A customer's own listings and the form to list a new one (D22). */
export default function HostSpaces() {
  const [spaces, setSpaces] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    myHostSpaces({ signal: ctrl.signal })
      .then((res) => {
        setSpaces(res.spaces);
        if (res.spaces.length === 0) setOpen(true);
      })
      .catch((e) => e.name !== 'AbortError' && setError(e.message));
    return () => ctrl.abort();
  }, [reload]);

  const errors = touched ? check(form) : {};
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(check(form)).length) return;
    setSaving(true);
    setNotice(null);
    try {
      const created = await createHostSpace({
        ...form,
        slots: Number(form.slots),
        hourly_rate: form.hourly_rate.trim(),
        daily_rate: form.daily_rate.trim(),
      });
      setNotice({ tone: 'success', text: `"${created.name}" is listed. Drivers searching ${created.locality} can book it now.` });
      setForm(EMPTY);
      setTouched(false);
      setOpen(false);
      setReload((n) => n + 1);
    } catch (err) {
      setNotice({ tone: 'danger', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack stack-lg">
      <PageHeader
        title="Your spaces"
        subtitle="Away at work? List the empty spot at your home for those hours and earn from it."
        actions={
          !open ? (
            <button type="button" className="btn btn-accent" onClick={() => setOpen(true)}>
              <Icon name="plus" size={18} /> List a space
            </button>
          ) : null
        }
      />

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!spaces && !error ? <Spinner label="Loading your spaces" /> : null}

      {spaces && spaces.length > 0 ? (
        <ul className="space-grid">
          {spaces.map((s) => (
            <li key={s.id}>
              <Link to={`/host/${s.id}`} className="space-card">
                <div className="space-card-top">
                  <span className="space-pin"><Icon name="pin" size={18} />{s.locality}</span>
                  <span className={`badge ${s.is_listed ? 'badge-success' : 'badge-neutral'}`}>
                    {s.is_listed ? 'Listed' : 'Hidden'}
                  </span>
                </div>
                <h2 className="space-name">{s.name}</h2>
                <p className="muted m-0">{s.address}, {s.city}</p>
                <div className="space-meta">
                  <span><Icon name="clock" size={16} /> {s.opens_at} to {s.closes_at}</span>
                  <span><Icon name="car" size={16} /> {s.slot_count} {s.slot_count === 1 ? 'spot' : 'spots'}</span>
                </div>
                <div className="space-card-foot">
                  <span className="space-price">
                    {s.from_hourly_rate ? <><strong>{formatINR(s.from_hourly_rate)}</strong> / hour</> : null}
                  </span>
                  <span className="btn btn-sm btn-primary">Manage</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <form className="card stack form-narrow" onSubmit={submit} noValidate>
          <div className="row row-between">
            <h2 className="m-0">List a parking space</h2>
            {spaces && spaces.length > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            ) : null}
          </div>
          <Field label="Name" required value={form.name} onChange={set('name')} error={errors.name}
            maxLength={100} hint='What drivers see, e.g. "Sharma house driveway".' />
          <Field label="House address" required value={form.address} onChange={set('address')} error={errors.address}
            maxLength={300} hint="Shown only to drivers after they book, never in search." />
          <div className="field-row">
            <Field label="Locality" required value={form.locality} onChange={set('locality')} error={errors.locality}
              maxLength={100} hint="e.g. Lajpat Nagar" />
            <Field label="City" required value={form.city} onChange={set('city')} error={errors.city} maxLength={100} />
          </div>
          <div className="field-row">
            <Field label="Free from (IST)" as="select" value={form.opens_at} onChange={set('opens_at')} options={timeOptions} />
            <Field label="Free until (IST)" as="select" value={form.closes_at} onChange={set('closes_at')}
              options={timeOptions} error={errors.closes_at} />
          </div>
          <div className="field-row">
            <Field label="Vehicle" as="select" value={form.vehicle_type} onChange={set('vehicle_type')}
              options={[<option key="car" value="car">Car</option>, <option key="bike" value="bike">Bike</option>]} />
            <Field label="Number of spots" type="number" min={1} max={10} value={form.slots}
              onChange={set('slots')} error={errors.slots} />
          </div>
          <div className="field-row">
            <Field label="Price per hour (₹)" inputMode="decimal" value={form.hourly_rate}
              onChange={set('hourly_rate')} error={errors.hourly_rate} />
            <Field label="Price per day (₹)" inputMode="decimal" value={form.daily_rate}
              onChange={set('daily_rate')} error={errors.daily_rate} hint="The most a driver pays in one day." />
          </div>
          <div className="row">
            <button type="submit" className="btn btn-accent" disabled={saving}>
              {saving ? <Spinner inline /> : null}
              List my space
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
