import React from 'react';

/**
 * A RANKING QUESTION'S RESULTS — items ordered by average place, each with a
 * strip showing where people actually put it (survey-aggregate.js `rankKind`:
 * `placeHist[item][place]`, plus `unplaced` for anyone whose ranking left it
 * out — RATIONALE.md "Visualising results": "a strip showing where each item
 * was placed"). Lower average place is better and sorts first.
 *
 * Presentational — see RatingResult.jsx's header for the shared contract.
 */
export default function RankResult({ question }) {
  const r = question.result || {};
  const options = Array.isArray(question.options) ? question.options : [];
  const avgPlace = Array.isArray(r.avgPlace) ? r.avgPlace : [];
  const placeHist = Array.isArray(r.placeHist) ? r.placeHist : [];
  const unplaced = Array.isArray(r.unplaced) ? r.unplaced : [];
  const n = r.n || 0;

  const order = options
    .map((label, i) => ({ label, i, avg: avgPlace[i] }))
    .sort((a, b) => {
      const aAvg = a.avg === null || a.avg === undefined ? Infinity : a.avg;
      const bAvg = b.avg === null || b.avg === undefined ? Infinity : b.avg;
      return aAvg - bAvg;
    });

  return (
    <div className="svr-rank">
      {order.map(({ label, i, avg }, pos) => {
        const hist = placeHist[i] || [];
        const left = unplaced[i] || 0;
        return (
          <div key={label} className="svr-rank-row">
            <span className="svr-rank-p">{pos + 1}</span>
            <span className="svr-rank-l" title={label}>{label}</span>
            <span className="svr-rank-strip" title="Where people put it, first place to last">
              {hist.map((c, p) => (c > 0 ? (
                <i key={p} className={`svr-p${Math.min(p + 1, 7)}`} style={{ flex: c }} />
              ) : null))}
              {left > 0 && <i className="svr-punplaced" style={{ flex: left }} />}
            </span>
            <span className="svr-rank-v"><b>{avg === null || avg === undefined ? '—' : avg.toFixed(1)}</b> avg</span>
          </div>
        );
      })}
      <p className="svr-foot">By average place &middot; {n} {n === 1 ? 'answer' : 'answers'}.</p>
    </div>
  );
}
