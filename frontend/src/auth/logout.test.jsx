import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import RequireRole from './RequireRole.jsx';

vi.mock('../api/parkit.js', () => ({
  me: vi.fn(async () => ({ user: { id: 1, name: 'Cy', role: 'customer' } })),
  login: vi.fn(),
  register: vi.fn(),
}));

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function LogoutButton() {
  const { logout } = useAuth();
  return <button onClick={logout}>Log out</button>;
}

describe('logout', () => {

  it('from a protected page goes to "/" with no next param', async () => {
    const { TOKEN_KEY } = await import('../api/client.js');
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, 'x');
    render(
      <MemoryRouter initialEntries={['/book']}>
        <AuthProvider>
          <LogoutButton />
          <Routes>
            <Route path="/book" element={<RequireRole roles={['customer']}><p>Book page</p></RequireRole>} />
            <Route path="*" element={<Where />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Book page');
    fireEvent.click(screen.getByText('Log out'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
