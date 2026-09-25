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
  return (
    <p className="workie-context-hint" data-testid="workie-context-hint">{`Workie had: ${text}`}</p>
  );
}
