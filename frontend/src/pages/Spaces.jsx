import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchSpaces } from '../api/parkit.js';
import Alert from '../components/Alert.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { formatINR } from '../lib/money.js';

const isAbort = (e) => e?.name === 'AbortError';
const POPULAR = ['Lajpat Nagar', 'Saket', 'Hauz Khas', 'Connaught Place', 'Karol Bagh', 'Noida'];

/** Drivers search listed spaces by locality (D23). Results never show the house address. */
export default function Spaces() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const [draft, setDraft] = useState(q);
  const [state, setState] = useState({ status: 'loading', spaces: [], error: null });
  const [reload, setReload] = useState(0);

  useEffect(() => setDraft(q), [q]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: 'loading', error: null }));
    searchSpaces({ q: q || undefined, vehicleType: type || undefined }, { signal: ctrl.signal })
      .then((res) => setState({ status: 'ready', spaces: res.spaces, error: null }))
      .catch((e) => !isAbort(e) && setState({ status: 'error', spaces: [], error: e }));
    return () => ctrl.abort();
  }, [q, type, reload]);

  const go = (next) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.type) p.set('type', next.type);
    setParams(p);
  };

  return (
    <div className="stack stack-lg">
      <PageHeader title="Find parking" subtitle="Private spaces listed by people near you. Prices are per hour, capped per day." />

      <form
        className="search-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: draft.trim(), type });
        }}
      >
        <Icon name="search" size={20} className="search-icon" />
        <label htmlFor="space-search" className="visually-hidden">Locality or city</label>
        <input
          id="space-search"
          className="search-input"
          placeholder="Where do you need parking? e.g. Lajpat Nagar"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <select
          className="select search-type"
          aria-label="Vehicle type"
          value={type}
          onChange={(e) => go({ q, type: e.target.value })}
        >
          <option value="">Car or bike</option>
          <option value="car">Car</option>
          <option value="bike">Bike</option>
        </select>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      <div className="chip-row" aria-label="Popular localities">
        {POPULAR.map((p) => (
          <button key={p} type="button" className={`chip${q === p ? ' is-on' : ''}`} onClick={() => go({ q: p, type })}>
            {p}
          </button>
        ))}
        {q ? <button type="button" className="chip" onClick={() => go({ q: '', type })}>Show all</button> : null}
      </div>

      {state.status === 'loading' ? <Spinner label="Finding spaces" /> : null}
      {state.status === 'error' ? (
        <Alert tone="danger">
          <p>{state.error.message}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReload((n) => n + 1)}>Try again</button>
        </Alert>
      ) : null}

      {state.status === 'ready' && state.spaces.length === 0 ? (
        <EmptyState
          title={q ? `No spaces in "${q}" yet` : 'No spaces listed yet'}
          message="Try a nearby locality, or list your own empty parking space and earn from it."
          action={<Link to="/host" className="btn btn-accent">List your space</Link>}
        />
      ) : null}

      {state.status === 'ready' && state.spaces.length > 0 ? (
        <>
          <p className="muted m-0">
            {state.spaces.length} {state.spaces.length === 1 ? 'space' : 'spaces'}
            {q ? ` matching "${q}"` : ' across the city'}
          </p>
          <ul className="space-grid">
            {state.spaces.map((s) => (
              <li key={s.id}>
                <Link to={`/spaces/${s.id}`} className="space-card">
                  <div className="space-card-top">
                    <span className="space-pin"><Icon name="pin" size={18} />{s.locality}</span>
                    <span className="space-icons">
                      {s.vehicle_types.map((v) => <Icon key={v} name={v} size={20} />)}
                    </span>
                  </div>
                  <h2 className="space-name">{s.name}</h2>
                  <p className="muted m-0">{s.city}</p>
                  <div className="space-meta">
                    <span><Icon name="clock" size={16} /> {s.opens_at} to {s.closes_at}</span>
                    <span><Icon name="car" size={16} /> {s.slot_count} {s.slot_count === 1 ? 'spot' : 'spots'}</span>
                  </div>
                  <div className="space-card-foot">
                    <span className="space-price">
                      {s.from_hourly_rate ? <><strong>{formatINR(s.from_hourly_rate)}</strong> / hour</> : null}
                    </span>
                    <span className="btn btn-sm btn-primary">Book</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
