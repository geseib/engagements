import React from 'react';
import Icon from './Icon';
import './ActingAsBanner.css';

/**
 * "YOU ARE ACTING AS ENGAGE" — and how to stop.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Platform mode is exclusive: it shows Organisations, Moderation, Accounts and
 * Archive, and no content at all. That is deliberate — an Engage admin standing
 * in the platform console should not also be holding their own question sets.
 *
 * But the mode is STICKY. It is remembered in localStorage, so somebody who
 * tried it once opens the console days later, finds four sections none of which
 * are theirs, and has no reason to connect that to a chip in the top bar.
 * Reported from dev, in exactly those terms: "I also dont see anyway to get to
 * question sets or prompts, sessions etc."
 *
 * A mode with no visible exit is a trap even when the exit is one click away.
 * So the state names itself, on the screen, with the way out attached — rather
 * than relying on the person noticing that a chip they have never used is the
 * control that governs everything they can see.
 *
 * It says WHERE it will take them ("Go to George Seib") rather than "Leave
 * platform mode", because the useful thing to know is the destination.
 */
export default function ActingAsBanner({ orgName = '', onLeave }) {
  return (
    <div className="pmode" data-theme="dark">
      <span className="pmode-icon" aria-hidden="true">
        <Icon name="Lock" size={13} weight="bold" color="var(--primary)" />
      </span>
      <span className="pmode-text">
        <strong>You are acting as Engage.</strong>
        {' '}
        This console manages organisations, accounts and moderation — it holds no
        question sets or sessions, and cannot open anybody’s content.
      </span>
      {onLeave && (
        <button type="button" className="pmode-btn" onClick={onLeave}>
          {orgName ? `Go to ${orgName}` : 'Go to your space'}
        </button>
      )}
    </div>
  );
}
