import React, { useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { passwordMeetsPolicy } from './passwordPolicy';
import { startGoogleSignIn } from './googleSignIn';
import PasswordField from './PasswordField';
import { GoogleMark, ClockIcon, AlertIcon } from './AuthChrome';
import './auth.css';

/** One sentence, one place: the blur path and the submit path must not differ. */
const MISMATCH = 'These two do not match yet.';

/**
 * Create a host account. Built from docs/design/entry-redesign/11-register.html.
 *
 * THREE THINGS MOVED, ONE SENTENCE WAS DELETED, AND ONE FIELD CAME BACK.
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
 * ------------------------------------------------------------------------
 * 4. THE CONFIRM-PASSWORD FIELD IS BACK, ON THIS FORM ONLY. THIS DIVERGES
 *    FROM THE MOCKUP ON PURPOSE. DO NOT "FIX" IT.
 * ------------------------------------------------------------------------
 *
 * `docs/design/entry-redesign/11-register.html` draws ONE password field with a
 * Show toggle, and so do 14-forgot and 17-password-change. `bbadaa59` built all
 * three that way. An agent reading the mockup later will see this second field,
 * conclude it is drift, and delete it. It is not drift. **The owner ruled on
 * 2026-08-11 that registration keeps a confirm field and reset and change do
 * not** (`docs/handoff/RESUME.md` §6 states the trade-off this decided).
 *
 * The reason the ruling splits the three forms:
 *
 *   - A typo HERE creates an account with a password nobody can reproduce. The
 *     person does not find out at the point of the mistake; they find out later,
 *     when they cannot sign in, with no reason to suspect the password they are
 *     sure they typed. The Show toggle is the only guard, and on a shared or
 *     projected screen people will not use it.
 *   - A typo at reset or at forced change is recoverable by running the same
 *     flow again, immediately, from the same screen. The consequence is a minute.
 *
 * Confirm fields measurably increase abandonment, which is a real cost and the
 * mockup's reason for cutting them. So it is bought exactly where the
 * consequence is permanent and nowhere else. **Adding one to
 * `ForgotPasswordForm.jsx` or `PasswordChangeForm.jsx` is also against this
 * decision** -- the ruling is a split, not a preference for two fields.
 */
const RegisterForm = ({ onToggleMode, onSuccess }) => {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  // False until the user has LEFT a password field, which is the signal that
  // they have finished typing rather than paused. See `leftPasswordField`.
  const [matchChecked, setMatchChecked] = useState(false);
  const confirmRef = useRef(null);

  const { signUp, error, setError } = useAuth();

  const change = (key) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
    // Typing in EITHER password field retracts the mismatch message. Without
    // this the message stays up character by character while someone corrects
    // the very thing it is complaining about, and each keystroke of the first
    // field would re-raise it against a half-typed second one.
    if (key === 'password' || key === 'confirm') setMatchChecked(false);
    if (error) setError(null);
  };

  /**
   * Blur on either password field means "finished typing" -- with one exception.
   * Clicking this field's own Show toggle blurs the input, and someone who is
   * three characters into the confirm field and reaches for Show to check their
   * work is the LAST person who should be told the passwords do not match. The
   * toggle is a sibling inside `.au-pwwrap`, so a blur whose relatedTarget is
   * inside the same wrapper is focus moving within the control, not away from it.
   */
  const leftPasswordField = (event) => {
    const next = event.relatedTarget;
    if (next && event.currentTarget.parentElement && event.currentTarget.parentElement.contains(next)) {
      return;
    }
    setMatchChecked(true);
  };

  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  // Shown once they have left a field, or once a submit has been refused --
  // never mid-keystroke. `fieldErrors.confirm` is what carries the second case.
  const confirmHint = fieldErrors.confirm || (mismatch && matchChecked ? MISMATCH : '');

  const validate = () => {
    const errors = {};

    if (!form.name.trim()) errors.name = 'We need a name to put on your sessions.';
    else if (form.name.trim().length < 2) errors.name = 'That is too short to be a name.';

    if (!form.email.trim()) errors.email = 'We need an email address.';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errors.email = 'That does not look like an email address.';

    if (!passwordMeetsPolicy(form.password)) {
      errors.password = 'Your password does not meet all five rules yet.';
    }

    if (!form.confirm) errors.confirm = 'Type the password a second time so a typo cannot lock you out.';
    else if (form.confirm !== form.password) errors.confirm = MISMATCH;

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) {
      // The submit button is never disabled -- a dead button states no reason
      // and cannot be focused to find one. Submission is refused HERE, and when
      // the refusal is about the two passwords, focus goes to the field that
      // has to change so the message under it is read out and the fix is one
      // keystroke away.
      if (!form.confirm || form.confirm !== form.password) {
        if (confirmRef.current) confirmRef.current.focus();
      }
      return;
    }

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
          onBlur={leftPasswordField}
          autoComplete="new-password"
          showRules
          invalid={Boolean(fieldErrors.password)}
          disabled={isSubmitting}
          hint={fieldErrors.password}
          hintId="reg-pw-err"
        />

        {/* The second field. See note 4 in the header before removing it.
            No checklist here: the rules are stated once, above, and this field
            has exactly one requirement, which is the sentence under it. */}
        <PasswordField
          id="reg-pw2"
          name="confirmPassword"
          label="Confirm password"
          value={form.confirm}
          onChange={change('confirm')}
          onBlur={leftPasswordField}
          inputRef={confirmRef}
          autoComplete="new-password"
          invalid={Boolean(confirmHint)}
          disabled={isSubmitting}
          hint={confirmHint}
          hintId="reg-pw2-err"
          liveHint
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
