import React, { useEffect, useRef, useState } from 'react';

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
 *
 * THE WIPE (refresh-2026-09-22 RATIONALE §6 step 4, 03-stage-results.html).
 * A phase CHANGE is also an event, and the bar's colour alone is perceived
 * only by whoever happens to be looking at the bar. The wipe is a full-width
 * band across the middle of the stage — one word and one instruction — that
 * plays once (`--rv`, the reveal clock) and leaves. Keyed on the phase so a
 * change mounts a fresh one rather than restarting the one on screen; not
 * drawn on first mount, because a reload mid-round is not a change the room
 * witnessed; and not drawn into the lobby, which is a return, not a beat.
 * The RESULTS beats (results, field notes, feedback) share one bar value and
 * so one wipe — the chip in the rail tells them apart.
 */
const KNOWN_PHASES = new Set(['lobby', 'ask', 'vote', 'results', 'done']);

const WIPE = {
  ask: ['wipe', 'Answering', 'Write your answer on your phone'],
  vote: ['wipe', 'Voting', 'Choose on your phone'],
  results: ['wipe results', 'Results', 'Look up'],
};

export default function PhaseBar({ phase }) {
  const normalized = typeof phase === 'string' ? phase.toLowerCase() : '';
  const dataPhase = KNOWN_PHASES.has(normalized) ? normalized : 'lobby';

  const previous = useRef(dataPhase);
  const [wipe, setWipe] = useState(null);
  useEffect(() => {
    if (previous.current === dataPhase) return;
    previous.current = dataPhase;
    setWipe(WIPE[dataPhase] ? { phase: dataPhase, key: Date.now() } : null);
  }, [dataPhase]);

  const words = wipe ? WIPE[wipe.phase] : null;
  return (
    <>
      <div className="bar" data-phase={dataPhase} role="presentation" />
      {words && (
        <div
          key={wipe.key}
          className={words[0]}
          aria-hidden="true"
          onAnimationEnd={() => setWipe(null)}
        >
          {words[1]}
          <small>{words[2]}</small>
        </div>
      )}
    </>
  );
}
