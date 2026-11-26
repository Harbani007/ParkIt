import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFacility } from '../api/parkit.js';
import { roleHome, useAuth } from '../auth/AuthContext.jsx';

const STEPS = [
  ['1', 'Book', 'Pick a day, time and vehicle type, choose a slot and see the price up front.'],
  ['2', 'Get your QR', 'Pay (simulated) and receive a booking code with a QR image.'],
  ['3', 'Check in', 'Show the code at the gate. Staff check you in and out.'],
];

const dd = { margin: '0 0 var(--space-3)' };

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
      <section className="stack">
        <h1>Park in a private facility, booked ahead.</h1>
        <p>
          ParkIt lets you reserve a car or bike slot in advance. Check availability, see the
          price, and get a QR booking code for the gate.
        </p>
        <div className="row">
          <Link to={cta.to} className="btn btn-primary">{cta.label}</Link>
          {!role && <Link to="/login" className="btn btn-secondary">Log in</Link>}
          {role === 'customer' && <Link to="/bookings" className="btn btn-secondary">My bookings</Link>}
        </div>
      </section>

      <section className="card" aria-labelledby="facility-heading">
        <h2 id="facility-heading">The facility</h2>
        {error ? (
          <div className="alert alert-danger" role="alert">
            <p>Could not load facility details: {error}</p>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </button>
          </div>
        ) : !facility ? (
          <div role="status">
            <span className="skeleton" style={{ display: 'block', height: '1.25rem', width: '60%' }} />
            <span className="visually-hidden">Loading facility details</span>
          </div>
        ) : (
          <dl style={{ margin: 0 }}>
            <dt className="muted">Name</dt>
            <dd style={dd}>{facility.name}</dd>
            {facility.address && (
              <>
                <dt className="muted">Address</dt>
                <dd style={dd}>{facility.address}</dd>
              </>
            )}
            <dt className="muted">Open daily</dt>
            <dd style={dd}>{facility.opens_at} to {facility.closes_at} IST</dd>
            <dt className="muted">Book up to</dt>
            <dd style={{ margin: 0 }}>{facility.max_advance_days} days ahead</dd>
          </dl>
        )}
        <p className="muted">Hourly and daily rates are shown per slot when you choose a time.</p>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {STEPS.map(([n, title, text]) => (
            <li key={n} className="card">
              <h3>{n}. {title}</h3>
              <p className="muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
