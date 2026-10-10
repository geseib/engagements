/**
 * THE BUILD ROOM'S SESSION PANEL (docs/design/build-room-sidebar, S1-S6).
 *
 * The same side panel the other engagements open from SESSION or the backslash
 * key (components/stage/SessionSetupPanel.jsx), with two tabs and no more:
 *
 *   Players   everyone in the room, one list shared with the other engagements
 *             (components/stage/PlayersList.jsx): Unlock name / Let them take
 *             it, Lock again, Not now, Remove, Bring back. Only the right-hand
 *             column differs: ideas sent here, a lane for a builder.
 *   Settings  everything that used to hide in the header's three-dot menu, in
 *             four groups that answer one question each, in the order a host
 *             meets them: The room, Claude, Crew, This session. End session is
 *             last and alone.
 *
 * It holds nothing of its own but which tab is up. The page owns the roster
 * (useBuildPlayers) and every action; this draws them. A button that opens a
 * dialog (Connect Claude Code, Wrap up, End session...) puts the panel away
 * first, so one thing is in front of the host at a time.
 *
 * ROOM SAFETY. The panel carries names, so it is only ever opened by the host,
 * and the screens the room sees never show it closed: they show a count (the
 * SESSION button, the pill) and nothing that names a person. The request strip
 * (HandoverStrip) names the person, and renders on the Host screen only.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import PlayersList from '../components/stage/PlayersList';
import { copyText } from '../utils/copyText';
import { RunCrewCodeSwitch } from './BuildCrew';
import { WifiPanel } from './BuildWifiShare';
import { askingOf } from './useBuildPlayers';
import { W } from './words';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const plural = (n, one, many) => (n === 1 ? one : many);

/** "2:31", in the host's own clock. Empty for a missing or unreadable time. */
export function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
}

/** The builders still on the crew, by name, with the task each is on. */
function crewMap(crew) {
  const out = new Map();
  if (!crew || !crew.enabled) return out;
  const tasks = new Map((crew.tasks || []).map((t) => [t.taskId, t.text]));
  (crew.builders || []).filter((b) => !b.closed).forEach((b) => out.set(b.name, { lane: b.taskId ? tasks.get(b.taskId) || '' : '' }));
  return out;
}

/** Ideas the room sent, per person (the host's own queued ones are nobody's). */
function ideaCounts(room) {
  const out = new Map();
  (room.ideas || []).forEach((i) => {
    if (!i.playerName || i.source === 'host') return;
    out.set(i.playerName, (out.get(i.playerName) || 0) + 1);
  });
  return out;
}

/**
 * The roster as PlayersList draws it. `rank` carries the here or away dot, so
 * the shared list needs no column of its own for it.
 */
export function rosterOf(room, roster) {
  const builders = crewMap(room.crew);
  const ideas = ideaCounts(room);
  const rows = (roster.players || []).map((p) => {
    const name = p.playerName || p.name || '';
    const handover = p.handover || {};
    const here = Boolean(p.isConnected);
    const b = builders.get(name);
    return {
      name,
      rank: <span className={`brm-sp-dot${here ? '' : ' is-away'}`} aria-hidden="true" />,
      done: null,
      handoverRequested: Boolean(handover.requested),
      handoverOpen: Boolean(handover.open),
      here,
      builder: Boolean(b),
      lane: b ? b.lane : '',
      joinedAt: p.joinedAt || null,
      ideas: ideas.get(name) || 0,
    };
  }).filter((r) => r.name);
  const departed = (roster.removed || []).map((p) => ({
    name: p.playerName || p.name || '',
    removedAt: p.removedAt || null,
    ideas: ideas.get(p.playerName || p.name || '') || 0,
  })).filter((r) => r.name).sort((a, b) => a.name.localeCompare(b.name));
  const here = rows.filter((r) => r.here).length;
  const nb = rows.filter((r) => r.builder).length;
  const summary = [`${here} here`, `${rows.length - here} away`, ...(nb ? [`${nb} ${plural(nb, 'builder', 'builders')}`] : [])].join(' · ');
  return { rows, departed, summary };
}

const ideasText = (n) => `${n} ${plural(n, 'idea', 'ideas')}`;

/* ------------------------------------------------------------------ strip -- */

/**
 * THE REQUEST STRIP (S6a): somebody on another device is asking to take a name.
 * Host screen only; it names the person, which the screens the room sees never
 * do. Let them take it is filled and never orange (the screen's lead move keeps
 * the orange); Space never answers it.
 */
