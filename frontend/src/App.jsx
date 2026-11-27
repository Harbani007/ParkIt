import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
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
import Spaces from './pages/Spaces.jsx';
import HostSpaces from './pages/host/HostSpaces.jsx';
import HostSpaceLayout from './pages/host/HostSpaceLayout.jsx';
import { ManageScope } from './manage/ManageScope.jsx';
import Icon, { BrandMark } from './components/Icon.jsx';

const TITLES = [
  ['/login', 'Log in'],
  ['/register', 'Register'],
  ['/spaces', 'Find parking'],
  ['/host', 'Your spaces'],
  ['/bookings', 'My bookings'],
  ['/admin/slots', 'Slots'],
  ['/admin/settings', 'Settings'],
  ['/admin/gate', 'Gate'],
  ['/admin', 'Dashboard'],
];

function pageTitle(pathname) {
  if (pathname === '/') return 'ParkIt: book parking ahead';
  if (pathname.startsWith('/bookings/')) return 'Booking | ParkIt';
  if (/^\/spaces\/\d+/.test(pathname)) return 'Book a space | ParkIt';
  if (/^\/host\/\d+/.test(pathname)) return 'Manage your space | ParkIt';
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
  const { user, role, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While the session is being restored, show nothing account-specific (no guest flash).
  const links =
    loading
      ? []
      : role === 'admin'
      ? [['/admin', 'Dashboard', true], ['/admin/gate', 'Gate'], ['/admin/slots', 'Slots'], ['/admin/settings', 'Settings']]
      : role === 'customer'
        ? [['/spaces', 'Find parking'], ['/bookings', 'My bookings', true], ['/host', 'Host']]
        : [['/spaces', 'Find parking'], ['/login', 'Log in'], ['/register', 'Register']];

  return (
    <header className={`nav no-print${open ? ' is-open' : ''}`}>
      <NavLink to="/" className="brand"><BrandMark />ParkIt</NavLink>
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

function AdminScope() {
  return (
    <ManageScope linkBase="/admin" apiBase="/admin">
      <Outlet />
    </ManageScope>
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
          <Route path="/spaces" element={<Spaces />} />
          <Route path="/spaces/:spaceId" element={<RequireRole roles={['customer']}><Book /></RequireRole>} />
          <Route path="/book" element={<Navigate to="/spaces" replace />} />
          <Route path="/host" element={<RequireRole roles={['customer']}><HostSpaces /></RequireRole>} />
          <Route path="/host/:spaceId" element={<RequireRole roles={['customer']}><HostSpaceLayout /></RequireRole>}>
            <Route index element={<Dashboard />} />
            <Route path="gate" element={<Gate />} />
            <Route path="slots" element={<Slots />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="/bookings" element={<RequireRole roles={['customer']}><MyBookings /></RequireRole>} />
          <Route path="/bookings/:code" element={<RequireRole roles={['customer', 'admin']}><BookingDetail /></RequireRole>} />
          <Route path="/admin" element={<RequireRole roles={['admin']}><AdminScope /></RequireRole>}>
            <Route index element={<Dashboard />} />
            <Route path="slots" element={<Slots />} />
            <Route path="settings" element={<Settings />} />
            <Route path="gate" element={<Gate />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="no-print">
        <div className="footer-inner">
          <span className="footer-aws"><Icon name="cloud" size={18} />Runs on AWS: EC2, RDS, S3, SNS</span>
          <ApiStatus />
        </div>
      </footer>
    </>
  );
}
