import { useEffect, useState } from 'react';
import { summary as fetchSummary } from '../../api/parkit.js';
import { formatINR } from '../../lib/money.js';
import { addDaysIST, formatDate, todayIST } from '../../lib/time.js';
import Alert from '../Alert.jsx';
import EmptyState from '../EmptyState.jsx';
import Field from '../Field.jsx';
import Spinner from '../Spinner.jsx';

function presetRange(preset) {
  const today = todayIST();
  if (preset === 'week') return { from: addDaysIST(today, -6), to: today };
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: today, to: today };
}

const PRESETS = [
  ['today', 'Today'],
  ['week', 'Last 7 days'],
  ['month', 'This month'],
];

const COUNT_CARDS = [
  ['upcoming', 'Upcoming'],
  ['checked_in', 'Checked in'],
  ['completed', 'Completed'],
  ['missed', 'Missed'],
  ['cancelled', 'Cancelled'],
];

function pct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';
}

function clampPct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

// `refreshKey`: change it to re-fetch the current range (e.g. after a cancellation).
export default function SummaryPanel({ refreshKey = 0 }) {
  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(() => presetRange('today'));
  const [draft, setDraft] = useState(() => presetRange('today'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const rangeError = draft.from && draft.to && draft.to < draft.from ? '"To" must be on or after "From".' : '';
  const incomplete = !draft.from || !draft.to;

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    fetchSummary(range.from, range.to, { signal: ctrl.signal })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e.message || 'Could not load the summary.');
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [range, reload, refreshKey]);

  function choosePreset(p) {
    const r = presetRange(p);
    setPreset(p);
    setDraft(r);
    setRange(r);
  }

  function applyCustom(e) {
    e.preventDefault();
    if (rangeError || incomplete) return;
    setPreset('custom');
    setRange({ from: draft.from, to: draft.to });
  }

  return (
    <section className="card stack" aria-labelledby="summary-heading" aria-busy={loading}>
      <div className="row row-between">
        <h2 id="summary-heading" className="m-0">Summary</h2>
        <div className="segmented" role="group" aria-label="Date range presets">
          {PRESETS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={preset === key} onClick={() => choosePreset(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <form className="field-row align-end" onSubmit={applyCustom} noValidate>
        <Field label="From" type="date" value={draft.from} max={draft.to || undefined}
          onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
        <Field label="To" type="date" value={draft.to} min={draft.from || undefined} error={rangeError}
          onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        <div>
          <button type="submit" className="btn btn-secondary" disabled={Boolean(rangeError) || incomplete}>
            Apply custom range
          </button>
        </div>
      </form>

      <p className="muted m-0">
        Showing {formatDate(range.from)}{range.to !== range.from ? ` to ${formatDate(range.to)}` : ''}.
      </p>

      {loading && !data ? <Spinner label="Loading summary" /> : null}
      {error ? (
        <Alert tone="danger">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReload((n) => n + 1)}>Retry</button>
        </Alert>
      ) : null}

      {data && !error ? (
        <div className={`stack${loading ? ' is-loading' : ''}`}>
          <div className="grid">
            <div className="stat-card">
              <p className="stat-label">Revenue</p>
              <p className="stat-value">{formatINR(data.revenue)}</p>
              <p className="stat-note">Excludes refunds. Payments are simulated.</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Occupancy</p>
              <p className="stat-value">{pct(data.occupancy_pct)}</p>
              <span className="bar" role="img" aria-label={`Occupancy ${pct(data.occupancy_pct)}`}>
                <span style={{ '--bar-value': clampPct(data.occupancy_pct) }} />
              </span>
              <p className="stat-note">Booked hours of all slots over opening hours.</p>
            </div>
          </div>

          <div className="grid grid-compact">
            {COUNT_CARDS.map(([key, label]) => (
              <div className="stat-card" key={key}>
                <p className="stat-label">{label}</p>
                <p className="stat-value">{data.counts?.[key] ?? 0}</p>
              </div>
            ))}
          </div>

          <div>
            <h3>By day</h3>
            {data.by_day?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <caption className="visually-hidden">Bookings, revenue and occupancy per day</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col" className="num">Bookings</th>
                      <th scope="col" className="num">Revenue</th>
                      <th scope="col">Occupancy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_day.map((d) => (
                      <tr key={d.date}>
                        <td data-label="Date">{formatDate(d.date)}</td>
                        <td data-label="Bookings" className="num">{d.bookings}</td>
                        <td data-label="Revenue" className="num">{formatINR(d.revenue)}</td>
                        <td data-label="Occupancy">
                          <span className="bar-cell">
                            <span className="bar" role="img" aria-label={`Occupancy ${pct(d.occupancy_pct)}`}>
                              <span style={{ '--bar-value': clampPct(d.occupancy_pct) }} />
                            </span>
                            <span className="bar-pct">{pct(d.occupancy_pct)}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No days in this range" />
            )}
          </div>
        </div>
      ) : null}

      <p className="field-hint">
        Revenue excludes refunds; all payments are simulated. Dates and times are IST.
      </p>
    </section>
  );
}
