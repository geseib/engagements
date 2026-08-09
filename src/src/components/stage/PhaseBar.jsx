import React from 'react';

/**
 * The room's persistent phase signal — the `.bar` grid area. Ported (as CSS)
 * from docs/design/host-redesign/02-ask-call-and-answer.html:198-206, where
 * a full-width band is the whole state: a 20px pill in a corner would
 * subtend ~8 arcminutes at 25ft — recognisable as a coloured blob, not
 * readable. Costing 8px of stage buys a signal that is perceived without
 * being read.
 *
 * The CSS selects on the lowercase value (`.bar[data-phase="ask"]`), so the
 * phase is normalised here rather than trusting the caller's casing —
 * game-state phases elsewhere in this app are upper-case ("ASK", "VOTE").
 */
const KNOWN_PHASES = new Set(['lobby', 'ask', 'vote', 'results', 'done']);

export default function PhaseBar({ phase }) {
  const normalized = typeof phase === 'string' ? phase.toLowerCase() : '';
  const dataPhase = KNOWN_PHASES.has(normalized) ? normalized : 'lobby';

  return <div className="bar" data-phase={dataPhase} role="presentation" />;
}
