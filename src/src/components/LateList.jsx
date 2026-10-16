import React, { useState } from 'react';
import LW from '../config/lateWords';
import { canShowOnWall } from '../utils/lateClient';
import './LateList.css';

/**
 * THE HOST'S LATE LIST (session flow v3 §4.4; late items Task 4).
 *
 * Everything that arrived after its moment, grouped by round: a late round
 * answer, a late answer to a question for the room, a comment added later.
 * Each says what it is, who sent it, when it arrived and its review label,
 * with two quiet buttons: "Show on the wall" (a comment or a late Idea, and
 * only while the wall is on that item's round and beat, so the press really
 * shows it; a late round answer has no wall view) and "Mark reviewed".
 *
 * The host's only. Never imported by a phone, wall or Present file (Q14,
 * __tests__/lateList.test.jsx). Presentational: the page owns the reads and
 * the writes, and each handler resolves `{ ok, error }`.
 *
 * At ENDED, "Close comments": comments stay open until 24 h after the end.
 */
function LateItem({ item, roundNoun, wall, busy, onShow, onMarkReviewed }) {
  const when = LW.arrivedDuring(item.arrivedDuring, roundNoun);
  const label = item.label || LW.labels[item.reviewed || 'none'] || LW.labels.none;
  return (
    <li className={`late-item${item.reviewed ? ' is-reviewed' : ''}`}>
      <div className="late-head">
        <span className="late-kind">{LW.kinds[item.kind] || item.kind}</span>
        <span className={`late-label${item.reviewed ? '' : ' is-waiting'}`}>{label}</span>
      </div>
      {item.text ? <p className="late-text">{item.text}</p> : null}
      <p className="late-meta">
        {item.who}
        {when ? ` · ${when}` : ''}
      </p>
      {(canShowOnWall(item, wall) || !item.reviewed) ? (
        <div className="late-acts">
          {canShowOnWall(item, wall) ? (
            <button type="button" className="late-btn" disabled={busy} onClick={() => onShow(item)}>{LW.show}</button>
          ) : null}
          {!item.reviewed ? (
            <button type="button" className="late-btn" disabled={busy} onClick={() => onMarkReviewed(item)}>{LW.markReviewed}</button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function LateList({
  rounds = [],
  ended = false,
  commentsClosedAt = null,
  // The round on the wall now: { round, beat, askId } (lateClient canShowOnWall).
  wall = null,
  onShow = () => Promise.resolve({ ok: true }),
  onMarkReviewed = () => Promise.resolve({ ok: true }),
  onCloseComments = () => Promise.resolve({ ok: true }),
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = (fn) => async (arg) => {
    setBusy(true);
    setError('');
    try {
      const r = await fn(arg);
      if (r && r.ok === false) setError(r.error || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  const groups = (Array.isArray(rounds) ? rounds : []).filter((r) => r && Array.isArray(r.items) && r.items.length);
  return (
    <div className="late">
      {groups.length === 0 ? <p className="late-empty">{LW.empty}</p> : groups.map((r) => (
        <section key={r.round} className="late-round" role="group" aria-labelledby={`late-round-${r.round}`}>
          <h4 className="late-round-h" id={`late-round-${r.round}`}>{LW.roundHeading(r.round, r.roundNoun)}</h4>
          <ul className="late-items">
            {r.items.map((item) => (
              <LateItem
                key={`${item.kind}:${item.ref}`}
                item={item}
                roundNoun={r.roundNoun}
                wall={wall}
                busy={busy}
                onShow={run(onShow)}
                onMarkReviewed={run(onMarkReviewed)}
              />
            ))}
          </ul>
        </section>
      ))}
      {error ? <p className="late-error" role="alert">{error}</p> : null}
      {ended ? (
        <div className="late-close">
          {commentsClosedAt ? <p className="late-closed">{LW.commentsClosed}</p> : (
            <>
              <button type="button" className="late-btn" disabled={busy} onClick={() => run(onCloseComments)()}>{LW.closeComments}</button>
              <p className="late-explain">{LW.closeExplain}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
