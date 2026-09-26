import React from 'react';

/**
 * WHAT WORKIE HAD — a quiet line for the host alone (question-background spec §4).
 *
 * Flags only, never the content. Mounted on the host remote — live under "What
 * we heard" (HostRemote.jsx) and after the fact in an opened round
 * (RemoteSessionPanel.jsx). NEVER on the host page, its sidebar, or the round
 * review the host page opens over the stage (PastRound), all of which the room
 * may be watching; and never in the session report (GameReport), which is
 * rendered on that same page and printed for the client.
 * A summary written before the flags existed carries none, and gets no line rather
 * than a row of dashes that would read as "Workie had nothing".
 */
const ITEMS = [
  ['background', 'question notes'],
  ['setNote', 'set note'],
  ['eventDetails', 'event details'],
  ['hostInstructions', 'host instructions'],
  ['briefing', 'briefing'],
];

export default function WorkieContextHint({ contextUsed }) {
  if (!contextUsed || typeof contextUsed !== 'object') return null;
  const text = ITEMS.map(([key, label]) => `${label} ${contextUsed[key] ? '✓' : '—'}`).join(' · ');
  /*
    READ ALOUD AS WORDS. A screen reader says "✓" as "check mark" at best and
    "—" as "em dash" or nothing, so the ticks carry no meaning aloud. The line is
    one image-like unit named in words — the star-rating pattern (role="img"
    with a label, children presentational) — which leaves the visible text
    exactly as it is. An aria-label on a bare <p> would not do: a paragraph may
    not be named, and screen readers read its text instead.
  */
  const spoken = ITEMS.map(([key, label]) => `${label}: ${contextUsed[key] ? 'yes' : 'no'}`).join('; ');
  return (
    <p
      className="workie-context-hint"
      data-testid="workie-context-hint"
      role="img"
      aria-label={`Workie had — ${spoken}`}
    >
      {`Workie had: ${text}`}
    </p>
  );
}
