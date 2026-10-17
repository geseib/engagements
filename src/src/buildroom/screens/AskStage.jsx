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
import { winnerOf, ratingStep } from '../buildScreens';
import { KIND_LABEL, askNumber, OpenLink } from './common';

/**
 * THE CURRENT ASK'S BOARD: the options and their counts, the ideas, the
 * rating, the reasons. On the Stage it is the wall (host={false}). On the Host
 * screen it sits inside the four-step path with `pathMode` (owner,
 * 2026-10-07): the path (BuildAskPath.jsx) carries the question, Edit wording,
 * Discard, Close, Reopen, the wheel and the direction, so the board has no
 * eyebrow, heading or controls of its own; a click on an option still picks.
 */
export function AskStage({ ask, host, busy, ended, run, api, pickId = null, onPick = null, pathMode = false }) {
  return (
    <section className={`brm-stage brm-stage--${ask.status}`} aria-label="Current ask">
      {!pathMode && (
        <>
          <div className="brm-top">
            <span className="brm-eyebrow">
              <b>{ask.status === 'voting' ? 'Vote' : KIND_LABEL[ask.kind]}</b> · Ask {askNumber(ask.askId)}
              {ask.status === 'results' && ' · Closed'}
            </span>
          </div>
          <h2 className="brm-q">{ask.prompt}</h2>
          {ask.detail && <p className="brm-detail">{ask.detail}</p>}
        </>
      )}
      {ask.kind === 'choice' && <ChoiceBoard ask={ask} pickId={pickId} onPick={onPick} viewFrom={pathMode ? 'host' : null} />}
      {ask.kind === 'rating' && <RatingBoard ask={ask} />}
      {ask.kind === 'suggest' && <SuggestBoard ask={ask} host={host} busy={busy} ended={ended} run={run} api={api} pickId={pickId} onPick={onPick} />}
      {ask.status === 'results' && ask.kind !== 'suggest' && <Whys ask={ask} host={host} />}
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

function ChoiceBoard({ ask, pickId = null, onPick = null, viewFrom = null }) {
  const openViewer = useContext(ViewerContext);
  const open = ['live', 'voting'].includes(ask.status);
  const picking = Boolean(onPick) && (open || ask.status === 'results');
  const current = picking && !open ? pickId || winnerOf(ask) : null;
  const opts = (ask.results && ask.results.options) || [];
  const lead = Math.max(0, ...opts.map((o) => o.count));
  return (
    <div className="brm-choices">
      {(ask.options || []).map((o, i) => {
        const r = opts.find((x) => x.label === o.label) || { count: 0, pct: 0 };
        return (
          <div key={o.label} className={`brm-choice brm-choice--${i % 3}${lead && r.count === lead ? ' is-lead' : ''}${picking ? ' is-pickable' : ''}`} onClick={picking ? cardPick(onPick, o.label) : undefined} title={picking ? `Pick ${o.label}` : undefined}>
            <div className="brm-choice-head">
              <span className="brm-big" aria-hidden="true">{o.label}</span>
              <div className="brm-choice-text">
                <div className="brm-ct"><span className="brm-sr">Choice {o.label}: </span>{o.title}</div>
                {o.detail && <div className="brm-cd">{o.detail}</div>}
                <OpenLink href={o.url} label={`Open ${o.label}`} />
              </div>
            </div>
            <BuildImage imageId={o.imageId} alt={`Choice ${o.label}: ${o.title}`} className="brm-shot brm-shot--opt" onOpen={viewFrom && openViewer ? () => openViewer(ask.askId, o.label, viewFrom) : null} />
            <div className="brm-bar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} /></div>
            <div className="brm-count"><b>{r.count}</b> {r.pct}%</div>
            {picking && <PickButton id={o.label} current={current} onPick={onPick} open={open} />}
          </div>
        );
      })}
    </div>
  );
}

function RatingBoard({ ask }) {
  const rating = (ask.results && ask.results.rating) || { avg: null, count: 0, dist: [0, 0, 0, 0, 0] };
  const max = Math.max(1, ...(rating.dist || []));
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

function SuggestBoard({ ask, host, busy, ended, run, api, pickId = null, onPick = null }) {
  const [said, setSaid] = useState('');
  // Ideas are picked once the room votes on them (voting), or at results.
  const open = ask.status === 'voting';
  const picking = Boolean(onPick) && (open || ask.status === 'results');
  const current = picking && !open ? pickId || winnerOf(ask) : null;
  const all = ask.responses || [];
  const shown = host ? all : all.filter((r) => !r.hidden);
  const counting = ask.status !== 'live';
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
          <li key={r.respId} className={`brm-sug${r.hidden ? ' is-hidden' : ''}${picking && !r.hidden ? ' is-pickable' : ''}`} onClick={picking && !r.hidden ? cardPick(onPick, r.respId) : undefined}>
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

function Whys({ ask, host }) {
  const whys = (ask.results && ask.results.whys) || [];
  if (!whys.length) return null;
  return (
    <div className="brm-whysbox">
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
