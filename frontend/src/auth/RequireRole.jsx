import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, roleHome } from './AuthContext.jsx';

// <RequireRole roles={['customer']}>...</RequireRole>
// Guest -> /login?next=<path>; signed in with the wrong role -> that role's home.
export default function RequireRole({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="empty-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <span className="visually-hidden">Loading</span>
      </div>
    );
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return children;
}
