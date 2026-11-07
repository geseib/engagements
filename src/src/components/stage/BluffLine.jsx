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
 *   gameId, round, apiBase   for the results read at RESULTS
 */
export default function BluffLine({ phase, question, gameId, round, apiBase }) {
  const [reveal, setReveal] = useState(null);
  const bluffOn = Boolean(question && question.bluff && question.bluff.active);

  useEffect(() => {
    let live = true;
    setReveal(null);
    if (phase !== 'RESULTS' || !bluffOn || !gameId || !round || typeof fetch !== 'function') return undefined;
    fetch(`${apiBase || ''}games/get-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, questionNumber: round }),
    })
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => { if (live && data && data.bluff) setReveal(data.bluff); })
      .catch(() => {});
    return () => { live = false; };
  }, [phase, bluffOn, gameId, round, apiBase]);

  if (phase === 'RESULTS') {
    const lines = bluffRevealLines(reveal);
    if (!lines) return null;
    return (
      <p className="qdetail" data-testid="stage-bluff">
        <b>{BLUFF_WORDS.revealHeading}:</b> {lines.realAnswer}
        {reveal.realBallot ? ` (response ${reveal.realBallot})` : ''}
      </p>
    );
  }
  const line = bluffStageLine(question);
  if (!line) return null;
  return <p className="qdetail" data-testid="stage-bluff">{line}</p>;
}
