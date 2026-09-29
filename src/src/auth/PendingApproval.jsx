import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { navigateTo } from './navigate';
import { CheckIcon, ClockIcon } from './AuthChrome';
import './auth.css';

/**
 * Waiting on approval. Built from docs/design/entry-redesign/13-pending.html --
 * the screen this whole exercise is really about.
 *
 * WHAT WAS REMOVED, AND WHY (RATIONALE.md §8.1):
 *
 *   "Our team will review your account within 24-48 hours"
 *       An SLA nobody agreed to. There is no queue, no timer, and on a small
 *       deployment "our team" is one colleague. It appeared twice.
 *
 *   "You'll receive an email notification once approved"
 *       There is no SES resource and no sendEmail call anywhere in
 *       lambda-functions/. This is the sentence that makes people stop
 *       checking. See OPEN-QUESTIONS.md §1.
 *
 *   "Start thinking about what types of sessions you'd like to host"
 *       Filler on a blocked screen reads as being managed.
 *
 *   "Learn More - explore our help documentation"
 *       Linked to nothing.
 *
 * WHAT REPLACED IT. Three things, in the order a blocked person needs them:
 * the one thing they can do now (a working code field, on this page, because
 * they may be sitting in the meeting right now); the one thing that unblocks
 * them (their details as a single copyable line, which needs no backend and
 * converts a passive wait into one action); and the facts.
 *
 * THE SCREEN NOTICES THE APPROVAL ITSELF (the owner, 29 Sep 2026: "it [is]
 * less obvious that they need to sign out and back in only once they have been
 * approved … 1/ move this message to the top 2/ could this screen give a notice
 * when the approval is done if you are on it?"). Group membership rides in the
 * ID token, so an approval used to show only after signing out and in. It now
 * checks: AuthContext `refreshSession` exchanges the refresh token for a new ID
 * token, whose groups are the account's groups NOW — every CHECK_MS while the
 * tab is in view, when the person comes back to the tab, and on "Check now".
 * The line that says so is at the TOP, under the headline, where the question
 * "am I in yet?" is asked; when the answer turns yes, that same place says
 * "You are approved" with one button into the app, and no sign out.
 *
 * Nobody signed in (`/auth?status=pending` reached straight off the URL) has no
 * token to refresh, so there it says to sign in instead of pretending to check.
 */

const CODE_LENGTH = 4;
/** How often the screen asks Cognito whether the account has been approved. */
export const CHECK_MS = 30000;

const isApproved = (user) => {
  const groups = (user && user.groups) || [];
  return groups.includes('hosts') || groups.includes('admins');
};

