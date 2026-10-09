/**
 * THE LATER LIST (batch 2-3, B4): one list on the Host screen for everything
 * held back. Room ideas the host saved and directions held for Claude are two
 * kinds of item in one list, newest first, each with the same three moves.
 * Claude hears nothing from it until the host sends an item; the Stage never
 * shows it; History shows an item only once it has left.
 *
 * The ticks are the page's state (BuildRoomPage), so What's next can lead with
 * "Put N from Later to a vote" while two to six are ticked.
 */
import React from 'react';
import Icon from '../components/Icon';
import { W } from './words';
import { laterItems, VOTE_IDEAS_MAX } from './buildScreens';

const clockOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

export default function BuildLater({ room, ticked, setTicked, busy, ended, run, api, onVote, onAskRoom }) {
  const items = laterItems(room);
  if (!items.length) return null;
  const live = new Set(items.map((x) => x.key));
  const on = ticked.filter((k) => live.has(k));
  const toggle = (k) => setTicked((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const later = ((room.brief || {}).later || []);

  const remove = (x) => run(() => (x.type === 'idea'
    ? api.ideaAction(x.id, 'dismiss')
    : api.editBrief({ later: later.filter((i) => i.id !== x.id).map(({ id, text }) => ({ id, text })) })));
  const send = (x) => run(() => (x.type === 'idea' ? api.ideaAction(x.id, 'direct') : api.sendLater(x.id)));

  return (
    <section className="brm-later" aria-label={W.later}>
      <h3 className="brm-h5">{W.later} · {items.length} <span className="brm-hint">{W.laterNote}</span></h3>
      {!ended && on.length > 0 && (
        <div className="brm-qbulk" role="group" aria-label="Ticked in Later">
          <b>{on.length} ticked</b>
          <button
            type="button" className="brm-btn brm-btn--sm"
            disabled={busy || on.length < 2 || on.length > VOTE_IDEAS_MAX}
            title={on.length < 2 ? 'Tick at least 2' : on.length > VOTE_IDEAS_MAX ? 'A vote takes at most 6' : undefined}
            onClick={() => onVote(items.filter((x) => on.includes(x.key)))}
          >
            {W.putToVote(on.length)}
          </button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-push" onClick={() => setTicked([])}>Clear</button>
        </div>
      )}
      {items.map((x) => (
        <div className={`brm-idea brm-later-item${on.includes(x.key) ? ' is-ticked' : ''}`} key={x.key} data-kind={x.type}>
          <div className="brm-row brm-gap">
            {!ended && <input type="checkbox" className="brm-qtick" checked={on.includes(x.key)} onChange={() => toggle(x.key)} aria-label={`Tick: ${x.text}`} />}
            <span className={`brm-later-tag brm-later-tag--${x.type}`}>{x.tag}</span>
            <span className="brm-who">{x.from}{x.at ? ` · ${clockOf(x.at)}` : ''}</span>
          </div>
          <div className="brm-idea-text">{x.text}</div>
          {!ended && (
            <div className="brm-idea-acts brm-later-acts">
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => remove(x)}>{W.remove}</button>
              <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={() => onAskRoom(x.text)}>{W.askRoom}</button>
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Claude gets it now, as Do now" onClick={() => send(x)}>
                <Icon name="PaperPlaneTilt" size={14} /> {W.sendNow}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
