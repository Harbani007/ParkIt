import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TOKEN_KEY, setTokenGetter, setUnauthorizedHandler } from '../api/client.js';
import * as parkit from '../api/parkit.js';

// Token storage trade-off: localStorage survives reloads and keeps the app
// simple, but any XSS bug could read the token. Mitigations: React escapes
// output, no dangerouslySetInnerHTML, no third-party scripts, and the JWT
// expires (7 days). An httpOnly cookie would need API changes (CSRF, CDN
// cookie forwarding), so it is left as future work.
function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}

// Registered synchronously at import so requests made by children's first
// effects (which run before the provider's own effects) already carry the token.
setTokenGetter(readToken);

const AuthContext = createContext(null);

export function roleHome(role) {
  return role === 'admin' ? '/admin' : role === 'customer' ? '/bookings' : '/';
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(() => (readToken() ? 'loading' : 'ready'));

  const clearSession = useCallback(() => {
    writeToken(null);
    setUser(null);
  }, []);

  // 401 on a request that carried a token: drop the session and go to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setStatus('ready');
      const next = window.location.pathname + window.location.search;
      navigate('/login', {
        replace: true,
        state: { expired: true, next: next === '/login' ? undefined : next },
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession, navigate]);

  // Restore the session on load.
  useEffect(() => {
    if (!readToken()) return undefined;
    let cancelled = false;
    parkit
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch((err) => {
        // 401 is handled by the unauthorized handler; for other failures
        // (server down) keep the token but show as signed out.
        if (!cancelled && err.status !== 401) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setStatus('ready');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startSession = useCallback((res) => {
    writeToken(res.token);
    setUser(res.user);
    setStatus('ready');
    return res.user;
  }, []);

  // login/register resolve to the user, or throw ApiError (401, 409, 429, 400).
  const login = useCallback(
    async (email, password) => startSession(await parkit.login(email, password)),
    [startSession],
  );
  const register = useCallback(
    async (fields) => startSession(await parkit.register(fields)),
    [startSession],
  );
  // Navigate home first and only drop the session once the location is "/", so a route guard
  // on the current page cannot redirect to /login?next= in between.
  const [loggingOut, setLoggingOut] = useState(false);
  const logout = useCallback(() => {
    navigate('/');
    setLoggingOut(true);
  }, [navigate]);
  useEffect(() => {
    if (loggingOut && location.pathname === '/') {
      clearSession();
      setStatus('ready');
      setLoggingOut(false);
    }
  }, [loggingOut, location.pathname, clearSession]);

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      status,
      loading: status === 'loading',
      login,
      register,
      logout,
    }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { AuthContext };
