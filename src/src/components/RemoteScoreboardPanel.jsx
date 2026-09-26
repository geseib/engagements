import React from 'react';
import Icon from './Icon';
import { SCOREBOARD_STYLES, STYLE_LABELS } from '../config/scoreboard';

/**
 * THE SCOREBOARD, FROM THE HOST'S PHONE.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §3. The owner asked
 * to open the board "from the remote, a keyboard shortcut, or a button on the
 * Players tab", and to switch between its three looks. This is the remote's:
 * open or close, next page, and the look.
 *
 * PRESENTATIONAL, like RemoteFocusPanel beside it: every action is a prop and
 * nothing here fetches. What the board is comes from the SERVER, through the
 * `/state` poll HostRemote already makes, so the phone follows the projector
 * as well as driving it — and, holding no socket, is a beat behind by
 * construction. Every press is idempotent at the far end, so a tap on what
 * the host sees is always safe.
 *
 * NOT DRAWN AT ALL for a game type without a board (Poll, Wavelength, Survey):
 * the owner ruled them out, so a dead button would be a control that can
 * never mean anything. DISABLED WITH ITS REASON before the first round is
 * scored, because that state ends on its own.
 */
export default function RemoteScoreboardPanel({
  board = { open: false, style: 'departure' },
  availability = { show: false, enabled: false, reason: '' },
  busy = false,
  onToggle = () => {},
  onNextPage = () => {},
  onStyle = () => {},
}) {
  if (!availability.show) return null;
  const open = Boolean(board.open);

  return (
    <section className="hr-card" aria-label="Scoreboard">
      <h2 className="hr-card-heading">Scoreboard</h2>
      <p className="hr-hint">Standings on the room&apos;s screen — every player, their total and how far they moved.</p>
      <div className="hr-grid hr-sb-controls">
        <button
          type="button"
          className="hr-btn hr-btn--ghost"
          aria-pressed={open}
          disabled={busy || (!open && !availability.enabled)}
          onClick={() => onToggle(!open)}
        >
          <Icon name={open ? 'EyeSlash' : 'ListNumbers'} weight="bold" size={18} color="currentColor" />
          {open ? 'Hide the scoreboard' : 'Show the scoreboard'}
        </button>
        <button
          type="button"
          className="hr-btn hr-btn--ghost"
          disabled={busy || !open}
          onClick={onNextPage}
        >
          <Icon name="ArrowRight" weight="bold" size={18} color="currentColor" />
          Next page
        </button>
      </div>
      {!availability.enabled && availability.reason && (
        <p className="hr-hint hr-sb-reason">{availability.reason}</p>
      )}
      <div className="hr-sb-looks" role="group" aria-label="Scoreboard look">
        {SCOREBOARD_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            className="hr-btn hr-btn--ghost hr-btn--small"
            aria-pressed={board.style === style}
            disabled={busy}
            onClick={() => { if (board.style !== style) onStyle(style); }}
          >
            {STYLE_LABELS[style]}
          </button>
        ))}
      </div>
    </section>
  );
}
