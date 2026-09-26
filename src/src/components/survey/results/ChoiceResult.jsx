import React from 'react';

/**
 * A CHOICE QUESTION'S RESULTS — bars with a share and a count, the top option
 * flagged "Most picked" (RATIONALE.md "Visualising results": trivia's bars,
 * amber for Most picked rather than green for Correct — this is never a
 * trivia round, so there is no correct answer to flag). Multi-pick adds the
 * "shares can pass 100%" note; an Other write-in lists the words themselves,
 * from `question.texts` filtered to `result.otherIds`.
 *
 * Presentational — see RatingResult.jsx's header for the shared contract.
 */
export default function ChoiceResult({ question }) {
  const r = question.result || {};
  const options = Array.isArray(question.options) ? question.options : [];
  const counts = Array.isArray(r.counts) ? r.counts : [];
  const n = r.n || 0;
  const pct = (c) => (n ? Math.round((c * 100) / n) : 0);
  const top = counts.length ? Math.max(0, ...counts) : 0;
  const otherIds = new Set(Array.isArray(r.otherIds) ? r.otherIds : []);
  const otherTexts = Array.isArray(question.texts) ? question.texts.filter((t) => otherIds.has(t.id)) : [];

  return (
    <div className="svr-bars">
      {options.map((label, i) => {
        const c = counts[i] || 0;
        const isTop = top > 0 && c === top;
        return (
          <div key={label} className={isTop ? 'svr-bar is-top' : 'svr-bar'}>
            <span className="svr-bar-l" title={label}>
              {label}
              {isTop && <span className="svr-tag">Most picked</span>}
            </span>
            <span className="svr-bar-t"><i style={{ width: `${pct(c)}%` }} /></span>
            <span className="svr-bar-v">{pct(c)}%<small>{c}</small></span>
          </div>
        );
      })}
      {question.allowMultiple && (
        <p className="svr-foot">
          Pick up to {question.maxPicks || options.length} &middot; shares are of the {n} {n === 1 ? 'person' : 'people'} who answered, so they can add to more than 100%.
        </p>
      )}
      {question.allowOther && r.other > 0 && (
        <div className="svr-foot">
          {r.other} {r.other === 1 ? 'person' : 'people'} wrote something else{otherTexts.length ? ':' : '.'}
          {otherTexts.length > 0 && (
            <ul className="svr-otherlist">
              {otherTexts.map((t) => <li key={t.id}>{t.text}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
