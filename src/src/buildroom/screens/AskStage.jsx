/**
 * THE CURRENT ASK'S BOARD, as the Stage and the Host screen's path draw it
 * (moved from BuildRoomPage.jsx in B6, unchanged). With no `onPick` nothing on
 * it can be picked; with `host` false it names nobody.
 */
import React, { useContext, useState } from 'react';
import Icon from '../../components/Icon';
import BuildImage from '../BuildImage';
import { ViewerContext } from '../MockupViewer';
import { W } from '../words';
import { winnerOf, ratingStep, bestWhy } from '../buildScreens';
import { KIND_LABEL, askNumber, OpenLink } from './common';
import Pager from '../../components/stage/Pager';
import { shows, dropRank } from '../../config/roomContent';
import { pageSlice } from '../../config/stagePaging';

/**
 * THE CURRENT ASK'S BOARD: the options and their counts, the ideas, the
 * rating, the reasons. On the Stage it is the wall (host={false}). On the Host
 * screen it sits inside the four-step path with `pathMode` (owner,
 * 2026-10-07): the path (BuildAskPath.jsx) carries the question, Edit wording,
 * Discard, Close, Reopen, the wheel and the direction, so the board has no
 * eyebrow, heading or controls of its own; a click on an option still picks.
 */
/*
 * WHAT THE ROOM SEES (owner, 17-18 Oct 2026; config/roomContent.js,
 * docs/design/room-content-v2 frames 7-8). With `rc` (the Stage, on one screen
 * and on the room's window) the board draws what the room content names:
 *   - the prompt leads; each option is a card with its letter, its title at the
 *     secondary step and its detail under it at the body step, on every profile
 *     (the details give way first for space, all at once, through one data-drop
 *     gate); the ask's own detail on Call only;
 *   - NO TALLY WHILE THE ASK IS OPEN (rc 'tally' dropped on BUILD_ASK): no
 *     count, percent or bar on any kind, so the first votes don't steer the
 *     rest; the meter's "Answered n / m" is the only number, and one small line
 *     says where to answer;
 *   - on the result the votes rise inside each option as a fill, the count
 *     large (a Build Room's options are Claude's, never a player's, so a count
 *     names nobody); the winner carries a gold border, "The room's pick" and
 *     the room's best reason quoted (rc 'whys'); Call keeps the reasons list.
 * `paging` ({ size, page, onPage, enabled }) cuts a long ask's options into
 * pages: with `onPage` (the host's Stage) the shared Pager prints "Options 1-3
 * of 6 · page 1 of 2 · ↑ ↓ to page"; without (the room's window, which no
 * server fact pages) the first page shows and "and 3 more options on your
 * phone" says what is not on the wall. The Host screen's path (`pathMode`) and
 * the host's board keep their live counts: those are the host's, not the room's.
 */

/** data-drop numbers after the rail's own (1-3): the cue first, then the rule's order. */
const DROP_CUE = 3;
const dropAt = (rc, key) => {
  const r = dropRank(rc, key);
  return r ? String(DROP_CUE + r) : undefined;
};

const CUE = {
  choice: () => W.cueChoose,
  rating: () => W.cueRate,
  suggest: (ask) => (ask.status === 'voting' ? W.cueIdeasVote : W.cueSuggest),
};

