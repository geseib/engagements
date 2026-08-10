import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { passwordMeetsPolicy } from './passwordPolicy';
import PasswordField from './PasswordField';
import { AlertIcon, CheckIcon } from './AuthChrome';
import './auth.css';

/**
 * Password reset. Built from docs/design/entry-redesign/14-forgot.html, which
 * draws four moments. THE THIRD ONE DID NOT EXIST: this form used to call
 * `onToggleMode('login')` on success, so the user landed on the sign-in form
 * with no confirmation that anything had happened. It is a state now.
 *
 * THE COPY IN STEP 2 IS A SECURITY FIX, NOT A TONE CHANGE. AuthContext used to
 * map `UserNotFoundException` to "No account found with this email address." at
 * an unauthenticated endpoint -- an account-enumeration oracle: type an address,
 * learn whether it has an account here. The mapping is gone (see AuthContext),
 * and this screen now answers the same way whichever it was:
 *
 *     "If there is an account for <address>, a code is on its way."
 *
 * That sentence is only honest if the form ALSO advances to step 2 when Cognito
 * says the user does not exist, which is why `handleRequest` treats that one
 * code as success. Advancing on every error would be wrong -- a rate-limit or a
 * Google-only account are real failures with real remedies, and both still stop
 * here and say so. (RATIONALE.md §8.4.)
 */
const ForgotPasswordForm = ({ onToggleMode, initialEmail = '' }) => {
  const [step, setStep] = useState('request'); // request | reset | done
  const [form, setForm] = useState({ email: initialEmail, code: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const { forgotPassword, confirmPassword, error, setError } = useAuth();

  const change = (key) => (event) => {
    const raw = event.target.value;
    const value = key === 'code' ? raw.replace(/\D/g, '').slice(0, 6) : raw;
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
    if (error) setError(null);
  };

  const handleRequest = async (event) => {
    event.preventDefault();
    const errors = {};
    if (!form.email.trim()) errors.email = 'We need an email address.';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errors.email = 'That does not look like an email address.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setIsSubmitting(true);
    try {
      await forgotPassword(form.email.trim());
      setStep('reset');
    } catch (err) {
      // "No such user" must be indistinguishable from "code sent", or the
      // screen is the oracle the AuthContext mapping used to be.
      if (err && err.code === 'UserNotFoundException') {
        setError(null);
        setStep('reset');
      }
      /* every other failure stays here and is shown */
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    const errors = {};
    if (form.code.length !== 6) errors.code = 'The code from the email is 6 digits.';
    if (!passwordMeetsPolicy(form.password)) {
      errors.password = 'Your password does not meet all five rules yet.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setIsSubmitting(true);
    try {
      await confirmPassword(form.email.trim(), form.code, form.password);
      setStep('done');
    } catch (_) {
      /* surfaced through AuthContext's `error` */
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await forgotPassword(form.email.trim());
    } catch (_) {
      /* surfaced through AuthContext's `error` */
    } finally {
      setIsSubmitting(false);
    }
  };

  const errorNotice = error && (
    <div className="au-notice is-attn" role="alert">
      <AlertIcon />
      <div className="au-notice-body">
        <h3 className="au-wrapany">{error}</h3>
      </div>
    </div>
  );

  const backToSignIn = (
    <button
      type="button"
      className="au-btn au-btn-quiet"
      onClick={() => onToggleMode('login')}
      disabled={isSubmitting}
    >
      Back to sign in
    </button>
  );

  if (step === 'done') {
    return (
      <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
        <div>
          <h1>Password changed</h1>
          <p className="au-muted" style={{ marginTop: '10px' }}>
            Use the new one to sign in. Anywhere you were already signed in stays signed in.
          </p>
        </div>

        <div className="au-notice is-good">
          <CheckIcon />
          <div className="au-notice-body">
            <h3>Saved</h3>
            <p>
              Changed just now for <span className="au-wrapany">{form.email.trim()}</span>.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="au-btn au-btn-primary"
          onClick={() => onToggleMode('login')}
        >
          Sign in
        </button>
      </div>
    );
  }

  if (step === 'reset') {
    return (
      <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
        <div>
          <h1>Reset your password</h1>
          <p className="au-muted" style={{ marginTop: '10px' }}>
            If there is an account for{' '}
            <strong className="au-wrapany" style={{ color: 'var(--text)' }}>
              {form.email.trim()}
            </strong>
            , a code is on its way.
          </p>
        </div>

        {errorNotice}

        <form className="au-stack au-s20" onSubmit={handleReset} noValidate>
          <div className="au-field">
            <label className="au-label" htmlFor="reset-code">Code from the email</label>
            <input
              id="reset-code"
              name="code"
              className={`au-input${fieldErrors.code ? ' is-bad' : ''}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              spellCheck="false"
              value={form.code}
              onChange={change('code')}
              disabled={isSubmitting}
              style={{ fontSize: '22px', letterSpacing: '.4em' }}
              aria-describedby={fieldErrors.code ? 'reset-code-err' : undefined}
              aria-invalid={fieldErrors.code ? true : undefined}
            />
            {fieldErrors.code && <p className="au-hint is-bad" id="reset-code-err">{fieldErrors.code}</p>}
          </div>

          <PasswordField
            id="reset-pw"
            name="password"
            label="New password"
            value={form.password}
            onChange={change('password')}
            autoComplete="new-password"
            showRules
            invalid={Boolean(fieldErrors.password)}
            disabled={isSubmitting}
            hint={fieldErrors.password}
            hintId="reset-pw-err"
          />

          <button type="submit" className="au-btn au-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Set the new password'}
          </button>

          <button
            type="button"
            className="au-btn au-btn-quiet"
            onClick={handleResend}
            disabled={isSubmitting}
          >
            Send another code
          </button>
        </form>

        {backToSignIn}
      </div>
    );
  }

  return (
    <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
      <div>
        <h1>Reset your password</h1>
        <p className="au-muted" style={{ marginTop: '10px' }}>
          We will email you a 6&#8209;digit code.
        </p>
      </div>

      {errorNotice}

      <form className="au-stack au-s20" onSubmit={handleRequest} noValidate>
        <div className="au-field">
          <label className="au-label" htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            name="email"
            className={`au-input${fieldErrors.email ? ' is-bad' : ''}`}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck="false"
            placeholder="you@work.com"
            value={form.email}
            onChange={change('email')}
            disabled={isSubmitting}
            aria-describedby={fieldErrors.email ? 'forgot-email-err' : undefined}
            aria-invalid={fieldErrors.email ? true : undefined}
          />
          {fieldErrors.email && <p className="au-hint is-bad" id="forgot-email-err">{fieldErrors.email}</p>}
        </div>

        <button type="submit" className="au-btn au-btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send the code'}
        </button>
      </form>

      {backToSignIn}
    </div>
  );
};

export default ForgotPasswordForm;
