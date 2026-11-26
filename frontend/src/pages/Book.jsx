import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createBooking, getAvailability, getFacility } from '../api/parkit.js';
import { fileUrl } from '../api/client.js';
import Alert from '../components/Alert.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Field from '../components/Field.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SlotGrid, { ANY_SLOT, anySlotPrice } from '../components/SlotGrid.jsx';
import Spinner from '../components/Spinner.jsx';
import {
  addDaysIST,
  endTimeLabel,
  formatDate,
  formatTimeRange,
  hourOptions,
  isWithinCancelWindow,
  maxDateIST,
  startsAtISO,
  startTimeOptions,
  todayIST,
} from '../lib/time.js';
import { formatINR } from '../lib/money.js';
import { isValidVehicleNumber, normaliseVehicleNumber } from '../lib/codes.js';

const isAbort = (e) => e?.name === 'AbortError';

export default function Book() {
  const [facility, setFacility] = useState(null);
  const [facilityError, setFacilityError] = useState(null);

  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [hours, setHours] = useState(1);
  const [type, setType] = useState('car');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [touched, setTouched] = useState(false);
  const [selected, setSelected] = useState(null);

  const [view, setView] = useState('choose'); // choose | pay | done
  const [avail, setAvail] = useState({ status: 'idle', slots: [], error: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState(null); // { tone, text } shown on the choose view
  const [submitError, setSubmitError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState(null);

  const chooseHeading = useRef(null);
  const payHeading = useRef(null);
  const doneHeading = useRef(null);
  const viewChanged = useRef(false);

  // Facility
  const loadFacility = useCallback(() => {
    const ctrl = new AbortController();
    setFacilityError(null);
    getFacility({ signal: ctrl.signal })
      .then((f) => {
        setFacility(f);
        const today = todayIST();
        const hasToday = startTimeOptions(f, today).length > 0;
        const tomorrow = addDaysIST(today, 1);
        setDate(hasToday || tomorrow > maxDateIST(f) ? today : tomorrow);
      })
      .catch((e) => !isAbort(e) && setFacilityError(e));
    return ctrl;
  }, []);
  useEffect(() => {
    const ctrl = loadFacility();
    return () => ctrl.abort();
  }, [loadFacility]);

  const startOptions = useMemo(
    () => (facility && date ? startTimeOptions(facility, date) : []),
    [facility, date],
  );
  // Keep the start time valid when the date (and so the option list) changes.
  useEffect(() => {
    if (!facility || !date) return;
    setStart((s) => (startOptions.includes(s) ? s : startOptions[0] ?? ''));
  }, [facility, date, startOptions]);

  const hoursList = useMemo(() => (facility && start ? hourOptions(facility, start) : []), [facility, start]);
  useEffect(() => {
    if (hoursList.length) setHours((h) => (hoursList.includes(h) ? h : Math.min(h, hoursList.length) || 1));
  }, [hoursList]);

  const ready = Boolean(facility && date && start && hoursList.includes(hours));
  const startsAt = ready ? startsAtISO(date, start) : null;

  // Availability: debounced, stale requests aborted.
  useEffect(() => {
    if (!ready) {
      setAvail({ status: 'idle', slots: [], error: null });
      return undefined;
    }
    const ctrl = new AbortController();
    setAvail((a) => ({ ...a, status: 'loading', error: null }));
    const timer = setTimeout(() => {
      getAvailability({ startsAt, hours, vehicleType: type }, { signal: ctrl.signal })
        .then((res) => setAvail({ status: 'ready', slots: res.slots, error: null }))
        .catch((e) => {
          if (!isAbort(e)) setAvail({ status: 'error', slots: [], error: e });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [ready, startsAt, hours, type, refreshKey]);

  const slots = useMemo(() => avail.slots.filter((s) => s.vehicle_type === type), [avail.slots, type]);
  const anyPrice = useMemo(() => anySlotPrice(slots), [slots]);

  // Drop a selection that is no longer valid.
  useEffect(() => {
    if (avail.status !== 'ready') return;
    setSelected((sel) => {
      if (sel === null) return sel;
      if (sel === ANY_SLOT) return anyPrice ? sel : null;
      const s = slots.find((x) => x.id === sel);
      return s?.available ? sel : null;
    });
  }, [avail.status, slots, anyPrice]);

  // Any change to the inputs invalidates what was chosen and returns to the first view.
  const inputsKey = `${date}|${start}|${hours}|${type}`;
  useEffect(() => {
    setSelected(null);
    setSubmitError(null);
  }, [inputsKey]);

  // Move focus to the heading of the new view.
  useEffect(() => {
    if (!viewChanged.current) return;
    const ref = view === 'pay' ? payHeading : view === 'done' ? doneHeading : chooseHeading;
    ref.current?.focus();
  }, [view]);
  const goTo = (v) => {
    viewChanged.current = true;
    setView(v);
  };

  const selectedSlot = typeof selected === 'number' ? slots.find((s) => s.id === selected) : null;
  const price = selected === ANY_SLOT ? anyPrice?.text : selectedSlot ? formatINR(selectedSlot.amount) : null;
  const normalised = normaliseVehicleNumber(vehicleNumber);
  const vehicleValid = isValidVehicleNumber(normalised);
  const vehicleError =
    fieldError ||
    (touched && !vehicleValid
      ? normalised.length === 0
        ? 'Enter your vehicle number.'
        : 'Use 4 to 12 letters and digits, for example DL3CAB1234.'
      : null);

  const lateWarning = ready && isWithinCancelWindow(startsAt);

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    setFieldError(null);
    setSubmitError(null);
    if (!vehicleValid || !selected) return;
    setSubmitting(true);
    try {
      const body = {
        vehicle_type: type,
        starts_at: startsAt,
        hours,
        vehicle_number: normalised,
        ...(selected !== ANY_SLOT ? { slot_id: selected } : {}),
      };
      const created = await createBooking(body);
      setBooking(created);
      goTo('done');
    } catch (err) {
      if (err.status === 409) {
        // Slot may have just been taken: refresh the grid and, if our slot is gone, go back.
        let stillFree = true;
        try {
          const res = await getAvailability({ startsAt, hours, vehicleType: type });
          setAvail({ status: 'ready', slots: res.slots, error: null });
          if (typeof selected === 'number') {
            stillFree = res.slots.some((s) => s.id === selected && s.available);
          } else {
            stillFree = res.slots.some((s) => s.vehicle_type === type && s.available);
          }
        } catch {
          setRefreshKey((k) => k + 1);
        }
        if (!stillFree) {
          setSelected(null);
          setNotice({ tone: 'warning', text: `${err.message}. The slot list has been refreshed, so please pick another.` });
          goTo('choose');
        } else {
          setSubmitError(err.message);
        }
      } else if (err.status === 400) {
        setSubmitError(err.message);
        if (JSON.stringify(err.details ?? '').includes('vehicle_number')) setFieldError(err.message);
      } else {
        setSubmitError(err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const bookAnother = () => {
    setBooking(null);
    setSelected(null);
    setNotice(null);
    setRefreshKey((k) => k + 1);
    goTo('choose');
  };

  // ---------- Render ----------
  if (facilityError) {
    return (
      <div className="container container-narrow stack">
        <PageHeader title="Book a slot" />
        <Alert tone="danger">{facilityError.message}</Alert>
        <div><button type="button" className="btn btn-secondary" onClick={loadFacility}>Try again</button></div>
      </div>
    );
  }
  if (!facility || !date) {
    return (
      <div className="container container-narrow stack">
        <PageHeader title="Book a slot" />
        <Spinner label="Loading facility" />
      </div>
    );
  }

  if (view === 'done' && booking) {
    return (
      <div className="container container-narrow stack">
        <PageHeader title="Booking confirmed" headingRef={doneHeading} />
        <Alert tone="success">Your slot is reserved and the simulated payment of {formatINR(booking.amount)} is complete.</Alert>
        <div className="card stack stack-center">
          <p className="muted">Your booking code</p>
          <span className="code">{booking.booking_code}</span>
          {booking.qr_url ? (
            <img className="qr" src={fileUrl(booking.qr_url)} alt={`QR code for booking ${booking.booking_code}`} />
          ) : null}
          <p>
            Slot <strong>{booking.slot.code}</strong> &middot; {booking.vehicle_number}
            <br />
            {formatTimeRange(booking.starts_at, booking.ends_at)}
          </p>
          <p className="muted">Show the code or QR at the gate.</p>
        </div>
        <div className="row">
          <Link className="btn btn-primary" to={`/bookings/${encodeURIComponent(booking.booking_code)}`}>View booking</Link>
          <Link className="btn btn-secondary" to="/bookings">My bookings</Link>
          <button type="button" className="btn btn-ghost" onClick={bookAnother}>Book another</button>
        </div>
      </div>
    );
  }

  const noStartToday = startOptions.length === 0;
  const maxDate = maxDateIST(facility);

  if (view === 'pay') {
    return (
      <div className="container container-narrow stack">
        <PageHeader title="Vehicle and pay" headingRef={payHeading} subtitle="Step 3 of 3" />
        <form className="stack" onSubmit={submit} noValidate>
          <div className="card stack">
            <h2>Summary</h2>
            <dl className="dl dl-tight">
              <div><dt>When</dt><dd>{formatTimeRange(startsAt, startsAtISO(date, endTimeLabel(start, hours)))}</dd></div>
              <div><dt>Duration</dt><dd>{hours} {hours === 1 ? 'hour' : 'hours'}</dd></div>
              <div><dt>Vehicle type</dt><dd>{type === 'car' ? 'Car' : 'Bike'}</dd></div>
              <div>
                <dt>Slot</dt>
                <dd>{selected === ANY_SLOT ? 'Assigned on booking (least-used free slot)' : selectedSlot?.code}</dd>
              </div>
              <div><dt>Amount</dt><dd><strong>{price}</strong></dd></div>
            </dl>
          </div>

          <Field
            label="Vehicle number"
            required
            value={vehicleNumber}
            onChange={(e) => { setVehicleNumber(e.target.value); setFieldError(null); }}
            onBlur={() => setTouched(true)}
            error={vehicleError}
            hint={normalised ? `Will be saved as ${normalised}` : 'For example DL 3C AB 1234. Spaces and dashes are ignored.'}
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={24}
          />

          {lateWarning ? (
            <Alert tone="warning" title="No cancellation">
              This booking starts in under 2 hours and cannot be cancelled.
            </Alert>
          ) : (
            <p className="field-hint">You can cancel for a full refund until 2 hours before the start.</p>
          )}

          <Alert tone="info" title="Simulated payment">
            No real money is charged. Pressing the button below marks the payment as paid for this demo.
          </Alert>

          {submitError ? <Alert tone="danger">{submitError}</Alert> : null}

          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => goTo('choose')} disabled={submitting}>Back</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <Spinner inline /> : null}
              {selected === ANY_SLOT && anyPrice && !anyPrice.same ? `Pay and book (${price})` : `Pay ${price} and book`}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // view === 'choose'
  const endLabel = (h) => `${h} h (until ${endTimeLabel(start, h)})`;
  const chooseDisabled = !selected || avail.status !== 'ready';

  return (
    <div className="container stack-lg">
      <PageHeader
        title="Book a slot"
        headingRef={chooseHeading}
        subtitle={`Open ${facility.opens_at} to ${facility.closes_at} IST. Times are Indian Standard Time.`}
      />

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <section className="card stack" aria-labelledby="step1">
        <h2 id="step1">1. When and what</h2>
        <div className="field-row">
          <Field
            label="Date"
            type="date"
            required
            value={date}
            min={todayIST()}
            max={maxDate}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            hint={`Up to ${formatDate(maxDate + 'T12:00:00+05:30')}`}
          />
          <Field
            label="Start time (IST)"
            as="select"
            required
            value={start}
            disabled={noStartToday}
            onChange={(e) => setStart(e.target.value)}
            options={startOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            error={noStartToday ? 'Bookings for this date are closed. Pick another date.' : null}
          />
          <Field
            label="Duration"
            as="select"
            required
            value={hours}
            disabled={!hoursList.length}
            onChange={(e) => setHours(Number(e.target.value))}
            options={hoursList.map((h) => <option key={h} value={h}>{endLabel(h)}</option>)}
          />
        </div>
        <div className="field">
          <span id="vtype-label" className="label-text">Vehicle type</span>
          <div className="segmented" role="radiogroup" aria-labelledby="vtype-label">
            {['car', 'bike'].map((t) => (
              <label key={t}>
                <input type="radio" name="vehicle_type" value={t} checked={type === t} onChange={() => setType(t)} />
                <span>{t === 'car' ? 'Car' : 'Bike'}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack" aria-labelledby="step2" aria-busy={avail.status === 'loading'}>
        <div className="row-between">
          <h2 id="step2">2. Choose a slot</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={!ready || avail.status === 'loading'}
          >
            Refresh
          </button>
        </div>

        {!ready ? (
          <p className="muted">Pick a date, start time and duration to see free slots.</p>
        ) : avail.status === 'error' ? (
          <>
            <Alert tone="danger">{avail.error.message}</Alert>
            <div><button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((k) => k + 1)}>Try again</button></div>
          </>
        ) : avail.status === 'idle' || (avail.status === 'loading' && avail.slots.length === 0) ? (
          <div className="slot-grid" aria-label="Loading slots">
            <Spinner label="Loading slots" />
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-tile" />)}
          </div>
        ) : slots.length === 0 ? (
          <EmptyState
            title={`No ${type} slots at this facility`}
            message="Try the other vehicle type."
          />
        ) : (
          <>
            {!anyPrice ? (
              <EmptyState
                title="Nothing free at this time"
                message="Every slot is booked. Try a different start time, a shorter duration or another date."
              />
            ) : null}
            <SlotGrid
              slots={slots}
              value={selected}
              onChange={setSelected}
              legend={`Slots for ${type}s on ${date} at ${start}`}
              disabled={avail.status === 'loading'}
            />
          </>
        )}
        <p className="visually-hidden" role="status">
          {avail.status === 'ready' ? `${slots.filter((s) => s.available).length} free slots` : ''}
        </p>
      </section>

      {lateWarning && selected ? (
        <Alert tone="warning" title="No cancellation">
          This booking starts in under 2 hours and cannot be cancelled once confirmed.
        </Alert>
      ) : null}

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={chooseDisabled}
          onClick={() => { setNotice(null); goTo('pay'); }}
        >
          Continue{price ? ` (${price})` : ''}
        </button>
        {!selected && ready ? <span className="muted">Choose a slot to continue.</span> : null}
      </div>
    </div>
  );
}