export function AskStage({
  ask, host, busy, ended, run, api, pickId = null, onPick = null, pathMode = false, rc = null, paging = null,
}) {
  const roomView = Boolean(rc) && !host && !pathMode;
  const open = ['live', 'voting'].includes(ask.status);
  const showDetail = !roomView || shows(rc, 'detail');
  const showOptionDetail = !roomView || shows(rc, 'optionDetail');
  const showWhys = !roomView || shows(rc, 'whys');
  // No tally while the ask is open, on the room's screens (owner, 18 Oct 2026).
  const showTally = !roomView || shows(rc, 'tally');
  const room = roomView ? {
    tally: showTally, whys: showWhys, detailDrop: dropAt(rc, 'optionDetail'), whysDrop: dropAt(rc, 'whys'),
  } : null;
  // The full reasons list: the host's board, and Call; Room, TV and Table quote the best one on the pick.
  const whysList = !open && ask.kind !== 'suggest' && showWhys && (!roomView || rc.verbose || ask.kind === 'rating');
  const cue = roomView && open && CUE[ask.kind] ? CUE[ask.kind](ask) : '';
  return (
    <section className={`brm-stage brm-stage--${ask.status}`} aria-label="Current ask" data-room-view={roomView ? '' : undefined}>
      {!pathMode && (
        <>
          <div className="brm-top">
            <span className="brm-eyebrow">
              <b>{ask.status === 'voting' ? 'Vote' : KIND_LABEL[ask.kind]}</b> · Ask {askNumber(ask.askId)}
              {ask.status === 'results' && ' · Closed'}
              {ask.status === 'decided' && ' · Decided'}
            </span>
          </div>
          <h2 className="brm-q" data-rc-part={roomView ? 'prompt' : undefined} data-rc={roomView ? 'lead' : undefined}>{ask.prompt}</h2>
          {ask.detail && showDetail && <p className="brm-detail" data-drop={roomView ? dropAt(rc, 'detail') || '4' : undefined} data-drop-note={roomView ? 'Detail' : undefined}>{ask.detail}</p>}
        </>
      )}
      {ask.kind === 'choice' && <ChoiceBoard ask={ask} pickId={pickId} onPick={onPick} viewFrom={pathMode ? 'host' : null} showDetail={showOptionDetail} paging={roomView ? paging : null} room={room} />}
      {ask.kind === 'rating' && <RatingBoard ask={ask} tally={showTally} />}
      {ask.kind === 'suggest' && <SuggestBoard ask={ask} host={host} busy={busy} ended={ended} run={run} api={api} pickId={pickId} onPick={onPick} room={room} />}
      {whysList && <Whys ask={ask} host={host} drop={roomView ? dropAt(rc, 'whys') || '5' : null} />}
      {cue && <p className="brm-cue" data-drop={String(DROP_CUE)}>{cue}</p>}
    </section>
  );
}

/**
 * "CHOOSE THIS INSTEAD" (owner, 2026-10-06), at results: the answer going to
 * Claude says so; every other one offers itself. On the Stage a click goes to
 * the Host with that answer's sentence in the direction; on the Host it swaps
 * the sentence in place, as often as the host changes their mind.
 */
function PickButton({ id, current, onPick, idea = false, open = false }) {
  if (open) return <button type="button" className="brm-btn brm-btn--sm brm-pick" onClick={() => onPick(id)}>Pick this</button>;
  if (current && id === current) return <span className="brm-pick is-on">Going to Claude</span>;
  const label = `Choose this${idea ? ' idea' : ''}${current ? ' instead' : ''}`;
  return <button type="button" className="brm-btn brm-btn--sm brm-pick" onClick={() => onPick(id)}>{label}</button>;
}

/** A click on an option card picks it, unless the click was on a link or button inside it. */
const cardPick = (onPick, id) => (e) => {
  if (e.target && e.target.closest && e.target.closest('a, button, input, textarea')) return;
  onPick(id);
};

