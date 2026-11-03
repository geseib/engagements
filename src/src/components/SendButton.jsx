import React from 'react';
import Button from './ui/Button';
import Icon from './Icon';
import { SENT } from '../config/playerWords';

/**
 * THE DOCK'S SEND, AND WHAT IT TURNS INTO (owner, 3 Nov 2026: "could the
 * button on the player screen change to sent when answering a question
 * instead of greyed out send. it would change back to send if you edit as it
 * does now.").
 *
 *   <SendButton sent={sent} type="submit" form="x" disabled={!ready}>Send my answer</SendButton>
 *
 * Not sent: the live main button (orange primary unless `variant` says
 * otherwise), every prop passed through, `children` its label.
 * Sent: ui/Button's 'done' look, a check and "Sent", in the same place. It is
 * not actionable (aria-disabled, type="button", the click swallowed), and the
 * caller's type/form/onClick/disabled are dropped so nothing can resubmit
 * through it. The caller flips `sent` back to false when the participant
 * edits, and the live Send returns.
 *
 * "Sent" means the server (or the socket) took it. A send held offline is
 * NOT sent: its screen says "Not sent yet" (playerWords HELD) and never
 * renders this with `sent`.
 */
export default function SendButton({ sent = false, variant = 'primary', size = 56, children, ...rest }) {
  if (sent) {
    // eslint-disable-next-line no-unused-vars
    const { type, form, disabled, onClick, ...keep } = rest;
    return (
      <Button variant="done" size={size} {...keep}>
        <Icon name="Check" weight="bold" size={18} />
        {SENT}
      </Button>
    );
  }
  return <Button variant={variant} size={size} {...rest}>{children}</Button>;
}

/**
 * SAID ONCE, POLITELY. A live region that is on the page BEFORE the send, so
 * its change to "Sent" is announced (a region that mounts already holding its
 * text is not reliably read). It has no role, so it is not one more `status`
 * for a screen's own lines to collide with; `plr-sr` clips it to nothing.
 * Mount it where it outlives the Send → Sent switch.
 */
export function SentAnnouncer({ sent }) {
  return (
    <span className="plr-sr" aria-live="polite" aria-atomic="true" data-sent-live="">
      {sent ? SENT : ''}
    </span>
  );
}
