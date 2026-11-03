/**
 * THE BUILD ROOM'S SESSION MENU (docs/design/build-room-sidebar, S1-S6;
 * experience plan 2e, §3.2a, §3.2b: "same + Build settings").
 *
 * The Session menu every format opens from the top bar's labelled button, top
 * right, or the backslash key (components/stage/SessionSetupPanel.jsx), named
 * and closed in the same words (config/hostWords.js). On the two-screen
 * console it opens as a sheet over the content area (HostConsole's sheet
 * host), never over Your part now or the Needs-you line.
 *
 * THE SAME NAMES AS EVERY FORMAT (docs/design/session-menu D10, approved 3
 * Nov 2026, with People in every version):
 *
 *   Claude        the chip, Connect Claude Code, the Continue prompt, the auto
 *                 switch, the posts gate; More: plugin version, the crew,
 *                 Back to the opening.
 *   Asks so far   the report first, Wrap up, the history.
 *   People        everyone, in the rail's person row, and who left.
 *   Screens       where the room watches, the room's window; More: size, New
 *                 link, Look here privately, the keys.
 *   Joining       the codes and the demo; More: names on the room meter.
 *
 * End session and Main menu are the foot, in every section; the X closes it.
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
import HelpButton from '../components/HelpButton';
import HW from '../config/hostWords';
import { helpFor } from '../config/help/screens';
import PersonRow, { PERSON_WORDS } from '../components/people/PersonRow';
import MoreOptions from '../components/stage/MoreOptions';
import { NEEDS_ACTIONS } from '../config/needsYou';
import '../components/stage/SessionMenu.css';
import { copyText } from '../utils/copyText';
import { RunCrewCodeSwitch } from './BuildCrew';
import { CodeBox, DemoTile, AppList, QuietWarning, demoSlotOf, demoOnStage } from './BuildWifiShare';
import { askingOf } from './useBuildPlayers';
import { W } from './words';
import { DISPLAY_PROFILES, ScreenChoiceRow, RoomWindowRow } from '../components/stage/ScreensGroup';
import { SCREEN_WORDS, screenWordsFor } from '../config/roomScreen';
import { presentHref } from '../config/surfaces';
import Button from '../components/ui/Button';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const plural = (n, one, many) => (n === 1 ? one : many);

/** "2:31", in the host's own clock. Empty for a missing or unreadable time. */
/** Settings > Claude: which plugin Claude runs and whether it is the latest. Here only, never a room screen. */
function PluginVersion({ plugin }) {
  const latest = plugin.latest || '';
  // Connected, but too old to say its version (before the header): older than the latest.
  if (!plugin.running && plugin.outdated) {
    return <p className="brm-hint brm-sp-note brm-ver" data-testid="brm-plugin-ver"><span><span className="brm-ver-k">{W.pluginRunning}</span> <b className="brm-ver-old">{W.pluginOlder(latest)}</b></span></p>;
  }
  if (!plugin.running) return <p className="brm-hint brm-sp-note" data-testid="brm-plugin-ver">{W.pluginUnknown}</p>;
  return (
    <p className="brm-hint brm-sp-note brm-ver" data-testid="brm-plugin-ver">
      <span><span className="brm-ver-k">{W.pluginRunning}</span> <b className={plugin.outdated ? 'brm-ver-old' : ''}>{plugin.running}</b></span>
      {plugin.outdated
        ? <span><span className="brm-ver-k">{W.pluginLatest}</span> <b>{latest}</b></span>
        : <span className="brm-ver-ok">{W.pluginCurrent}</span>}
    </p>
  );
}

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
 * The roster rows the People section hands to PersonRow. `rank` carries the
 * here or away dot, so the row needs no column of its own for it.
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
            <p>
              {`${name} is ${one.isConnected ? 'here now' : 'away'}${joined ? ` \u00b7 joined ${joined}` : ''}`}
            </p>
          </>
        ) : (
          <b>{W.nPeopleAsking(asking.length)}</b>
        )}
      </div>
      <div className="brm-strip-acts">
        <Button type="button" size={36} className="brm-tight" onClick={onSee}>{W.seeInPlayers}</Button>
        {one && <Button type="button" size={36} className="brm-tight" disabled={busy} title={W.tipHandoverNotNow(name)} onClick={() => onRefuse(name)}>{W.notNow}</Button>}
        {one && <Button type="button" size={36} className="brm-tight" disabled={busy} title={W.tipTakeIt} onClick={() => onGrant(name)}>{W.letThemTakeIt}</Button>}
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

