import React, { useEffect, useState } from 'react';
import { bluffStageLine, bluffRevealLines, BLUFF_WORDS } from '../../config/bluffRound';

/**
 * THE BLUFF ROUND, ON THE HOST'S STAGE (docs/design/bluff-round/README.md).
 *
 * While the room answers and votes: one line saying a bluff is in play (or why
 * this round plays normally) — never who has the real answer; the question
 * payload the stage holds does not know. At RESULTS: the real answer and which
 * numbered response it was, read from the round's results (get-results
 * `bluff`). Names stay off the wall, as everywhere on the stage; the phones
 * and Workie say who had it and who fooled the room.
 *
 *   phase     'ASK' | 'VOTE' | 'RESULTS'
 *   question  the round's question payload (carries the public `bluff`)
 *   reveal    get-results' `bluff` block for this round (useBluffReveal)
 */
export default function BluffLine({ phase, question, reveal }) {
  if (phase === 'RESULTS') {
    const lines = bluffRevealLines(reveal);
    if (!lines) return null;
    return (
      <p className="qdetail" data-testid="stage-bluff">
        <b>{BLUFF_WORDS.revealHeading}:</b> {lines.realAnswer}
        {reveal.realBallot ? ` (${BLUFF_WORDS.ballotNumber(reveal.realBallot).toLowerCase()})` : ''}
      </p>
    );
  }
  const line = bluffStageLine(question);
  if (!line) return null;
  return <p className="qdetail" data-testid="stage-bluff">{line}</p>;
}

/**
 * This round's reveal, once it is in RESULTS and the round bluffed: the public
 * get-results read (which only reports once the room is on that round's
 * results). null otherwise. One read per round.
 */
export function useBluffReveal({ inResults, question, gameId, round, apiBase }) {
  const [reveal, setReveal] = useState(null);
  const bluffOn = Boolean(question && question.bluff && question.bluff.active);
  useEffect(() => {
    let live = true;
    setReveal(null);
    if (!inResults || !bluffOn || !gameId || !round || typeof fetch !== 'function') return undefined;
    Promise.resolve()
      .then(() => fetch(`${apiBase || ''}games/get-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, questionNumber: round }),
      }))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => { if (live && data && data.bluff && data.bluff.realAnswer) setReveal(data.bluff); })
      .catch(() => {});
    return () => { live = false; };
  }, [inResults, bluffOn, gameId, round, apiBase]);
  return reveal;
}
