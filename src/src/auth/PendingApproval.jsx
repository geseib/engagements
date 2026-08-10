import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { navigateTo } from './navigate';
import { ClockIcon } from './AuthChrome';
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
 * THERE IS NO "CHECK AGAIN" BUTTON, AND THAT IS THE HONEST ANSWER. Group
 * membership is read from the cached ID token's `cognito:groups` and nothing
 * forces a refresh, so an admin can approve someone and the UI will not notice
 * until the token rolls. `13-pending.html` draws a Check again button on the
 * assumption that `refreshSession()` exists; it does not exist anywhere in this
 * codebase, and a button wired to a missing function throws on click. The
 * mockup's own §8.1 names this: "if that is not wired, the honest label is
 * 'Sign out and back in to check'." So that is what this says. Wiring a real
 * refresh is a change to AuthContext's session handling and is worth doing --
 * it is reported, not silently faked.
 */

const CODE_LENGTH = 4;

const PendingApproval = ({ email, name, onSignOut }) => {
  const { currentUser, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

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
      <span className="au-pill is-attn">
        <ClockIcon /> Not approved yet
      </span>

      <div>
        <h1>Your account exists. It cannot host yet.</h1>
        <p className="au-muted" style={{ marginTop: '12px' }}>
          Someone with admin rights at your organisation has to approve it first. We cannot
          do that from here and we cannot tell you when they will.
        </p>
      </div>

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
          <dd>Pending</dd>
        </dl>

        <p className="au-meta" style={{ marginTop: '6px' }}>
          Approval is read from your sign-in, so it will not appear here on its own. Sign out
          and back in to check.
        </p>

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
