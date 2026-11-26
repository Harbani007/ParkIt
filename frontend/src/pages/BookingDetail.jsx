import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fileUrl } from '../api/client.js';
import { cancelBooking, getBooking } from '../api/parkit.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Alert from '../components/Alert.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatINR } from '../lib/money.js';
import { formatDateTime, formatTimeRange } from '../lib/time.js';

function Item({ label, children }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function BookingDetail() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const isNew = params.get('new') === '1';

  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null); // { status, message }
  const [attempt, setAttempt] = useState(0);
  const [qrFailed, setQrFailed] = useState(false);
  const qrRetried = useRef(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(null); // 'ok' | 'fail'

  const load = useCallback(
    (signal) =>
      getBooking(code, { signal })
        .then((b) => {
          setBooking(b);
          setError(null);
          setQrFailed(false);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setError({ status: err.status, message: err.message });
        }),
    [code],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setBooking(null);
    setError(null);
    setQrFailed(false);
    qrRetried.current = false;
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, attempt]);

  // F3: a pre-signed QR URL can expire; re-fetch the booking once for a fresh one.
  function onQrError() {
    if (qrRetried.current) {
      setQrFailed(true);
      return;
    }
    qrRetried.current = true;
    load();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(booking.booking_code);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2500);
  }

  async function confirmCancel() {
    setCancelling(true);
    try {
      const updated = await cancelBooking(booking.booking_code);
      setBooking(updated);
      setNotice({
        tone: 'success',
        text: `Booking cancelled. Your simulated payment of ${formatINR(updated.amount)} was refunded.`,
      });
    } catch (err) {
      setNotice({ tone: 'danger', text: `Could not cancel: ${err.message}` });
      load();
    } finally {
      setCancelling(false);
      setConfirmOpen(false);
    }
  }

  const backTo = isAdmin ? '/admin' : '/bookings';
  const backLabel = isAdmin ? 'Back to dashboard' : 'Back to my bookings';

  if (error) {
    if (error.status === 404) {
      return (
        <EmptyState
          title="Booking not found"
          message="We could not find a booking with that code. Check the code, or open it from your list of bookings."
          action={<Link to={backTo} className="btn btn-primary">{backLabel}</Link>}
        />
      );
    }
    return (
      <div className="stack">
        <Alert tone="danger" title="Could not load this booking">
          <p>{error.message}</p>
          <div className="row">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </button>
            <Link to={backTo} className="btn btn-sm btn-ghost">{backLabel}</Link>
          </div>
        </Alert>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="stack" aria-busy="true">
        <Spinner label="Loading booking" />
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-block" />
      </div>
    );
  }

  const b = booking;
  const qrSrc = fileUrl(b.qr_url);
  const cancelled = b.status === 'cancelled';
  const refunded = b.payment?.status === 'refunded';
  const customer = b.customer;

  return (
    <div className="stack stack-lg">
      <PageHeader
        title="Booking details"
        actions={
          <>
            <Link to={backTo} className="btn btn-ghost">{backLabel}</Link>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>Print</button>
          </>
        }
      />

      {isNew && !cancelled ? (
        <Alert tone="success" title="Booking confirmed">
          Your simulated payment of {formatINR(b.amount)} went through. Show the code or QR below at the gate.
        </Alert>
      ) : null}
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <section className="card stack" aria-labelledby="code-heading">
        <div className="row row-between">
          <h2 id="code-heading">Booking code</h2>
          <StatusBadge booking={b} />
        </div>
        <div className="row">
          <span className="code" aria-label={`Booking code ${b.booking_code}`}>{b.booking_code}</span>
          <button type="button" className="btn btn-secondary btn-sm no-print" onClick={copyCode}>
            {copied === 'ok' ? 'Copied' : 'Copy code'}
          </button>
          <span className="visually-hidden" role="status">
            {copied === 'ok' ? 'Booking code copied' : copied === 'fail' ? 'Could not copy the code' : ''}
          </span>
        </div>

        {cancelled ? (
          <p className="muted">QR not available: this booking was cancelled.</p>
        ) : qrSrc && !qrFailed ? (
          <div className="stack">
            <img
              className="qr"
              src={qrSrc}
              alt={`QR code for booking ${b.booking_code}`}
              width="240"
              height="240"
              onError={onQrError}
            />
            <p>
              <strong>Show this at the gate.</strong> Staff scan the QR or type the booking code to check
              you in. Arrive up to 15 minutes before your start time.
            </p>
          </div>
        ) : (
          <div className="stack">
            <p className="muted">QR not available right now. You can still use the booking code at the gate.</p>
            {qrSrc ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm no-print"
                onClick={() => {
                  qrRetried.current = false;
                  setQrFailed(false);
                  load();
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        <dl className="dl">
          <Item label="When">{formatTimeRange(b.starts_at, b.ends_at)}</Item>
          <Item label="Duration">{b.hours} {b.hours === 1 ? 'hour' : 'hours'}</Item>
          <Item label="Slot">{b.slot ? `${b.slot.code} (${b.slot.vehicle_type})` : '—'}</Item>
          <Item label="Vehicle">{b.vehicle_number}</Item>
          <Item label="Amount"><strong>{formatINR(b.amount)}</strong></Item>
          <Item label="Payment">
            {refunded ? 'Refunded' : b.payment?.status === 'paid' ? 'Paid' : (b.payment?.status ?? '—')}
            {b.payment?.provider === 'simulated' ? ' (simulated)' : ''}
          </Item>
          {b.checked_in_at ? <Item label="Checked in">{formatDateTime(b.checked_in_at)}</Item> : null}
          {b.checked_out_at ? <Item label="Checked out">{formatDateTime(b.checked_out_at)}</Item> : null}
          {b.cancelled_at ? <Item label="Cancelled">{formatDateTime(b.cancelled_at)}</Item> : null}
          <Item label="Booked on">{formatDateTime(b.created_at)}</Item>
        </dl>

        {refunded ? (
          <Alert tone="info">
            The simulated payment of {formatINR(b.payment.amount ?? b.amount)} has been refunded.
          </Alert>
        ) : null}
        {b.overstayed ? (
          <Alert tone="warning">This vehicle stayed past the booked end time.</Alert>
        ) : null}
      </section>

      {customer ? (
        <section className="card stack" aria-labelledby="customer-heading">
          <h2 id="customer-heading">Customer</h2>
          <dl className="dl">
            <Item label="Name">{customer.name}</Item>
            {customer.email ? <Item label="Email">{customer.email}</Item> : null}
            {customer.phone ? <Item label="Phone">{customer.phone}</Item> : null}
          </dl>
        </section>
      ) : null}

      {b.can_cancel || isAdmin ? (
        <div className="row no-print">
          {isAdmin ? (
            <Link to={`/admin/gate?code=${encodeURIComponent(b.booking_code)}`} className="btn btn-primary">
              Open at gate
            </Link>
          ) : null}
          {b.can_cancel ? (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmOpen(true)}>
              Cancel booking
            </button>
          ) : null}
        </div>
      ) : b.status === 'confirmed' ? (
        <p className="muted no-print">Cancellation closed (under 2 hours to start).</p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>
          Your simulated payment of {formatINR(b.amount)} will be refunded. This cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
