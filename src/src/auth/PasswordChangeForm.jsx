import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { passwordMeetsPolicy } from './passwordPolicy';
import PasswordField from './PasswordField';
import AuthChrome, { AlertIcon } from './AuthChrome';
import './auth.css';

/**
 * The forced password change, for an account an admin created.
 * Built from docs/design/entry-redesign/17-password-change.html.
 *
 * This surface renders its own chrome because AuthPage returns it BEFORE the
 * page shell -- it is a Cognito challenge mid-sign-in, not one of the modes.
 *
 * Its validator was the third of the three that disagreed
 * (`[!@#$%^&*(),.?":{}|<>]`, which rejects a hyphen), and it is now the shared
 * one. The old copy explained the rules in a prose paragraph AFTER the fields;
 * they are a live checklist beside the field now, and there is no confirm field
 * -- the Show toggle does that job without asking for the password twice.
 *
 * The hidden username input is not decoration: without it a password manager
 * offering to save the new password has no account to file it under.
 */
const PasswordChangeForm = () => {
  const { completeNewPassword, error, loading, newPasswordRequired } = useAuth();
  const [password, setPassword] = useState('');
  const [showError, setShowError] = useState('');

  const email = newPasswordRequired?.userAttributes?.email || '';

  const handleSubmit = async (event) => {
    event.preventDefault();
    setShowError('');

    if (!passwordMeetsPolicy(password)) {
      setShowError('Your password does not meet all five rules yet.');
      return;
    }

    try {
      await completeNewPassword(password);
    } catch (_) {
      /* surfaced through AuthContext's `error` */
    }
  };

  if (!newPasswordRequired) return null;

  return (
    <AuthChrome>
      <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
        <div>
          <p className="au-kicker">One thing first</p>
          <h1 style={{ marginTop: '10px' }}>Choose your own password</h1>
          <p className="au-muted" style={{ marginTop: '12px' }}>
            Your account was set up for you, so the password you just used was temporary.
            It stops working once you pick one.
          </p>
        </div>

        {error && (
          <div className="au-notice is-attn" role="alert">
            <AlertIcon />
            <div className="au-notice-body">
              <h3 className="au-wrapany">{error}</h3>
            </div>
          </div>
        )}

        <form className="au-stack au-s20" onSubmit={handleSubmit} noValidate>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            readOnly
            hidden
            aria-hidden="true"
          />

          <PasswordField
            id="set-pw"
            name="password"
            label="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            showRules
            invalid={Boolean(showError)}
            disabled={loading}
            hint={showError}
            hintId="set-pw-err"
          />

          <button type="submit" className="au-btn au-btn-primary" disabled={loading}>
            {loading ? 'Saving…' : 'Save and continue'}
          </button>
        </form>

        {email && (
          <p className="au-meta">
            Signed in as <span className="au-wrapany">{email}</span>.
          </p>
        )}
      </div>
    </AuthChrome>
  );
};

export default PasswordChangeForm;
