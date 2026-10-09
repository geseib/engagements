/**
 * THE POINTS PANEL (talking points T1 and T3): a tab beside Later in the
 * middle column. Claude's talking points, research findings and ideas, held
 * for the host. The room sees none of them until the host shows one on the
 * Stage or puts several to a vote.
 *
 * The ticks are the page's state (BuildRoom), so What's next can hand the one
 * orange button to this panel's action row while points are ticked. With one
 * ticked, Send to Claude leads; with two or more, Put N to a vote leads. While
 * an ask or the opening holds the orange, the row's main button is outline
 * (`leadsRow` is false): one orange on the whole Host screen.
 *
 * SPACE NEVER FIRES THIS ROW (controller ruling): an accidental tick plus Space
 * must do nothing. The main button carries `data-no-space`; Ctrl or Cmd Enter
 * presses it (`data-points-primary`, read by the page's key handler).
 *
 * Untrusted text: a point's words and links came from Claude or a builder's
 * Claude. They are shown as text; a link is shown only when it is http(s).
 */
import React, { useState } from 'react';
import Icon from '../components/Icon';
import ActionRow from './BuildActionRow';
import { W } from './words';
import { safeHref } from './buildHostApi';
import {
  pointsOf, pointGroups, POINT_OPEN, POINT_TAGS, pointNote, pointFrom, POINTS_OPEN_MAX, VOTE_POINTS_MAX,
} from './buildScreens';

const SHOWN_PER_GROUP = 2;

const clockOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

const siteOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
};

