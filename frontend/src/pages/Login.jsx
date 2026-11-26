import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { roleHome, useAuth } from '../auth/AuthContext.jsx';
import Alert from '../components/Alert.jsx';
import Field from '../components/Field.jsx';
import Spinner from '../components/Spinner.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next')) ?? safeNext(location.state?.next);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  function validate() {
    const e = {};
    if (!email.trim()) e.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    if (!password) e.password = 'Enter your password.';
    return e;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (pending) return;
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      document.getElementById(e.email ? 'login-email' : 'login-password')?.focus();
      return;
    }
    setPending(true);
    try {
      const user = await login(email.trim(), password);
      navigate(next ?? roleHome(user.role), { replace: true });
    } catch (err) {
      if (err.status === 401) setFormError('Invalid email or password.');
      else if (err.status === 429) setFormError('Too many attempts. Wait a minute and try again.');
      else setFormError(err.message);
      setPending(false);
    }
  }

  return (
    <div className="container-narrow stack" style={{ marginInline: 'auto' }}>
      <h1>Log in</h1>

      {location.state?.expired ? (
        <Alert tone="warning">Your session has expired. Please log in again.</Alert>
      ) : null}
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <form className="card stack" onSubmit={onSubmit} noValidate aria-busy={pending || undefined}>
        <Field label="Email" id="login-email" error={errors.email} required>
          <input
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
        </Field>
        <Field label="Password" id="login-password" error={errors.password} required>
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? <Spinner inline /> : null}
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p>
        New to ParkIt?{' '}
        <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>Create an account</Link>
      </p>

      {import.meta.env.DEV ? (
        <p className="muted">
          Demo admin (local seed): admin@parkit.local / admin12345
        </p>
      ) : null}
    </div>
  );
}
