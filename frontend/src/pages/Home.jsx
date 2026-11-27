import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getFacility } from '../api/parkit.js';
import { roleHome, useAuth } from '../auth/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import ParkingArt from '../components/ParkingArt.jsx';

const STEPS = [
  ['1', 'Search', 'Type the locality you are driving to and see private spaces nearby, with prices up front.'],
  ['2', 'Book and get your QR', 'Pick a time, pay (simulated) and get a booking code, a QR image and the exact address.'],
  ['3', 'Park', 'Show the code to the host when you arrive. They check you in and out.'],
];

const FEATURES = [
  ['home', 'Earn from your empty spot', 'At the office all day? List the space at your home for those hours and get paid.', true],
  ['pin', 'Parking where you are going', 'Coming from Noida to Lajpat Nagar? Find and reserve a private spot before you leave.'],
  ['shield', 'Never double booked', 'The database itself refuses two bookings for the same spot at the same time.', true],
  ['mail', 'QR and email confirmations', 'Every booking gets a QR code (stored in Amazon S3) and an email through Amazon SNS.'],
];

export default function Home() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [where, setWhere] = useState('');
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

  const search = (e) => {
    e.preventDefault();
    navigate(where.trim() ? `/spaces?q=${encodeURIComponent(where.trim())}` : '/spaces');
  };

  return (
    <div className="stack stack-lg">
      <section className="hero-band" aria-labelledby="hero-heading">
        <div>
          <span className="hero-eyebrow"><span className="pulse" aria-hidden="true" />Spaces across Delhi NCR</span>
          <h1 id="hero-heading">
            Empty parking at home? <span className="hl">Someone nearby needs it.</span>
          </h1>
          <p className="lead">
            ParkIt connects home owners with free parking spaces to drivers who need a spot nearby.
            Search a locality, book by the hour and get a QR code for entry.
          </p>
          <form className="hero-search" role="search" onSubmit={search}>
            <label htmlFor="hero-where" className="visually-hidden">Where do you need parking?</label>
            <Icon name="search" size={20} className="search-icon" />
            <input
              id="hero-where"
              className="search-input"
              placeholder="Where are you going? e.g. Lajpat Nagar"
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" className="btn btn-accent">Find parking</button>
          </form>
          <div className="row">
            {role === 'admin' ? (
              <Link to={roleHome('admin')} className="btn btn-secondary">Open admin dashboard</Link>
            ) : (
              <Link to={role ? '/host' : '/register?next=/host'} className="btn btn-secondary">
                <Icon name="home" size={18} /> List your parking space
              </Link>
            )}
          </div>
          <ul className="hero-chips" aria-label="Highlights">
            <li><Icon name="check" size={16} />Book by the hour</li>
            <li><Icon name="check" size={16} />Address shared only after booking</li>
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
          <h2 id="facility-heading" className="m-0">Run by ParkIt: our own facility</h2>
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
          <p className="muted m-0">
            Plus spaces listed by home owners across the city. <Link to="/spaces">See all spaces</Link>
          </p>
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