/* ------------------------------------------------------------- the codes -- */

/**
 * WHICH ORANGE (two codes, owner 2026-10-11): the room group has one, the move
 * that matters most in the Demo tile's state. Share demo and Try again are
 * inside the tile; Stop sharing leads when nobody can reach it; otherwise the
 * Stage button does.
 */
const STAGE_LEADS = new Set(['none', 'starting', 'waiting', 'on']);

/**
 * THE ROOM'S TWO CODES (docs/design/build-room-two-qr, C): Join always, the
 * demo beside it, then the one button that puts them on the Stage. Two tiles
 * side by side at laptop width (232px codes), frameless under 420px of panel,
 * stacked under 330px, so no code is ever under 160px (BuildRoom.css). Ended:
 * Join only, nothing to press.
 */
export function RoomCodes({ room, now, ended, busy, run, api, wifiLink = '', onShowCodes }) {
  const [copied, setCopied] = useState('');
  const playUrl = `${window.location.origin}/play?gameId=${room.gameId}`;
  const here = room.playerCount || 0;
  const st = ended ? 'ended' : demoSlotOf(room, now);
  const both = !ended && demoOnStage(room, now, wifiLink);
  const lan = room.lan || {};
  const open = Number(lan.open) || 0;
  const copyLink = async () => {
    const ok = await copyText(playUrl);
    setCopied(ok ? 'Copied' : 'Press and hold to copy');
    setTimeout(() => setCopied(''), 2500);
  };
  const stageLeads = STAGE_LEADS.has(st);
  return (
    <>
      <div className="brm-codes">
        <div className="brm-codes-tile" data-testid="brm-join-tile">
          <CodeBox value={playUrl} label={`QR code to join at ${playUrl}`} />
          <h4 className="brm-codes-h">{W.codesJoin}<span>{W.codesAnyNetwork}</span></h4>
          <span className="brm-codes-u">{`${window.location.host}/play`}</span>
          <p className="brm-codes-m">
            Code <b className="brm-codes-code" aria-label={`Join code ${room.gameId}`}>{room.gameId}</b>{` \u00b7 ${here} joined`}
          </p>
          {!ended && (
            <div className="brm-codes-acts">
              <Button type="button" size={36} className="brm-tight" onClick={copyLink}>Copy join link</Button>
              {copied && <span className="brm-hint" role="status">{copied}</span>}
            </div>
          )}
        </div>
        {!ended && <DemoTile room={room} now={now} link={wifiLink} here={here} busy={busy} run={run} api={api} />}
      </div>
      {st === 'on' && both && open < here && <p className="brm-hint brm-sp-note">{W.shareNotAll(open, here)}</p>}
      {st === 'quiet' && <QuietWarning />}
      {(st === 'on' || st === 'quiet') && <AppList map={lan.map || []} />}
      {!ended && (
        <div className="brm-sp-row">
          <Button type="button" variant={stageLeads ? 'primary' : 'secondary'} size={36} className="brm-ctl" onClick={onShowCodes}>
            {both ? W.showBothOnStage : W.shareShowOnStage}
          </Button>
          {(st === 'starting' || st === 'waiting') && <span className="brm-hint">{W.demoJoinsWhenLive}</span>}
          {st === 'quiet' && (
            <Button type="button" variant="primary" size={36} className="brm-ctl brm-push" disabled={busy} onClick={() => run(() => api.share({ on: false }))}>{W.stopSharing}</Button>
          )}
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- screens -- */

/** How long the armed New link waits for its second press (standards §3). */
export const ARM_MS = 6000;

/**
 * SCREENS (parity PLAN §2.7, B9 in part; standards §4: first, Applies now).
 * The room's window: its link (with the session's wall key, so it opens on
 * the other display where Chrome can place it), whether it is really up (the
 * server's `presenting` and `presentDetail`, config/presentStatus.js), and
 * the room screen size, which the server holds (`wall.profile`) so every
 * window draws the same. New link retires every open window's link: it asks
 * in place first, the second press within 6 s goes ahead. The parts are the
 * shared Screens group's (ScreenChoiceRow, RoomWindowRow, the profiles), so
 * Where the room watches, the window's state, Open as a tab and the line for
 * a laptop with no second display read as Call & Answer's do (B9, 19 Oct).
 * The window's row is drawn whichever is chosen: it is never taken away.
 */
export function WallScreens({ room, busy, run, api, ended, choice = null, onChoose = null, extra = null, sizeInMore = false }) {
  const [armed, setArmed] = useState(false);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const key = room.wallKey || '';
  const href = key ? presentHref(room.gameId, { type: 'build', k: key }) : '';
  const detail = Number(room.presenting) > 0 ? room.presentDetail : null;
  const profile = (room.wall && room.wall.profile) || 'room';
  const rotate = async () => {
    if (!armed) { setArmed(true); setSaid(''); return; }
    setArmed(false);
    const out = await run(() => api.wall({ rotate: true }));
    if (out !== undefined) setSaid(W.wallNewLinkDone);
  };
  /* The size and New link: the menu draws them in Screens · More options. */
  const tuning = (
    <>
        <div className="scr-row">
          <div className="scr-k">
            <label className="scr-label" htmlFor="brm-wall-size">{SCREEN_WORDS.size}</label>
            <span className="scr-hint">{SCREEN_WORDS.sizeHint}</span>
          </div>
          <select id="brm-wall-size" className="scr-select" value={profile} disabled={busy} onChange={(e) => run(() => api.wall({ profile: e.target.value }))}>
            {DISPLAY_PROFILES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {href && !ended && (
          <div className="scr-row">
            <div className="scr-k">
              <span className="scr-label">{W.wallNewLinkLabel}</span>
              <span className="scr-hint" role={armed || said ? 'status' : undefined}>{armed ? W.wallNewLinkWhy : (said || W.wallNewLinkHint)}</span>
            </div>
            <Button type="button" size={36} className="brm-tight brm-push" disabled={busy} onClick={rotate}>{armed ? W.wallNewLinkArmed : W.wallNewLink}</Button>
          </div>
        )}
    </>
  );
  return (
    <div className="brm-sp-grp" data-group="screens" data-capability="screens">
      <div className="brm-sp-gh"><h3>{W.screensGroup}</h3><span>{W.screensScope}</span></div>
      <div className="scr">
        {/* One screen or two (parity PLAN §2.7, B9): the same choice and the same
            stored value as Call & Answer's, and the Host screen's first question. */}
        {typeof onChoose === 'function' && href && (
          <ScreenChoiceRow choice={choice === 'two' ? 'two' : 'classic'} onChoose={onChoose} words={screenWordsFor('build')} />
        )}
        <RoomWindowRow href={href} detail={detail} linkProps={{ title: W.wallOpenHint, 'data-capability': 'room-window' }} />
        {href && <p className="scr-hint brm-sp-note">{W.wallFollows}</p>}
        {sizeInMore ? null : tuning}
      </div>
      {typeof extra === 'function' ? extra(tuning) : extra}
    </div>
  );
}

/* ------------------------------------------------------------------ panel -- */

/* ------------------------------------------------------------------ panel -- */

/**
 * THE BUILD ROOM'S SECTIONS (docs/design/session-menu D10, with the owner's
 * one change: People in every version). The same names as every other
 * format's menu: Claude · Asks so far · People · Screens · Joining.
 */
export const BUILD_MENU_TABS = Object.freeze([
  { id: 'claude', label: 'Claude' },
  { id: 'asks', label: 'Asks so far' },
  { id: 'people', label: 'People' },
  { id: 'screens', label: 'Screens' },
  { id: 'joining', label: 'Joining' },
]);

/* The old ids, still asked for (the rail's links, the request strip's See in
   People, the top bar's SESSION): where each one lives now. */
const BUILD_LEGACY = Object.freeze({ players: 'people', settings: 'claude' });

/* A group asked for by name (the Wi-Fi chip, Claude's status): its section. */
const GROUP_TAB = Object.freeze({
  screens: 'screens',
  room: 'joining',
  'share-demo': 'joining',
  wifi: 'joining',
  demo: 'joining',
  joining: 'joining',
  claude: 'claude',
  crew: 'claude',
  build: 'claude',
  session: 'asks',
  report: 'asks',
});

/** Which Build Room section a tab and group ask for. */
export function buildMenuSection(tab = '', group = '') {
  const id = BUILD_LEGACY[tab] || tab;
  if (id === 'claude' && GROUP_TAB[group]) return GROUP_TAB[group];
  return BUILD_MENU_TABS.some((t) => t.id === id) ? id : 'claude';
}

/** The People filters a rail link can ask for (`group`). */
const PEOPLE_FILTERS = [
  { id: 'here', label: 'Here', test: (r) => r.here },
  { id: 'away', label: 'Away', test: (r) => !r.here },
  { id: 'builders', label: 'Builders', test: (r) => r.builder },
];

/**
 * PEOPLE, IN THE RAIL'S PERSON ROW (components/people/PersonRow.jsx): dot,
 * name, Builder and lane or here/away, ideas sent, ⋯ (Move to a new device,
 * Lock name, Remove from session; the Build Room has no Rename). An asker's
 * row turns amber with Let them / Not now. Who left, with Bring back. Search
 * and Here / Away / Builders once the room is past twelve people.
 */
function BuildPeople({ rows, departed, summary, ended, filter: initialFilter = '', actions }) {
  const [query, setQuery] = useState('');
  const [filterId, setFilterId] = useState(PEOPLE_FILTERS.some((f) => f.id === initialFilter) ? initialFilter : 'all');
  const searchable = rows.length > 12 || filterId !== 'all';
  const active = PEOPLE_FILTERS.find((f) => f.id === filterId);
  const needle = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => (active ? active.test(r) : true))
    .filter((r) => (needle ? r.name.toLowerCase().includes(needle) : true))
    .sort((a, b) => a.name.localeCompare(b.name))
    .sort((a, b) => Number(b.handoverRequested && !b.handoverOpen) - Number(a.handoverRequested && !a.handoverOpen));
  const menuFor = (r) => (ended ? [] : [
    r.handoverOpen
      ? { id: 'lock', label: PERSON_WORDS.lock, onSelect: () => actions.onLock(r.name) }
      : { id: 'move', label: PERSON_WORDS.move, onSelect: () => (r.handoverRequested ? actions.onGrant(r.name, true) : actions.onUnlock(r.name)) },
    { id: 'remove', label: PERSON_WORDS.remove, danger: true, onSelect: () => actions.onRemove(r.name) },
  ]);
  const needsFor = (r) => (!ended && r.handoverRequested && !r.handoverOpen ? {
    id: `name:${r.name}`, kind: 'name-request', name: r.name, actions: [NEEDS_ACTIONS.LET, NEEDS_ACTIONS.NOT_NOW],
  } : null);
  const onNeedsAct = (item, a) => (a === NEEDS_ACTIONS.LET ? actions.onGrant(item.name, true) : actions.onRefuse(item.name));
  return (
    <>
      <p className="brm-hint brm-sp-note" data-testid="brm-people-count">{`${rows.length} in the room · ${summary}`}</p>
      {searchable ? (
        <div className="brm-sp-row brm-sp-filters">
          <input type="search" className="brm-sp-search" placeholder="Search names…" aria-label="Search names" value={query} onChange={(e) => setQuery(e.target.value)} />
          {[{ id: 'all', label: 'All' }, ...PEOPLE_FILTERS].map((f) => (
            <Button key={f.id} type="button" size={36} variant={filterId === f.id ? 'primary' : 'secondary'} className="brm-tight" aria-pressed={filterId === f.id} onClick={() => setFilterId(f.id)}>{f.label}</Button>
          ))}
        </div>
      ) : null}
      {rows.length === 0 ? <p className="brm-hint">Nobody has joined yet.</p> : (
        <ul className="bc-people brm-sp-people" aria-label="Everyone in the room">
          {shown.map((r) => (
            <PersonRow
              key={r.name}
              name={r.name}
              status={r.here ? 'here' : 'away'}
              doing={r.builder ? (r.lane ? `Builder · ${r.lane}` : 'Builder') : (r.here ? 'Here' : 'Away')}
              fact={ideasText(r.ideas)}
              menu={menuFor(r)}
              needsItem={needsFor(r)}
              onNeedsAct={onNeedsAct}
            />
          ))}
        </ul>
      )}
      {departed.length ? (
        <div className="brm-sp-left" data-testid="brm-people-left">
          <h4 className="brm-sp-sh">Left the session</h4>
          <p className="brm-hint brm-sp-note">{W.departedNote}</p>
          <ul className="bc-people brm-sp-people" aria-label="Left the session">
            {departed.map((r) => (
              <PersonRow
                key={r.name}
                name={r.name}
                status="left"
                doing={`Removed${r.removedAt ? ` ${timeOf(r.removedAt)}` : ''}`}
                fact={ideasText(r.ideas)}
                menu={[{ id: 'restore', label: 'Bring back', onSelect: () => actions.onRestore(r.name) }]}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export default function BuildSessionPanel({
  room, now, ended, busy, run, api, connected = true,
  roster, reloadPlayers,
  tab: tabAsked, onTab, focusGroup = '', onClose,
  topLine = null, slots = {},
  listNames, onListNames,
  onConnect, onUpdatePlugin, onCrew, onWrap, onReport, onEnd, onShowCodes, wifiLink = '',
  roomChoice = null, onRoomChoice = null,
  onLook = null, continueSlot = null, inSheet = false,
}) {
  const panelRef = useRef(null);
  const rootRef = useRef(null);
  const openerRef = useRef(null);
  const crew = room.crew && room.crew.enabled ? room.crew : null;
  const { rows, departed, summary } = useMemo(() => rosterOf(room, roster), [room, roster]);
  const asking = askingOf(roster.players);
  const tab = buildMenuSection(tabAsked, focusGroup);

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

  // Opened at a group (the Wi-Fi chip, Claude's status): bring it into view.
  useEffect(() => {
    if (!focusGroup) return;
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
  const opening = room.opening && room.opening.phase === 'building';
  const ids = BUILD_MENU_TABS.map((t) => t.id);

  // Arrow keys, Home and End move between the tabs (the tabs pattern); the selected one is the tab stop.
  const tabKeys = (e) => {
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

  const tabs = BUILD_MENU_TABS.map((t) => (t.id === 'people'
    ? { ...t, count: rows.length, flag: asking.length ? `${asking.length} asking` : '' }
    : t));

  const builders = crew ? (crew.builders || []).filter((b) => !b.closed) : [];
  const claudeMore = [
    !ended && room.plugin ? { label: 'Plugin version' } : null,
    { label: 'Crew' },
    !ended && opening ? { label: 'Back to the opening' } : null,
  ];

  return (
    <div className={`brm-sp-root${inSheet ? ' is-sheet' : ''}`} ref={rootRef}>
      <div className="brm-sp-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="brm-sp smenu" ref={panelRef} role="dialog" aria-modal="true" aria-label={HW.sessionMenu} tabIndex={-1} onKeyDown={trapFocus} data-capability="settings">
        <div className="brm-sp-head">
          <h2 className="brm-sp-title">{HW.sessionMenu}</h2>
          <span className={`brm-sp-ws${connected ? ' is-up' : ''}`} aria-live="polite">{connected ? 'Connected' : 'Connecting…'}</span>
          {/* Help and close, the two things you reach for when lost, as on the
              other engagements' Session menu (Help Phase 3). */}
          <HelpButton
            {...helpFor('build-session-panel')}
            variant="inline"
            size="small"
            tooltip="Help and feedback"
            className="help-button-quiet"
            reports={{ context: 'host', gameId: room.gameId }}
          />
          <button type="button" className="brm-sp-x" aria-label={HW.closeSessionMenu} onClick={onClose}><Icon name="X" size={16} /></button>
        </div>

        {topLine && <div className="brm-sp-top" data-testid="brm-sp-top">{topLine}</div>}

        <div className="brm-sp-tabs" role="tablist" aria-label={`${HW.sessionMenu} sections`}>
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
          {/* CLAUDE: the chip, Connect Claude Code, the Continue prompt, the
              auto switch and the posts gate; the plugin version, the crew and
              Back to the opening in More options. */}
          {tab === 'claude' && (
            <section id="brm-sp-pane-claude" role="tabpanel" aria-labelledby="brm-sp-tab-claude" className="brm-sp-pane">
              <div className="brm-sp-grp" data-group="claude" data-capability="claude-status">
                <div className="brm-sp-row">
                  {slots.agentChip}
                  {!ended && (
                    <Button type="button" size={36} className="brm-tight brm-push" onClick={pick(onConnect)}>
                      <Icon name="Lock" size={14} /> Connect Claude Code
                    </Button>
                  )}
                </div>
                {/* The plugin is older than the current one: one line, here only. */}
                {!ended && room.plugin && room.plugin.outdated && (
                  <p className="brm-hint brm-sp-note" data-testid="brm-plugin-out">
                    {W.pluginOutdated}{' '}
                    <Button type="button" variant="tertiary" size={36} className="brm-tight" onClick={pick(onUpdatePlugin)}>{W.pluginUpdate}</Button>
                  </p>
                )}
                {/* Claude is away: the prompt that brings it back. */}
                {!ended && continueSlot}
                {!ended && slots.autoSwitch}
                {!ended && <p className="brm-hint brm-sp-note">{W.autoNote}</p>}
                {/* THE RELEASE GATE (owner, 17 Oct 2026): Claude's posts and screenshots wait for the host. */}
                {!ended && (
                  <div data-capability="release-posts">
                    <Switch
                      label={W.postsSwitch}
                      checked={room.settings ? room.settings.reviewAgentPosts !== false : true}
                      disabled={busy}
                      onChange={(on) => run(() => api.saveSettings({ reviewAgentPosts: on }))}
                      note={W.postsNote}
                    />
                  </div>
                )}
              </div>
              <MoreOptions section="build-claude" groups={claudeMore}>
                {!ended && room.plugin ? <PluginVersion plugin={room.plugin} /> : null}
                <div className="brm-sp-sub" data-group="crew" data-capability="crew">
                  <h4 className="brm-sp-sh">Crew</h4>
                  {crew ? (
                    <>
                      <div className="brm-sp-row">
                        <span className="brm-sp-lab">{`${builders.length} ${plural(builders.length, 'builder', 'builders')}`}</span>
                        <span className="brm-hint">{builders.map((b) => b.name).join(', ')}</span>
                        {!ended && <Button type="button" size={36} className="brm-tight brm-push" onClick={pick(onCrew)}>Crew</Button>}
                      </div>
                      {!ended && <RunCrewCodeSwitch crew={crew} busy={busy} run={run} api={api} />}
                    </>
                  ) : (
                    <>
                      <p className="brm-hint brm-sp-note">{W.crewNote}</p>
                      {!ended && <div className="brm-sp-row"><Button type="button" size={36} className="brm-tight" onClick={pick(onCrew)}>Open to a crew</Button></div>}
                    </>
                  )}
                </div>
                {!ended && opening && (
                  <div className="brm-sp-row" data-capability="opening">
                    <Button type="button" size={36} className="brm-tight" disabled={busy} onClick={pick(() => run(() => api.openingAction('resume', {})))}>Back to the opening</Button>
                    <span className="brm-hint">{W.startUndoNote}</span>
                  </div>
                )}
              </MoreOptions>
            </section>
          )}

          {/* ASKS SO FAR: the report first, then Wrap up, then the history. */}
          {tab === 'asks' && (
            <section id="brm-sp-pane-asks" role="tabpanel" aria-labelledby="brm-sp-tab-asks" className="brm-sp-pane">
              <div className="brm-sp-grp" data-group="session" data-capability="report">
                <div className="smenu-report">
                  <Icon name="FileText" size={22} />
                  <div className="smenu-report__t">
                    <b>Session report</b>
                    <span className="brm-hint">Every ask, what the room chose, and what Claude built.</span>
                  </div>
                  <Button type="button" size={36} className="brm-tight" onClick={pick(onReport)}><Icon name="FileText" size={14} /> Report</Button>
                </div>
                <div className="brm-sp-row">
                  <Button type="button" size={36} className="brm-tight" onClick={pick(onWrap)}>Wrap up</Button>
                  {typeof onLook === 'function' && (
                    <Button type="button" size={36} className="brm-tight" data-capability="history" onClick={pick(() => onLook('history'))}>{W.lookHistory}</Button>
                  )}
                </div>
              </div>
            </section>
          )}

          {tab === 'people' && (
            <section id="brm-sp-pane-people" role="tabpanel" aria-labelledby="brm-sp-tab-people" className="brm-sp-pane" data-capability="players">
              <BuildPeople rows={rows} departed={departed} summary={summary} ended={ended} filter={focusGroup} actions={players} />
            </section>
          )}

          {/* SCREENS: where the room watches, the room's window; the size, New
              link, Look here privately and the keys in More options. */}
          {tab === 'screens' && (
            <section id="brm-sp-pane-screens" role="tabpanel" aria-labelledby="brm-sp-tab-screens" className="brm-sp-pane">
              <WallScreens
                room={room} busy={busy} run={run} api={api} ended={ended} choice={roomChoice} onChoose={onRoomChoice}
                extra={(tuning) => (
                  <MoreOptions section="build-screens" groups={[{ label: 'Screen size' }, room.wallKey && !ended ? { label: 'New link' } : null, typeof onLook === 'function' ? { label: W.lookHere } : null, { label: 'Keys' }]}>
                    <div className="scr">{tuning}</div>
                    {typeof onLook === 'function' ? (
                      // LOOK HERE, PRIVATELY: Build or History on this laptop alone.
                      <div className="brm-sp-row brm-sp-look">
                        <span className="brm-sp-lab">{W.lookHere}</span>
                        <Button type="button" size={36} className="brm-tight" data-capability="build-screen" onClick={pick(() => onLook('build'))}>{W.lookBuild}</Button>
                        <Button type="button" size={36} className="brm-tight" onClick={pick(() => onLook('history'))}>{W.lookHistory}</Button>
                      </div>
                    ) : null}
                    <p className="brm-hint brm-sp-keys">
                      <kbd>1</kbd>{'–'}<kbd>4</kbd> screens {'·'} <kbd>P</kbd> Host and back {'·'} <kbd>Space</kbd> the lead move {'·'} <kbd>\</kbd> this menu {'·'} <kbd>Esc</kbd> close
                    </p>
                  </MoreOptions>
                )}
                sizeInMore
              />
            </section>
          )}

          {/* JOINING: the codes; the demo on this Wi-Fi and the meter's names in More options. */}
          {tab === 'joining' && (
            <section id="brm-sp-pane-joining" role="tabpanel" aria-labelledby="brm-sp-tab-joining" className="brm-sp-pane">
              <div className="brm-sp-grp" data-group="room" data-capability="share-demo">
                <RoomCodes room={room} now={now} ended={ended} busy={busy} run={run} api={api} wifiLink={wifiLink} onShowCodes={pick(onShowCodes)} />
              </div>
              <MoreOptions section="build-joining" groups={[{ label: 'List names on the room meter' }]}>
                <Switch
                  label="List names on the room meter"
                  checked={Boolean(listNames)}
                  onChange={onListNames}
                  note={W.roomMeterNote}
                />
              </MoreOptions>
            </section>
          )}
        </div>

        {/* THE FOOT, as on every other format: End session and Main menu, in every section. */}
        <div className="brm-sp-foot" data-testid="brm-sp-foot">
          {!ended && (
            <Button type="button" size={36} className="brm-tight brm-danger" title={HW.endSessionHint} onClick={pick(onEnd)}>{`${HW.endSession}…`}</Button>
          )}
          <Button as="a" size={36} className="brm-tight brm-push" href="/" title={HW.mainMenuHint}>
            <Icon name="House" size={14} /> {HW.mainMenu}
          </Button>
        </div>
      </aside>
    </div>
  );
}