export function HandoverStrip({ asking, busy, onGrant, onRefuse, onSee }) {
  if (!asking.length) return null;
  const one = asking.length === 1 ? asking[0] : null;
  const name = one ? (one.playerName || one.name) : '';
  const joined = one ? timeOf(one.joinedAt) : '';
  return (
    <section className="brm-strip" role="region" aria-label="Someone is asking to take a name" data-testid="brm-handover-strip">
      <span className="brm-strip-i" aria-hidden="true">!</span>
      <div className="brm-strip-t">
        {one ? (
          <>
            <b>{W.wantsName} <span className="brm-strip-name">{name}</span></b>
            <p title={W.tipHandover(name)}>
              {`${name} is ${one.isConnected ? 'here now' : 'away'}${joined ? ` \u00b7 joined ${joined}` : ''}`}
            </p>
          </>
        ) : (
          <b>{W.nPeopleAsking(asking.length)}</b>
        )}
      </div>
      <div className="brm-strip-acts">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={onSee}>{W.seeInPlayers}</button>
        {one && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => onRefuse(name)}>{W.notNow}</button>}
        {one && <button type="button" className="brm-btn brm-btn--sm brm-btn--solid" disabled={busy} onClick={() => onGrant(name)}>{W.letThemTakeIt}</button>}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- switch -- */

function Switch({ label, checked, onChange, disabled = false, note = '', tag = '' }) {
  return (
    <div className="brm-sp-switch">
      <label className={`brm-auto${checked ? ' is-on' : ''}`}>
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="brm-sp-lab">{label}</span>
        {tag && <span className="brm-sp-new">{tag}</span>}
      </label>
      {note && <p className="brm-hint brm-sp-note">{note}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ panel -- */

export default function BuildSessionPanel({
  room, now, ended, busy, run, api, connected = true,
  roster, reloadPlayers,
  tab, onTab, focusGroup = '', onClose,
  topLine = null, slots = {},
  listNames, onListNames,
  onConnect, onUpdatePlugin, onCrew, onWrap, onReport, onEnd, onShowQr, onWifiWall, wifiLink = '',
}) {
  const panelRef = useRef(null);
  const rootRef = useRef(null);
  const openerRef = useRef(null);
  const crew = room.crew && room.crew.enabled ? room.crew : null;
  const { rows, departed, summary } = useMemo(() => rosterOf(room, roster), [room, roster]);
  const asking = askingOf(roster.players);
  const [copied, setCopied] = useState('');

  // Where focus came from, so it can go back (a keyboard host who opens this
  // and closes it must not be dropped at the top of the page).
  useEffect(() => {
    openerRef.current = document.activeElement;
    const el = panelRef.current;
    if (el && typeof el.focus === 'function') el.focus();
    return () => {
      const o = openerRef.current;
      if (o && typeof o.focus === 'function' && document.contains(o)) o.focus();
    };
  }, []);

  // The roster is read afresh each time the panel opens.
  useEffect(() => { reloadPlayers(); }, [reloadPlayers]);

  // Esc and backslash both close, because backslash is what opened it. A
  // dialog opened from here is on top of it: leave the key to that dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' && e.key !== '\\') return;
      if (e.key === '\\' && (e.metaKey || e.ctrlKey || e.repeat)) return;
      const t = e.target;
      if (e.key === '\\' && t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const others = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], .brm-modal')).filter((d) => d !== panelRef.current);
      if (others.length) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // It starts below the header and stops above the Stage's dock, so Main menu,
  // the screens and SESSION itself stay in reach while it is open.
  useLayoutEffect(() => {
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      const hdr = document.querySelector('.brm-hbar');
      const dock = document.querySelector('.dock');
      const top = hdr ? Math.max(0, Math.round(hdr.getBoundingClientRect().bottom)) : 0;
      const bottom = dock ? Math.max(0, Math.round(window.innerHeight - dock.getBoundingClientRect().top)) : 0;
      el.style.setProperty('--brm-sp-top', `${top}px`);
      el.style.setProperty('--brm-sp-bottom', `${bottom}px`);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [tab, topLine]);

  // Settings opened at a group (the Wi-Fi chip, Claude's status): bring it into view.
  useEffect(() => {
    if (tab !== 'settings' || !focusGroup) return;
    const g = panelRef.current && panelRef.current.querySelector(`[data-group="${focusGroup}"]`);
    if (g && typeof g.scrollIntoView === 'function') g.scrollIntoView({ block: 'start' });
  }, [tab, focusGroup]);

  const trapFocus = (e) => {
    if (e.key !== 'Tab') return;
    const el = panelRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // Every roster action: one at a time on the page, the server's sentence on
  // failure, then both the room and the roster read again.
  const act = (fn) => run(async () => { await fn(); await reloadPlayers(); });
  const builderNames = new Set(rows.filter((r) => r.builder).map((r) => r.name));
  const players = {
    onUnlock: (name) => act(() => api.playerHandover(name, { bindToRequester: false })),
    onGrant: (name, requested) => act(() => api.playerHandover(name, { bindToRequester: Boolean(requested) })),
    onLock: (name) => act(() => api.playerHandover(name, { lock: true })),
    onRefuse: (name) => act(() => api.playerHandover(name, { refuse: true })),
    // A builder's Remove is one action: the seat closes, their Claude is
    // unlinked, the person leaves the counts. Bring back is the generic restore.
    onRemove: (name) => act(() => (builderNames.has(name) ? api.removeBuilder(name) : api.playerRemoved(name, true))),
    onRestore: (name) => act(() => api.playerRemoved(name, false)),
  };

  const pick = (fn) => () => { onClose(); fn(); };
  const playUrl = `${window.location.origin}/play?gameId=${room.gameId}`;
  const copyLink = async () => {
    const ok = await copyText(playUrl);
    setCopied(ok ? 'Copied' : 'Press and hold to copy');
    setTimeout(() => setCopied(''), 2500);
  };
  const opening = room.opening && room.opening.phase === 'building';

  // Arrow keys, Home and End move between the tabs (the tabs pattern); the selected one is the tab stop.
  const tabKeys = (e) => {
    const ids = ['players', 'settings'];
    const at = ids.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight') next = ids[(at + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(at + ids.length - 1) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (!next) return;
    e.preventDefault();
    onTab(next);
    const el = document.getElementById(`brm-sp-tab-${next}`);
    if (el) el.focus();
  };

  const tabs = [
    { id: 'players', label: W.players, count: rows.length, flag: asking.length ? `${asking.length} asking` : '' },
    { id: 'settings', label: W.settings },
  ];

  return (
    <div className="brm-sp-root" ref={rootRef}>
      <div className="brm-sp-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="brm-sp" ref={panelRef} role="dialog" aria-modal="true" aria-label="Session" tabIndex={-1} onKeyDown={trapFocus}>
        <div className="brm-sp-head">
          <h2 className="brm-sp-title">Session</h2>
          <span className={`brm-sp-ws${connected ? ' is-up' : ''}`} aria-live="polite">{connected ? 'Connected' : 'Connecting…'}</span>
          <button type="button" className="brm-sp-x" aria-label="Close the session panel" onClick={onClose}><Icon name="X" size={16} /></button>
        </div>

        {topLine && <div className="brm-sp-top" data-testid="brm-sp-top">{topLine}</div>}

        <div className="brm-sp-tabs" role="tablist" aria-label="Session sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`brm-sp-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={tab === t.id ? `brm-sp-pane-${t.id}` : undefined}
              tabIndex={tab === t.id ? 0 : -1}
              onKeyDown={tabKeys}
              className={`brm-sp-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => onTab(t.id)}
            >
              {t.label}
              {t.count !== undefined && <b className="brm-sp-c">{t.count}</b>}
              {t.flag && <span className="brm-sp-flag">{`· ${t.flag}`}</span>}
            </button>
          ))}
        </div>

        <div className="brm-sp-body">
          {tab === 'players' && (
            <section id="brm-sp-pane-players" role="tabpanel" aria-labelledby="brm-sp-tab-players" className="brm-sp-pane">
              <PlayersList
                rows={rows}
                departed={departed}
                sortBy="name"
                askingFirst
                searchAfter={12}
                filters={[
                  { id: 'here', label: 'Here', test: (r) => r.here },
                  { id: 'away', label: 'Away', test: (r) => !r.here },
                  { id: 'builders', label: 'Builders', test: (r) => r.builder },
                ]}
                countLabel={(n) => `${n} in the room`}
                summary={summary}
                departedNote={W.departedNote}
                emptyText="Nobody has joined yet."
                renderBadge={(r) => (r.builder ? <span className="brm-chip brm-chip--live brm-sp-tag">Builder</span> : null)}
                renderMeta={(r, gone) => (gone
                  ? [`Removed${r.removedAt ? ` ${timeOf(r.removedAt)}` : ''}`, ideasText(r.ideas)].join(' · ')
                  : [r.here ? 'Here' : 'Away', r.joinedAt ? `joined ${timeOf(r.joinedAt)}` : '', ideasText(r.ideas), r.lane ? `on ${r.lane}` : ''].filter(Boolean).join(' · '))}
                {...players}
              />
            </section>
          )}

          {tab === 'settings' && (
            <section id="brm-sp-pane-settings" role="tabpanel" aria-labelledby="brm-sp-tab-settings" className="brm-sp-pane">
              <div className="brm-sp-grp" data-group="room">
                <div className="brm-sp-gh"><h3>The room</h3></div>
                <div className="brm-sp-row">
                  <span className="brm-code" aria-label={`Join code ${room.gameId}`}>{room.gameId}</span>
                  <span className="brm-hint">{`${window.location.host}/play · ${room.playerCount || 0} joined`}</span>
                </div>
                <div className="brm-sp-row">
                  <button type="button" className="brm-btn brm-btn--sm" onClick={copyLink}>Copy join link</button>
                  <button type="button" className="brm-btn brm-btn--sm" onClick={pick(onShowQr)}>Show the QR on the wall</button>
                  {copied && <span className="brm-hint" role="status">{copied}</span>}
                </div>
                {!ended && (
                  <WifiPanel
                    inline
                    lan={room.lan}
                    link={wifiLink}
                    now={now}
                    busy={busy}
                    run={run}
                    api={api}
                    onClose={onClose}
                    onShowWall={pick(onWifiWall)}
                  />
                )}
                <Switch
                  label="List names on the room meter"
                  tag="new"
                  checked={Boolean(listNames)}
                  onChange={onListNames}
                  note={W.roomMeterNote}
                />
              </div>

              <div className="brm-sp-grp" data-group="claude">
                <div className="brm-sp-gh"><h3>Claude</h3></div>
                <div className="brm-sp-row">
                  {slots.agentChip}
                  {!ended && (
                    <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={pick(onConnect)}>
                      <Icon name="Lock" size={14} /> Connect Claude Code
                    </button>
                  )}
                </div>
                {/* The plugin is older than the current one: one line, here only (never the Stage or a device). */}
                {!ended && room.plugin && room.plugin.outdated && (
                  <p className="brm-hint brm-sp-note" data-testid="brm-plugin-out">
                    {W.pluginOutdated}{' '}
                    <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={pick(onUpdatePlugin)}>{W.pluginUpdate}</button>
                  </p>
                )}
                {!ended && slots.autoSwitch}
                {!ended && <p className="brm-hint brm-sp-note">{W.autoNote}</p>}
              </div>

              <div className="brm-sp-grp" data-group="crew">
                <div className="brm-sp-gh"><h3>Crew</h3></div>
                {crew ? (
                  <>
                    <div className="brm-sp-row">
                      <span className="brm-sp-lab">{`${(crew.builders || []).filter((b) => !b.closed).length} ${plural((crew.builders || []).filter((b) => !b.closed).length, 'builder', 'builders')}`}</span>
                      <span className="brm-hint">{(crew.builders || []).filter((b) => !b.closed).map((b) => b.name).join(', ')}</span>
                      {!ended && <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={pick(onCrew)}>Crew</button>}
                    </div>
                    {!ended && <RunCrewCodeSwitch crew={crew} busy={busy} run={run} api={api} />}
                  </>
                ) : (
                  <>
                    <p className="brm-hint brm-sp-note">{W.crewNote}</p>
                    {!ended && <div className="brm-sp-row"><button type="button" className="brm-btn brm-btn--sm" onClick={pick(onCrew)}>Open to a crew</button></div>}
                  </>
                )}
              </div>

              <div className="brm-sp-grp" data-group="session">
                <div className="brm-sp-gh"><h3>This session</h3><span>Going back, finishing, stopping</span></div>
                {!ended && opening && (
                  <div className="brm-sp-row">
                    <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={pick(() => run(() => api.openingAction('resume', {})))}>Back to the opening</button>
                    <span className="brm-hint">{W.startUndoNote}</span>
                  </div>
                )}
                <div className="brm-sp-row">
                  <button type="button" className="brm-btn brm-btn--sm" onClick={pick(onWrap)}>Wrap up</button>
                  <button type="button" className="brm-btn brm-btn--sm" onClick={pick(onReport)}><Icon name="FileText" size={14} /> Report</button>
                </div>
                {!ended && (
                  <div className="brm-sp-row brm-sp-end">
                    <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" onClick={pick(onEnd)}>End session</button>
                    <span className="brm-hint">{W.endsForAll}</span>
                  </div>
                )}
              </div>

              <p className="brm-hint brm-sp-keys">
                <kbd>1</kbd>{'–'}<kbd>4</kbd> screens {'·'} <kbd>P</kbd> Host and back {'·'} <kbd>Space</kbd> the lead move {'·'} <kbd>\</kbd> this panel {'·'} <kbd>Esc</kbd> close
              </p>
            </section>
          )}
        </div>

        <div className="brm-sp-foot">
          <span className="brm-hint"><kbd>\</kbd> opens and closes this panel</span>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={onClose}>Close</button>
        </div>
      </aside>
    </div>
  );
}
