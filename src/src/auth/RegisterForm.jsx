import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { passwordMeetsPolicy } from './passwordPolicy';
import { startGoogleSignIn } from './googleSignIn';
import PasswordField from './PasswordField';
import { GoogleMark, ClockIcon, AlertIcon } from './AuthChrome';
import './auth.css';

/**
 * Create a host account. Built from docs/design/entry-redesign/11-register.html.
 *
 * THREE THINGS MOVED, AND ONE SENTENCE WAS DELETED.
 *
 * 1. The approval gate is now ABOVE the form. It is the single most important
 *    fact about creating this account, and it used to sit halfway down, after
 *    the password field, where someone who has already decided to sign up has
 *    stopped reading. It also names the alternative -- joining needs no account.
 *
 * 2. THE EMAIL PROMISE IS GONE. The old copy said "You'll receive an email once
 *    your account is approved." There is no SES resource, no `sendEmail` call
 *    and no notification pipeline anywhere in lambda-functions/. That sentence
 *    is the one that makes people stop checking, so printing a promise nothing
 *    keeps is worse than saying nothing. 13-pending.html removed it for the
 *    same reason. If the pipeline is ever built, this is where the line goes
 *    back. (RATIONALE.md §8.1, OPEN-QUESTIONS.md §1.)
 *
 * 3. Password rules are a live checklist from the first keystroke, and the
 *    strength meter is gone -- the checklist states every fact the meter
 *    approximated. The validator is now the shared one, so `Northeast#26` is no
 *    longer rejected here and accepted at reset. (RATIONALE.md §8.3, §8.7.)
 *
 * The confirm-password field is gone too, which the mockup draws and this note
 * records deliberately: a Show/Hide toggle on a single field solves the typo
 * the second field was guarding against, and does it without asking for the
 * password twice.
 */
const RegisterForm = ({ onToggleMode, onSuccess }) => {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const { signUp, error, setError } = useAuth();

  const change = (key) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
    if (error) setError(null);
  };

  const validate = () => {
    const errors = {};

    if (!form.name.trim()) errors.name = 'We need a name to put on your sessions.';
    else if (form.name.trim().length < 2) errors.name = 'That is too short to be a name.';

    if (!form.email.trim()) errors.email = 'We need an email address.';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errors.email = 'That does not look like an email address.';

    if (!passwordMeetsPolicy(form.password)) {
      errors.password = 'Your password does not meet all five rules yet.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await signUp(form.email, form.password, form.name);
      if (onSuccess) {
        onSuccess({ email: form.email, name: form.name, nextStep: 'verify' });
      }
    } catch (_) {
      /* surfaced through AuthContext's `error` */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
      <div>
        <p className="au-kicker">Running a session</p>
        <h1 style={{ marginTop: '10px' }}>Create a host account</h1>
      </div>

      {/* The gate, above the form. */}
      <div className="au-notice is-attn">
        <ClockIcon />
        <div className="au-notice-body">
          <h3>An admin has to approve you before you can run a session</h3>
          <p>
            Creating the account is instant. Being able to host is not. If you need to{' '}
            <em>join</em> something today, <a href="/">a code is all you need</a>.
          </p>
        </div>
      </div>

      {error && (
        <div className="au-notice is-attn" role="alert">
          <AlertIcon />
          <div className="au-notice-body">
            <h3 className="au-wrapany">{error}</h3>
          </div>
        </div>
      )}

      <button
        type="button"
        className="au-btn au-btn-social"
        onClick={() => startGoogleSignIn('register')}
        disabled={isSubmitting}
      >
        <GoogleMark /> Continue with Google
      </button>

      <p className="au-divider">or</p>

      <form className="au-stack au-s20" onSubmit={handleSubmit} noValidate>
        <div className="au-field">
          <label className="au-label" htmlFor="reg-name">Your name</label>
          <input
            id="reg-name"
            name="name"
            className={`au-input${fieldErrors.name ? ' is-bad' : ''}`}
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            value={form.name}
            onChange={change('name')}
            disabled={isSubmitting}
            aria-describedby={fieldErrors.name ? 'reg-name-err' : undefined}
            aria-invalid={fieldErrors.name ? true : undefined}
          />
          {fieldErrors.name && <p className="au-hint is-bad" id="reg-name-err">{fieldErrors.name}</p>}
        </div>

        <div className="au-field">
          <label className="au-label" htmlFor="reg-email">Work email</label>
          <input
            id="reg-email"
            name="email"
            className={`au-input${fieldErrors.email ? ' is-bad' : ''}`}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck="false"
            value={form.email}
            onChange={change('email')}
            disabled={isSubmitting}
            aria-describedby={fieldErrors.email ? 'reg-email-err' : undefined}
            aria-invalid={fieldErrors.email ? true : undefined}
          />
          {fieldErrors.email && (
            <p className="au-hint is-bad au-wrapany" id="reg-email-err">{fieldErrors.email}</p>
          )}
        </div>

        <PasswordField
          id="reg-pw"
          name="password"
          label="Password"
          value={form.password}
          onChange={change('password')}
          autoComplete="new-password"
          showRules
          invalid={Boolean(fieldErrors.password)}
          disabled={isSubmitting}
          hint={fieldErrors.password}
          hintId="reg-pw-err"
        />

        <button type="submit" className="au-btn au-btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="au-meta">
        Already have one?{' '}
        <button
          type="button"
          onClick={() => onToggleMode('login')}
          style={{
            background: 'none', border: 0, padding: 0, font: 'inherit',
            color: 'var(--secondary)', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Sign in
        </button>
        . By creating an account you accept the <a href="/terms">terms</a> and the{' '}
        <a href="/privacy">privacy policy</a>.
      </p>
    </div>
  );
};

export default RegisterForm;
