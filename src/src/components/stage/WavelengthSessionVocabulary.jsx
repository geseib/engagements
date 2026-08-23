import React from 'react';
import { aggregateWavelengthSession, WAVELENGTH_STAGE_TERM_CAP } from '../../utils/wavelength';

/**
 * ENDED, wavelength: the session's shared vocabulary where the podium would be.
 *
 * The podium must not exist here — wavelength writes no scores and no Winners,
 * and a podium would have to invent its own numbers
 * (2026-08-09-ended-screen-review.md §1.4). What replaces it is the one thing
 * a wavelength session actually produces: the words the whole room said,
 * combined across every round, from each round's STORED analysis — the copy
 * the room saw, never recomputed.
 *
 * Two tiers, same treatment as the round wall (WavelengthConvergence):
 * unison terms at full weight with the count of rounds they landed in, the
 * near-misses dimmer with how many people offered them. The single figure —
 * "11 words the whole room shared" — is the session's score.
 */
const WavelengthSessionVocabulary = ({ rounds, loading = false }) => {
  const { roundsCounted, unison, nearMiss, figure } = aggregateWavelengthSession(rounds);

  if (loading && roundsCounted === 0) {
    // Beat one, ENDED edition: the report is being read back. One sentence,
    // never a bare spinner in front of a room.
    return (
      <div className="wl-conv" data-testid="wl-session-vocab">
        <p className="wl-wait">Reading the rounds back for the session&rsquo;s shared words&hellip;</p>
      </div>
    );
  }

  // A wavelength session with no analysed round has nothing to claim, and an
  // empty band that pretends otherwise is worse than no band.
  if (roundsCounted === 0) return null;

  const roundsNoun = roundsCounted === 1 ? 'round' : `${roundsCounted} rounds`;
  const headline = figure > 0
    ? (<><b>{figure}</b> word{figure === 1 ? '' : 's'} the whole room shared</>)
    : 'No word was on every list';
  const sub = figure > 0
    ? `Unanimous in at least one of the session's ${roundsNoun}.`
    : `Across the session's ${roundsNoun} — here is what came closest.`;

  // Unison leads at full weight; the near-misses trail, dimmer, capped the
  // same way the round wall is capped, with the cut said out loud.
  const shownUnison = unison.slice(0, WAVELENGTH_STAGE_TERM_CAP);
  const room = Math.max(0, WAVELENGTH_STAGE_TERM_CAP - shownUnison.length);
  const shownNear = nearMiss.slice(0, room);
  const hidden = (unison.length - shownUnison.length) + (nearMiss.length - shownNear.length);

  return (
    <div className="wl-conv" data-testid="wl-session-vocab">
      <div className="kicker">Where the room was already agreed</div>
      <p className="wl-headline">{headline}</p>
      <p className="wl-sub">{sub}</p>
      <div className="terms">
        {shownUnison.map((term) => (
          <span
            key={`u-${term.word}`}
            className="t w1"
            data-tier="unison"
            title={term.members.length > 1 ? `Counted together: ${term.members.join(', ')}` : undefined}
          >
            {term.word}
            <sup>{term.landedIn > 1 ? `×${term.landedIn}` : ''}</sup>
          </span>
        ))}
        {shownNear.map((term) => (
          <span
            key={`n-${term.word}`}
            className={`t ${term.total >= 4 ? 'w3' : 'w4'} wl-dim`}
            data-tier="near"
            title={term.members.length > 1 ? `Counted together: ${term.members.join(', ')}` : undefined}
          >
            {term.word}
            <sup>{term.total}</sup>
          </span>
        ))}
      </div>
      {hidden > 0 && (
        <p className="wl-note">
          {`Showing the ${shownUnison.length + shownNear.length} most shared — every word is in the session report.`}
        </p>
      )}
    </div>
  );
};

export default WavelengthSessionVocabulary;