function ChoiceBoard({
  ask, pickId = null, onPick = null, viewFrom = null, showDetail = true, paging = null, room = null,
}) {
  const openViewer = useContext(ViewerContext);
  const open = ['live', 'voting'].includes(ask.status);
  const picking = Boolean(onPick) && (open || ask.status === 'results');
  const current = picking && !open ? pickId || winnerOf(ask) : null;
  const opts = (ask.results && ask.results.options) || [];
  const lead = Math.max(0, ...opts.map((o) => o.count));
  const all = ask.options || [];
  // The room's screens: no tally while open; on the result the votes inside each card.
  const tally = !room || room.tally;
  const pick = room && room.tally && !open ? winnerOf(ask) : null;
  const why = pick && room.whys ? bestWhy(ask.results && ask.results.whys, pick) : '';
  const anyDetail = showDetail && all.some((o) => o.detail);
  // A long ask pages (room content): the wall, with no page from the server, shows the first.
  const size = paging && paging.size > 0 ? paging.size : all.length || 1;
  const slice = pageSlice(all, paging && paging.onPage ? paging.page : 0, size);
  const board = (
    <div className={`brm-choices${room ? ' brm-choices--room' : ''}`}>
      {slice.items.map((o, j) => {
        const i = slice.offset + j;
        const r = opts.find((x) => x.label === o.label) || { count: 0, pct: 0 };
        const won = Boolean(pick) && pick === o.label;
        const leads = tally && !room && lead && r.count === lead;
        return (
          <div key={o.label} className={`brm-choice brm-choice--${i % 3}${leads ? ' is-lead' : ''}${won ? ' is-pick' : ''}${picking ? ' is-pickable' : ''}`} onClick={picking ? cardPick(onPick, o.label) : undefined} title={picking ? `Pick ${o.label}` : undefined} data-pick={won ? '' : undefined}>
            {room && tally && <span className="brm-fill" aria-hidden="true" style={{ height: `${Math.max(0, Math.min(100, Number(r.pct) || 0))}%` }} />}
            <div className="brm-choice-head">
              <span className="brm-big" aria-hidden="true">{o.label}</span>
              {won && <span className="brm-pickbadge">{W.roomsPick}</span>}
              <div className="brm-choice-text">
                <div className="brm-ct"><span className="brm-sr">Choice {o.label}: </span>{o.title}</div>
                {o.detail && showDetail && <div className="brm-cd" data-rc-part={room ? 'optionDetail' : undefined}>{o.detail}</div>}
                <OpenLink href={o.url} label={`Open ${o.label}`} />
              </div>
            </div>
            {won && why && <blockquote className="brm-pickwhy" data-rc-part="whys" data-drop={room.whysDrop} data-drop-note="The room's reason">{`“${why}”`}</blockquote>}
            <BuildImage imageId={o.imageId} alt={`Choice ${o.label}: ${o.title}`} className="brm-shot brm-shot--opt" onOpen={viewFrom && openViewer ? () => openViewer(ask.askId, o.label, viewFrom) : null} />
            {tally && !room && (
              <>
                <div className="brm-bar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} /></div>
                <div className="brm-count"><b>{r.count}</b> {r.pct}%</div>
              </>
            )}
            {tally && room && <div className="brm-score" data-rc-part="tally"><b>{r.count}</b> <span>{W.votesTally(r.count, r.pct)}</span></div>}
            {picking && <PickButton id={o.label} current={current} onPick={onPick} open={open} />}
          </div>
        );
      })}
    </div>
  );
  // ONE GATE FOR EVERY OPTION'S DETAIL: the fitter hides this empty marker and
  // the sheet hides the details after it, so they give way together, never one
  // card at a time (BuildRoom.css .brm-cdgate).
  const gate = room && anyDetail && room.detailDrop
    ? <span className="brm-cdgate" aria-hidden="true" data-drop={room.detailDrop} data-drop-note="Option detail" />
    : null;
  if (slice.pages <= 1) return <>{gate}{board}</>;
  const more = all.length - slice.items.length;
  return (
    <>
      {gate}
      {board}
      {paging.onPage
        ? <Pager total={all.length} page={slice.page} pageSize={size} noun={W.optionsNoun} onPage={paging.onPage} enabled={paging.enabled !== false} />
        : <p className="brm-moreopts" data-more-options={more}>{W.moreOptions(more)}</p>}
    </>
  );
}

