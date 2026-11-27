import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { manageBooking as getBooking, checkIn, checkOut } from '../../api/parkit.js';
import PageHeader from '../../components/PageHeader.jsx';
import Alert from '../../components/Alert.jsx';
import Spinner from '../../components/Spinner.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import BookingSummary from '../../components/BookingSummary.jsx';
import { normaliseBookingCode } from '../../lib/codes.js';
import { formatDateTime } from '../../lib/time.js';

const isAbort = (e) => e?.name === 'AbortError';

const NOTHING_TO_DO = {
  completed: 'This booking is already completed. The car has been checked out.',
  cancelled: 'This booking was cancelled, so nobody can be checked in.',
  missed: 'This booking was missed: the booking window ended without a check-in.',
};

export default function Gate() {
  const [params, setParams] = useSearchParams();
  const initial = normaliseBookingCode(params.get('code') ?? '');
  const [code, setCode] = useState(initial);
  const [booking, setBooking] = useState(null);
  const [looking, setLooking] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(null); // { tone, text }
  const [done, setDone] = useState(null); // { text, overstayed }
  const inputRef = useRef(null);
  const lookupCtrl = useRef(null);

  const lookup = useCallback(async (raw) => {
    const value = normaliseBookingCode(raw);
    if (!value) {
      setError({ tone: 'danger', text: 'Enter a booking code.' });
      inputRef.current?.focus();
      return;
    }
    lookupCtrl.current?.abort();
    const ctrl = new AbortController();
    lookupCtrl.current = ctrl;
    setLooking(true);
    setError(null);
    setDone(null);
    setBooking(null);
    try {
      const b = await getBooking(value, { signal: ctrl.signal });
      setBooking(b);
    } catch (err) {
      if (isAbort(err)) return;
      setError({
        tone: 'danger',
        text: err.status === 404 ? 'No booking with that code.' : err.message || 'Could not look up the booking.',
      });
      inputRef.current?.focus();
    } finally {
      if (lookupCtrl.current === ctrl) setLooking(false);
    }
  }, []);

  useEffect(() => {
    if (initial) lookup(initial);
    return () => lookupCtrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onChange(e) {
    setCode(normaliseBookingCode(e.target.value));
  }

  function onSubmit(e) {
    e.preventDefault();
    if (params.get('code')) setParams({}, { replace: true });
    lookup(code);
  }

  async function act(kind) {
    setActing(true);
    setError(null);
    try {
      const updated = kind === 'in' ? await checkIn(booking.booking_code) : await checkOut(booking.booking_code);
      const at = kind === 'in' ? updated.checked_in_at : updated.checked_out_at;
      setDone({
        text: `${updated.booking_code} ${kind === 'in' ? 'checked in' : 'checked out'} at ${formatDateTime(at)}.`,
        overstayed: kind === 'out' && Boolean(updated.overstayed),
      });
      setBooking(null);
      setCode('');
      inputRef.current?.focus();
    } catch (err) {
      setError({
        tone: err.status === 409 ? 'warning' : 'danger',
        text: err.message || 'The action failed.',
      });
      if (err.status === 409) {
        // State changed under us (e.g. already checked in): show the booking's true state.
        try {
          setBooking(await getBooking(booking.booking_code));
        } catch {
          /* keep what is on screen; the warning above still explains the conflict */
        }
      }
    } finally {
      setActing(false);
    }
  }

  const status = booking?.status;

  return (
    <div className="container container-narrow stack-lg">
      <PageHeader title="Gate" subtitle="Check cars in and out by booking code." />

      <form className="card stack" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="gate-code">Booking code</label>
          <input
            id="gate-code"
            ref={inputRef}
            className="input input-lg"
            value={code}
            onChange={onChange}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            placeholder="PK-XXXXXX"
            aria-describedby="gate-hint"
          />
          <p className="field-hint" id="gate-hint">Type or paste the code, for example PK-7KQ2XM. The dash is optional.</p>
        </div>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={looking || acting}>
          {looking ? <Spinner inline /> : null}
          Find booking
        </button>
      </form>

      {done ? (
        <Alert tone="success">
          <p><strong>{done.text}</strong></p>
          {done.overstayed ? <p><span className="badge badge-warning">Overstayed</span> The car stayed past the booked end time.</p> : null}
          <p>Ready for the next car.</p>
        </Alert>
      ) : null}

      {error ? <Alert tone={error.tone}>{error.text}</Alert> : null}

      {looking ? <Spinner label="Looking up booking" /> : null}

      {booking ? (
        <div className="stack">
          <BookingSummary booking={booking} showCustomer />
          {status === 'confirmed' ? (
            <div className="stack">
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => act('in')} disabled={acting} aria-busy={acting || undefined}>
                {acting ? <Spinner inline /> : null}
                Check in
              </button>
              <p className="muted">Check-in opens 15 minutes before the start time and closes when the booking ends.</p>
            </div>
          ) : status === 'checked_in' ? (
            <div className="stack">
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => act('out')} disabled={acting} aria-busy={acting || undefined}>
                {acting ? <Spinner inline /> : null}
                Check out
              </button>
              <p className="muted">Checking out ends the stay. Cars that leave after the booked end time are flagged as overstayed.</p>
            </div>
          ) : (
            <Alert tone="info">
              <StatusBadge booking={booking} />{' '}
              {NOTHING_TO_DO[status] ?? 'Nothing can be done for this booking.'}
            </Alert>
          )}
        </div>
      ) : null}
    </div>
  );
}
