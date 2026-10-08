/**
 * BETWEEN ASKS (owner, 2026-10-07; docs/design/build-room-host-flow H1, H5
 * and build-room-combine-and-stage P1, P2).
 *
 *   WhatsNext    Claude's line, then the host's moves, most likely first
 *                (whatsNextMoves' rule alone). The lead move's button is the
 *                step's primary: it takes the focus when the lead changes
 *                (useNextFocus, never while the host types) and Space on the
 *                Host screen presses it.
 *   DecidedList  every decided ask, oldest first, with a tick. The ticked ones
 *                combine into one prompt in the Composer, which the host edits
 *                and sends the usual way; a combined row says "In a prompt".
 *
 * The ticks and the "used" times are the page's session state (BuildRoom),
 * never saved, so a refetch of the room keeps them.
 */
import React, { useRef } from 'react';
import Icon from '../components/Icon';
import { whatsNextMoves, claudeState, combineLine, METHOD_WORDS } from './buildScreens';
import { useNextFocus } from './useNextFocus';

const MOVE_ICON = { 'vote-mockups': 'Image', starter: 'Question', 'new-ask': 'Plus', tell: 'ChatCircleText' };

const clockOf = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const askNo = (askId) => Number(askId) || askId;
const upFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Every decided ask, oldest first. */
export function decidedAsks(asks) {
  return (asks || []).filter((a) => a && a.status === 'decided' && a.decision)
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
}

/** The answer alone: combineLine without the question in front, else the direction. */
export function decidedAnswer(ask) {
  const prompt = String(ask.prompt || '').trim();
  const line = combineLine(ask);
  if (prompt && line.startsWith(prompt) && line.length > prompt.length) {
    return line.slice(prompt.length).replace(/^[:\s]+/, '').trim();
  }
  return String((ask.decision && ask.decision.direction) || '').trim();
}

export function WhatsNext({ room, now, ticked, onMove, continueOn = false }) {
  const ref = useRef(null);
  const moves = whatsNextMoves(room, { ticked: ticked ? ticked.size : 0 });
  const lead = moves[0];
  useNextFocus(ref, lead ? lead.key : '');
  const st = claudeState(room, now, { host: true, continueOn });
  return (
    <div className="brm-wnext" ref={ref}>
      <div className="brm-claudeline" data-state={st.key}>
        <span className={`brm-cdot brm-cdot--${st.key}`} aria-hidden="true" />
        <b>{st.headline}</b>
        {st.line && <span className="brm-claudeline-t">{st.line}</span>}
      </div>
      <div className="brm-row brm-gap">
        <h3 className="brm-h5" id="brm-wnext-h">What&apos;s next</h3>
        <span className="brm-spacehint"><kbd>Space</kbd> does the first</span>
      </div>
      <ul className="brm-wnlist" aria-labelledby="brm-wnext-h">
        {moves.map((m, i) => (
          <li key={m.key} className={`brm-wn${i === 0 ? ' is-lead' : ''}`}>
            <span className="brm-wn-ic" aria-hidden="true">
              {m.count ? m.count : <Icon name={MOVE_ICON[m.key] || 'Plus'} size={18} />}
            </span>
            <span className="brm-wn-t">
              <b>{m.title}</b>
              <span>{m.hint}</span>
            </span>
            <button
              type="button"
              className={`brm-btn brm-btn--sm${i === 0 ? ' brm-btn--primary' : ''}`}
              data-next-primary={i === 0 ? true : undefined}
              onClick={() => onMove(m.key)}
            >
              {m.button}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DecidedList({ asks, ticked, setTicked, used = {}, onCombine, ended = false }) {
  const rows = decidedAsks(asks);
  const live = rows.filter((a) => ticked.has(a.askId));
  const toggle = (id) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setTicked(next);
  };
  if (!rows.length) return <p className="brm-empty">Nothing decided yet. Each answer the room settles lands here, ready to combine into one prompt.</p>;
  return (
    <div className="brm-decided">
      <ul className="brm-declist">
        {rows.map((a) => {
          const on = ticked.has(a.askId);
          const method = a.decision.method && METHOD_WORDS[a.decision.method];
          const how = used[a.askId] ? `In a prompt · ${clockOf(used[a.askId])}` : upFirst(method || '');
          return (
            // The whole row ticks; the checkbox stays the accessible control.
            <li key={a.askId} className={`brm-dec${on ? ' is-ticked' : ''}${ended ? '' : ' is-pick'}`} onClick={ended ? undefined : (e) => { if (e.target.tagName !== 'INPUT') toggle(a.askId); }}>
              {!ended && (
                <input type="checkbox" className="brm-qtick" checked={on} onChange={() => toggle(a.askId)} aria-label={a.prompt} />
              )}
              <div className="brm-dec-t">
                <p className="brm-dec-q">Ask {askNo(a.askId)} · {a.prompt}</p>
                <p className="brm-dec-a">{decidedAnswer(a)}</p>
                {how && <p className="brm-dec-how">{how}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {!ended && live.length > 0 && (
        <div className="brm-qbulk" role="group" aria-label="Ticked answers">
          <b>{live.length} ticked</b>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" onClick={onCombine}>Add to the prompt</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-push" onClick={() => setTicked(new Set())}>Clear</button>
        </div>
      )}
    </div>
  );
}
