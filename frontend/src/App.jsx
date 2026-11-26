import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { health } from './api/parkit.js';
import { roleHome, useAuth } from './auth/AuthContext.jsx';
import RequireRole from './auth/RequireRole.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Book from './pages/Book.jsx';
import MyBookings from './pages/MyBookings.jsx';
import BookingDetail from './pages/BookingDetail.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Slots from './pages/admin/Slots.jsx';
import Settings from './pages/admin/Settings.jsx';
import Gate from './pages/admin/Gate.jsx';
import NotFound from './pages/NotFound.jsx';

const TITLES = [
  ['/login', 'Log in'],
  ['/register', 'Register'],
  ['/book', 'Book a slot'],
  ['/bookings', 'My bookings'],
  ['/admin/slots', 'Slots'],
  ['/admin/settings', 'Settings'],
  ['/admin/gate', 'Gate'],
  ['/admin', 'Dashboard'],
];

function pageTitle(pathname) {
  if (pathname === '/') return 'ParkIt: book parking ahead';
  if (pathname.startsWith('/bookings/')) return 'Booking | ParkIt';
  const hit = TITLES.find(([p]) => pathname === p);
  return `${hit ? hit[1] : 'Page not found'} | ParkIt`;
}

// Guests only: signed-in users go to ?next= (same-site paths only) or their home.
function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  if (loading) return children;
  if (user) {
    // Same precedence as Login: ?next=, then location.state.next, then the role's home. Login's
    // own navigate() after a successful submit therefore resolves to the same target.
    const safe = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null);
    const next = safe(params.get('next')) ?? safe(location.state?.next);
    return <Navigate to={next ?? roleHome(user.role)} replace />;
  }
  return children;
}

function NavBar() {
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const links =
    role === 'admin'
      ? [['/admin', 'Dashboard', true], ['/admin/gate', 'Gate'], ['/admin/slots', 'Slots'], ['/admin/settings', 'Settings']]
      : role === 'customer'
        ? [['/book', 'Book a slot'], ['/bookings', 'My bookings', true]]
        : [['/book', 'Book a slot'], ['/login', 'Log in'], ['/register', 'Register']];

  return (
    <header className={`nav no-print${open ? ' is-open' : ''}`}>
      <NavLink to="/" className="brand">ParkIt</NavLink>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="main-nav"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Close' : 'Menu'}
        <span className="visually-hidden"> navigation</span>
      </button>
      <nav id="main-nav" aria-label="Main">
        {links.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={Boolean(end)}>{label}</NavLink>
        ))}
        {user && (
          <>
            <span className="nav-user">{user.name}</span>
            <button type="button" onClick={logout}>Log out</button>
          </>
        )}
      </nav>
    </header>
  );
}

function ApiStatus() {
  const [state, setState] = useState('checking…');
  useEffect(() => {
    const ctrl = new AbortController();
    health({ signal: ctrl.signal })
      .then((h) => setState(`${h.status} (database ${h.db})`))
      .catch((err) => {
        if (err.name !== 'AbortError') setState('unreachable');
      });
    return () => ctrl.abort();
  }, []);
  return <p className="muted m-0">API: {state}</p>;
}

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = pageTitle(pathname);
  }, [pathname]);

  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <NavBar />
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="/book" element={<RequireRole roles={['customer']}><Book /></RequireRole>} />
          <Route path="/bookings" element={<RequireRole roles={['customer']}><MyBookings /></RequireRole>} />
          <Route path="/bookings/:code" element={<RequireRole roles={['customer', 'admin']}><BookingDetail /></RequireRole>} />
          <Route path="/admin" element={<RequireRole roles={['admin']}><Dashboard /></RequireRole>} />
          <Route path="/admin/slots" element={<RequireRole roles={['admin']}><Slots /></RequireRole>} />
          <Route path="/admin/settings" element={<RequireRole roles={['admin']}><Settings /></RequireRole>} />
          <Route path="/admin/gate" element={<RequireRole roles={['admin']}><Gate /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="no-print">
        <ApiStatus />
      </footer>
    </>
  );
}
