import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { AlertIcon, ClockIcon } from './AuthChrome';
import './auth.css';

/**
 * Confirm the email address. Built from
 * docs/design/entry-redesign/12-verify.html.
 *
 * SIX PAINTED CELLS BEHIND ONE REAL INPUT, not six inputs. Four (or six) real
 * inputs is the common pattern and it is wrong: paste lands in the first box,
 * backspace at a box boundary does nothing or jumps unpredictably, and a screen
 * reader announces six unlabelled fields. One input with maxlength gets paste,
 * backspace, select-all, undo and a single accessible name for free; the cells
 * are aria-hidden decoration painted from the input's value.
 *
 * `autocomplete="one-time-code"` is correct HERE and wrong on the session-code
 * field, which is why only this one carries it: this code really does arrive by
 * email, and a session code does not.
 *
 * The resend cooldown was already here and is kept -- it is shipped behaviour
 * that is correct, and silence in a mockup is not an instruction to delete.
 */

const CODE_LENGTH = 6;

const maskEmail = (address) => {
  const [local, domain] = String(address || '').split('@');
  if (!domain) return address || '';
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.substring(0, 2)}${'*'.repeat(local.length - 2)}@${domain}`;
};

/*
  `askEmail`: THE DOOR FROM THE EMAIL (2026-10-02). The code arrives by email,
  but this screen used to be reachable only straight after registering or by
  signing in with the right password — the email said "enter it on the
  sign-in screen", where there was no box for it. /auth?mode=verify (linked
  from the email) and "Have a code from an email?" on the sign-in form open it
  with no sign-up in hand, so it asks for the address too.
*/
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const VerificationForm = ({ email, name, onToggleMode, onSuccess, fromSignIn = false, askEmail = false }) => {
  const [typedEmail, setTypedEmail] = useState(email || '');
  const address = askEmail ? typedEmail.trim() : email;
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [fieldError, setFieldError] = useState('');

  const { confirmSignUp, resendConfirmationCode, error, setError } = useAuth();

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [resendTimer]);

  const handleChange = (event) => {
    setCode(event.target.value.replace(/\D+/g, '').slice(0, CODE_LENGTH));
    if (fieldError) setFieldError('');
    if (error) setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (askEmail && !looksLikeEmail(address)) {
      setFieldError('Type the email address you signed up with.');
      return;
    }
    if (code.length !== CODE_LENGTH) {
      setFieldError('The code from the email is 6 digits.');
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmSignUp(address, code);
      if (onSuccess) onSuccess({ email: address, name, verified: true, nextStep: 'pending' });
    } catch (_) {
      /* surfaced through AuthContext's `error` */
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || isResending) return;
    if (askEmail && !looksLikeEmail(address)) {
      setFieldError('Type the email address you signed up with, then send a new code to it.');
      return;
    }
    setIsResending(true);
    setError(null);
    try {
      await resendConfirmationCode(address);
      setResendTimer(60);
    } catch (_) {
      /* surfaced through AuthContext's `error` */
    } finally {
      setIsResending(false);
    }
  };

  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => index);

  return (
    <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
      {askEmail ? (
        <div>
          <h1>Enter your code</h1>
          <p className="au-muted" style={{ marginTop: '12px' }}>
            Type the email you signed up with and the 6&#8209;digit code we sent to it.
          </p>
        </div>
      ) : (
      <div>
        {/* From sign-in, this is someone who came back later (LoginForm's
            UserNotConfirmed): the code went out when they created the account,
            and may since have gone missing or run out — hence the resend
            below, and the words saying so. */}
        <h1>{fromSignIn ? 'Confirm your email to finish' : 'Check your email'}</h1>
        <p className="au-muted" style={{ marginTop: '12px' }}>
          {fromSignIn ? 'When you created the account we sent a 6\u2011digit code to ' : 'We sent a 6\u2011digit code to '}
          <strong className="au-wrapany" style={{ color: 'var(--text)' }}>
            {maskEmail(email)}
          </strong>
          {fromSignIn ? '. Enter it here, or send a new one below if it has expired or gone missing.' : '.'}
        </p>
      </div>
      )}

      {error && (
        <div className="au-notice is-attn" role="alert">
          <AlertIcon />
          <div className="au-notice-body">
            <h3 className="au-wrapany">{error}</h3>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {askEmail && (
          <>
            <label className="au-label" htmlFor="verify-email">Email</label>
            <input
              id="verify-email"
              className="au-input"
              type="email"
              autoComplete="email"
              placeholder="you@work.com"
              value={typedEmail}
              onChange={(event) => { setTypedEmail(event.target.value); if (fieldError) setFieldError(''); if (error) setError(null); }}
              disabled={isSubmitting}
              style={{ marginBottom: '14px' }}
            />
          </>
        )}
        <label className="au-label" htmlFor="verify-code">Code from the email</label>
        <div className="au-codewrap">
          <div className="au-cells au-cells6" aria-hidden="true">
            {cells.map((index) => (
              <div key={index} className={`au-cell${index === code.length ? ' is-next' : ''}`}>
                {code[index] || ''}
              </div>
            ))}
          </div>
          <input
            id="verify-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck="false"
            aria-label="Verification code, 6 digits"
            value={code}
            onChange={handleChange}
            disabled={isSubmitting}
          />
        </div>
        {fieldError && <p className="au-hint is-bad">{fieldError}</p>}

        <button
          type="submit"
          className="au-btn au-btn-primary"
          style={{ marginTop: '14px' }}
          disabled={isSubmitting || code.length !== CODE_LENGTH}
        >
          {isSubmitting ? 'Confirming…' : 'Confirm'}
        </button>
      </form>

      <div className="au-notice">
        <ClockIcon />
        <div className="au-notice-body">
          <h3>Nothing arrived?</h3>
          <p>Look in spam. Codes take up to a minute.</p>
        </div>
      </div>

      <button
        type="button"
        className="au-btn au-btn-ghost"
        onClick={handleResend}
        disabled={resendTimer > 0 || isResending}
      >
        {resendTimer > 0 ? `Send another code in ${resendTimer}s` : 'Send another code'}
      </button>

      <button
        type="button"
        className="au-btn au-btn-quiet"
        onClick={() => onToggleMode(askEmail ? 'login' : 'register')}
        disabled={isSubmitting}
      >
        {askEmail ? 'Back to sign in' : 'Use a different email'}
      </button>
    </div>
  );
};

export default VerificationForm;
