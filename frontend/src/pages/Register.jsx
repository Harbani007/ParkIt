import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { roleHome, useAuth } from '../auth/AuthContext.jsx';
import Alert from '../components/Alert.jsx';
import Field from '../components/Field.jsx';
import Spinner from '../components/Spinner.jsx';
import { useConfig } from '../api/useConfig.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS = ['name', 'email', 'phone', 'password'];

function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

// API details look like [{ path: 'body.email', message }]; map them to our field names.
function detailsToErrors(details) {
  const out = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    const key = String(d?.path ?? '').split('.').pop();
    if (FIELDS.includes(key) && d.message && !out[key]) out[key] = d.message;
  }
  return out;
}

export default function Register() {
  const { register } = useAuth();
  const { email_notifications: emailsOn } = useConfig();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [values, setValues] = useState({ name: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (key) => (ev) => setValues((v) => ({ ...v, [key]: ev.target.value }));

  function validate() {
    const e = {};
    const name = values.name.trim();
    if (!name) e.name = 'Enter your name.';
    else if (name.length > 100) e.name = 'Name can be at most 100 characters.';

    const email = values.email.trim();
    if (!email) e.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email)) e.email = 'Enter a valid email address.';

    const phone = values.phone.trim();
    if (phone && !/^\d{10,15}$/.test(phone)) e.phone = 'Phone must be 10 to 15 digits, with no spaces or symbols.';

    const pw = values.password;
    if (pw.length < 8) e.password = 'Password must be at least 8 characters.';
    else if (new TextEncoder().encode(pw).length > 72) e.password = 'Password is too long (72 bytes at most).';
    return e;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (pending) return;
    setFormError(null);
    const e = validate();
    setErrors(e);
    const first = FIELDS.find((f) => e[f]);
    if (first) {
      document.getElementById(`register-${first}`)?.focus();
      return;
    }
    setPending(true);
    try {
      const user = await register({
        name: values.name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        password: values.password,
      });
      navigate(next ?? roleHome(user.role), { replace: true });
    } catch (err) {
      const fieldErrors = err.status === 400 ? detailsToErrors(err.details) : {};
      if (Object.keys(fieldErrors).length) {
        setErrors(fieldErrors);
        setFormError('Please fix the highlighted fields.');
        document.getElementById(`register-${FIELDS.find((f) => fieldErrors[f])}`)?.focus();
      } else if (err.status === 409) {
        setErrors({ email: 'An account with this email already exists.' });
        setFormError('An account with this email already exists. Try logging in instead.');
      } else if (err.status === 429) {
        setFormError('Too many attempts. Wait a minute and try again.');
      } else {
        setFormError(err.message);
      }
      setPending(false);
    }
  }

  return (
    <div className="container-narrow stack" style={{ marginInline: 'auto' }}>
      <h1>Create an account</h1>

      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <form className="card stack" onSubmit={onSubmit} noValidate aria-busy={pending || undefined}>
        <Field label="Full name" id="register-name" error={errors.name} required>
          <input
            className="input"
            name="name"
            autoComplete="name"
            maxLength={100}
            value={values.name}
            onChange={set('name')}
          />
        </Field>
        <Field
          label="Email"
          id="register-email"
          error={errors.email}
          required
          hint={
            emailsOn
              ? 'We email your booking confirmations. AWS will first send you a message titled "AWS Notification - Subscription Confirmation": click its link to turn the emails on.'
              : undefined
          }
        >
          <input
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={values.email}
            onChange={set('email')}
          />
        </Field>
        <Field
          label="Phone (optional)"
          id="register-phone"
          hint="10 to 15 digits, for the facility to reach you."
          error={errors.phone}
        >
          <input
            className="input"
            type="tel"
            name="phone"
            autoComplete="tel"
            inputMode="numeric"
            value={values.phone}
            onChange={set('phone')}
          />
        </Field>
        <Field
          label="Password"
          id="register-password"
          hint="At least 8 characters."
          error={errors.password}
          required
        >
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="new-password"
            value={values.password}
            onChange={set('password')}
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? <Spinner inline /> : null}
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p>
        Already have an account?{' '}
        <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>Log in</Link>
      </p>
    </div>
  );
}
