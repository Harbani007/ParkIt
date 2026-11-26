import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Placeholder from './pages/Placeholder.jsx';

export default function App() {
  return (
    <>
      <header className="nav">
        <NavLink to="/" className="brand">ParkIt</NavLink>
        <nav>
          <NavLink to="/book">Book a slot</NavLink>
          <NavLink to="/bookings">My bookings</NavLink>
          <NavLink to="/admin">Admin</NavLink>
          <NavLink to="/login">Log in</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          {/* Phase 3 replaces these placeholders with real pages. */}
          <Route path="/login" element={<Placeholder title="Log in" />} />
          <Route path="/register" element={<Placeholder title="Register" />} />
          <Route path="/book" element={<Placeholder title="Book a slot" />} />
          <Route path="/bookings" element={<Placeholder title="My bookings" />} />
          <Route path="/admin" element={<Placeholder title="Admin dashboard" />} />
          <Route path="*" element={<Placeholder title="Page not found" />} />
        </Routes>
      </main>
    </>
  );
}
