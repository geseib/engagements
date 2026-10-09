/**
 * LATER AND POINTS, ONE SLOT (talking points T1): two tabs over one panel in
 * the middle column. Both are lists the host holds and Claude has not acted
 * on; one slot keeps the column from scrolling and keeps Waiting for you on
 * top. The Points tab shows how many are new, so a batch arriving while the
 * host looks at Later is not missed. Points opens by itself the first time a
 * batch arrives; after that the tab's count says so and the host chooses when
 * to look.
 *
 * A room that carries no `points` (the server did not send them) shows Later
 * alone, as before.
 */
import React, { useEffect, useRef, useState } from 'react';
import BuildLater from './BuildLater';
import BuildPoints from './BuildPoints';
import { W } from './words';
import { laterItems, pointsOf } from './buildScreens';

export default function BuildLaterPoints({
  room, ended, busy, run, api, laterTicked, setLaterTicked, onVoteLater, onAskRoom,
  pointTicked, setPointTicked, leadsRow, askOpen = false, openPoints = 0, onRequest, onVotePoints,
}) {
  const pts = pointsOf(room);
  const later = laterItems(room);
  const total = pts ? pts.items.length : 0;
  const fresh = pts ? pts.items.filter((p) => p.status === 'new').length : 0;
  const [tab, setTab] = useState(() => (total > 0 && later.length === 0 ? 'points' : 'later'));
  // Ticks belong to the tab they were made on: the action row is not on screen in the other.
  // Every switch, the host's click or an automatic one, clears the tab being left.
  const goTo = (next) => {
    if (next === 'later') setPointTicked([]);
    else setLaterTicked([]);
    setTab(next);
  };
  // The first batch to arrive opens Points by itself, once.
  const seenAny = useRef(total > 0);
  useEffect(() => {
    if (total > 0 && !seenAny.current) { seenAny.current = true; goTo('points'); }
    if (total > 0) seenAny.current = true;
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
  // What's next sent the host here.
  const asked = useRef(openPoints);
  useEffect(() => {
    if (openPoints !== asked.current) { asked.current = openPoints; goTo('points'); }
  }, [openPoints]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pts) {
    return <BuildLater room={room} ticked={laterTicked} setTicked={setLaterTicked} busy={busy} ended={ended} run={run} api={api} onVote={onVoteLater} onAskRoom={onAskRoom} />;
  }
  const choose = (next) => {
    if (next === tab) return;
    goTo(next);
  };
  return (
    <div className="brm-lp">
      <div className="brm-lp-tabs" role="tablist" aria-label={`${W.later} and ${W.points}`}>
        <button type="button" role="tab" id="brm-tab-later" aria-selected={tab === 'later'} aria-controls="brm-tabpanel" className={`brm-lp-tab${tab === 'later' ? ' is-on' : ''}`} onClick={() => choose('later')}>
          {W.later} <b>{later.length}</b>
        </button>
        <button type="button" role="tab" id="brm-tab-points" aria-selected={tab === 'points'} aria-controls="brm-tabpanel" className={`brm-lp-tab${tab === 'points' ? ' is-on' : ''}`} onClick={() => choose('points')}>
          {W.points} <b>{total}</b>{fresh > 0 && <span className="brm-lp-new"> · {W.pointsNew(fresh)}</span>}
        </button>
        <span className="brm-hint brm-push">{W.roomSeesNone}</span>
      </div>
      <div id="brm-tabpanel" role="tabpanel" aria-labelledby={tab === 'later' ? 'brm-tab-later' : 'brm-tab-points'}>
        {tab === 'later' ? (
          <>
            <BuildLater room={room} ticked={laterTicked} setTicked={setLaterTicked} busy={busy} ended={ended} run={run} api={api} onVote={onVoteLater} onAskRoom={onAskRoom} />
            {!later.length && <p className="brm-empty">{W.laterEmpty}</p>}
          </>
        ) : (
          <BuildPoints
            room={room} ticked={pointTicked} setTicked={setPointTicked} busy={busy} ended={ended} run={run} api={api}
            leadsRow={leadsRow} askOpen={askOpen} onRequest={onRequest} onVote={onVotePoints}
          />
        )}
      </div>
    </div>
  );
}
