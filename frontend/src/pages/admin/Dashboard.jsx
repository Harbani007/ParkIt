import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminBookings, cancelBooking } from '../../api/parkit.js';
import Alert from '../../components/Alert.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import Field from '../../components/Field.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import SummaryPanel from '../../components/admin/SummaryPanel.jsx';
import { formatINR } from '../../lib/money.js';
import { addDaysIST, formatDate, formatTime, todayIST } from '../../lib/time.js';

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['confirmed', 'Confirmed'],
  ['checked_in', 'Checked in'],
  ['completed', 'Completed'],
  ['missed', 'Missed'],
  ['cancelled', 'Cancelled'],
];

export default function Dashboard() {
  const [date, setDate] = useState(() => todayIST());
  const [status, setStatus] = useState('');
  const [bookings, setBookings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [summaryKey, setSummaryKey] = useState(0);
  const [toCancel, setToCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => { document.title = 'Admin dashboard | ParkIt'; }, []);

  useEffect(() => {
    if (!date) return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    adminBookings(date, status, { signal: ctrl.signal })
      .then((d) => { setBookings(d.bookings); setLoading(false); })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e.message || 'Could not load bookings.');
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [date, status, reload]);

  const confirmCancel = useCallback(async () => {
    if (!toCancel) return;
    setCancelling(true);
    try {
      await cancelBooking(toCancel.booking_code);
      setNotice({ tone: 'success', text: `Booking ${toCancel.booking_code} cancelled and refunded (simulated).` });
      setToCancel(null);
      setReload((n) => n + 1);
      setSummaryKey((n) => n + 1);
    } catch (e) {
      setNotice({ tone: 'danger', text: e.message || 'Could not cancel the booking.' });
      setToCancel(null);
    } finally {
      setCancelling(false);
    }
  }, [toCancel]);

  const today = todayIST();
  const rows = bookings ?? [];

  return (
    <div className="stack stack-lg">
      <PageHeader
        title="Admin dashboard"
        subtitle="Bookings and revenue for the facility. Times are IST."
        actions={
          <>
            <Link className="btn btn-primary" to="/admin/gate">Gate</Link>
            <Link className="btn btn-secondary" to="/admin/slots">Slots</Link>
          </>
        }
      />

      <SummaryPanel refreshKey={summaryKey} />

      <section className="card stack" aria-labelledby="bookings-heading" aria-busy={loading}>
        <h2 id="bookings-heading" className="m-0">Bookings on {formatDate(date)}</h2>

        <div className="row align-end">
          <button type="button" className="btn btn-secondary" onClick={() => setDate(addDaysIST(date, -1))}
            aria-label="Previous day">&larr; Prev</button>
          <Field label="Day" type="date" value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button type="button" className="btn btn-secondary" onClick={() => setDate(addDaysIST(date, 1))}
            aria-label="Next day">Next &rarr;</button>
          <button type="button" className="btn btn-ghost" onClick={() => setDate(today)} disabled={date === today}>
            Today
          </button>
          <Field label="Status" as="select" value={status} onChange={(e) => setStatus(e.target.value)}
            options={STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)} />
        </div>

        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

        {loading && !bookings ? <Spinner label="Loading bookings" /> : null}
        {error ? (
          <Alert tone="danger">
            <p>{error}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReload((n) => n + 1)}>Retry</button>
          </Alert>
        ) : null}

        {!error && bookings && rows.length === 0 ? (
          <EmptyState
            title="No bookings"
            message={status ? 'No bookings with this status on this day.' : 'No bookings start on this day.'}
            action={status ? <button type="button" className="btn btn-secondary" onClick={() => setStatus('')}>Clear filter</button> : null}
          />
        ) : null}

        {!error && rows.length > 0 ? (
          <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
            <table className="table">
              <caption className="visually-hidden">Bookings starting on {formatDate(date)}</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Code</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Slot</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.booking_code} className={b.overstayed || b.status === 'missed' ? 'is-overstayed' : undefined}>
                    <td data-label="Time">{formatTime(b.starts_at).replace(' IST', '')} – {formatTime(b.ends_at)}</td>
                    <td data-label="Code"><Link to={`/bookings/${encodeURIComponent(b.booking_code)}`}>{b.booking_code}</Link></td>
                    <td data-label="Customer">
                      {b.customer?.name ?? '—'}
                      {b.customer?.phone ? <><br /><span className="muted">{b.customer.phone}</span></> : null}
                    </td>
                    <td data-label="Vehicle">{b.vehicle_number}</td>
                    <td data-label="Slot">{b.slot?.code ?? '—'}</td>
                    <td data-label="Amount" className="num">{formatINR(b.amount)}</td>
                    <td data-label="Status"><StatusBadge booking={b} /></td>
                    <td data-label="Actions" className="actions">
                      {b.status === 'confirmed' || b.status === 'checked_in' ? (
                        <Link className="btn btn-secondary btn-sm" to={`/admin/gate?code=${encodeURIComponent(b.booking_code)}`}>
                          Open at gate
                        </Link>
                      ) : null}
                      {b.can_cancel ? (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => { setNotice(null); setToCancel(b); }}>
                          Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={Boolean(toCancel)}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={() => setToCancel(null)}
      >
        {toCancel ? (
          <p>
            {toCancel.booking_code} for {toCancel.customer?.name ?? 'the customer'} ({toCancel.vehicle_number}) will be
            cancelled and the simulated payment of {formatINR(toCancel.amount)} refunded.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
