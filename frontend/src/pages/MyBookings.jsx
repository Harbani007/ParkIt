import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cancelBooking, myBookings } from '../api/parkit.js';
import Alert from '../components/Alert.jsx';
import BookingSummary from '../components/BookingSummary.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { formatINR } from '../lib/money.js';
import { formatTimeRange } from '../lib/time.js';

const SCOPES = [
  { key: 'active', label: 'Active' },
  { key: 'past', label: 'Past' },
];

export default function MyBookings() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'past' ? 'past' : 'active';

  const [bookings, setBookings] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [toCancel, setToCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }
  const noticeRef = useRef(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setBookings(null);
    setError(null);
    myBookings(scope, { signal: ctrl.signal })
      .then((res) => setBookings(res.bookings))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => ctrl.abort();
  }, [scope, attempt]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  function selectScope(key) {
    setNotice(null);
    setParams(key === 'active' ? {} : { scope: key }, { replace: true });
  }

  function onTabKeyDown(ev) {
    const i = SCOPES.findIndex((s) => s.key === scope);
    let n = null;
    if (ev.key === 'ArrowRight') n = (i + 1) % SCOPES.length;
    else if (ev.key === 'ArrowLeft') n = (i - 1 + SCOPES.length) % SCOPES.length;
    else if (ev.key === 'Home') n = 0;
    else if (ev.key === 'End') n = SCOPES.length - 1;
    if (n === null) return;
    ev.preventDefault();
    selectScope(SCOPES[n].key);
    document.getElementById(`tab-${SCOPES[n].key}`)?.focus();
  }

  async function confirmCancel() {
    if (!toCancel) return;
    const b = toCancel;
    setCancelling(true);
    try {
      await cancelBooking(b.booking_code);
      setNotice({
        tone: 'success',
        text: `Booking ${b.booking_code} is cancelled. Your simulated payment of ${formatINR(b.amount)} was refunded.`,
      });
    } catch (err) {
      setNotice({ tone: 'danger', text: `Could not cancel ${b.booking_code}: ${err.message}` });
    } finally {
      setCancelling(false);
      setToCancel(null);
      reload();
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="My bookings"
        actions={<Link to="/spaces" className="btn btn-primary">Find parking</Link>}
      />

      {notice ? (
        <Alert tone={notice.tone} ref={noticeRef} tabIndex={-1}>
          {notice.text}
        </Alert>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Booking list" onKeyDown={onTabKeyDown}>
        {SCOPES.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            id={`tab-${s.key}`}
            className="tab"
            aria-selected={scope === s.key}
            aria-controls="bookings-panel"
            tabIndex={scope === s.key ? 0 : -1}
            onClick={() => selectScope(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div id="bookings-panel" role="tabpanel" aria-labelledby={`tab-${scope}`} className="stack">
        {error ? (
          <Alert tone="danger" title="Could not load your bookings">
            <p>{error}</p>
            <button type="button" className="btn btn-sm btn-secondary" onClick={reload}>Retry</button>
          </Alert>
        ) : bookings === null ? (
          <div className="stack" aria-busy="true">
            <Spinner label="Loading your bookings" />
            <span className="skeleton" style={{ display: 'block', height: '9rem' }} />
            <span className="skeleton" style={{ display: 'block', height: '9rem' }} />
          </div>
        ) : bookings.length === 0 ? (
          scope === 'active' ? (
            <EmptyState
              title="No active bookings"
              message="Reserve a car or bike slot ahead of time and get a QR code for the gate."
              action={<Link to="/spaces" className="btn btn-primary">Find parking</Link>}
            />
          ) : (
            <EmptyState
              title="No past bookings yet"
              message="Completed, cancelled and missed bookings will show up here."
              action={<Link to="/spaces" className="btn btn-secondary">Find parking</Link>}
            />
          )
        ) : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {bookings.map((b) => (
              <li key={b.booking_code}>
                <BookingSummary booking={b}>
                  <Link
                    to={`/bookings/${encodeURIComponent(b.booking_code)}`}
                    className="btn btn-secondary btn-sm"
                    aria-label={`View details for booking ${b.booking_code}`}
                  >
                    View details
                  </Link>
                  {b.can_cancel ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setToCancel(b)}
                      aria-label={`Cancel booking ${b.booking_code}`}
                    >
                      Cancel
                    </button>
                  ) : b.status === 'confirmed' ? (
                    <span className="muted">Cancellation closed (under 2 hours to start)</span>
                  ) : b.status === 'cancelled' && b.payment?.status === 'refunded' ? (
                    <span className="muted">Refunded (simulated)</span>
                  ) : null}
                </BookingSummary>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={toCancel !== null}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={() => setToCancel(null)}
      >
        {toCancel ? (
          <div className="stack">
            <p>
              <strong>{toCancel.booking_code}</strong>: {formatTimeRange(toCancel.starts_at, toCancel.ends_at)}
              {toCancel.slot ? `, slot ${toCancel.slot.code}` : ''}
            </p>
            <p>
              Your simulated payment of {formatINR(toCancel.amount)} will be refunded. This cannot be undone.
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