function RatingBoard({ ask, tally = true }) {
  const rating = (ask.results && ask.results.rating) || { avg: null, count: 0, dist: [0, 0, 0, 0, 0] };
  const max = Math.max(1, ...(rating.dist || []));
  // While the room still rates, its screens show the scale it rates on, never the average so far.
  if (!tally) {
    return (
      <ol className="brm-ratescale" aria-label={W.ratingScaleSr}>
        {[1, 2, 3, 4, 5].map((n) => <li key={n}>{ratingStep(n)}</li>)}
      </ol>
    );
  }
  return (
    <div className="brm-rating">
      <div className="brm-rating-avg">
        <b>{rating.avg === null || rating.avg === undefined ? '–' : rating.avg}</b>
        <span>average of {rating.count || 0}</span>
      </div>
      <div className="brm-dist">
        {[1, 2, 3, 4, 5].map((n) => (
          <div className="brm-distrow" key={n}>
            <span className="brm-distn">{ratingStep(n)}</span>
            <div className="brm-bar"><span style={{ width: `${((rating.dist || [])[n - 1] || 0) / max * 100}%` }} /></div>
            <span className="brm-distc">{(rating.dist || [])[n - 1] || 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestBoard({ ask, host, busy, ended, run, api, pickId = null, onPick = null, room = null }) {
  const [said, setSaid] = useState('');
  // Ideas are picked once the room votes on them (voting), or at results.
  const open = ask.status === 'voting';
  const picking = Boolean(onPick) && (open || ask.status === 'results');
  const current = picking && !open ? pickId || winnerOf(ask) : null;
  const all = ask.responses || [];
  const shown = host ? all : all.filter((r) => !r.hidden);
  // The room's screens show no votes while the room still votes (owner, 18 Oct 2026).
  const counting = ask.status !== 'live' && (!room || room.tally);
  const pick = room && counting ? winnerOf(ask) : null;
  const sorted = counting ? [...shown].sort((a, b) => (b.votes || 0) - (a.votes || 0)) : shown;
  const max = Math.max(1, ...sorted.map((r) => r.votes || 0));
  const add = async (e) => {
    e.preventDefault();
    if (!said.trim()) return;
    const ok = await run(() => api.addResponse(ask.askId, said.trim()));
    if (ok !== undefined) setSaid('');
  };
  return (
    <div className="brm-suggest">
      {!sorted.length && <div className="brm-empty">{W.noSuggestions}</div>}
      <ul className="brm-sugs">
        {sorted.map((r) => (
          <li key={r.respId} className={`brm-sug${r.hidden ? ' is-hidden' : ''}${pick && pick === r.respId ? ' is-pick' : ''}${picking && !r.hidden ? ' is-pickable' : ''}`} onClick={picking && !r.hidden ? cardPick(onPick, r.respId) : undefined} data-pick={pick && pick === r.respId ? '' : undefined}>
            {pick && pick === r.respId && <span className="brm-pickbadge">{W.roomsPick}</span>}
            <span className="brm-sug-text">{r.text}</span>
            {counting && (
              <span className="brm-sug-votes">
                <span className="brm-bar brm-bar--thin" aria-hidden="true"><span style={{ width: `${((r.votes || 0) / max) * 100}%` }} /></span>
                <b>{r.votes || 0}</b> {(r.votes || 0) === 1 ? 'vote' : 'votes'}
              </span>
            )}
            {host && <span className="brm-who">{r.source === 'host' ? 'from the room, out loud' : r.playerName}{r.hidden ? ' · hidden' : ''}</span>}
            {picking && !r.hidden && <PickButton id={r.respId} current={current} onPick={onPick} idea open={open} />}
            {host && !ended && (
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => run(() => api.responseAction(ask.askId, r.respId, { action: r.hidden ? 'show' : 'hide' }))}>
                {r.hidden ? 'Show' : 'Hide'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {host && !ended && ask.status !== 'results' && (
        <form className="brm-verbal" onSubmit={add}>
          <Icon name="Microphone" size={16} color="var(--success)" />
          <input className="brm-input" aria-label="Add what the room said" placeholder={W.addSaid} value={said} maxLength={280} onChange={(e) => setSaid(e.target.value)} />
          <button type="submit" className="brm-btn brm-btn--sm" disabled={busy || !said.trim()}>Add</button>
        </form>
      )}
    </div>
  );
}

function Whys({ ask, host, drop = null }) {
  const whys = (ask.results && ask.results.whys) || [];
  if (!whys.length) return null;
  // On the Stage the reasons are support that gives way for space (`drop`: its data-drop number).
  return (
    <div className="brm-whysbox" data-rc-part={drop ? 'whys' : undefined} data-drop={drop || undefined} data-drop-note={drop ? 'Reasons' : undefined}>
      <span className="brm-lbl">Reasons</span>
      <ul className="brm-whys">
        {whys.map((w, i) => (
          <li key={i}>
            <span className="brm-letter brm-letter--sm" aria-hidden="true">{w.label}</span>
            <span className="brm-w">{w.text}</span>
            {host && w.playerName && <span className="brm-who">{w.playerName}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
