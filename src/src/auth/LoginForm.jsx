import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { startGoogleSignIn } from './googleSignIn';
import PasswordField from './PasswordField';
import { GoogleMark, AlertIcon } from './AuthChrome';
import './auth.css';

/**
 * Host sign in. Built from docs/design/entry-redesign/10-signin.html.
 *
 * ONLY GOOGLE EXISTS. The brief says four providers are configured in Cognito;
 * the app contains exactly one button, and `10-signin.html` draws one plus a
 * separate panel showing what the block becomes at four. Drawing four buttons
 * here would be drawing a feature. If the other three are ever wired up, the
 * one full-width button becomes a two-up grid and nothing else moves.
 * (RATIONALE.md §8.2, OPEN-QUESTIONS.md §8.)
 *
 * THE ERROR COPY IS THE POINT. Cognito's `signIn` failures were unmapped, so a
 * product that never asks for a username told people "Incorrect username or
 * password." The mapping now lives in AuthContext (which owns the Cognito
 * codes); this form echoes the address back, because that is the thing worth
 * checking, and names the one cause the message cannot otherwise explain --
 * an account created with Google has no password to be wrong.
 *
 * `initialError` carries a message in from the URL, which is how OAuthCallback
 * reports a failure it could not handle itself.
 */
const LoginForm = ({ onToggleMode, onSuccess, initialError }) => {
  const [form, setForm] = useState({ email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const { signIn, error, setError } = useAuth();
  const displayError = error || initialError;

  const change = (key) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
    if (error) setError(null);
  };

  const validate = () => {
    const errors = {};
    if (!form.email.trim()) errors.email = 'We need an email address.';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errors.email = 'That does not look like an email address.';
    if (!form.password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const user = await signIn(form.email, form.password);
      if (onSuccess) onSuccess(user);
    } catch (_) {
      /* surfaced through AuthContext's `error` */
    } finally {
      setIsSubmitting(false);
    }
  };

  // The address is echoed into the headline rather than left implicit: when a
  // sign-in fails, "which address did I just type" is the question, and a
  // second account at a different domain is the commonest answer.
  //
  // ONLY FOR `error`, NEVER FOR `initialError`. AuthContext's mapped messages
  // are written to be completed by an address ("That password does not match",
  // "...for"). `initialError` is an opaque string off the URL that OAuthCallback
  // put there; appending an address to a sentence not written for one produces
  // "Something went wrong dana@example.com".
  const rejected = Boolean(error) && form.email.trim();

  return (
    <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
      <div>
        <p className="au-kicker">Running a session</p>
        <h1 style={{ marginTop: '10px' }}>Host sign in</h1>
      </div>

      {displayError && (
        <div className="au-notice is-attn" role="alert">
          <AlertIcon />
          <div className="au-notice-body">
            <h3 className="au-wrapany">
              {rejected ? `${displayError} ${form.email.trim()}` : displayError}
            </h3>
            <p>
              Signed up with Google? Use the Google button — there is no password on that
              account.
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        className="au-btn au-btn-social"
        onClick={() => startGoogleSignIn('login')}
        disabled={isSubmitting}
      >
        <GoogleMark /> Continue with Google
      </button>

      <p className="au-divider">or</p>

      <form className="au-stack au-s20" onSubmit={handleSubmit} noValidate>
        <div className="au-field">
          <label className="au-label" htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            className={`au-input${fieldErrors.email || displayError ? ' is-bad' : ''}`}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck="false"
            placeholder="you@work.com"
            value={form.email}
            onChange={change('email')}
            disabled={isSubmitting}
            aria-describedby={fieldErrors.email ? 'login-email-err' : undefined}
            aria-invalid={fieldErrors.email ? true : undefined}
          />
          {fieldErrors.email && <p className="au-hint is-bad" id="login-email-err">{fieldErrors.email}</p>}
        </div>

        <PasswordField
          id="login-pw"
          name="password"
          label="Password"
          value={form.password}
          onChange={change('password')}
          autoComplete="current-password"
          invalid={Boolean(fieldErrors.password || displayError)}
          disabled={isSubmitting}
          hint={fieldErrors.password}
          hintId="login-pw-err"
          trailing={
            <button
              type="button"
              onClick={() => onToggleMode('forgot')}
              disabled={isSubmitting}
              style={{
                background: 'none', border: 0, padding: 0, font: 'inherit',
                fontWeight: 600, color: 'var(--secondary)', cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Forgotten it?
            </button>
          }
        />

        <button type="submit" className="au-btn au-btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="au-meta">
        New here?{' '}
        <button
          type="button"
          onClick={() => onToggleMode('register')}
          disabled={isSubmitting}
          style={{
            background: 'none', border: 0, padding: 0, font: 'inherit',
            color: 'var(--secondary)', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Create a host account
        </button>
        . It has to be approved by an admin before you can run a session.
      </p>
    </div>
  );
};

export default LoginForm;
