import React from 'react';

/**
 * WHAT WORKIE HAD — a quiet line for the host alone (question-background spec §4).
 *
 * Flags only, never the content. Mounted on the host remote and in the session
 * report; NEVER on the host page or its sidebar, which the room may be watching.
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
