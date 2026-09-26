import React from 'react';

/**
 * A RATING QUESTION'S RESULTS — the histogram-plus-mean shape for a plain
 * scale (1–5, 1–10, stars) and the recommend-score split for a 0–10 scale.
 * docs/design/survey-redesign/_src/results.py `result_card()` is the mockup
 * this follows (30-results.html); RATIONALE.md "Visualising results" names
 * the two shapes as the whole of what a rating question ever draws.
 *
 * Presentational: `question` is one entry of `GET /games/{id}/survey-results`
 * `.questions[]` (survey-host.js `results()`), carrying the aggregate's own
 * `result` (survey-aggregate.js `ratingKind().result`) beside the question's
 * own fields (`scale`, `lowLabel`, `highLabel`). No fetching, no state.
 */
const SCALE_LABELS = {
  '0-10': Array.from({ length: 11 }, (_, i) => String(i)),
  '1-10': Array.from({ length: 10 }, (_, i) => String(i + 1)),
};
const DEFAULT_LABELS = ['1', '2', '3', '4', '5']; // 1-5 and stars

export default function RatingResult({ question }) {
  const r = question.result || {};
  const n = r.n || 0;

  if (r.scale === '0-10') {
    const detractors = r.detractors || 0;
    const passives = r.passives || 0;
    const promoters = r.promoters || 0;
    const pct = (c) => (n ? Math.round((c * 100) / n) : 0);
    const scoreText = r.score === null || r.score === undefined
      ? '—'
      : `${r.score > 0 ? '+' : ''}${r.score}`;
    return (
      <div className="svr-rate">
        <div className="svr-mean">
          <b>{scoreText}</b>
          <span>recommend score</span>
          <em>&minus;100 to +100</em>
        </div>
        <div className="svr-split-wrap">
          <div
            className="svr-split"
            role="img"
            aria-label={`Would not ${pct(detractors)}%, maybe ${pct(passives)}%, would ${pct(promoters)}%`}
          >
            <i className="svr-det" style={{ flex: detractors || 0.0001 }}>{pct(detractors)}%</i>
            <i className="svr-pas" style={{ flex: passives || 0.0001 }}>{pct(passives)}%</i>
            <i className="svr-pro" style={{ flex: promoters || 0.0001 }}>{pct(promoters)}%</i>
          </div>
          <div className="svr-legend">
            <span><i className="svr-swatch svr-swatch--det" />0&ndash;6 &middot; would not (<b>{detractors}</b>)</span>
            <span><i className="svr-swatch svr-swatch--pas" />7&ndash;8 &middot; maybe (<b>{passives}</b>)</span>
            <span><i className="svr-swatch svr-swatch--pro" />9&ndash;10 &middot; would (<b>{promoters}</b>)</span>
          </div>
        </div>
      </div>
    );
  }

  const counts = Array.isArray(r.counts) ? r.counts : [];
  const labels = SCALE_LABELS[r.scale] || DEFAULT_LABELS;
  const max = counts.length ? Math.max(1, ...counts) : 1;
  const meanText = r.mean === null || r.mean === undefined ? '—' : r.mean.toFixed(2);
  const topOf = labels.length >= 2 ? `${labels[labels.length - 2]} or ${labels[labels.length - 1]}` : 'the top';

  return (
    <div className="svr-rate">
      <div className="svr-mean">
        <b>{meanText}</b>
        <span>out of {labels[labels.length - 1]} &middot; mean</span>
        {r.topTwo !== null && r.topTwo !== undefined && (
          <em>{r.topTwo}% said {topOf}</em>
        )}
      </div>
      <div>
        <div className="svr-hist" style={{ '--n': counts.length || 1 }}>
          {counts.map((c, i) => (
            <div key={labels[i] || i} className={c > 0 && c === max ? 'svr-col is-top' : 'svr-col'}>
              <em>{c}</em>
              <i style={{ height: `${max ? Math.round((c * 100) / max) : 0}%` }} />
            </div>
          ))}
        </div>
        <div className="svr-histx" style={{ '--n': counts.length || 1 }}>
          {labels.map((l) => <span key={l}>{l}</span>)}
        </div>
        {(question.lowLabel || question.highLabel) && (
          <div className="svr-ends">
            <span>{question.lowLabel || ''}</span>
            <span>{question.highLabel || ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}