/** The active requests' chips: "Claude is researching: …", or the wait for a Claude that is away. */
function RequestChips({ requests, connected, ended, busy, run, api }) {
  // A request that finished with nothing says so, until the host dismisses it.
  const [gone, setGone] = useState(() => new Set());
  const active = requests.filter((r) => ['waiting', 'working'].includes(r.status));
  const empty = requests.filter((r) => r.status === 'done' && r.count === 0 && !gone.has(r.id));
  if (!active.length && !empty.length) return null;
  return (
    <ul className="brm-pchips" aria-label={W.requestsLabel}>
      {empty.map((r) => (
        <li key={r.id} className="brm-pchip is-none" data-status="empty">
          <span className="brm-pchip-t" role="status">{W.nothingFound(r.kind, r.subject)}</span>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setGone((s) => new Set([...s, r.id]))}>{W.hide}</button>
        </li>
      ))}
      {active.map((r) => {
        const who = r.for === 'host' ? 'Claude' : W.claudeOf(r.for);
        const away = r.status === 'waiting' && r.for === 'host' && !connected;
        const text = away
          ? W.requestWaits(r.kind, r.subject)
          : (r.kind === 'ideas' ? W.findingIdeas(r.subject, who) : W.researching(r.subject, who));
        return (
          <li key={r.id} className={`brm-pchip${away ? ' is-away' : ''}`} data-status={r.status}>
            <span className="brm-pchip-t" role="status">{text}</span>
            {!ended && (
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => run(() => api.cancelPointRequest(r.id))}>{W.cancel}</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Sources({ sources }) {
  const links = (sources || []).map((s) => ({ ...s, href: safeHref(s.url) })).filter((s) => s.href);
  if (!links.length) return null;
  return (
    <p className="brm-psrc">
      {links.map((s) => (
        <a key={s.href} className="brm-link" href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`${s.title ? `${s.title} \u00b7 ${siteOf(s.href)}` : siteOf(s.href)} (${W.opensNewTab})`}>
          {s.title ? `${s.title} · ${siteOf(s.href)}` : siteOf(s.href)} {'↗'}
        </a>
      ))}
    </p>
  );
}

function PointRow({ p, on, canTick, onTick, busy, ended, run, api }) {
  const note = pointNote(p);
  return (
    <li className={`brm-point${on ? ' is-ticked' : ''}`} data-kind={p.kind} data-status={p.status}>
      <div className="brm-row brm-gap">
        {canTick && <input type="checkbox" className="brm-qtick" checked={on} onChange={onTick} aria-label={W.tickPoint(p.text)} />}
        <span className={`brm-later-tag brm-ptag brm-ptag--${p.kind}`}>{POINT_TAGS[p.kind] || W.tagTalk}</span>
        <span className="brm-who">{pointFrom(p)} · {clockOf(p.createdAt)}</span>
        {note && <span className="brm-pnote">{note}</span>}
        {!ended && !['sent', 'later', 'voting'].includes(p.status) && (
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger brm-push" disabled={busy} onClick={() => run(() => api.pointAction(p.id, 'remove'))}>{W.remove}</button>
        )}
      </div>
      <div className="brm-idea-text">{p.text}</div>
      <Sources sources={p.sources} />
    </li>
  );
}

export default function BuildPoints({
  room, ticked, setTicked, busy, ended, run, api, leadsRow, askOpen = false, onRequest, onVote,
}) {
  const [open, setOpen] = useState(() => new Set());
  const pts = pointsOf(room);
  if (!pts) return null;
  const groups = pointGroups(room);
  const connected = Boolean(room.agent && room.agent.connected);
  const actionable = new Set(pts.items.filter((p) => POINT_OPEN.includes(p.status)).map((p) => p.id));
  const on = ticked.filter((id) => actionable.has(id));
  const toggle = (id) => setTicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const toggleGroup = (g) => {
    const ids = g.points.filter((p) => actionable.has(p.id)).map((p) => p.id);
    const all = ids.length > 0 && ids.every((id) => on.includes(id));
    setTicked((list) => (all ? list.filter((x) => !ids.includes(x)) : [...new Set([...list, ...ids])]));
  };
  const clear = () => setTicked([]);
  const each = (action) => async () => {
    const ids = on;
    const ok = await run(async () => { for (const id of ids) await api.pointAction(id, action); return true; });
    if (ok !== undefined) clear();
  };
  const send = async () => {
    const ids = on;
    const ok = await run(() => (ids.length === 1 ? api.pointAction(ids[0], 'send') : api.sendPoints(ids)));
    if (ok !== undefined) clear();
  };
  const vote = async () => {
    const ids = on;
    const ok = onVote ? await onVote(ids) : undefined;
    if (ok !== undefined) clear();
  };
  const n = on.length;
  const main = leadsRow ? ' brm-btn--primary' : '';
  // Space never presses these; Ctrl or Cmd Enter does, while the row leads.
  const attrs = { 'data-no-space': true, ...(leadsRow ? { 'data-points-primary': true } : {}) };
  const full = pts.open >= POINTS_OPEN_MAX;

  return (
    <section className="brm-points" aria-label={W.points}>
      {!ended && (
        <div className="brm-row brm-gap brm-ptop">
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy || full} title={full ? W.pointsFull(POINTS_OPEN_MAX) : undefined} onClick={() => onRequest('research')}><Icon name="MagnifyingGlass" size={14} /> {W.research}</button>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy || full} title={full ? W.pointsFull(POINTS_OPEN_MAX) : undefined} onClick={() => onRequest('ideas')}><Icon name="Lightbulb" size={14} /> {W.ideasAsk}</button>
          {full && <span className="brm-hint" role="status">{W.pointsFull(POINTS_OPEN_MAX)}</span>}
        </div>
      )}
      <RequestChips requests={pts.requests} connected={connected} ended={ended} busy={busy} run={run} api={api} />
      {!groups.length && <p className="brm-empty">{W.pointsEmpty}</p>}
      {groups.map((g) => {
        const shownAll = open.has(g.key);
        const list = shownAll ? g.points : g.points.slice(0, SHOWN_PER_GROUP);
        const rest = g.points.length - list.length;
        const ids = g.points.filter((p) => actionable.has(p.id)).map((p) => p.id);
        const allOn = ids.length > 0 && ids.every((id) => on.includes(id));
        return (
          <div className="brm-pgroup" key={g.key} role="group" aria-label={g.heading}>
            <div className="brm-row brm-gap brm-pgroup-h">
              {!ended && ids.length > 0 && <input type="checkbox" className="brm-qtick" checked={allOn} onChange={() => toggleGroup(g)} aria-label={W.tickAll(g.heading)} />}
              <h4 className="brm-pgroup-t">{g.heading}</h4>
              <span className="brm-who brm-push">{g.by} · {clockOf(g.at)}</span>
            </div>
            <ul className="brm-plist">
              {list.map((p) => (
                <PointRow key={p.id} p={p} on={on.includes(p.id)} canTick={!ended && actionable.has(p.id)} onTick={() => toggle(p.id)} busy={busy} ended={ended} run={run} api={api} />
              ))}
            </ul>
            {rest > 0 && (
              <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={() => setOpen((s) => new Set([...s, g.key]))}>{W.moreOf(rest, rest === 1 ? g.noun : `${g.noun}s`)}</button>
            )}
            {shownAll && g.points.length > SHOWN_PER_GROUP && (
              <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={() => setOpen((s) => { const c = new Set(s); c.delete(g.key); return c; })}>{W.fewer}</button>
            )}
          </div>
        );
      })}
      {!ended && n > 0 && (
        <ActionRow space={leadsRow} hint={leadsRow ? `${W.ticked(n)} · ${n === 1 ? W.ctrlEnterSends : W.ctrlEnterVote}` : W.ticked(n)}>
          <button type="button" className="brm-btn brm-btn--ghost" onClick={clear}>{W.clear}</button>
          <button type="button" className="brm-btn" disabled={busy} onClick={each('later')}>{W.saveLater}</button>
          <button
            type="button" className="brm-btn" disabled={busy || n !== 1 || askOpen}
            title={n !== 1 ? W.oneAtATime : askOpen ? W.finishAsk : undefined}
            onClick={each('show')}
          >
            {W.showOnStage}
          </button>
          {n === 1 ? (
            <>
              <button type="button" className="brm-btn" disabled title={W.tickRange}>{W.putToVote(1)}</button>
              <button type="button" className={`brm-btn${main}`} {...attrs} disabled={busy} onClick={send}>{W.sendPlain}</button>
            </>
          ) : (
            <>
              <button type="button" className="brm-btn" disabled={busy} onClick={send}>{W.sendThese(n)}</button>
              <button
                type="button" className={`brm-btn${main}`} {...attrs}
                disabled={busy || n > VOTE_POINTS_MAX}
                title={n > VOTE_POINTS_MAX ? W.voteAtMost(VOTE_POINTS_MAX) : undefined}
                onClick={vote}
              >
                {W.putToVote(n)}
              </button>
            </>
          )}
        </ActionRow>
      )}
    </section>
  );
}
