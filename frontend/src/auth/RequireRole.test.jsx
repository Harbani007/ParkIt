import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import RequireRole from './RequireRole.jsx';
import { AuthContext, roleHome } from './AuthContext.jsx';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderAt(path, auth) {
  return render(
    <AuthContext.Provider value={{ user: null, loading: false, ...auth }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <RequireRole roles={['admin']}>
                <p>Admin area</p>
              </RequireRole>
            }
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('roleHome', () => {
  it('maps roles to home routes', () => {
    expect(roleHome('admin')).toBe('/admin');
    expect(roleHome('customer')).toBe('/bookings');
    expect(roleHome(undefined)).toBe('/');
  });
});

describe('RequireRole', () => {
  it('redirects a guest to /login?next= with the encoded original path', () => {
    renderAt('/admin/slots?x=1', { user: null });
    expect(screen.getByTestId('where').textContent).toBe(
      `/login?next=${encodeURIComponent('/admin/slots?x=1')}`,
    );
    expect(screen.queryByText('Admin area')).toBeNull();
  });

  it('redirects a customer away from an admin route to their home', () => {
    renderAt('/admin', { user: { role: 'customer' } });
    expect(screen.getByTestId('where').textContent).toBe('/bookings');
    expect(screen.queryByText('Admin area')).toBeNull();
  });

  it('renders children for a permitted role', () => {
    renderAt('/admin', { user: { role: 'admin' } });
    expect(screen.getByText('Admin area')).toBeTruthy();
  });

  it('shows a loading status instead of redirecting while the session loads', () => {
    renderAt('/admin', { user: null, loading: true });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByTestId('where')).toBeNull();
    expect(screen.queryByText('Admin area')).toBeNull();
  });
});
