import React, { useEffect, useState } from 'react';
import {
  normalizeWavelengthAnalysis,
  isWavelengthPending,
  wavelengthHeadline,
  wavelengthMetaLine,
  wavelengthMatchingNote,
  wavelengthTerms,
  WAVELENGTH_STILL_MATCHING,
} from '../../utils/wavelength';

/**
 * Wavelength RESULTS on the stage — the ranked, weighted flow the mockup
 * (docs/design/host-redesign/08-results-wavelength.html) draws, carrying the
 * convergence spec's semantics instead of raw frequency:
 *
 *   - LANDED words (on every submitter's list) at full weight and colour
 *   - everything else dimmer, each with the number of people who said it
 *   - one figure, denominator in words — never a bare percentage
 *
 * THE REVEAL IS TWO BEATS (spec §4). The round closes immediately with the
 * exact-match analysis and clustering marked pending; this component shows a
 * sentence about what is happening — the host is standing in front of people,
 * and a spinner with no sentence is how that silence becomes awkward. Beat two
 * is the `wavelengthAnalysisReady` frame updating the prop. If no frame lands
 * inside the watchdog window, the exact-match result goes up annotated
 * "matched on exact wording only" — a degraded claim about agreement that does
 * not announce itself is worse than no claim.
 *
 * jsdom cannot judge any of the geometry here; what IS pinned in
 * __tests__/wavelengthConvergence.test.jsx is the vocabulary — the landed
 * words, the denominator, the near-miss headline, the fallback note.
 */
const CLUSTERING_WATCHDOG_MS = 20000;

const WavelengthConvergence = ({ analysis: rawAnalysis }) => {
  const analysis = normalizeWavelengthAnalysis(rawAnalysis);
  const pending = isWavelengthPending(analysis);
  const [waitedOut, setWaitedOut] = useState(false);

  useEffect(() => {
    if (!pending) return undefined;
    setWaitedOut(false);
    const timer = setTimeout(() => setWaitedOut(true), CLUSTERING_WATCHDOG_MS);
    return () => clearTimeout(timer);
    // rawAnalysis in the deps restarts the watchdog when a new round's
    // pending analysis replaces this one mid-wait.
  }, [pending, rawAnalysis]);

  if (!analysis) return null;

  if (pending && !waitedOut) {
    return (
      <div className="wl-conv">
        <div className="kicker">{wavelengthMetaLine(analysis)}</div>
        <p className="wl-wait">
          Every list is in. Matching the room&rsquo;s words&thinsp;&mdash; plurals,
          spellings and abbreviations count together&hellip;
        </p>
      </div>
    );
  }

  /* Waited out: the frame is LATE, which is not the same as failed and must not
     be described as it. This used to rewrite the round to clustering:'failed'
     locally, so the wall asserted "spelling variants were not combined this
     round" about a run nothing had reported on — and the worker's budget is
     minutes, so a frame landing after this re-flows the words underneath a
     sentence that already called it a failure. The round is passed through as
     it is; only the SENTENCE changes. */
  const headline = wavelengthHeadline(analysis);
  const note = pending ? WAVELENGTH_STILL_MATCHING : wavelengthMatchingNote(analysis);
  const { terms, reduction } = wavelengthTerms(analysis);

  return (
    <div className="wl-conv">
      <div className="kicker">{wavelengthMetaLine(analysis)}</div>
      <p className="wl-headline">
        {headline.figure !== null
          ? (<><b>{headline.figure}</b> {headline.label}</>)
          : headline.label}
      </p>
      <p className="wl-sub">{headline.sub}</p>
      {terms.length > 0 && (
        <div className="terms">
          {terms.map((term) => (
            <span
              key={term.word}
              className={`t ${term.sizeClass}${term.tier === 'offered' ? ' wl-dim' : ''}`}
              data-tier={term.tier}
              /* The audit trail (spec §3): every cluster's members ride along,
                 so a disputed merge is settled by looking, not by trusting. */
              title={term.members && term.members.length > 1
                ? `Counted together: ${term.members.join(', ')}`
                : undefined}
            >
              {term.word}
              <sup>{term.count}</sup>
            </span>
          ))}
        </div>
      )}
      {reduction && <p className="wl-note">{reduction}</p>}
      {note && <p className="wl-note">{note}</p>}
    </div>
  );
};

export default WavelengthConvergence;
