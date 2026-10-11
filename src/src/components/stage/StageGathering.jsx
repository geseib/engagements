import React from 'react';

/**
 * THE STAGE WHILE A ROUND-PHASE'S RESPONSES ARE ON THEIR WAY (owner,
 * 2026-10-11): "it should say gathering responses… in an active way, so it
 * looks like it's doing something and not an error."
 *
 * Three states, one prop (config/stageAnswers.js `stageAnswersStatus`):
 *   - `gathering` — "Gathering responses…" with three dots that breathe. A
 *     polite live status, so a screen reader hears it once and is not nagged.
 *     The dots are decoration (`aria-hidden`); under reduced motion they hold
 *     still and the words carry it alone.
 *   - `failed` — the load for this round-phase was refused or threw. Said
 *     plainly, with a retry when the page gives one, so the stage never sits
 *     on "Gathering…" for a load that is not coming.
 *   - `ready` — nothing: the caller draws the cards, or its own none line.
 *
 * The dots are MUTED GREY, not the primary orange: the stage has one orange
 * and it belongs to whatever the host should press next.
 */
export default function StageGathering({ status, noun = 'responses', onRetry = null }) {
  if (status === 'failed') {
    return (
      <div className="gathering is-failed" role="alert">
        <p className="gathering__words">{`The ${noun} did not load.`}</p>
        {onRetry ? (
          <button type="button" className="btn ghost" onClick={onRetry}>Try again</button>
        ) : null}
      </div>
    );
  }
  if (status !== 'gathering') return null;
  return (
    <p className="gathering" role="status" aria-live="polite">
      <span className="gathering__words">{`Gathering ${noun}…`}</span>
      <span className="gathering__dots" aria-hidden="true"><i /><i /><i /></span>
    </p>
  );
}
