import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFacility } from '../api/parkit.js';
import { roleHome, useAuth } from '../auth/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import ParkingArt from '../components/ParkingArt.jsx';

const STEPS = [
  ['1', 'Book', 'Pick a day, time and vehicle type, choose a slot and see the price up front.'],
  ['2', 'Get your QR', 'Pay (simulated) and receive a booking code with a QR image.'],
  ['3', 'Check in', 'Show the code at the gate. Staff check you in and out.'],
];

const FEATURES = [
  ['shield', 'Never double booked', 'The database itself refuses two bookings for the same slot at the same time.', true],
  ['qr', 'QR entry', 'Every booking gets a code and a QR image, stored privately in Amazon S3.'],
  ['mail', 'Email confirmations', 'Booking and cancellation emails delivered through Amazon SNS.', true],
  ['clock', 'Fair pricing', 'Pay by the hour, capped at the daily rate. Cancel free up to 2 hours before.'],
];

export default function Home() {
  const { role } = useAuth();
  const [facility, setFacility] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    getFacility({ signal: ctrl.signal })
      .then(setFacility)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => ctrl.abort();
  }, [attempt]);

  const cta =
    role === 'admin'
      ? { to: roleHome('admin'), label: 'Open dashboard' }
      : { to: '/book', label: 'Book a slot' };

  return (
    <div className="stack stack-lg">
      <section className="hero-band" aria-labelledby="hero-heading">
        <div>
          <span className="hero-eyebrow"><span className="pulse" aria-hidden="true" />Slots open today</span>
          <h1 id="hero-heading">
            Park in a private facility, <span className="hl">booked ahead.</span>
          </h1>
          <p className="lead">
            ParkIt lets you reserve a car or bike slot in advance. Check availability, see the
            price, and get a QR booking code for the gate.
          </p>
          <div className="row">
            <Link to={cta.to} className="btn btn-accent btn-lg">{cta.label}</Link>
            {!role && <Link to="/login" className="btn btn-secondary btn-lg">Log in</Link>}
            {role === 'customer' && <Link to="/bookings" className="btn btn-secondary btn-lg">My bookings</Link>}
          </div>
          <ul className="hero-chips" aria-label="Highlights">
            <li><Icon name="check" size={16} />Instant QR code</li>
            <li><Icon name="check" size={16} />Free cancellation</li>
            <li><Icon name="cloud" size={16} />Hosted on AWS</li>
          </ul>
        </div>
        <ParkingArt />
      </section>

      <section aria-label="Why ParkIt" className="feature-grid">
        {FEATURES.map(([icon, title, text, accent]) => (
          <div className="feature" key={title}>
            <span className={`icon-bubble${accent ? ' is-accent' : ''}`}><Icon name={icon} size={22} /></span>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </section>

      <section className="card facility-card" aria-labelledby="facility-heading">
        <span className="icon-bubble is-accent"><Icon name="car" size={24} /></span>
        <div className="stack">
          <h2 id="facility-heading" className="m-0">The facility</h2>
          {error ? (
            <div className="alert alert-danger" role="alert">
              <p>Could not load facility details: {error}</p>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </button>
            </div>
          ) : !facility ? (
            <div role="status">
              <span className="skeleton skeleton-line" />
              <span className="visually-hidden">Loading facility details</span>
            </div>
          ) : (
            <dl className="facility-facts">
              <div><dt>Name</dt><dd>{facility.name}</dd></div>
              {facility.address && <div><dt>Address</dt><dd>{facility.address}</dd></div>}
              <div><dt>Open daily</dt><dd>{facility.opens_at} to {facility.closes_at} IST</dd></div>
              <div><dt>Book up to</dt><dd>{facility.max_advance_days} days ahead</dd></div>
            </dl>
          )}
          <p className="muted m-0">Hourly and daily rates are shown per slot when you choose a time.</p>
        </div>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="steps">
          {STEPS.map(([n, title, text]) => (
            <li key={n}>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