const timeOf = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const PendingApproval = ({ email, name, onSignOut }) => {
  const { currentUser, signOut, refreshSession } = useAuth();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  // 'idle' | 'checking' | 'approved' | 'failed' — and when it last asked.
  const [check, setCheck] = useState({ state: 'idle', at: null });
  const canCheck = Boolean(currentUser) && typeof refreshSession === 'function';
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const checkNow = useCallback(async () => {
    if (!canCheck) return;
    setCheck((prev) => (prev.state === 'approved' ? prev : { ...prev, state: 'checking' }));
    try {
      const fresh = await refreshSession();
      if (!alive.current) return;
      setCheck({ state: isApproved(fresh) ? 'approved' : 'idle', at: new Date() });
    } catch (_) {
      if (alive.current) setCheck({ state: 'failed', at: new Date() });
    }
  }, [canCheck, refreshSession]);

  // Every CHECK_MS while the tab is in view, and straight away when the person
  // comes back to it — the moment they are most likely to be wondering.
  const approved = check.state === 'approved';
  useEffect(() => {
    if (!canCheck || approved) return undefined;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const timer = setInterval(() => { if (visible()) checkNow(); }, CHECK_MS);
    const onBack = () => { if (visible()) checkNow(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [canCheck, approved, checkNow]);

  // Into the app: an ordinary page load, which reads the token just refreshed.
  // From /auth itself there is nothing behind the screen, so it goes home.
  const startHosting = () => {
    const path = window.location.pathname || '/';
    navigateTo(path.startsWith('/auth') ? '/' : `${path}${window.location.search || ''}`);
  };

  const userName = name || currentUser?.attributes?.name || '';
  const userEmail = email || currentUser?.attributes?.email || '';

  const handleSignOut = () => {
    signOut();
    if (onSignOut) onSignOut();
  };

  // Built from the parts that exist rather than a template with holes in it.
  // `/auth?status=pending` reaches this screen straight off the URL with no
  // signed-in user, and the template version then produced
  // "Host access request — this account, ." -- a line whose whole purpose is to
  // be pasted into someone else's inbox.
  const requestLine = ['Host access request', [userName, userEmail].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' — ') + '.';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(requestLine);
      setCopied(true);
    } catch (_) {
      // No clipboard permission, or an insecure origin. The line is on screen
      // and selectable either way, so this is not worth an error state.
    }
  };

  const handleJoin = (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) return;
    navigateTo(`/play?gameId=${code}`);
  };

  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => index);

  return (
    <div className="au-col au-stack au-s24" style={{ paddingBlock: '8px 40px' }}>
      {approved ? (
        <span className="au-pill is-good">
          <CheckIcon /> Approved
        </span>
      ) : (
        <span className="au-pill is-attn">
          <ClockIcon /> Not approved yet
        </span>
      )}

      <div>
        <h1>{approved ? 'You can host now.' : 'Your account exists. It cannot host yet.'}</h1>
        {!approved && (
          <p className="au-muted" style={{ marginTop: '12px' }}>
            Someone with admin rights at your organisation has to approve it first. We cannot
            do that from here and we cannot tell you when they will.
          </p>
        )}
      </div>

      {/* 0 — "am I in yet?", answered where it is asked. */}
      {approved ? (
        <div className="au-notice is-good" role="status" data-testid="approval-status">
          <CheckIcon />
          <div className="au-notice-body au-stack au-s12">
            <div>
              <h3>Your account has been approved.</h3>
              <p>No need to sign out — your sign-in already knows.</p>
            </div>
            <button type="button" className="au-btn au-btn-primary" onClick={startHosting}>
              Start hosting
            </button>
          </div>
        </div>
      ) : canCheck ? (
        <div className="au-notice" role="status" data-testid="approval-status">
          <ClockIcon />
          <div className="au-notice-body au-stack au-s12">
            <div>
              <h3>This page will tell you the moment you are approved.</h3>
              <p>
                {check.state === 'failed'
                  ? `We could not check at ${timeOf(check.at)} — we will try again shortly.`
                  : `It checks every ${CHECK_MS / 1000} seconds while it is open${check.at ? `; last checked at ${timeOf(check.at)}` : ''}. No need to sign out and back in.`}
              </p>
            </div>
            <button
              type="button"
              className="au-btn au-btn-ghost au-sm"
              onClick={checkNow}
              disabled={check.state === 'checking'}
            >
              {check.state === 'checking' ? 'Checking…' : 'Check now'}
            </button>
          </div>
        </div>
      ) : (
        <div className="au-notice" role="status" data-testid="approval-status">
          <ClockIcon />
          <div className="au-notice-body au-stack au-s12">
            <div>
              <h3>Sign in to see whether you have been approved.</h3>
              <p>Once you are signed in, this page checks by itself.</p>
            </div>
            <button type="button" className="au-btn au-btn-ghost au-sm" onClick={handleSignOut}>
              Sign in
            </button>
          </div>
        </div>
      )}

      {/* 1 — the one thing they can do now. */}
      <div className="au-card au-stack au-s20">
        <div>
          <h2>You can still join a session</h2>
          <p className="au-muted" style={{ marginTop: '8px', fontSize: 'var(--au-t-label)' }}>
            Approval is only about <em>hosting</em>. If a session is running right now, your
            code works.
          </p>
        </div>

        <form onSubmit={handleJoin}>
          <label className="au-label" htmlFor="pending-code">Session code</label>
          <div className="au-codewrap">
            <div className="au-cells" aria-hidden="true">
              {cells.map((index) => (
                <div
                  key={index}
                  className={`au-cell${index === code.length ? ' is-next' : ''}`}
                >
                  {code[index] || ''}
                </div>
              ))}
            </div>
            <input
              id="pending-code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              autoComplete="off"
              spellCheck="false"
              aria-label="Session code, 4 digits"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D+/g, '').slice(0, CODE_LENGTH))
              }
            />
          </div>
          <button
            type="submit"
            className="au-btn au-btn-primary"
            style={{ marginTop: '14px' }}
            disabled={code.length !== CODE_LENGTH}
          >
            Join
          </button>
        </form>
      </div>

      {/* 2 — the one thing that unblocks them. */}
      <div className="au-card au-stack au-s20">
        <div>
          <h2>Nudge whoever approves accounts</h2>
          <p className="au-muted" style={{ marginTop: '8px', fontSize: 'var(--au-t-label)' }}>
            There is no queue we can jump for you. Sending them your details is the fastest
            route.
          </p>
        </div>

        <div className="au-card" style={{ background: 'var(--surface-2)', borderColor: 'transparent' }}>
          <p className="au-wrapany" style={{ fontSize: 'var(--au-t-label)', lineHeight: 1.55 }}>
            {requestLine}
          </p>
        </div>

        <button type="button" className="au-btn au-btn-ghost" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy this'}
        </button>
      </div>

      <hr className="au-hr" />

      {/* 3 — the facts. */}
      <div className="au-stack au-s12">
        {/* Only rows there is a value for. A label with an empty cell beside it
            reads as a value that failed to load, which is a worse thing to say
            than nothing. There is deliberately no "Requested" row: nothing in
            the client records when the request was made, and the mockup's date
            was sample data rather than a field that exists. */}
        <dl className="au-dl">
          {userEmail && (
            <>
              <dt>Email</dt>
              <dd className="au-wrapany">{userEmail}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>{approved ? 'Approved' : 'Pending'}</dd>
        </dl>

        <div className="au-row" style={{ marginTop: '6px' }}>
          <button type="button" className="au-btn au-btn-ghost au-sm" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;
