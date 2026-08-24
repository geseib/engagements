import React, { useEffect, useRef, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import './PendingInvites.css';

/**
 * `/invite/{token}` — the link an admin hands to somebody with no account yet.
 *
 * ── WHO ACTUALLY NEEDS THIS ────────────────────────────────────────────────
 *
 * Almost nobody. Anyone who already has an account signs in with the address
 * they were invited at and the invitation is waiting on their landing screen
 * (components/PendingInvites.jsx) — no link, nothing to deliver, nothing to
 * lose. This page exists for the one case that cannot cover: a person who has
 * to create an account first, and who therefore needs somewhere to land after
 * they do.
 *
 * It is behind the same ProtectedRoute as everything else, which is what makes
 * that work: an unauthenticated visitor is sent to sign in or register and
 * comes back here afterwards.
 *
 * ── IT ACCEPTS ON ARRIVAL ──────────────────────────────────────────────────
 *
 * Following a link somebody sent you IS the acceptance; asking again on arrival
 * would be a confirmation of a decision already made. The refusals are the
 * interesting part and each is stated as itself: a wrong address, an expired
 * invitation, one already taken.
 *
 * Guarded by a ref rather than an empty dependency list alone, because React 18
 * mounts effects twice in development and accepting twice would show the second
 * call's "no longer available" over the first call's success.
 */
export default function InviteAcceptPage() {
  const [phase, setPhase] = useState('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = decodeURIComponent(window.location.pathname.replace(/^\/invite\//, ''));
    if (!token) {
      setPhase('failed');
      setMessage('That invitation link is not valid.');
      return;
    }

    (async () => {
      try {
        const res = await authFetch(
          `${window.API_BASE || ''}invites/${encodeURIComponent(token)}/accept`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
        setPhase('done');
        setMessage('You are in. Taking you to your sessions…');
        window.setTimeout(() => { window.location.href = '/'; }, 1200);
      } catch (err) {
        setPhase('failed');
        setMessage(err.message || 'Could not accept that invitation.');
      }
    })();
  }, []);

  return (
    <div className="pinv pinv-page" data-theme="dark">
      <div className="pinv-row">
        <span className="pinv-text">
          {phase === 'working' && 'Checking your invitation…'}
          {phase !== 'working' && message}
        </span>
        {phase === 'failed' && (
          <button type="button" className="pinv-btn" onClick={() => { window.location.href = '/'; }}>
            Go to Engage
          </button>
        )}
      </div>
    </div>
  );
}
