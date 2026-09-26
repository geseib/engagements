import React from 'react';

/**
 * A YES/NO QUESTION'S RESULTS — one split bar plus the "why" answers filed
 * under the choice that explains them (RATIONALE.md "Visualising results").
 * `result.whys` names ids into `question.texts`; the ids carry no arrival
 * order (survey-aggregate.js "TEXT IDS CARRY NO ORDER"), so the list below is
 * in whatever order the ids came back in, not when anyone answered.
 *
 * Presentational — see RatingResult.jsx's header for the shared contract.
 */
export default function YesNoResult({ question }) {
  const r = question.result || {};
  const counts = r.counts || { yes: 0, no: 0, unsure: 0 };
  const n = r.n || 0;
  const pct = (c) => (n ? Math.round((c * 100) / n) : 0);
  const yesLabel = question.yesLabel || 'Yes';
  const noLabel = question.noLabel || 'No';
  const showUnsure = Boolean(question.unsure);
  const texts = Array.isArray(question.texts) ? question.texts : [];
  const textById = new Map(texts.map((t) => [t.id, t]));
  const whys = r.whys || {};
  const whyEntries = ['no', 'yes', 'unsure']
    .flatMap((v) => (Array.isArray(whys[v]) ? whys[v] : []).map((id) => ({ id, v })))
    .map((e) => ({ ...e, text: textById.get(e.id) && textById.get(e.id).text }))
    .filter((e) => e.text);
  const labelFor = (v) => (v === 'yes' ? yesLabel : v === 'no' ? noLabel : 'not sure');

  return (
    <div className="svr-yesno">
      <div
        className="svr-split"
        role="img"
        aria-label={`${yesLabel} ${pct(counts.yes)}%, ${noLabel} ${pct(counts.no)}%${showUnsure ? `, not sure ${pct(counts.unsure)}%` : ''}`}
      >
        <i className="svr-yes" style={{ flex: counts.yes || 0.0001 }}>{yesLabel} {pct(counts.yes)}%</i>
        <i className="svr-no" style={{ flex: counts.no || 0.0001 }}>{noLabel} {pct(counts.no)}%</i>
        {showUnsure && <i className="svr-ns" style={{ flex: counts.unsure || 0.0001 }}>{pct(counts.unsure)}%</i>}
      </div>
      <div className="svr-legend">
        <span><b>{counts.yes}</b> {yesLabel.toLowerCase()}</span>
        <span><b>{counts.no}</b> {noLabel.toLowerCase()}</span>
        {showUnsure && <span><b>{counts.unsure}</b> not sure</span>}
      </div>
      {whyEntries.length > 0 && (
        <ul className="svr-quotes">
          {whyEntries.map((e) => (
            <li key={e.id}>
              {e.text}
              <small>said {labelFor(e.v)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
