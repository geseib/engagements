/**
 * BUILD ROOM — the host's page (docs/design/build-room/PLAN.md, index.html).
 *
 *   /build                         → the create form
 *   /build?gameId=NNNN             → the room: the current ask, the timeline,
 *                                    the ideas inbox, Connect Claude Code
 *   /build?gameId=NNNN&view=report → the report (BuildReport.jsx)
 *
 * FOUR SCREENS (owner, 2026-10-05; docs/design/build-room-host-redesign):
 * Host is the host's working screen; Stage, Build and History are made to be
 * shown to the room, and render nothing host-only (no controls, ideas inbox,
 * host notes, names or the key). Keys 1-4 pick one; P flips between Host and
 * the last screen the room saw. One column under 900px, for a phone.
 *
 * LIVE. A host WebSocket (ticketed, as GameHostPage's) refetches GET
 * build/state on every `buildChanged`; an 8s poll is the fallback, because a
 * dropped socket must never leave the wall frozen on an old vote.
 *
 * UNTRUSTED TEXT. Everything Claude or a phone wrote is rendered as text —
 * React escapes it — and never as HTML. A link renders only when it is
 * http(s) (`safeHref`).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../components/Modal';
import { getAuthToken } from '../auth/authFetch';
import { rememberReturnPath } from '../auth/returnPath';
import reloadPage from '../utils/reloadPage';
import Icon from '../components/Icon';
import DeleteReasonField from '../components/DeleteReasonField';
import webSocketClient from '../WebSocketClient';
import { copyText } from '../utils/copyText';
import BuildReport from './BuildReport';
import BuildImage, { ImageLoader } from './BuildImage';
import BuildWheel from './BuildWheel';
import {
  pluginInstallCommand,
  pluginConnectCommand,
  hostImageUrl,
  apiBase, buildApi, createBuildSession, buildRoomPath, connectCommand, safeHref,
} from './buildHostApi';
import './BuildRoom.css';
import {
  SCREENS, isProjected, screenForKey, togglePresent, waitingCount, askPill, latestBuild, stageModel, winnerOf, directionFor,
  questionAnswer, decisionMethod, METHOD_WORDS,
} from './buildScreens';
import Stage from '../components/stage/Stage';
import Rail from '../components/stage/Rail';
import RoomMeter from '../components/stage/RoomMeter';
import Dock from '../components/stage/Dock';
import { loadProfile } from '../config/displayProfile';
import {
  CrewBoard, CrewDialog, CrewIncoming, CrewTasks, EarlyLook, EarlyLookDialog, RunCrewCodeSwitch, StageTabs, featuredShare,
} from './BuildCrew';

export const POLL_MS = 8000;

// ── Words ───────────────────────────────────────────────────────────────────

export const KIND_LABEL = { suggest: 'Ideas', choice: 'Choose', rating: 'Rate' };
export const STATUS_LABEL = {
  proposed: 'Proposed',
  live: 'Live',
  voting: 'Voting',
  results: 'Closed',
  decided: 'Decided',
  discarded: 'Discarded',
};

/** One sentence under each stage: what happens next, and what the host does. Hidden in Present. */
export function stageHint(ask) {
  if (!ask) return 'Claude is working. Log what the room says, or ask the room yourself.';
  switch (ask.status) {
    case 'proposed': return "The room can't see this yet. Edit it, then open it.";
    case 'live': return ask.kind === 'suggest'
      ? 'The room is suggesting. Open voting when you have enough ideas.'
      : 'The room is answering. Close it when the count settles.';
    case 'voting': return 'The room is voting. Close it when the count settles.';
    case 'results': return 'Shape the direction, then send it to Claude.';
    default: return '';
  }
}

/** The first-run strip on an empty room. */
export const HOW_IT_WORKS = [
  'Connect Claude Code: mint a key and paste one command.',
  'Paste the Kick off prompt into Claude Code.',
  'Claude asks the room. You shape each answer and send it back.',
  'Wrap up, then share the report.',
];

/** The prompt cards (PLAN §7). The MCP server serves the same four as slash commands. */
export const PROMPT_CARDS = [
  {
    name: 'kickoff',
    title: 'Kick off',
    text: 'Read the room with room_status. Restate the goal, tell the room your plan in three short steps with post_update, then start building. Ask the room only at real decision points.',
  },
  {
    name: 'ideas',
    title: 'Ask the room for ideas',
    text: 'Ask the room for ideas about what matters most for this next step, using ask_room_for_ideas. Keep building what does not depend on it, call wait_for_room, then build from the host\'s direction.',
  },
  {
    name: 'ab-mockups',
    title: 'Show A/B mockups',
    text: 'Build two quick variants of the next screen. Create the ask first with ask_room_to_choose, stamp each variant with the exact letter Engage returns, tell me their local URLs, then wait_for_room and build the decision.',
  },
  {
    name: 'continue',
    title: 'Continue',
    text: 'Pick up my latest direction from the Build Room with check_directions and room_status, do it, post what changed, then call wait_for_direction and keep listening for the next one.',
  },
  {
    name: 'preview',
    title: 'Preview the work',
    text: 'Show the room the work so far, running. Work out how this project runs (its dev server, a build and a static server, or plain HTML), start it in the background on a free port or reuse the one already running, and wait until the page answers. Then post_update with kind "showing", one line for the room and the link to the local URL, screenshot the main page and share_image it, and tell me the URL. If it cannot run yet, say plainly what is missing.',
  },
  {
    name: 'share-repo',
    title: 'Share the repo with the crew',
    text: 'Open this project to the crew. Cut a base branch for this session from main (build-room/ and the join code), push it, then call share_repo with the remote URL, the base branch and its commit. Builders branch from it; only I merge into it.',
  },
  {
    name: 'wrap-up',
    title: 'Wrap up',
    text: 'We are wrapping up. Call room_status, then write the outcome with wrap_up: a short summary for the room, what you built, the running demo link first, and next steps. Post a final milestone thanking the room, then call wait_for_direction.',
  },
];
export const slashCommand = (name) => `/mcp__engage__${name}`;
/** With the Engage plugin the same prompts are the plugin's own commands. */
export const pluginCommand = (name) => `/engage:${name}`;

const askNumber = (askId) => Number(askId) || askId;

export function clockTime(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function agoText(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** Who wrote a timeline entry, in the wall's words. */
export function byLabel(entry) {
  if (entry.kind === 'base') return 'Base moved';
  if (entry.by === 'builder') return entry.kind === 'help' ? 'Help' : 'Crew';
  if (entry.by === 'agent') return entry.kind === 'showing' ? 'Showing' : 'Claude';
  if (entry.by === 'system') return 'System';
  if (entry.by === 'room' || entry.kind === 'idea') return 'Idea';
  switch (entry.kind) {
    case 'verbal': return 'Room said';
    case 'decision': return 'Decided';
    case 'direction': return 'To Claude';
    case 'note': return 'Host note';
    case 'milestone': return 'Milestone';
    case 'outcome': return 'Wrap-up';
    default: return 'Host';
  }
}

/** One dot colour per family on the timeline. */
const entryTone = (entry) => {
  if (entry.by === 'agent') return 'claude';
  if (entry.kind === 'decision' || entry.kind === 'direction') return 'decision';
  if (entry.kind === 'verbal' || entry.kind === 'idea') return 'verbal';
  if (entry.kind === 'note') return 'note';
  if (entry.by === 'system') return 'ask';
  return 'host';
};

/** The direction the decide panel starts with: the room's top answer, as a sentence. */
export function defaultDirection(ask) {
  // The question and the answer (owner, 2026-10-06).
  const w = ask && ask.wheel;
  const landed = w && w.landed ? (w.slices || []).find((x) => x.id === w.landed) : null;
  if (landed) return questionAnswer(ask.prompt, landed.text);
  const r = (ask && ask.results) || {};
  if (ask.kind === 'choice') {
    const top = [...(r.options || [])].sort((a, b) => b.count - a.count)[0];
    return top && top.count ? questionAnswer(ask.prompt, top.title) : '';
  }
  if (ask.kind === 'rating') {
    return r.rating && r.rating.avg !== null && r.rating.avg !== undefined
      ? questionAnswer(ask.prompt, `${r.rating.avg} out of 5`) : '';
  }
  const top = (r.ranked || [])[0];
  return top ? questionAnswer(ask.prompt, top.text) : '';
}

/** What the host can fold into the direction with one click. */
export function foldSources(ask) {
  const r = (ask && ask.results) || {};
  const out = [];
  if (ask.kind === 'suggest') {
    (r.ranked || []).slice(0, 6).forEach((x, i) => {
      if (i > 0) out.push({ id: `resp:${x.respId}`, text: x.text, respId: x.respId });
    });
  } else {
    if (ask.kind === 'choice') {
      const sorted = [...(r.options || [])].sort((a, b) => b.count - a.count);
      sorted.slice(1).forEach((o) => {
        if (o.count) out.push({ id: `opt:${o.label}`, text: `Keep something from ${o.label} (${o.title})`, label: o.label });
      });
    }
    (r.whys || []).slice(0, 6).forEach((w, i) => out.push({ id: `why:${i}`, text: w.text }));
  }
  return out;
}

const appendSentence = (base, text) => {
  const b = String(base || '').trim();
  if (!b) return text;
  return /[.!?]$/.test(b) ? `${b} ${text}` : `${b}. ${text}`;
};

const removeSentence = (base, text) => String(base || '')
  .replace(`. ${text}`, '').replace(` ${text}`, '').replace(text, '')
  .trim();

const isTyping = (el) => {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
};

/** A ticking clock for "active 6s ago". */
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** A link only when it is http(s); otherwise the text, inert. */
function SafeLink({ href, children, className }) {
  const url = safeHref(href);
  if (!url) return children ? <span className={className}>{children}</span> : null;
  return <a className={className} href={url} target="_blank" rel="noopener noreferrer">{children || url}</a>;
}

// ── Page ────────────────────────────────────────────────────────────────────

/**
 * A link the HOST opens on this laptop — a mockup, the demo, something Claude
 * is showing. Local addresses work here because Claude runs on this laptop;
 * that is the point, so the button says where it goes.
 */
export function OpenLink({ href, label, primary = false }) {
  if (!safeHref(href)) return null;
  return (
    <a className={`brm-btn brm-openbtn${primary ? ' brm-btn--primary' : ''}`} href={href} target="_blank" rel="noopener noreferrer" title={href}>
      <Icon name="ArrowSquareOut" size={16} /> {label}
    </a>
  );
}

export default function BuildRoomPage() {
  const params = new URLSearchParams(window.location.search);
  const gameId = (params.get('gameId') || '').trim();
  // The create screen's Build Room format carries the typed title over.
  if (!gameId) return <BuildCreate initialTitle={(params.get('title') || '').slice(0, 120)} />;
  return <BuildRoom gameId={gameId} initialView={params.get('view') === 'report' ? 'report' : 'room'} />;
}

// ── Create ──────────────────────────────────────────────────────────────────

export function BuildCreate({ navigate = (url) => window.location.assign(url), initialTitle = '' }) {
  const [title, setTitle] = useState(initialTitle);
  const [goal, setGoal] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [accessCode, setAccessCode] = useState('');
  const [review, setReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!title.trim()) { setError('Give the room a title.'); return; }
    if (visibility === 'private' && !accessCode.trim()) { setError('A private room needs an access code.'); return; }
    setBusy(true);
    setError('');
    try {
      const gameId = await createBuildSession({ title, goal, visibility, accessCode });
      if (!review) {
        try { await buildApi(gameId).saveSettings({ reviewAgentAsks: false }); } catch (e) { /* the room can switch it */ }
      }
      navigate(buildRoomPath(gameId));
    } catch (e) {
      setError(e.message || 'The room could not be created.');
      setBusy(false);
    }
  };

  return (
    <div className="brm brm-createpage" data-theme="dark">
      <form className="brm-card brm-create" onSubmit={submit} aria-labelledby="brm-create-title">
        <div className="brm-dh">
          <h1 id="brm-create-title">New Build Room</h1>
          <a className="brm-x" href="/" aria-label="Close"><Icon name="X" size={16} /></a>
        </div>
        <p className="brm-sub">A room of people and your own Claude Code build something together. Claude asks the room at real decision points; you shape every answer before it reaches Claude.</p>
        <label className="brm-field">
          <span className="brm-lbl">Title</span>
          <input className="brm-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Volunteer sign-up for the food bank" />
        </label>
        <label className="brm-field">
          <span className="brm-lbl">Goal: what should exist when we&apos;re done?</span>
          <textarea className="brm-input brm-ta" value={goal} maxLength={2000} onChange={(e) => setGoal(e.target.value)} placeholder="A one-page site where a volunteer can pick a shift in under a minute, on a phone." />
          <span className="brm-hint">Claude reads this first. It shows on the wall and at the top of the report.</span>
        </label>
        <fieldset className="brm-field brm-fieldset">
          <legend className="brm-lbl">Who can join</legend>
          <label className="brm-check"><input type="radio" name="brm-vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Anyone with the code</label>
          <label className="brm-check"><input type="radio" name="brm-vis" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private: an access code as well</label>
          {visibility === 'private' && (
            <input className="brm-input" aria-label="Access code" value={accessCode} maxLength={40} onChange={(e) => setAccessCode(e.target.value)} placeholder="Access code" />
          )}
        </fieldset>
        <label className="brm-check brm-field">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
          <span>Review Claude&apos;s questions before the room sees them<span className="brm-hint brm-block">Recommended. You can switch this off in the room.</span></span>
        </label>
        {error && <div className="brm-alert" role="alert">{error}</div>}
        <div className="brm-row">
          <a className="brm-btn brm-btn--ghost" href="/">Cancel</a>
          <button type="submit" className="brm-btn brm-btn--primary brm-push" disabled={busy}>
            {busy ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── The room ────────────────────────────────────────────────────────────────

export function BuildRoom({ gameId, initialView = 'room' }) {
  const api = useMemo(() => buildApi(gameId), [gameId]);
  // Screenshots are private: fetched with the host's sign-in (buildHostApi).
  const loadImage = useCallback((imageId) => hostImageUrl(gameId, imageId), [gameId]);
  const [room, setRoom] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // FOUR SCREENS (owner, 2026-10-05). Host is the host's; Stage, Build and
  // History are shown to the room. `lastShown` is where P goes back to.
  const [screen, setScreenState] = useState('host');
  const lastShown = useRef(null);
  const setScreen = useCallback((next) => {
    if (isProjected(next)) lastShown.current = next;
    setScreenState(next);
  }, []);
  const [view, setView] = useState(initialView);
  // WHICH ANSWER GOES TO CLAUDE (owner, 2026-10-06): the winner unless the
  // host picks another ("choose this instead"), on the Stage or the Host.
  const [pick, setPick] = useState(null); // {askId, id}
  const [dialog, setDialog] = useState(null); // 'connect' | 'wrap' | 'end' | 'crew' | {compose: kind}
  // Crew mode: which stage shows (the room's asks, or the crew board), and the early look open.
  const [stage, setStage] = useState('room');
  const [openShareId, setOpenShareId] = useState(null);
  const now = useNow(5000);

  // ── THE CONNECTION (owner, 2026-10-04) ────────────────────────────────
  // After a long wait the laptop sleeps, the socket gives up after five
  // retries, and every action said "check the connection" until the page was
  // reloaded. So the host sees one honest status in the header (live,
  // connecting, disconnected, no internet, signed out), the page recovers on
  // its own when the laptop wakes or comes back online, and one click
  // reconnects -- or, when the sign-in has run out, signs in again and comes
  // back to this room.
  const [wsConnected, setWsConnected] = useState(() => webSocketClient.isConnected());
  const everConnected = useRef(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [link, setLink] = useState('ok'); // 'ok' | 'network' | 'auth'
  const errorKind = useRef('');            // the kind of the error bar's error
  /** 'auth' when the sign-in is gone, 'network' when the server was not reached, else ''. */
  const failureKind = useCallback(async (e) => {
    if (e && e.status === 401) return 'auth';
    if (e && e.status) return '';
    // No status: the request never got an answer. A sign-in that has run out
    // can look like this too (an authorizer refusal may carry no CORS headers),
    // so ask the auth layer before calling it the network.
    return (await getAuthToken()) ? 'network' : 'auth';
  }, []);

  const inFlight = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) { again.current = true; return; }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        try {
          const next = await api.state();
          setRoom(next);
          setLoadError('');
          setLink('ok');
          // A network failure the page has since recovered from is not news.
          if (errorKind.current === 'network') { errorKind.current = ''; setError(''); }
        } catch (e) {
          const kind = await failureKind(e);
          if (kind) setLink(kind);
          setLoadError(kind === 'auth' ? '' : (e.message || 'The room could not be loaded.'));
        }
      } while (again.current);
    } finally {
      inFlight.current = false;
    }
  }, [api, failureKind]);

  /** One click: reconnect the socket and reload the room, or sign in again. */
  const reconnect = useCallback(async () => {
    if (link === 'auth' || !(await getAuthToken())) {
      rememberReturnPath();      // a Google sign-in leaves the page and comes back here
      reloadPage();              // a protected page shows the sign-in form in place
      return;
    }
    webSocketClient.ensureConnected();
    refresh();
  }, [link, refresh]);

  useEffect(() => {
    const onStatus = (up) => {
      if (up) everConnected.current = true;
      setWsConnected(Boolean(up));
    };
    webSocketClient.onConnectionStatusChange(onStatus);
    // Waking, coming back online, or returning to the tab: the same resync the
    // regular host page does (GameHostPage, "A4"), so no reload is needed.
    const resync = () => { setOnline(navigator.onLine !== false); webSocketClient.ensureConnected(); refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    const onOffline = () => setOnline(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', resync);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', resync);
    window.addEventListener('pageshow', resync);
    return () => {
      webSocketClient.onConnectionStatusChange(null);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resync);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', resync);
      window.removeEventListener('pageshow', resync);
    };
  }, [refresh]);

  let connection = 'live';
  if (link === 'auth') connection = 'signin';
  else if (!online) connection = 'offline';
  else if (!wsConnected || link === 'network') connection = everConnected.current || link === 'network' ? 'disconnected' : 'connecting';

  // First load, the fallback poll, and the host socket.
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    webSocketClient.onMessage('buildChanged', () => refresh());
    // Claude's live activity carries its own lines: show them, no refetch.
    webSocketClient.onMessage('buildActivity', (msg) => {
      const items = msg && Array.isArray(msg.items) ? msg.items : null;
      if (items) setRoom((r) => (r ? { ...r, activity: items } : r));
    });
    webSocketClient.onMessage('gameEnded', () => refresh());
    webSocketClient.onReconnected(() => refresh());
    webSocketClient.connect(gameId, null, true, { hostTicket: () => api.hostTicket() });
    return () => {
      clearInterval(poll);
      webSocketClient.disconnect();
      webSocketClient.offMessage('buildChanged');
      webSocketClient.offMessage('buildActivity');
      webSocketClient.offMessage('gameEnded');
      webSocketClient.onReconnected(null);
    };
  }, [api, gameId, refresh]);

  // 1-4 pick a screen; P flips between Host and the last screen the room saw.
  // Never while somebody is typing, never with a modifier, never inside a dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('[role="dialog"]')) return;
      if (e.key === 'p' || e.key === 'P') {
        setScreenState((cur) => {
          const next = togglePresent(cur, lastShown.current);
          if (isProjected(next)) lastShown.current = next;
          return next;
        });
        return;
      }
      const picked = screenForKey(e.key);
      if (picked) setScreen(picked);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen]);

  /** Every host action: one at a time, the server's sentence on failure, then refetch. */
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      const out = await fn();
      await refresh();
      return out;
    } catch (e) {
      const kind = await failureKind(e);
      if (kind) setLink(kind);
      errorKind.current = kind;
      setError(kind === 'auth'
        ? 'Your sign-in has run out. Sign in again to keep running the room; nothing in it is lost.'
        : (e.message || 'That did not work.'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [refresh, failureKind]);

  const goView = (next) => {
    setView(next);
    try {
      const url = next === 'report' ? `${buildRoomPath(gameId)}&view=report` : buildRoomPath(gameId);
      window.history.pushState({}, '', url);
    } catch (e) { /* the view still changes */ }
  };

  if (!room) {
    return (
      <div className="brm brm-loading" data-theme="dark">
        {loadError
          ? <div className="brm-alert" role="alert">{loadError} <a className="brm-link" href="/">Back to the host page</a></div>
          : <p className="brm-muted">Opening the Build Room…</p>}
      </div>
    );
  }

  if (view === 'report') return <ImageLoader.Provider value={loadImage}><BuildReport state={room} onBack={() => goView('room')} /></ImageLoader.Provider>;

  const present = isProjected(screen);
  const host = !present;
  const ended = room.state === 'ENDED';
  const asks = room.asks || [];
  const proposed = asks.filter((a) => a.status === 'proposed');
  const current = asks.find((a) => a.askId === room.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null;
  const firstRun = !asks.length && !(room.log || []).some((l) => l.by === 'agent');
  const crew = room.crew && room.crew.enabled ? room.crew : null;
  const onCrew = Boolean(crew) && stage === 'crew';
  const openShare = crew && openShareId ? (crew.shares || []).find((x) => x.shareId === openShareId) || null : null;
  const onWall = onCrew && present ? featuredShare(crew) : null;

  return (
    <ImageLoader.Provider value={loadImage}>
    <div className={`brm brm-room${present ? ' brm--present' : ''}${screen === 'host' ? ' brm-room--host' : ''}`} data-theme="dark">
      {screen === 'stage' ? (
        <BuildStage
          room={room}
          current={current}
          crewOn={onCrew}
          crew={crew}
          onWall={onWall}
          busy={busy}
          ended={ended}
          run={run}
          api={api}
          now={now}
          onHost={() => setScreen('host')}
          pickId={pick && current && pick.askId === current.askId ? pick.id : null}
          onPick={(id) => { if (current) setPick({ askId: current.askId, id }); setScreen('host'); }}
        />
      ) : (
      <>
      <RoomHeader
        connection={connection}
        onReconnect={reconnect}
        room={room}
        now={now}
        host={host}
        screen={screen}
        onScreen={setScreen}
        onConnect={() => setDialog('connect')}
        onWrap={() => setDialog('wrap')}
        onReport={() => goView('report')}
        onEnd={() => setDialog('end')}
        onCrew={() => setDialog('crew')}
        crew={crew}
        busy={busy}
        run={run}
        api={api}
        ended={ended}
      />
      {host && error && (
        <div className="brm-alert brm-alert--bar" role="alert">
          {error}
          {['network', 'auth'].includes(errorKind.current) && (
            <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={reconnect}>
              {errorKind.current === 'auth' ? 'Sign in again' : 'Reconnect'}
            </button>
          )}
          <button type="button" className={`brm-btn brm-btn--sm brm-btn--ghost${['network', 'auth'].includes(errorKind.current) ? '' : ' brm-push'}`} onClick={() => { errorKind.current = ''; setError(''); }}>Dismiss</button>
        </div>
      )}
      {host && loadError && (
        <div className="brm-alert brm-alert--bar" role="alert">
          {loadError}
          <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={reconnect}>Reconnect</button>
        </div>
      )}
      {ended && <div className="brm-notice brm-notice--bar">This session has ended. The timeline, the wrap-up and the report are still yours to edit.</div>}

      {screen === 'build' && <BuildScreen room={room} now={now} />}
      {screen === 'history' && <HistoryScreen room={room} />}
      {screen === 'host' && (
      <div className="brm-host">
        {/* NOW: what Claude or the room is doing, with that moment's controls,
            and the one composer for everything the host types (C1, C4, C5). */}
        <main className="brm-hostcol" aria-label="Now">
          {firstRun && (
            <section className="brm-panel brm-howto" aria-labelledby="brm-howto-h">
              <h2 className="brm-h" id="brm-howto-h">How a Build Room works</h2>
              <ol className="brm-steps">
                {HOW_IT_WORKS.map((text, i) => (
                  <li key={text}><span className="brm-n">{i + 1}</span>{text}</li>
                ))}
              </ol>
              {!room.agent?.key && (
                <button type="button" className="brm-btn brm-btn--primary" onClick={() => setDialog('connect')}>
                  <Icon name="Lock" size={16} /> Connect Claude Code
                </button>
              )}
            </section>
          )}

          {crew && <StageTabs stage={stage} onStage={setStage} crew={crew} host={host} />}

          {onCrew ? (
            <>
              <CrewBoard crew={crew} host={host} now={now} busy={busy} run={run} api={api} onOpen={setOpenShareId} playerCount={room.playerCount} />
              <CrewTasks crew={crew} host={!ended} busy={busy} run={run} api={api} />
            </>
          ) : (
            <>
              {current ? (
                <div className="brm-now">
                  <AskStage
                    key={`${current.askId}:${current.status}`}
                    ask={current} room={room} host busy={busy} ended={ended} run={run} api={api}
                    pickId={pick && pick.askId === current.askId ? pick.id : null}
                    onPick={(id) => setPick({ askId: current.askId, id })}
                  />
                </div>
              ) : (
                <NowBuilding room={room} now={now} ended={ended} busy={busy} run={run} api={api} onShowBuild={() => setScreen('build')} onCompose={(kind, extra) => setDialog({ compose: kind, ...extra })} />
              )}
            </>
          )}

          {!ended && <Composer agent={room.agent} busy={busy} run={run} api={api} onCompose={(kind) => setDialog({ compose: kind })} />}
        </main>

        {/* WAITING FOR YOU: Claude's proposed asks first (Claude is waiting on
            them), then the room's ideas (C1, C2). */}
        <section className="brm-hostcol" aria-labelledby="brm-waiting-h">
          <h2 className="brm-h5" id="brm-waiting-h">
            Waiting for you{waitingCount(room) > 0 ? ` · ${waitingCount(room)}` : ''}
          </h2>
          {freshWallComment(room, now) && (
            <div className="brm-notice brm-row brm-gap brm-onwall" role="status">
              <span><b>On the wall now:</b> &ldquo;{room.wallComment.text}&rdquo;</span>
              <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={() => run(() => api.clearWall())}>Take it down</button>
            </div>
          )}
          {proposed.map((ask) => (
            <ReviewCard key={`${ask.askId}:${ask.status}`} ask={ask} busy={busy} ended={ended} run={run} api={api} connected={room.agent?.connected} />
          ))}
          {onCrew && <CrewIncoming crew={crew} busy={busy} run={run} api={api} onOpen={setOpenShareId} />}
          {!onCrew && <IdeasInbox ideas={room.ideas || []} current={current} busy={busy} ended={ended} run={run} api={api} />}
        </section>

        {/* WHAT HAPPENED (owner, 2026-10-05): the timeline, the asks and the
            screenshots, one open at a time; the open one fills the column and
            scrolls inside itself, so the page never scrolls. */}
        <aside className="brm-hostcol brm-hostcol--stack">
          {current && !ended && <ClaudeActivity activity={room.activity || []} agent={room.agent} now={now} full />}
          <HistoryStack
            items={[
              { key: 'timeline', label: 'Timeline', count: (room.log || []).length, body: <Timeline log={room.log || []} host={host} busy={busy} ended={ended} run={run} api={api} deleteAs={room.deleteAs} /> },
              { key: 'asks', label: 'Asks', count: asks.length, body: asks.length
                ? <AskList asks={asks} host={host} busy={busy} ended={ended} run={run} api={api} currentAskId={room.currentAskId} />
                : <div className="brm-empty">No asks yet.</div> },
              { key: 'shots', label: 'Screenshots', count: (room.images || []).length, body: <ShotsPanel images={room.images || []} busy={busy} run={run} api={api} deleteAs={room.deleteAs} /> },
            ]}
          />
        </aside>
      </div>
      )}
      </>
      )}

      {host && dialog === 'connect' && (
        <ConnectPanel room={room} gameId={gameId} api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog === 'wrap' && (
        <WrapUpPanel outcome={room.outcome} api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog === 'crew' && (
        <CrewDialog crew={room.crew} gameId={gameId} busy={busy} run={run} api={api} shareCard={SHARE_REPO_CARD} onClose={() => setDialog(null)} />
      )}
      {host && openShare && (
        <EarlyLookDialog key={openShare.shareId} share={openShare} crew={crew} busy={busy} run={run} api={api} onClose={() => setOpenShareId(null)} />
      )}
      {host && dialog === 'end' && (
        <EndDialog api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog && dialog.compose && (
        <AskComposer kind={dialog.compose} prompt={dialog.prompt || ''} detail={dialog.detail || ''} api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
    </div>
    </ImageLoader.Provider>
  );
}

// ── What Claude is doing ────────────────────────────────────────────────────

const ACTIVITY_FRESH_MS = 2 * 60 * 1000;
const ACTIVITY_ICON = { edit: 'PencilSimple', read: 'FileText', run: 'Terminal', search: 'MagnifyingGlass', web: 'Globe', agent: 'UsersThree', plan: 'ListChecks', other: 'Gear' };

/**
 * LIVE: WHAT CLAUDE CODE IS DOING (owner, 2026-10-04). One line per tool,
 * from the plugin's hook: what kind of thing and which file, never what is in
 * it. The newest line leads; the host also sees the last few. Quiet after two
 * minutes without a line, so a stale "Editing…" never sits on the wall.
 */
export function ClaudeActivity({ activity, agent, now, full }) {
  const items = (activity || []).slice().reverse();
  const latest = items[0];
  const fresh = latest && now - Date.parse(latest.at) < ACTIVITY_FRESH_MS;
  if (!latest && !(agent && agent.connected)) return null;
  return (
    <section className={`brm-panel brm-activity${fresh ? ' is-live' : ''}`} aria-labelledby="brm-activity-h" aria-live="polite">
      <h2 className="brm-h5" id="brm-activity-h">{fresh ? 'Claude Code is working' : 'Claude Code'}</h2>
      {latest ? (
        <p className="brm-activity-now" data-testid="brm-activity-now">
          <Icon name={ACTIVITY_ICON[latest.kind] || 'Gear'} size={18} />
          <span>{latest.text}</span>
          <span className="brm-muted brm-small">{agoText(latest.at, now) || 'just now'}</span>
        </p>
      ) : (
        <p className="brm-hint">Nothing yet. What Claude does shows up here as it works.</p>
      )}
      {full && items.length > 1 && (
        <ul className="brm-activity-list">
          {items.slice(1, 8).map((a) => (
            <li key={`${a.at}:${a.text}`}>
              <Icon name={ACTIVITY_ICON[a.kind] || 'Gear'} size={14} />
              <span>{a.text}</span>
              <span className="brm-muted brm-small">{agoText(a.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

export function agentChipText(agent, now) {
  if (!agent) return 'Claude Code not connected';
  const name = agent.name || 'Claude Code';
  if (agent.listening) return `${name} is listening for you`;
  if (agent.connected) return `${name} connected · active ${agoText(agent.lastSeenAt, now) || 'just now'}`;
  if (agent.lastSeenAt) return `${name} last seen ${agoText(agent.lastSeenAt, now)}`;
  return `${name} not connected`;
}

/** What the host does when Claude Code has gone quiet (owner, 2026-10-05). */
export const CONTINUE_COMMAND = pluginCommand('continue');

/**
 * Claude's status in the header. When Claude Code was here and has stopped
 * ("last seen 4 min ago"), the chip is the fix: one click copies
 * /engage:continue to paste into the Claude Code window, and its tooltip
 * says so (owner, 2026-10-05). Connected, or never connected, it explains
 * itself on hover and does nothing on click.
 */
function AgentChip({ agent, now }) {
  const [copied, setCopied] = useState('');
  const quiet = Boolean(agent && agent.lastSeenAt && !agent.connected && !agent.listening);
  const cls = `brm-agentchip${agent && agent.connected ? ' is-on' : ''}${quiet ? ' is-quiet' : ''}`;
  if (!quiet) {
    const tip = !agent || !agent.lastSeenAt
      ? 'Claude Code has not connected yet. Use More, then Connect Claude Code.'
      : agent.listening
        ? 'Claude Code is waiting for your next direction.'
        : 'Claude Code is connected and working.';
    return <span className={cls} data-testid="brm-agentchip" title={tip}>{agentChipText(agent, now)}</span>;
  }
  const copy = async () => {
    const ok = await copyText(CONTINUE_COMMAND);
    setCopied(ok ? `Copied ${CONTINUE_COMMAND}. Paste it into Claude Code.` : `Copy failed. Type ${CONTINUE_COMMAND} into Claude Code.`);
    setTimeout(() => setCopied(''), 4000);
  };
  return (
    <button
      type="button"
      className={cls}
      data-testid="brm-agentchip"
      title={`Claude Code has stopped. Click to copy ${CONTINUE_COMMAND}, then paste it into the Claude Code window and press Enter.`}
      onClick={copy}
    >
      {copied || agentChipText(agent, now)}
    </button>
  );
}

const CONNECTION = {
  live: { text: 'Live', title: 'Connected to the room. Changes arrive as they happen.' },
  connecting: { text: 'Connecting…', title: 'Opening the live connection to the room.' },
  disconnected: { text: 'Disconnected · Reconnect', title: 'The live connection dropped. Click to reconnect now; it also retries on its own.' },
  offline: { text: 'No internet · Try again', title: 'This laptop is offline. The room reconnects when it is back.' },
  signin: { text: 'Signed out · Sign in again', title: 'Your sign-in has run out. Sign in again and you come straight back to this room.' },
};

/**
 * AUTO (owner, 2026-10-04): Claude's questions open to the room as soon as it
 * asks them, with no review step. The same setting as "Review Claude's
 * questions" in the Connect panel, the other way round, kept in sight.
 */
export function AutoSwitch({ settings, busy, run, api }) {
  const auto = settings ? settings.reviewAgentAsks === false : false;
  return (
    <label className={`brm-auto${auto ? ' is-on' : ''}`} title="When on, Claude's questions open to the room straight away, with no review first">
      <input
        type="checkbox"
        role="switch"
        checked={auto}
        disabled={busy}
        onChange={(e) => run(() => api.saveSettings({ reviewAgentAsks: !e.target.checked }))}
      />
      <span>Auto-open Claude&apos;s questions</span>
    </label>
  );
}

/** The host's one connection status. A button whenever there is something to do. */
export function ConnectionChip({ connection = 'live', onReconnect }) {
  const c = CONNECTION[connection] || CONNECTION.live;
  if (connection === 'live' || connection === 'connecting') {
    return <span className={`brm-conn brm-conn--${connection}`} title={c.title} data-testid="brm-conn">{c.text}</span>;
  }
  return (
    <button type="button" className={`brm-conn brm-conn--${connection}`} title={c.title} onClick={onReconnect} data-testid="brm-conn">
      {c.text}
    </button>
  );
}

/**
 * THE SESSION MENU (owner, 2026-10-05: "too much to take in"). The header's
 * once-a-session controls live here, out of the room's sight: Connect Claude
 * Code, the crew, Auto, Wrap up, Report, End session. A pick that opens a
 * dialog closes the menu; a switch leaves it open. A click inside a dialog
 * the menu opened (Run crew code asks first) is not "outside".
 */
function SessionMenu({ children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('[role="dialog"]')) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="brm-more" ref={ref}>
      <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        More <Icon name="CaretDown" size={14} />
      </button>
      {open && (
        <div className="brm-more-panel" role="group" aria-label="Session">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * THE HEADER, the same on all four screens: the title, the screens, the open
 * ask, Claude's status, the join code. On the Host screen it adds the live
 * connection and the session menu; on a screen the room sees, nothing in it
 * is host-only (the Host tab's count is a number, never content).
 */
function RoomHeader({ room, now, host, screen, onScreen, onConnect, onWrap, onReport, onEnd, onCrew, crew, busy, run, api, ended, connection, onReconnect }) {
  const waiting = waitingCount(room);
  const pill = askPill(room);
  const [qr, setQr] = useState(false);
  const playUrl = `${window.location.origin}/play?gameId=${room.gameId}`;
  const pick = (close, fn) => () => { close(); fn(); };
  return (
    <header className="brm-hbar">
      <div className="brm-hbar-title">
        <span className="brm-t" title={room.title}>{room.title || 'Build Room'}</span>
        {room.goal && <span className="brm-goal" title={room.goal}>{room.goal}</span>}
      </div>
      <nav className="brm-screens" aria-label="Screens">
        {SCREENS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`brm-screen${screen === s.key ? ' is-on' : ''}`}
            aria-pressed={screen === s.key}
            title={`${s.label} (${s.shortcut})`}
            onClick={() => onScreen(s.key)}
          >
            {s.label}
            {s.key === 'host' && waiting > 0 && <span className="brm-screen-n">{waiting}<span className="brm-sr"> waiting</span></span>}
          </button>
        ))}
      </nav>
      {pill && (
        <button type="button" className={`brm-askpill${pill.results ? ' is-results' : ''}`} title="Show it on the Stage (2)" onClick={() => onScreen('stage')}>
          {pill.text}
        </button>
      )}
      <div className="brm-hbar-tools">
        <AgentChip agent={room.agent} now={now} />
        {host && <ConnectionChip connection={connection} onReconnect={onReconnect} />}
        <button type="button" className="brm-codewrap brm-codebtn" title="Show the QR code" aria-label={`Join code ${room.gameId}. Show the QR code`} onClick={() => setQr(true)}>
          <span className="brm-muted brm-small">Join</span> <span className="brm-code">{room.gameId}</span>
        </button>
        <span className="brm-chip">{room.playerCount || 0} joined</span>
        {qr && <QrZoom playUrl={playUrl} gameId={room.gameId} onClose={() => setQr(false)} />}
        {host && (
          <SessionMenu>
            {(close) => (
              <>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={pick(close, onConnect)}>
                  <Icon name="Lock" size={14} /> Connect Claude Code
                </button>
                {!ended && (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={pick(close, onCrew)}>
                    <Icon name="UsersThree" size={14} /> {crew ? 'Crew' : 'Open to a crew'}
                  </button>
                )}
                {crew && <RunCrewCodeSwitch crew={crew} busy={busy} run={run} api={api} />}
                {!ended && <AutoSwitch settings={room.settings} busy={busy} run={run} api={api} />}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={pick(close, onWrap)}>Wrap up</button>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={pick(close, onReport)}>
                  <Icon name="FileText" size={14} /> Report
                </button>
                {!ended && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" onClick={pick(close, onEnd)}>End session</button>}
              </>
            )}
          </SessionMenu>
        )}
      </div>
    </header>
  );
}

/**
 * ONE OPEN AT A TIME (owner, 2026-10-05): "when you open one the other close.
 * but you never scroll the browser window, just the active open box." The
 * open section takes the column's height and scrolls inside itself; the
 * closed ones are a row each. One is always open: Timeline to start.
 */
function HistoryStack({ items }) {
  const [open, setOpen] = useState(items[0].key);
  return (
    <div className="brm-stack">
      {items.map((it) => {
        const isOpen = open === it.key;
        return (
          <div key={it.key} className={`brm-stackitem${isOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="brm-stackhead"
              aria-expanded={isOpen}
              aria-controls={`brm-stack-${it.key}`}
              onClick={() => setOpen(it.key)}
            >
              <Icon name={isOpen ? 'CaretDown' : 'CaretRight'} size={14} />
              {it.label}
              <span className="brm-muted">{` · ${it.count}`}</span>
            </button>
            {isOpen && <div className="brm-stackbody" id={`brm-stack-${it.key}`}>{it.body}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── The Stage screen ────────────────────────────────────────────────────────

/**
 * STAGE: what the room reads during an ask, drawn by the regular host stage's
 * own parts (components/stage/: Stage, Rail, RoomMeter, Dock), so a Build Room
 * ask looks and behaves like any other session on the projector: the same
 * display profiles and fitter, the phase chip and join code in the rail, the
 * count in the meter, one move in the dock on Space. The rail is this screen's
 * header; HOST at the dock's edge (or 1, or P) goes back, as SESSION does on
 * the regular stage. Everything on it is room-safe (stageModel); deciding needs
 * words, so at results the move is back to the Host screen.
 */
function BuildStage({ room, current, crewOn, crew, onWall, busy, ended, run, api, now, onHost, pickId, onPick }) {
  const [profile] = useState(() => loadProfile(window.localStorage, window.innerWidth));
  const [qr, setQr] = useState(false);
  const m = stageModel(room, current);
  const waiting = waitingCount(room);
  const move = !ended && m.primary ? m.primary : null;
  const doMove = useCallback((m) => {
    if (!m || busy) return;
    // The dock's "Go with B" is the winner: back to the Host with its sentence.
    if (m.action === 'decide') { onPick(null); return; }
    run(() => api.askAction(current.askId, { action: m.action }));
  }, [busy, onPick, run, api, current]);
  const act = useCallback(() => doMove(move), [doMove, move]);
  // Space fires the dock's move: never while typing, and never when a focused
  // control would take the Space itself.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('button, a, [role="button"], [role="dialog"]')) return;
      e.preventDefault();
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);
  const body = m.meter.of === null ? String(m.meter.count) : <>{m.meter.count}<small>{` / ${m.meter.of}`}</small></>;
  const playUrl = `${window.location.origin}/play?gameId=${room.gameId}`;
  let content;
  if (crewOn) {
    content = (
      <>
        {onWall && <EarlyLook key={onWall.shareId} share={onWall} crew={crew} host={false} stage />}
        <CrewBoard crew={crew} host={false} now={now} busy={busy} run={run} api={api} onOpen={() => undefined} playerCount={room.playerCount} />
      </>
    );
  } else if (current && m.wheel) {
    content = (
      <section className="brm-stage brm-wheelstage" aria-label="The wheel">
        <span className="brm-eyebrow"><b>The wheel</b> · Ask {Number(current.askId) || current.askId}</span>
        <h2 className="brm-q">{current.prompt}</h2>
        <BuildWheel wheel={current.wheel} size="lg" />
      </section>
    );
  } else if (current) {
    content = <AskStage key={`${current.askId}:${current.status}`} ask={current} room={room} host={false} busy={busy} ended={ended} run={run} api={api} pickId={pickId} onPick={onPick} />;
  } else {
    content = <IdleStage room={room} now={now} host={false} />;
  }
  return (
    <>
      <Stage
        profile={profile}
        phase={m.phase || ''}
        fitKey={[current ? `${current.askId}:${current.status}:${current.answerCount}:${current.voteCount}:${current.wheel ? current.wheel.spins.length : 0}` : 'idle', crewOn ? 'crew' : ''].join('|')}
        rail={(
          <Rail
            phase={m.phase}
            title={room.title || 'Build Room'}
            context={m.context}
            join={ended
              ? { code: room.gameId, closed: true }
              : { url: `${window.location.host}/play`, code: room.gameId, onPreview: () => undefined, onPreviewEnd: () => undefined, onPin: () => setQr(true) }}
          />
        )}
        meter={<RoomMeter phase={m.phase || 'LOBBY'} heading={m.meter.heading} body={body} />}
        dock={(
          <Dock status={m.status}>
            {!ended && m.secondary && <button type="button" className="btn ghost" disabled={busy} onClick={() => doMove(m.secondary)}>{m.secondary.label}</button>}
            {move && <button type="button" className="btn" disabled={busy} onClick={act}>{move.label}</button>}
            {/* The key sits beside the move it fires, as on the regular stage; HOST stays last. */}
            {move && <span className="kbd" aria-hidden="true">SPACE</span>}
            <button type="button" className="dock-more" onClick={onHost} aria-label="Host screen" title="Host screen (1 or P)">
              <span className="dock-more-lbl">HOST</span>
              {waiting > 0 && <span className="brm-screen-n">{waiting}</span>}
            </button>
          </Dock>
        )}
      >
        <div className="content"><div className="fitbox">{content}</div></div>
      </Stage>
      <WallComment comment={freshWallComment(room, now)} />
      {qr && <QrZoom playUrl={playUrl} gameId={room.gameId} onClose={() => setQr(false)} />}
    </>
  );
}

// ── The Build and History screens ───────────────────────────────────────────

/**
 * BUILD: what Claude has built so far (owner, 2026-10-05: "present is really
 * switching to the local live view of the development server"). Showing the
 * running page inside Engage waits on a browser check (PLAN step 0: an https
 * page could not frame localhost in Chromium 152), so this screen shows the
 * newest screenshot and opens the running build in a new tab: the fallback
 * the design keeps anyway (C8).
 */
function BuildScreen({ room, now }) {
  const { link, shot } = latestBuild(room);
  return (
    <section className="brm-screenbody brm-buildscreen" aria-label="The build">
      <WallComment comment={freshWallComment(room, now)} />
      <div className="brm-row">
        <h2 className="brm-q">What Claude has built so far</h2>
        {link && <span className="brm-push"><OpenLink href={link} label="Open the build" primary /></span>}
      </div>
      {shot ? (
        <BuildImage imageId={shot.imageId} caption={shot.caption} className="brm-shot brm-shot--build" />
      ) : (
        <div className="brm-empty">Nothing to show yet. When Claude previews the work, its newest screenshot appears here.</div>
      )}
    </section>
  );
}

/**
 * HISTORY: the room's story so far, to look back on together. The decisions,
 * the timeline as the wall shows it (no host notes, no idea authors), and
 * every screenshot. Nothing here edits; the Host screen does that.
 */
function HistoryScreen({ room }) {
  const decided = (room.asks || [])
    .filter((a) => a.status === 'decided' && a.decision)
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  const images = (room.images || []).slice().reverse();
  const noop = () => undefined;
  return (
    <div className="brm-screenbody brm-histscreen">
      <Timeline log={room.log || []} host={false} busy={false} ended run={noop} api={null} deleteAs="" />
      <div className="brm-histside">
        <section className="brm-panel" aria-labelledby="brm-decided-h">
          <h2 className="brm-h" id="brm-decided-h">Decided so far</h2>
          {decided.length ? (
            <ol className="brm-list brm-decided">
              {decided.map((a) => (
                <li key={a.askId}>
                  {a.decision.direction || a.prompt}
                  {a.decision.method && <span className="brm-muted brm-small">{` · ${METHOD_WORDS[a.decision.method] || a.decision.method}`}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="brm-hint">Nothing decided yet.</p>
          )}
        </section>
        <section className="brm-panel" aria-labelledby="brm-artifacts-h">
          <h2 className="brm-h" id="brm-artifacts-h">Screenshots</h2>
          {images.length ? (
            <div className="brm-shotgrid">
              {images.map((im) => (
                <BuildImage key={im.imageId} imageId={im.imageId} caption={im.caption || (im.label ? `Choice ${im.label}` : '')} className="brm-shot brm-shot--grid" />
              ))}
            </div>
          ) : (
            <p className="brm-hint">Claude&apos;s screenshots collect here as it works.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** The full join link, copied with one click, so the host can paste it into a chat or an email. */
function CopyLinkButton({ url, className, children }) {
  const [said, setSaid] = useState('');
  const copy = async (e) => {
    e.stopPropagation(); // inside the enlarged QR, a click anywhere else closes it
    const ok = await copyText(url);
    setSaid(ok ? 'Link copied' : 'Press and hold to copy');
    setTimeout(() => setSaid(''), 2500);
  };
  return (
    <button type="button" className={className} onClick={copy} title={`Copy ${url}`} aria-label={`Copy the join link ${url}`}>
      {children}
      <span className="brm-copied" role="status">{said}</span>
    </button>
  );
}

/**
 * The QR, big enough to scan from the back of the room (owner, 2026-10-04).
 * A click anywhere puts it away; the link under it copies instead.
 */
export function QrZoom({ playUrl, gameId, onClose }) {
  return (
    <Modal overlayClassName="brm-qrzoom" contentClassName="brm-qrzoom-card" onClose={onClose} label="Join QR code">
      <div className="brm-qrzoom-body" onClick={onClose}>
        <div className="brm-qrzoom-qr" role="img" aria-label={`QR code to join at ${playUrl}`}>
          <QRCodeSVG value={playUrl} size={512} level="M" includeMargin={false} />
        </div>
        <CopyLinkButton url={playUrl} className="brm-qrzoom-url">{playUrl}</CopyLinkButton>
        <div className="brm-qrzoom-code">Code <b>{gameId}</b></div>
        <p className="brm-qrzoom-hint">Click anywhere to put it away. Click the link to copy it.</p>
      </div>
    </Modal>
  );
}

// ── Review (proposed) ───────────────────────────────────────────────────────

function ReviewCard({ ask, busy, ended, run, api, connected }) {
  const [prompt, setPrompt] = useState(ask.prompt);
  const [detail, setDetail] = useState(ask.detail || '');
  const [options, setOptions] = useState(() => (ask.options || []).map((o) => ({ ...o })));
  const [low, setLow] = useState(ask.scale?.lowLabel || '');
  const [high, setHigh] = useState(ask.scale?.highLabel || '');

  const optionsDirty = JSON.stringify(options.map(({ title, detail: d, url }) => [title, d, url]))
    !== JSON.stringify((ask.options || []).map(({ title, detail: d, url }) => [title, d, url]));
  const dirty = prompt !== ask.prompt || detail !== (ask.detail || '') || optionsDirty
    || low !== (ask.scale?.lowLabel || '') || high !== (ask.scale?.highLabel || '');

  const editBody = () => ({
    action: 'edit',
    prompt,
    detail,
    ...(ask.kind === 'choice' ? { options: options.map(({ title, detail: d, url }) => ({ title, detail: d, url })) } : {}),
    ...(ask.kind === 'rating' ? { lowLabel: low, highLabel: high } : {}),
  });

  const save = () => run(() => api.askAction(ask.askId, editBody()));
  const open = () => run(async () => {
    if (dirty) await api.askAction(ask.askId, editBody());
    return api.askAction(ask.askId, { action: 'open' });
  });
  const discard = () => run(() => api.askAction(ask.askId, { action: 'discard' }));
  const setOpt = (i, key, value) => setOptions((list) => list.map((o, j) => (j === i ? { ...o, [key]: value } : o)));
  const letter = (i) => String.fromCharCode(65 + i);

  // PREVIEWS BEFORE THE ROOM SEES IT (owner, 2026-10-04). An option with no
  // screenshot and no preview link is judged by its title alone. Claude is told
  // to attach mockups before it waits; when it has not, the host can ask for
  // them here, and Claude gets the direction at once (wait_for_room returns on
  // a direction, engage-mcp.mjs).
  const [askedMockups, setAskedMockups] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const missing = ask.kind === 'choice'
    ? (ask.options || []).map((o, i) => (o.imageId || o.url ? null : (o.label || letter(i)))).filter(Boolean)
    : [];
  const askForMockups = async () => {
    const list = missing.join(', ');
    const out = await run(() => api.postDirection(
      `Before ask ${askNumber(ask.askId)} opens to the room: make a quick mockup of ${missing.length === 1 ? `option ${list}` : `options ${list}`}, `
      + `stamp each with its letter, screenshot it, and attach it to its option with share_image (askId "${ask.askId}", label ${list}). `
      + 'Then tell me they are in.',
    ));
    if (out !== undefined) setAskedMockups(true);
  };

  return (
    <section className="brm-panel brm-proposed" aria-label={`Proposed ask ${askNumber(ask.askId)}`}>
      <div className="brm-row brm-gap">
        <span className="brm-chip brm-chip--amber">{ask.source === 'agent' ? 'Proposed by Claude' : 'Draft'} · not shown to the room</span>
        {ask.source === 'agent' && connected && <span className="brm-muted brm-small brm-push">Claude is waiting</span>}
      </div>
      <div className="brm-row brm-gap">
        <h2 className="brm-h">Ask {askNumber(ask.askId)} · {KIND_LABEL[ask.kind]}</h2>
        {ask.kind === 'choice' && <span className="brm-hint brm-push">Options can change until someone answers</span>}
      </div>
      <p className="brm-stagehint">{stageHint(ask)}</p>
      {/* WHAT THE ROOM WOULD SEE, then the edits folded (C2): most of
          Claude's asks open as written, so the fields are one click away. */}
      <p className="brm-reviewq">{prompt || ask.prompt}</p>
      {ask.kind === 'choice' && (
        <ul className="brm-reviewopts">
          {options.map((o, i) => (
            <li key={o.label || i}>
              <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letter(i)}</span>
              <span className="brm-reviewopt-t">{o.title}</span>
              <BuildImage imageId={(ask.options[i] || {}).imageId} alt={`Choice ${letter(i)}`} className="brm-shot brm-shot--thumb" />
            </li>
          ))}
        </ul>
      )}
      {ask.kind === 'rating' && (low || high) && <p className="brm-hint">1 means {low || '…'} · 5 means {high || '…'}</p>}
      {missing.length > 0 && !ended && (
        <div className="brm-notice brm-row brm-gap" role="status" data-testid="brm-previews-missing">
          {askedMockups ? (
            <span>Asked Claude for mockups. Each appears under its option as Claude attaches it.</span>
          ) : (
            <span>
              <b>No preview for {missing.length === 1 ? `option ${missing[0]}` : `options ${missing.join(', ')}`} yet.</b>{' '}
              {connected
                ? 'The room chooses faster from a picture. Claude can make a quick mockup of each.'
                : 'Claude is not connected, so it cannot make mockups now. Add a preview URL under Edit, or open the ask without.'}
            </span>
          )}
          {connected && !askedMockups && (
            <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={askForMockups}>Ask Claude for mockups</button>
          )}
        </div>
      )}
      <details className="brm-fold brm-editfold" open={editOpen || dirty} onToggle={(e) => setEditOpen(e.currentTarget.open)}>
        <summary>Edit the question and options</summary>
        <div className="brm-editbody">
        <label className="brm-field">
          <span className="brm-lbl">Question (shown big on the wall)</span>
          <input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <label className="brm-field">
          <span className="brm-lbl">Context (optional)</span>
          <textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} />
        </label>
        {ask.kind === 'choice' && (
          <div className="brm-field">
            <span className="brm-lbl">Options</span>
            {options.map((o, i) => (
              <div className="brm-optedit" key={o.label || i}>
                <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letter(i)}</span>
                <div className="brm-optfields">
                  <input className="brm-input" aria-label={`Option ${letter(i)} title`} value={o.title} maxLength={120} onChange={(e) => setOpt(i, 'title', e.target.value)} />
                  <input className="brm-input brm-input--sm" aria-label={`Option ${letter(i)} preview URL`} placeholder="Preview URL (optional, http or https)" value={o.url || ''} onChange={(e) => setOpt(i, 'url', e.target.value)} />
                  <BuildImage imageId={(ask.options[i] || {}).imageId} alt={`Choice ${letter(i)}`} className="brm-shot brm-shot--thumb" />
                </div>
                {/* Only the LAST option can go: the server letters options by
                    position, and Claude has already stamped "Choice A" and "B". */}
                {i === options.length - 1 && options.length > 2 ? (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" aria-label={`Remove ${letter(i)}`} onClick={() => setOptions((l) => l.slice(0, -1))}>
                    <Icon name="X" size={14} />
                  </button>
                ) : <span />}
              </div>
            ))}
            {options.length < 6 && (
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setOptions((l) => [...l, { title: '', detail: '', url: '' }])}>
                <Icon name="Plus" size={14} /> Add option
              </button>
            )}
            <div className="brm-notice"><b>Letters are fixed.</b> Claude stamps &quot;Choice A&quot;, &quot;Choice B&quot; on its mockups, so renaming an option keeps its letter.</div>
          </div>
        )}
        {ask.kind === 'rating' && (
          <div className="brm-two">
            <label className="brm-field"><span className="brm-lbl">1 means</span><input className="brm-input" value={low} maxLength={40} onChange={(e) => setLow(e.target.value)} /></label>
            <label className="brm-field"><span className="brm-lbl">5 means</span><input className="brm-input" value={high} maxLength={40} onChange={(e) => setHigh(e.target.value)} /></label>
          </div>
        )}
        </div>
      </details>
      {!ended && (
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--ghostdanger" disabled={busy} onClick={discard}>Discard</button>
          {dirty && <button type="button" className="brm-btn brm-btn--ghost brm-push" disabled={busy} onClick={save}>Save edits</button>}
          {!answering && (
            <button type="button" className={`brm-btn brm-btn--ghost${dirty ? '' : ' brm-push'}`} disabled={busy || !prompt.trim()} onClick={() => setAnswering(true)}>Answer for the room</button>
          )}
          <button type="button" className={`brm-btn brm-btn--primary${answering && !dirty ? ' brm-push' : ''}`} disabled={busy || !prompt.trim()} onClick={open}>Open to the room</button>
        </div>
      )}
      {answering && !ended && (
        <DecidePanel
          ask={ask} busy={busy} run={run} api={api} spoken
          onCancel={() => setAnswering(false)}
          beforeDecide={dirty ? () => api.askAction(ask.askId, editBody()) : null}
        />
      )}
    </section>
  );
}

// ── The current ask ─────────────────────────────────────────────────────────

function AskStage({ ask, room, host, busy, ended, run, api, pickId = null, onPick = null }) {
  const [editing, setEditing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [prompt, setPrompt] = useState(ask.prompt);
  const [detail, setDetail] = useState(ask.detail || '');
  const act = (action) => run(() => api.askAction(ask.askId, { action }));
  const saveWording = async () => {
    const ok = await run(() => api.askAction(ask.askId, { action: 'edit', prompt, detail }));
    if (ok !== undefined) setEditing(false);
  };

  return (
    <>
      <section className={`brm-stage brm-stage--${ask.status}`} aria-label="Current ask">
        <div className="brm-top">
          <span className="brm-eyebrow">
            <b>{ask.status === 'voting' ? 'Vote' : KIND_LABEL[ask.kind]}</b> · Ask {askNumber(ask.askId)} · {ask.source === 'agent' ? 'Claude asks' : 'Host asks'}
            {ask.status === 'results' && ' · Closed'}
          </span>
          {host && !ended && (
            <span className="brm-hostkit">
              {!editing && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setEditing(true)}>Edit wording</button>}
              {ask.status === 'live' && ask.kind === 'suggest' && (
                <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => act('vote')}>Open voting</button>
              )}
              {['live', 'voting'].includes(ask.status) && !answering && (
                <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => setAnswering(true)}>Answer for the room</button>
              )}
              {/* The wheel instead of a vote (owner, 2026-10-06): close it and let chance pick. */}
              {['live', 'voting'].includes(ask.status) && ask.kind !== 'rating' && (
                <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Close it and let the wheel pick from every option" onClick={() => act('wheel')}>Spin the wheel instead</button>
              )}
              {['live', 'voting'].includes(ask.status) && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => act('close')}>Close</button>
              )}
              {ask.status === 'results' && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => act('reopen')}>Reopen</button>
              )}
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => act('discard')}>Discard</button>
            </span>
          )}
        </div>
        {host && !ended && <p className="brm-stagehint">{stageHint(ask)}</p>}
        {host && editing ? (
          <div className="brm-panel brm-inset">
            <label className="brm-field"><span className="brm-lbl">Question</span><input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
            <label className="brm-field"><span className="brm-lbl">Context</span><textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} /></label>
            <div className="brm-row brm-gap">
              <button type="button" className="brm-btn brm-btn--ghost" onClick={() => { setEditing(false); setPrompt(ask.prompt); setDetail(ask.detail || ''); }}>Cancel</button>
              <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !prompt.trim()} onClick={saveWording}>Save wording</button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="brm-q">{ask.prompt}</h2>
            {ask.detail && <p className="brm-detail">{ask.detail}</p>}
          </>
        )}

        {ask.kind === 'choice' && <ChoiceBoard ask={ask} pickId={pickId} onPick={onPick} />}
        {ask.kind === 'rating' && <RatingBoard ask={ask} />}
        {ask.kind === 'suggest' && <SuggestBoard ask={ask} host={host} busy={busy} ended={ended} run={run} api={api} pickId={pickId} onPick={onPick} />}
        {ask.status === 'results' && ask.kind !== 'suggest' && <Whys ask={ask} host={host} />}
      </section>
      {host && !ended && ask.status === 'results' && ask.kind !== 'rating' && (
        <WheelPanel ask={ask} busy={busy} run={run} api={api} />
      )}
      {host && !ended && ask.status === 'results' && (
        <DecidePanel key={`wheel:${ask.wheel ? ask.wheel.spins.length : 0}`} ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount} pickId={pickId} />
      )}
      {host && !ended && answering && ['live', 'voting'].includes(ask.status) && (
        <DecidePanel ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount} spoken onCancel={() => setAnswering(false)} />
      )}
    </>
  );
}

/**
 * THE WHEEL, OR A REVOTE (owner, 2026-10-05): "if a tie, it's either a wheel
 * spin or revote, host's choice", and the wheel any time at results. A random
 * person in the room spins it from their phone; the host can always spin;
 * if the room groans, spin again or hand it to someone else. Where it lands
 * fills in the direction below, which the host can still change.
 */
function WheelPanel({ ask, busy, run, api }) {
  const tied = (ask.results && ask.results.tied) || [];
  const act = (action, extra = {}) => run(() => api.askAction(ask.askId, { action, ...extra }));
  const nameOf = (id) => {
    if (ask.kind === 'choice') return id;
    const r = ((ask.results && ask.results.ranked) || []).find((x) => x.respId === id);
    return r ? `"${r.text}"` : id;
  };
  if (ask.revotedAs) {
    return <p className="brm-notice">Voted again as ask {Number(ask.revotedAs) || ask.revotedAs}.</p>;
  }
  if (!ask.wheel) {
    return (
      <section className="brm-panel brm-wheelpanel" aria-label="The wheel">
        {tied.length >= 2 ? (
          <p className="brm-notice"><b>A tie between {tied.map(nameOf).join(' and ')}.</b> Spin the wheel, or ask the room to vote again.</p>
        ) : (
          <p className="brm-hint">Let chance pick: the wheel holds every option.</p>
        )}
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--primary" disabled={busy} onClick={() => act('wheel')}>Spin the wheel</button>
          {tied.length >= 2 && <button type="button" className="brm-btn" disabled={busy} onClick={() => act('revote')}>Vote again</button>}
        </div>
        <p className="brm-hint">Someone in the room spins it from their phone. You can always spin it yourself.</p>
      </section>
    );
  }
  const w = ask.wheel;
  return (
    <section className="brm-panel brm-wheelpanel" aria-label="The wheel">
      <BuildWheel wheel={w} size="sm" busy={busy} onSpin={() => act('spin')} spinLabel={w.landed ? 'Spin again' : 'Spin it yourself'} />
      <div className="brm-row brm-gap brm-wheelacts">
        <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Pick someone else in the room to spin it" onClick={() => act('pass')}>Someone else spins</button>
      </div>
    </section>
  );
}

/**
 * "CHOOSE THIS INSTEAD" (owner, 2026-10-06), at results: the answer going to
 * Claude says so; every other one offers itself. On the Stage a click goes to
 * the Host with that answer's sentence in the direction; on the Host it swaps
 * the sentence in place, as often as the host changes their mind.
 */
function PickButton({ id, current, onPick, idea = false }) {
  if (current && id === current) return <span className="brm-pick is-on">Going to Claude</span>;
  const label = `Choose this${idea ? ' idea' : ''}${current ? ' instead' : ''}`;
  return <button type="button" className="brm-btn brm-btn--sm brm-pick" onClick={() => onPick(id)}>{label}</button>;
}

function ChoiceBoard({ ask, pickId = null, onPick = null }) {
  const picking = Boolean(onPick) && ask.status === 'results';
  const current = picking ? pickId || winnerOf(ask) : null;
  const opts = (ask.results && ask.results.options) || [];
  const lead = Math.max(0, ...opts.map((o) => o.count));
  return (
    <div className="brm-choices">
      {(ask.options || []).map((o, i) => {
        const r = opts.find((x) => x.label === o.label) || { count: 0, pct: 0 };
        return (
          <div key={o.label} className={`brm-choice brm-choice--${i % 3}${lead && r.count === lead ? ' is-lead' : ''}`}>
            <div className="brm-choice-head">
              <span className="brm-big" aria-hidden="true">{o.label}</span>
              <div className="brm-choice-text">
                <div className="brm-ct"><span className="brm-sr">Choice {o.label}: </span>{o.title}</div>
                {o.detail && <div className="brm-cd">{o.detail}</div>}
                <OpenLink href={o.url} label={`Open ${o.label}`} />
              </div>
            </div>
            <BuildImage imageId={o.imageId} alt={`Choice ${o.label}: ${o.title}`} className="brm-shot brm-shot--opt" />
            <div className="brm-bar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} /></div>
            <div className="brm-count"><b>{r.count}</b> {r.pct}%</div>
            {picking && <PickButton id={o.label} current={current} onPick={onPick} />}
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
            <span className="brm-distn">{n}{n === 1 && ask.scale?.lowLabel ? ` · ${ask.scale.lowLabel}` : ''}{n === 5 && ask.scale?.highLabel ? ` · ${ask.scale.highLabel}` : ''}</span>
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
  const picking = Boolean(onPick) && ask.status === 'results';
  const current = picking ? pickId || winnerOf(ask) : null;
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
      {!sorted.length && <div className="brm-empty">Suggestions appear here as phones send them. Anonymous on the wall.</div>}
      <ul className="brm-sugs">
        {sorted.map((r) => (
          <li key={r.respId} className={`brm-sug${r.hidden ? ' is-hidden' : ''}`}>
            <span className="brm-sug-text">{r.text}</span>
            {counting && (
              <span className="brm-sug-votes">
                <span className="brm-bar brm-bar--thin" aria-hidden="true"><span style={{ width: `${((r.votes || 0) / max) * 100}%` }} /></span>
                <b>{r.votes || 0}</b> {(r.votes || 0) === 1 ? 'vote' : 'votes'}
              </span>
            )}
            {host && <span className="brm-who">{r.source === 'host' ? 'from the room, out loud' : r.playerName}{r.hidden ? ' · hidden' : ''}</span>}
            {picking && !r.hidden && <PickButton id={r.respId} current={current} onPick={onPick} idea />}
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
          <input className="brm-input" aria-label="Add what the room said" placeholder="+ add what the room said out loud" value={said} maxLength={280} onChange={(e) => setSaid(e.target.value)} />
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

/**
 * The sentence Claude gets when the host answers FOR the room (people talked
 * instead of tapping): built from what the host picked, edited freely after.
 */
export function spokenDirection(ask, chosen) {
  // The question and the answer, as for a vote: that it was said out loud is
  // recorded on the decision, not told to Claude (owner, 2026-10-06).
  if (ask.kind === 'choice') {
    const picked = (ask.options || []).filter((o) => chosen.includes(o.label)).map((o) => o.title);
    return picked.length ? questionAnswer(ask.prompt, picked.join(' and ')) : '';
  }
  if (ask.kind === 'rating') return chosen[0] ? questionAnswer(ask.prompt, `${chosen[0]} out of 5`) : '';
  return '';
}

function DecidePanel({ ask, busy, run, api, playerCount, spoken = false, onCancel, beforeDecide, pickId = null }) {
  const [direction, setDirection] = useState(() => {
    if (spoken) return '';
    return pickId ? directionFor(ask, pickId) : defaultDirection(ask);
  });
  const [edited, setEdited] = useState(false);
  const [note, setNote] = useState('');
  const [send, setSend] = useState(true);
  const [folded, setFolded] = useState(() => new Set());
  const sources = foldSources(ask);
  const topChoice = !spoken && ask.kind === 'choice'
    ? [...((ask.results && ask.results.options) || [])].sort((a, b) => b.count - a.count).filter((o) => o.count)[0]
    : null;
  const [chosen, setChosen] = useState(() => {
    if (spoken) return [];
    if (pickId) return [pickId];
    if (ask.wheel && ask.wheel.landed) return [ask.wheel.landed];
    if (topChoice) return [topChoice.label];
    if (ask.kind === 'suggest' && ask.results?.ranked?.[0]) return [ask.results.ranked[0].respId];
    return [];
  });
  // A pick above ("choose this instead") swaps the sentence and the choice,
  // as often as the host changes their mind (owner, 2026-10-06).
  const firstPick = useRef(true);
  useEffect(() => {
    if (firstPick.current) { firstPick.current = false; return; }
    if (spoken || !pickId) return;
    setDirection(directionFor(ask, pickId));
    setChosen([pickId]);
    setFolded(new Set());
    setEdited(false);
  }, [pickId]); // eslint-disable-line react-hooks/exhaustive-deps
  // In spoken mode the sentence follows the picks until the host types in it.
  const pick = (next) => {
    setChosen(next);
    if (spoken && !edited) setDirection(spokenDirection(ask, next));
  };

  const toggleFold = (s) => {
    const next = new Set(folded);
    if (next.has(s.id)) {
      next.delete(s.id);
      setDirection((d) => removeSentence(d, s.text));
      if (s.respId) setChosen((c) => c.filter((x) => x !== s.respId));
    } else {
      next.add(s.id);
      setDirection((d) => appendSentence(d, s.text));
      if (s.respId) setChosen((c) => [...c, s.respId]);
    }
    setFolded(next);
  };
  const toggleChosen = (label) => pick(chosen.includes(label) ? chosen.filter((x) => x !== label) : [...chosen, label]);

  const decide = () => run(async () => {
    if (beforeDecide) await beforeDecide();
    return api.askAction(ask.askId, {
      action: 'decide', direction: direction.trim(), chosen, note: note.trim(), sendToAgent: send, ...(spoken ? { spoken: true } : {}),
      method: decisionMethod(ask, chosen, spoken),
    });
  });
  const total = ask.results?.total || 0;

  return (
    <section className="brm-panel brm-decide" aria-labelledby={`brm-decide-${ask.askId}`}>
      <h2 className="brm-h" id={`brm-decide-${ask.askId}`}>{spoken ? 'Answer for the room' : 'Direction for Claude'}</h2>
      <p className="brm-sub">{spoken
        ? 'For when people talk instead of tapping. Pick what the room said; Claude builds from the sentence below and is told it was said out loud.'
        : `Claude builds from this sentence, not from the counts. Edit it freely. ${total} of ${playerCount || 0} answered.`}</p>
      {spoken && ask.kind === 'rating' && (
        <div className="brm-field">
          <span className="brm-lbl">The room&apos;s rating</span>
          <div className="brm-foldchips">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`brm-fold${chosen[0] === String(n) ? ' is-in' : ''}`} aria-pressed={chosen[0] === String(n)} onClick={() => pick([String(n)])}>
                {n}{n === 1 && ask.scale?.lowLabel ? ` · ${ask.scale.lowLabel}` : ''}{n === 5 && ask.scale?.highLabel ? ` · ${ask.scale.highLabel}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <textarea className="brm-input brm-ta brm-dirbox" aria-label="Direction for Claude" value={direction} maxLength={2000} onChange={(e) => { setEdited(true); setDirection(e.target.value); }} placeholder={spoken ? 'What did the room decide?' : 'What should Claude do now?'} />
      {ask.kind === 'choice' && (
        <div className="brm-field">
          <span className="brm-lbl">{spoken ? 'What the room chose' : 'Chosen'}</span>
          <div className="brm-foldchips">
            {(ask.options || []).map((o) => (
              <button key={o.label} type="button" className={`brm-fold${chosen.includes(o.label) ? ' is-in' : ''}`} aria-pressed={chosen.includes(o.label)} onClick={() => toggleChosen(o.label)}>
                {o.label} · {o.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <div className="brm-field">
          <span className="brm-lbl">Fold in from the room</span>
          <div className="brm-foldchips">
            {sources.map((s) => (
              <button key={s.id} type="button" className={`brm-fold${folded.has(s.id) ? ' is-in' : ''}`} aria-pressed={folded.has(s.id)} onClick={() => toggleFold(s)}>
                <Icon name="Plus" size={12} /> {s.text}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="brm-field">
        <span className="brm-lbl">{spoken ? 'What people said (optional; goes to Claude with the answer)' : 'What the room said (optional; goes to Claude with the direction)'}</span>
        <input className="brm-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder='e.g. "show how many spots are left"' />
      </label>
      <div className="brm-row brm-gap">
        <label className="brm-toggle">
          <input type="checkbox" role="switch" checked={send} onChange={(e) => setSend(e.target.checked)} />
          <span>Send to Claude</span>
        </label>
        <span className="brm-hint">{send ? "Delivered on Claude's next call" : 'Recorded in the timeline only'}</span>
        {onCancel && <button type="button" className="brm-btn brm-btn--ghost brm-push" onClick={onCancel}>Cancel</button>}
        <button type="button" className={`brm-btn brm-btn--primary${onCancel ? '' : ' brm-push'}`} disabled={busy || (!direction.trim() && (spoken || !total))} onClick={decide}>
          <Icon name="ArrowRight" size={16} /> {send ? 'Send to Claude' : 'Record decision'}
        </button>
      </div>
    </section>
  );
}

// ── Between asks ────────────────────────────────────────────────────────────

const TICKER_KINDS = ['progress', 'showing', 'milestone'];

/** Claude has wrapped up: the stage says so, and the demo is one click away. */
function WrappedStage({ outcome, agent, images = [] }) {
  const links = outcome.links || [];
  const finals = images.filter((i) => i.kind === 'final');
  return (
    <section className="brm-stage brm-stage--wrapped" aria-label="What we built">
      <div className="brm-building">
        <span className="brm-donemark" aria-hidden="true"><Icon name="CheckCircle" size={30} weight="fill" /></span>
        <h2 className="brm-q">What we built</h2>
        {agent && agent.listening && <span className="brm-mins">Claude is listening</span>}
      </div>
      <p className="brm-wrapsum">{outcome.summary}</p>
      {finals.length > 0 && (
        <div className="brm-gallery">
          {finals.map((im) => <BuildImage key={im.imageId} imageId={im.imageId} caption={im.caption} className="brm-shot brm-shot--final" />)}
        </div>
      )}
      {links.length > 0 && (
        <div className="brm-openrow">
          {links.map((l, i) => (
            <OpenLink key={`${l.url}:${i}`} href={l.url} label={l.label || (i === 0 ? 'Open the demo' : l.url)} primary={i === 0} />
          ))}
        </div>
      )}
      <div className="brm-two">
        {outcome.built && outcome.built.length > 0 && (
          <div>
            <h3 className="brm-h5">Built</h3>
            <ul className="brm-list">{outcome.built.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
        {outcome.nextSteps && outcome.nextSteps.length > 0 && (
          <div>
            <h3 className="brm-h5">Next steps</h3>
            <ul className="brm-list">{outcome.nextSteps.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}

function IdleStage({ room, now, host }) {
  if (room.outcome && room.outcome.summary) return <WrappedStage outcome={room.outcome} agent={room.agent} images={room.images || []} />;
  const shots = (room.images || []).filter((i) => i.kind !== 'mockup');
  const latestShot = shots[shots.length - 1] || null;
  const log = room.log || [];
  const agentPosts = log.filter((l) => l.by === 'agent' && TICKER_KINDS.includes(l.kind));
  const ticker = agentPosts.slice(-3).reverse();
  const decided = (room.asks || []).filter((a) => a.status === 'decided' && a.decision).sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  const latest = decided[decided.length - 1] || null;
  const since = latest ? latest.decidedAt : (agentPosts[0] && agentPosts[0].createdAt);
  const mins = since ? Math.max(0, Math.round((now - Date.parse(since)) / 60000)) : null;
  const waiting = !agentPosts.length && !(room.agent && room.agent.connected);

  return (
    <section className="brm-stage brm-stage--idle" aria-label="Claude is building">
      <div className="brm-building">
        <span className="brm-pulse" aria-hidden="true" />
        <h2 className="brm-q">{waiting ? 'Waiting for Claude Code…' : room.agent && room.agent.listening ? 'Claude is listening…' : 'Claude is building…'}</h2>
        {!waiting && mins !== null && <span className="brm-mins">working for {mins} min</span>}
      </div>
      {host && <p className="brm-stagehint">{waiting ? 'Connect Claude Code, then paste the Kick off prompt.' : stageHint(null)}</p>}
      {latest && (
        <div className="brm-latest">
          <div className="brm-kind">Latest decision · Ask {askNumber(latest.askId)}</div>
          <div className="brm-tx">{latest.decision.direction}</div>
        </div>
      )}
      {latestShot && <BuildImage imageId={latestShot.imageId} caption={latestShot.caption} className="brm-shot brm-shot--latest" />}
      {ticker.length > 0 ? (
        <ul className="brm-ticker">
          {ticker.map((t, i) => (
            <li key={t.logId} className={i === 0 ? 'is-newest' : undefined}>
              <span className="brm-kind">{t.kind}</span>
              <span className="brm-tx">{t.text}</span>
              <span className="brm-ago">{agoText(t.createdAt, now)}</span>
              {safeHref(t.link) && <span className="brm-tickopen"><OpenLink href={t.link} label="Open" /></span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="brm-empty">Claude&apos;s progress posts appear here while it builds.</div>
      )}
    </section>
  );
}

// ── Screenshots ─────────────────────────────────────────────────────────────

const SHOT_KIND = { mockup: 'Mockup', final: 'Final', progress: 'Progress' };

/** Every screenshot Claude sent, for the host to check or remove. */
/*
  THE OWNER'S DELETE RULE (2026-10-04): GET build/state says the role this
  host would delete in (`deleteAs`). Engage staff give a reason in the same
  inline confirm; '' means this caller may not remove anything here.
*/
const NOT_YOURS = 'Only the host who created this room, or an owner or admin of its team, can delete from it.';

function ShotsPanel({ images, busy, run, api, deleteAs }) {
  const [confirm, setConfirm] = useState(null);
  const [reason, setReason] = useState('');
  const asStaff = deleteAs === 'platform-admin';
  return (
    <section className="brm-panel" aria-labelledby="brm-shots-h">
      <h2 className="brm-h" id="brm-shots-h">Screenshots</h2>
      {!images.length ? (
        <p className="brm-hint">Claude&apos;s screenshots of mockups and of the finished product collect here, and go into the report.</p>
      ) : (
        <div className="brm-shotgrid">
          {images.slice().reverse().map((im) => (
            <div className="brm-shotcell" key={im.imageId}>
              <BuildImage imageId={im.imageId} caption={im.caption} className="brm-shot brm-shot--grid" />
              <div className="brm-row brm-gap brm-small">
                <span className="brm-chip">{im.label ? `Choice ${im.label}` : SHOT_KIND[im.kind] || im.kind}</span>
                {confirm === im.imageId ? (
                  <>
                    {asStaff && (
                      <DeleteReasonField id={`brm-reason-${im.imageId}`} value={reason} onChange={setReason} scope="brm" labelClass="brm-lbl" inputClass="brm-input brm-ta brm-ta--sm" hintClass="brm-hint" />
                    )}
                    <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirm(null)}>Keep</button>
                    <button type="button" className="brm-btn brm-btn--sm brm-btn--dangersolid" disabled={busy || (asStaff && !reason.trim())} onClick={() => run(() => api.deleteImage(im.imageId, asStaff ? reason.trim() : ''))}>Remove</button>
                  </>
                ) : (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-danger brm-push" aria-label={`Remove ${im.caption || 'screenshot'}`} disabled={deleteAs === ''} title={deleteAs === '' ? NOT_YOURS : undefined} onClick={() => { setReason(''); setConfirm(im.imageId); }}>Remove</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── What next ───────────────────────────────────────────────────────────────

/** What a direction will do, said honestly: Claude only hears it on a call. */
export function deliveryLine(agent) {
  if (agent && agent.listening) return 'Claude is listening. It will act on this straight away.';
  if (agent && agent.connected) return 'Claude reads this on its next step.';
  return 'Claude reads this when it next calls Engage. If it has stopped, paste the Continue prompt into Claude Code.';
}

const CONTINUE_PROMPT = PROMPT_CARDS.find((c) => c.name === 'continue');
const PREVIEW_PROMPT = PROMPT_CARDS.find((c) => c.name === 'preview');
const SHARE_REPO_CARD = PROMPT_CARDS.find((c) => c.name === 'share-repo');

/**
 * NOW, BETWEEN ASKS (C1): what Claude is doing, the latest decision, and the
 * two things the host does with the build: show it to the room (the Build
 * screen) or ask Claude to run it and send a screenshot. When Claude has
 * gone quiet, the Continue prompt is one click away.
 */
export const STARTER_PROMPT = 'What should we build?';

function NowBuilding({ room, now, ended, busy, run, api, onShowBuild, onCompose }) {
  const [sent, setSent] = useState(false);
  if (room.outcome && room.outcome.summary) return <WrappedStage outcome={room.outcome} agent={room.agent} images={room.images || []} />;
  const agent = room.agent || {};
  const quiet = !(agent.listening || agent.connected);
  const decided = (room.asks || []).filter((a) => a.status === 'decided' && a.decision)
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  const latest = decided[decided.length - 1] || null;
  const line = ended ? 'This session has ended.'
    : agent.listening ? 'Claude is listening for you.'
      : agent.connected ? 'Claude is building.'
        : 'Waiting for Claude Code.';
  // A ROOM THAT BEGINS WITH AN ASK (owner, 2026-10-05): before anything is
  // built, the room picks what to build. The host lists the options or the
  // room suggests; a tie goes to the wheel or a revote (WheelPanel); and the
  // host can pick one and send it to Claude at any point.
  const starter = !ended && !(room.asks || []).length && onCompose;
  return (
    <section className="brm-panel brm-nowcard" aria-labelledby="brm-now-h">
      <h2 className="brm-h5" id="brm-now-h">Now</h2>
      {starter && (
        <div className="brm-starter">
          <p className="brm-nowline">Start with the room: {STARTER_PROMPT}</p>
          <p className="brm-hint">The room votes. A tie goes to the wheel, or to a revote. You can pick one and send it to Claude whenever you like.</p>
          <div className="brm-row brm-gap">
            <button type="button" className="brm-btn brm-btn--primary" onClick={() => onCompose('choice', { prompt: STARTER_PROMPT, detail: 'Pick the one you most want to see built today.' })}>
              I&apos;ll list the options
            </button>
            <button type="button" className="brm-btn" onClick={() => onCompose('suggest', { prompt: STARTER_PROMPT, detail: 'Say what you would build, in a few words. Then everyone votes.' })}>
              The room suggests
            </button>
          </div>
        </div>
      )}
      <p className="brm-nowline">{line}</p>
      {!ended && <ClaudeActivity activity={room.activity || []} agent={room.agent} now={now} full />}
      {latest && (
        <div className="brm-latest">
          <div className="brm-kind">Latest decision · Ask {askNumber(latest.askId)}</div>
          <div className="brm-tx">{latest.decision.direction}</div>
        </div>
      )}
      {!ended && (
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn" onClick={onShowBuild} title="Show the room the build (3)">
            <Icon name="Monitor" size={16} /> Show the build
          </button>
          {/* One click: Claude builds and serves a local preview, puts its
              link on this screen and screenshots it (owner, 2026-10-04). */}
          <button
            type="button"
            className="brm-btn"
            disabled={busy || quiet}
            title={quiet ? 'Connect Claude Code first' : 'Claude starts or builds the project, serves it locally, and puts the link here'}
            onClick={async () => { const ok = await run(() => api.postDirection(PREVIEW_PROMPT.text)); if (ok !== undefined) setSent(true); }}
          >
            Preview the work
          </button>
          {quiet && CONTINUE_PROMPT && <CopyButton text={CONTINUE_PROMPT.text} label="Copy the Continue prompt" />}
        </div>
      )}
      {sent && <p className="brm-hint" role="status">Asked Claude to preview the work.</p>}
    </section>
  );
}

const LOG_KINDS = [
  ['verbal', 'Room said'],
  ['note', 'Host note (never shown)'],
  ['milestone', 'Milestone'],
];

/**
 * THE ONE COMPOSER (C1): everything the host types, written once, then sent
 * where it belongs. It replaces "What next?" (Tell Claude, Ask the room) and
 * the timeline's own log form, which were two boxes for one act.
 *   Send to Claude  a direction, delivered on Claude's next call
 *   Log it          into the timeline as what the room said, a host note or
 *                   a milestone; "Also tell Claude" sends it too
 *   Ask the room    Ideas, Choose or Rate (the Ask the room dialog)
 */
function Composer({ agent, busy, run, api, onCompose }) {
  const [text, setText] = useState('');
  const [said, setSaid] = useState('');
  const [logKind, setLogKind] = useState('verbal');
  const [alsoTell, setAlsoTell] = useState(false);
  const words = text.trim();
  const tell = async (e) => {
    e.preventDefault();
    if (!words) return;
    const ok = await run(() => api.postDirection(words));
    if (ok !== undefined) { setText(''); setSaid(`Sent: ${words}`); }
  };
  const log = async () => {
    if (!words) return;
    const ok = await run(() => api.postLog({ kind: logKind, text: words, forAgent: logKind !== 'note' && alsoTell }));
    if (ok !== undefined) { setText(''); setAlsoTell(false); setSaid('Logged.'); }
  };
  return (
    <section className="brm-panel brm-composer" aria-labelledby="brm-compose-h">
      <h2 className="brm-h5" id="brm-compose-h">Add something</h2>
      <form onSubmit={tell}>
        <label className="brm-sr" htmlFor="brm-compose">Tell Claude, or log what the room said</label>
        <textarea
          id="brm-compose"
          className="brm-input brm-ta brm-ta--sm"
          placeholder="An idea, what the room said out loud, or a note for Claude"
          value={text}
          maxLength={2000}
          onChange={(e) => { setText(e.target.value); setSaid(''); }}
        />
        <p className="brm-hint">{deliveryLine(agent)}</p>
        <div className="brm-row brm-gap">
          <button type="submit" className="brm-btn brm-btn--primary" disabled={busy || !words}>
            <Icon name="PaperPlaneTilt" size={16} /> Send to Claude
          </button>
          <span className="brm-row brm-push">
            <select className="brm-input brm-input--sm brm-select" aria-label="Log it as" value={logKind} onChange={(e) => setLogKind(e.target.value)}>
              {LOG_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <label className="brm-check brm-small">
              <input type="checkbox" checked={logKind !== 'note' && alsoTell} disabled={logKind === 'note'} onChange={(e) => setAlsoTell(e.target.checked)} />
              Also tell Claude
            </label>
            <button type="button" className="brm-btn" disabled={busy || !words} onClick={log}>Log it</button>
          </span>
        </div>
        <div className="brm-row brm-gap">
          <span className="brm-label">Ask the room</span>
          <button type="button" className="brm-btn brm-btn--sm" title="Everyone suggests, then votes" onClick={() => onCompose('suggest')}>Ideas</button>
          <button type="button" className="brm-btn brm-btn--sm" title="A, B or C" onClick={() => onCompose('choice')}>Choose</button>
          <button type="button" className="brm-btn brm-btn--sm" title="A 1 to 5 pulse" onClick={() => onCompose('rating')}>Rate</button>
        </div>
        {said && <p className="brm-hint" role="status">{said}</p>}
      </form>
    </section>
  );
}

// ── Every ask ───────────────────────────────────────────────────────────────

function AskList({ asks, host, busy, ended, run, api, currentAskId }) {
  const shown = host ? asks : asks.filter((a) => !['proposed', 'discarded'].includes(a.status));
  if (!shown.length) return null;
  return (
    <section className="brm-panel" aria-labelledby="brm-asks-h">
      <h2 className="brm-h" id="brm-asks-h">Asks</h2>
      <table className="brm-tbl">
        <thead>
          <tr>
            <th className="brm-col-n">#</th>
            <th>Question</th>
            <th className="brm-col-kind">Kind</th>
            <th className="brm-col-state">Status</th>
            {host && !ended && <th className="brm-col-acts"><span className="brm-sr">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {[...shown].reverse().map((a) => (
            <tr key={a.askId} className={a.askId === currentAskId ? 'is-current' : undefined}>
              <td className="brm-num">{askNumber(a.askId)}</td>
              <td>
                <span className="brm-nm" title={a.prompt}>{a.prompt}</span>
                {a.decision && <span className="brm-subline" title={a.decision.direction}>Decided: {a.decision.direction}</span>}
              </td>
              <td>{KIND_LABEL[a.kind]}</td>
              <td><span className={`brm-chip brm-chip--${a.status}`}>{STATUS_LABEL[a.status] || a.status}</span></td>
              {host && !ended && (
                <td>
                  <div className="brm-rowact">
                    {a.status === 'proposed' && <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.askAction(a.askId, { action: 'open' }))}>Open</button>}
                    {['live', 'voting'].includes(a.status) && <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.askAction(a.askId, { action: 'close' }))}>Close</button>}
                    {['results', 'decided'].includes(a.status) && <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.askAction(a.askId, { action: 'reopen' }))}>Reopen</button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

function TimelineEntry({ entry, host, busy, ended, run, api, deleteAs }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const asStaff = deleteAs === 'platform-admin';
  const [text, setText] = useState(entry.text);
  const save = async () => {
    const ok = await run(() => api.logAction(entry.logId, { action: 'edit', text }));
    if (ok !== undefined) setEditing(false);
  };
  return (
    <li className={`brm-tl-${entryTone(entry)}`}>
      <span className="brm-tm">{clockTime(entry.createdAt)}</span>
      <span className="brm-dot" aria-hidden="true" />
      <div className="brm-tl-body">
        {editing ? (
          <div className="brm-tl-edit">
            <textarea className="brm-input brm-ta brm-ta--sm" aria-label="Edit entry" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            <div className="brm-row brm-gap">
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => { setEditing(false); setText(entry.text); }}>Cancel</button>
              <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy || !text.trim()} onClick={save}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <span className="brm-by">{byLabel(entry)}</span>
            <span className="brm-tl-text">{entry.text}</span>
            {entry.detail && !['direction', 'image'].includes(entry.kind) && <span className="brm-tl-detail">{entry.detail}</span>}
            {entry.kind === 'image' && <BuildImage imageId={entry.detail} alt={entry.text} className="brm-shot brm-shot--tl" />}
            {safeHref(entry.link) && <SafeLink className="brm-lnk brm-block" href={entry.link}>{entry.link}</SafeLink>}
            {host && entry.forAgent && <span className="brm-tl-flag">{entry.deliveredAt ? 'Claude has it' : 'Waiting for Claude'}</span>}
          </>
        )}
        {host && !editing && (
          <span className="brm-tl-acts">
            {confirming ? (
              <>
                <span className="brm-hint">Delete this entry?</span>
                {asStaff && (
                  <DeleteReasonField id={`brm-reason-${entry.logId}`} value={reason} onChange={setReason} scope="brm" labelClass="brm-lbl" inputClass="brm-input brm-ta brm-ta--sm" hintClass="brm-hint" />
                )}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirming(false)}>Keep</button>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--dangersolid" disabled={busy || (asStaff && !reason.trim())} onClick={() => run(() => api.logAction(entry.logId, { action: 'delete', ...(asStaff ? { reason: reason.trim() } : {}) }))}>Delete</button>
              </>
            ) : (
              <>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--link" aria-label={`Edit "${entry.text}"`} onClick={() => setEditing(true)}>Edit</button>
                {!ended && <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-danger" aria-label={`Delete "${entry.text}"`} disabled={deleteAs === ''} title={deleteAs === '' ? NOT_YOURS : undefined} onClick={() => { setReason(''); setConfirming(true); }}>Delete</button>}
              </>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

const WALL_HIDDEN_KINDS = ['note', 'ask', 'direction'];
const WALL_DETAIL_HIDDEN_KINDS = ['decision', 'idea'];

function Timeline({ log, host, busy, ended, run, api, deleteAs }) {
  // The host logs from the one composer (Composer), not from a form here.
  // Newest first: in a live room the latest thing Claude or the room did is
  // what everyone looks for, and the panel scrolls.
  // On the wall (Present) the timeline is the room's, as on the phones: no host
  // notes, no system bookkeeping (the asks table says it), and no detail on a
  // decision or an idea — that is the host's note or the idea's author.
  const shown = (host ? log : log
    .filter((l) => !WALL_HIDDEN_KINDS.includes(l.kind))
    .map((l) => (WALL_DETAIL_HIDDEN_KINDS.includes(l.kind) ? { ...l, detail: '' } : l))
    .map((l) => (l.kind === 'help' ? { ...l, text: `${l.name || 'A builder'} asked for help`, detail: '' } : l)))
    .slice().reverse();
  return (
    <section className="brm-panel brm-tlpanel" aria-labelledby="brm-tl-h">
      <h2 className="brm-h5" id="brm-tl-h">Timeline</h2>
      {shown.length ? (
        <ul className="brm-tl">
          {shown.map((entry) => (
            <TimelineEntry key={`${entry.logId}:${entry.editedAt || ''}`} entry={entry} host={host} busy={busy} ended={ended} run={run} api={api} deleteAs={deleteAs} />
          ))}
        </ul>
      ) : (
        <div className="brm-empty">Claude&apos;s progress, the room&apos;s decisions and what people say out loud collect here.</div>
      )}
    </section>
  );
}

// ── Ideas inbox (host only) ─────────────────────────────────────────────────

/** What happened to a handled idea, in the host's words. */
const HANDLED = { promoted: 'used', acknowledged: 'acknowledged', dismissed: 'dismissed' };

function IdeasInbox({ ideas, current, busy, ended, run, api }) {
  const fresh = ideas.filter((i) => i.status === 'new');
  const handled = ideas.filter((i) => i.status !== 'new');
  const canSuggest = Boolean(current && current.kind === 'suggest' && ['live', 'voting'].includes(current.status));
  const act = (idea, action) => run(() => api.ideaAction(idea.ideaId, action));
  return (
    <section className="brm-inbox" aria-labelledby="brm-inbox-h">
      <h2 className="brm-h5" id="brm-inbox-h">Ideas inbox · {fresh.length} new <span className="brm-hostonly">host only</span></h2>
      {!fresh.length && <p className="brm-hint">Phones can send an idea at any time. They land here for you to triage.</p>}
      {/* A burst of reactions after Claude shows something: clear them in one go. */}
      {!ended && fresh.length >= 2 && (
        <div className="brm-row brm-gap brm-ackall">
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" disabled={busy} title="Mark every new one as seen. Nothing goes to Claude." onClick={() => run(() => api.acknowledgeAll())}>
            Acknowledge all {fresh.length}
          </button>
        </div>
      )}
      {fresh.map((idea) => (
        <div className="brm-idea" key={idea.ideaId}>
          <div className="brm-idea-text">{idea.text}</div>
          <div className="brm-who">{idea.playerName} · {clockTime(idea.createdAt)}</div>
          {!ended && (
            <div className="brm-idea-acts">
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => act(idea, 'direct')}>Send to Claude</button>
              {/* ACKNOWLEDGE (owner, 2026-10-05): heard, not a job for Claude.
                  The sender's phone says "Seen by the host"; WALL also puts it
                  on the Stage for a short while, with no name. */}
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Show it on the Stage for 20 seconds, without a name. Nothing goes to Claude." onClick={() => act(idea, 'wall')}>Show on the wall</button>
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Mark it as seen. Their phone says so; nothing goes to Claude." onClick={() => act(idea, 'acknowledge')}>Acknowledge</button>
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy || !canSuggest} title={canSuggest ? undefined : 'Open an Ideas ask first'} onClick={() => act(idea, 'suggest')}>Add to current ideas</button>
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => act(idea, 'dismiss')}>Dismiss</button>
            </div>
          )}
        </div>
      ))}
      {handled.length > 0 && (
        <details className="brm-handled">
          <summary>{handled.length} handled</summary>
          {handled.map((idea) => (
            <div className="brm-idea brm-idea--done" key={idea.ideaId}>
              <div className="brm-idea-text">{idea.text}</div>
              <div className="brm-who">{idea.playerName} · {idea.walled ? 'on the wall' : HANDLED[idea.status] || idea.status}</div>
              {!ended && ['dismissed', 'acknowledged'].includes(idea.status) && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--link" disabled={busy} onClick={() => act(idea, 'restore')}>Restore</button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

/**
 * THE ROOM COMMENT ON THE WALL: one at a time, no name, for WALL_COMMENT_MS
 * from when the host put it up (owner, 2026-10-05). Shown on the screens the
 * room sees (Stage, Build); the host can take it down early from the Host.
 */
export const WALL_COMMENT_MS = 20 * 1000;
export function freshWallComment(room, now) {
  const w = room && room.wallComment;
  if (!w || !w.text) return null;
  const at = Date.parse(w.at || '');
  return Number.isFinite(at) && now - at < WALL_COMMENT_MS ? w : null;
}
function WallComment({ comment }) {
  if (!comment) return null;
  return (
    <div className="brm-wallcomment" role="status" key={comment.at}>
      <span className="brm-wallcomment-k">Someone in the room said</span>
      <q className="brm-wallcomment-t">{comment.text}</q>
    </div>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function DialogHead({ id, title, onClose }) {
  return (
    <div className="brm-dh">
      <h2 className="brm-h" id={id}>{title}</h2>
      <button type="button" className="brm-x" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>
    </div>
  );
}

function CopyButton({ text, label = 'Copy', className = 'brm-btn brm-btn--sm' }) {
  const [said, setSaid] = useState('');
  const copy = async () => {
    const ok = await copyText(text);
    setSaid(ok ? 'Copied' : 'Press and hold to copy');
    setTimeout(() => setSaid(''), 2500);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      <Icon name="ClipboardText" size={14} /> {said || label}
    </button>
  );
}

export function ConnectPanel({ room, gameId, api, run, busy, onClose }) {
  // THE KEY IS SHOWN ONCE: it lives in this component's state only, and is
  // gone when the panel closes. The server stores only its sha256.
  //
  // FOUR STEPS, IN THE ORDER THEY ARE DONE (owner, 2026-10-04): check for the
  // latest plugin (installs, updates, or says you are all set), mint a key and
  // copy the connect command, paste it into Claude Code, kick off. A crew room
  // adds a fifth: share the repo. Everything else is folded away below them.
  const [minted, setMinted] = useState(null);
  const [copied, setCopied] = useState('');
  const [confirmMint, setConfirmMint] = useState(false);
  const agent = room.agent || {};
  const liveKey = agent.key;
  const connected = Boolean(agent.lastSeenAt);
  const crew = Boolean(room.crew && room.crew.enabled);
  const command = minted ? connectCommand({ origin: window.location.origin, api: apiBase(), key: minted.key }) : '';
  const install = pluginInstallCommand({ origin: window.location.origin, api: apiBase() });
  const connectLine = minted ? pluginConnectCommand(minted.key) : '';
  const kickoff = pluginCommand('kickoff');
  const shareRepo = pluginCommand('share-repo');

  // Mint, then copy the connect command in the same click. A browser may refuse
  // the copy once the click is a network round-trip old; the command is shown
  // either way, with its own Copy button.
  const mint = async () => {
    setConfirmMint(false);
    const out = await run(() => api.mintKey('Claude Code'));
    if (!out || !out.key) return;
    setMinted({ key: out.key, keyId: out.keyId });
    const ok = await copyText(pluginConnectCommand(out.key));
    setCopied(ok ? 'Copied. Paste it into Claude Code.' : 'Copy it with the button below.');
  };
  const revoke = async () => {
    if (!liveKey) return;
    await run(() => api.revokeKey(liveKey.keyId));
    setMinted(null);
    setCopied('');
  };

  const step = (done, wait) => (done ? 'is-done' : wait ? 'is-wait' : '');
  const mintLabel = liveKey ? 'Mint a new key and copy the command' : 'Mint a key and copy the command';

  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--wide" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-connect-title">
      <DialogHead id="brm-connect-title" title="Connect Claude Code" onClose={onClose} />
      <p className="brm-sub">Claude Code runs on this laptop. The Engage plugin connects it to the room and saves every step in git.</p>

      <ol className="brm-steps brm-steps--connect">
        <li className={step(connected, false)}>
          <span className="brm-n">1</span>
          <div className="brm-step-body">
            <span className="brm-step-title">Check for the latest Engage plugin</span>
            <pre className="brm-cmd" data-testid="brm-install">{install}</pre>
            <div className="brm-row brm-gap">
              <CopyButton text={install} label="Copy" />
              <span className="brm-hint">Run it in a terminal. It installs the plugin if it is missing, updates it if it is out of date, or tells you you&apos;re all set. Needs Node 18 or later.</span>
            </div>
          </div>
        </li>

        <li className={step(Boolean(minted) || connected, !minted && !connected)}>
          <span className="brm-n">2</span>
          <div className="brm-step-body">
            <span className="brm-step-title">Mint a key and copy the connect command</span>
            {minted ? (
              <>
                <div className="brm-keywarn"><Icon name="Lock" size={16} color="var(--primary)" />
                  <div><b>This key is shown once.</b> It only works for this room and stops when you revoke it or the session ends. Lost it? Mint a new one; the old key stops working immediately.</div>
                </div>
                <pre className="brm-cmd" data-testid="brm-connect">{connectLine}</pre>
                <div className="brm-row brm-gap">
                  <CopyButton text={connectLine} label="Copy again" />
                  <span className="brm-hint" role="status">{copied} Key …{minted.key.slice(-4)}, minted just now.</span>
                </div>
              </>
            ) : liveKey ? (
              <p className="brm-hint brm-block">
                {connected ? 'Claude Code is connected with the current key. ' : ''}
                A key was minted {clockTime(liveKey.createdAt)}{liveKey.lastUsedAt ? ` and last used ${clockTime(liveKey.lastUsedAt)}` : ''}. It was shown once.
                Minting a new one stops the old key at once.
              </p>
            ) : null}
            <div className="brm-row brm-gap">
              {confirmMint ? (
                <>
                  <span className="brm-hint">The current key stops working immediately{connected ? ', and Claude Code disconnects until you paste the new command' : ''}.</span>
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirmMint(false)}>Keep it</button>
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={mint}>{mintLabel}</button>
                </>
              ) : !minted && (
                <button type="button" className={`brm-btn brm-btn--sm${connected ? '' : ' brm-btn--primary'}`} disabled={busy} onClick={() => (liveKey ? setConfirmMint(true) : mint())}>
                  {mintLabel}
                </button>
              )}
              {liveKey && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger brm-push" disabled={busy} onClick={revoke}>Revoke key</button>}
            </div>
          </div>
        </li>

        <li className={step(connected, Boolean(minted) && !connected)}>
          <span className="brm-n">3</span>
          <div className="brm-step-body">
            <span className="brm-step-title">Start Claude Code in your project folder and paste the command</span>
            <span className="brm-hint">{connected
              ? 'Claude Code has called in.'
              : 'In a terminal, go to your project folder and run claude. Paste the connect command and press Enter.'}</span>
          </div>
        </li>

        <li className={step(false, connected)}>
          <span className="brm-n">4</span>
          <div className="brm-step-body">
            <span className="brm-step-title">Kick off</span>
            <pre className="brm-cmd" data-testid="brm-kickoff">{kickoff}</pre>
            <div className="brm-row brm-gap">
              <CopyButton text={kickoff} label="Copy" />
              <span className="brm-hint">Run it in Claude Code. Claude reads the room, restates the goal and posts its plan.{crew ? '' : ' From then on every turn is saved as a git commit in this project, never pushed.'}</span>
            </div>
          </div>
        </li>

        {crew && (
          <li className={step(false, false)}>
            <span className="brm-n">5</span>
            <div className="brm-step-body">
              <span className="brm-step-title">Open the project to your crew</span>
              <pre className="brm-cmd" data-testid="brm-share-repo">{shareRepo}</pre>
              <div className="brm-row brm-gap">
                <CopyButton text={shareRepo} label="Copy" />
                <span className="brm-hint">Run it in Claude Code. It makes the base branch, shares the repo with the room and proposes the first tasks. Every turn is already saved as a git commit here, never pushed.</span>
              </div>
            </div>
          </li>
        )}
      </ol>

      <label className="brm-check brm-field">
        <input
          type="checkbox"
          checked={room.settings ? room.settings.reviewAgentAsks !== false : true}
          disabled={busy}
          onChange={(e) => run(() => api.saveSettings({ reviewAgentAsks: e.target.checked }))}
        />
        <span>Review Claude&apos;s questions before the room sees them<span className="brm-hint brm-block">When off, Claude&apos;s asks open to the room straight away.</span></span>
      </label>

      <details className="brm-alt">
        <summary>More commands for later</summary>
        <p className="brm-hint">Each is a command in Claude Code with the plugin, or a card to paste: {PROMPT_CARDS.map((p) => pluginCommand(p.name)).join(', ')}. Without the plugin they are {slashCommand('kickoff')} and so on.</p>
        <div className="brm-cards">
          {PROMPT_CARDS.map((p) => (
            <div className="brm-pcard" key={p.name}>
              <div className="brm-pt">{p.title} <span className="brm-slash">{pluginCommand(p.name)}</span></div>
              <p className="brm-pq">{p.text}</p>
              <CopyButton text={p.text} />
            </div>
          ))}
        </div>
      </details>

      {minted && (
        <details className="brm-alt">
          <summary>Without the plugin</summary>
          <p className="brm-hint">One command in the terminal instead, then restart Claude Code. No automatic checkpoints; Claude can still call checkpoint.</p>
          <pre className="brm-cmd" data-testid="brm-command">{command}</pre>
          <CopyButton text={command} label="Copy command" />
        </details>
      )}

      <p className="brm-hint">Game {gameId}. The key is never shown in Present mode.</p>
      <div className="brm-row"><button type="button" className="brm-btn brm-push" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

export function WrapUpPanel({ outcome, api, run, busy, onClose }) {
  const o = outcome || {};
  const initial = useMemo(() => ({
    summary: o.summary || '',
    built: (o.built || []).join('\n'),
    links: (o.links || []).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join('\n'),
    nextSteps: (o.nextSteps || []).join('\n'),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const requestClose = () => {
    if (dirty && !window.confirm('Discard your changes to the wrap-up?')) return;
    onClose();
  };
  const save = async () => {
    const body = {
      summary: form.summary.trim(),
      built: lines(form.built),
      links: lines(form.links).map((l) => {
        const [a, b] = l.split('|').map((x) => x.trim());
        return b ? { label: a, url: b } : { label: '', url: a };
      }),
      nextSteps: lines(form.nextSteps),
    };
    const ok = await run(() => api.saveOutcome(body));
    if (ok !== undefined) onClose();
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brm-wrap-title">
      <DialogHead id="brm-wrap-title" title="Wrap up" onClose={requestClose} />
      <p className="brm-sub">{o.by === 'agent' ? 'Claude wrote this at wrap-up. Edit anything; ' : 'What the room built. '}It leads the report.</p>
      <label className="brm-field"><span className="brm-lbl">Summary</span><textarea className="brm-input brm-ta" value={form.summary} maxLength={4000} onChange={set('summary')} /></label>
      <label className="brm-field"><span className="brm-lbl">What we built (one per line)</span><textarea className="brm-input brm-ta brm-ta--sm" value={form.built} onChange={set('built')} /></label>
      <label className="brm-field"><span className="brm-lbl">Links (one per line: label | https://…)</span><textarea className="brm-input brm-ta brm-ta--sm" value={form.links} onChange={set('links')} /></label>
      <label className="brm-field"><span className="brm-lbl">Next steps (one per line)</span><textarea className="brm-input brm-ta brm-ta--sm" value={form.nextSteps} onChange={set('nextSteps')} /></label>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>Cancel</button>
        <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !form.summary.trim()} onClick={save}>Save wrap-up</button>
      </div>
    </Modal>
  );
}

function EndDialog({ api, run, busy, onClose }) {
  const end = async () => {
    const ok = await run(() => api.endSession());
    if (ok !== undefined) onClose();
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm" onClose={onClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-end-title">
      <DialogHead id="brm-end-title" title="End this session?" onClose={onClose} />
      <p>Phones stop answering, no new asks can open, and Claude&apos;s calls are refused from now on. The timeline, the wrap-up and the report stay, and you can still edit them.</p>
      <p className="brm-hint">Only want to pause? Leave it open and close the current ask instead.</p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Keep it running</button>
        <button type="button" className="brm-btn brm-btn--dangersolid brm-push" disabled={busy} onClick={end}>End session</button>
      </div>
    </Modal>
  );
}

export function AskComposer({ kind: initialKind, prompt: initialPrompt = '', detail: initialDetail = '', api, run, busy, onClose }) {
  const [kind, setKind] = useState(initialKind);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [detail, setDetail] = useState(initialDetail);
  const [options, setOptions] = useState([{ title: '', url: '' }, { title: '', url: '' }]);
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [draft, setDraft] = useState(false);
  const dirty = Boolean(prompt || detail || options.some((o) => o.title));
  const requestClose = () => {
    if (dirty && !window.confirm('Discard this question?')) return;
    onClose();
  };
  const filled = options.filter((o) => o.title.trim());
  const ready = prompt.trim() && (kind !== 'choice' || filled.length >= 2);
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    const body = {
      kind,
      prompt: prompt.trim(),
      detail: detail.trim(),
      ...(kind === 'choice' ? { options: filled.map((o) => ({ title: o.title.trim(), url: o.url.trim() })) } : {}),
      ...(kind === 'rating' ? { lowLabel: low.trim(), highLabel: high.trim() } : {}),
      ...(draft ? { draft: true } : {}),
    };
    const ok = await run(() => api.createAsk(body));
    if (ok !== undefined) onClose();
  };
  const setOpt = (i, k, v) => setOptions((l) => l.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brm-compose-title">
      <form onSubmit={submit}>
        <DialogHead id="brm-compose-title" title="Ask the room" onClose={requestClose} />
        <div className="brm-seg" role="radiogroup" aria-label="Kind of ask">
          {['suggest', 'choice', 'rating'].map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`brm-segbtn${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <label className="brm-field"><span className="brm-lbl">Question (shown big on the wall)</span><input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
        <label className="brm-field"><span className="brm-lbl">Context (optional)</span><textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} /></label>
        {kind === 'choice' && (
          <div className="brm-field">
            <span className="brm-lbl">Options</span>
            {options.map((o, i) => (
              <div className="brm-optedit" key={i}>
                <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <div className="brm-optfields">
                  <input className="brm-input" aria-label={`Option ${String.fromCharCode(65 + i)}`} value={o.title} maxLength={120} onChange={(e) => setOpt(i, 'title', e.target.value)} />
                  <input className="brm-input brm-input--sm" aria-label={`Option ${String.fromCharCode(65 + i)} preview URL`} placeholder="Preview URL (optional)" value={o.url} onChange={(e) => setOpt(i, 'url', e.target.value)} />
                </div>
                {i === options.length - 1 && options.length > 2 ? (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" aria-label="Remove option" onClick={() => setOptions((l) => l.slice(0, -1))}><Icon name="X" size={14} /></button>
                ) : <span />}
              </div>
            ))}
            {options.length < 6 && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setOptions((l) => [...l, { title: '', url: '' }])}><Icon name="Plus" size={14} /> Add option</button>}
          </div>
        )}
        {kind === 'rating' && (
          <div className="brm-two">
            <label className="brm-field"><span className="brm-lbl">1 means</span><input className="brm-input" value={low} maxLength={40} onChange={(e) => setLow(e.target.value)} /></label>
            <label className="brm-field"><span className="brm-lbl">5 means</span><input className="brm-input" value={high} maxLength={40} onChange={(e) => setHigh(e.target.value)} /></label>
          </div>
        )}
        <label className="brm-check brm-field"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Save as a draft; don&apos;t open it yet</label>
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>Cancel</button>
          <button type="submit" className="brm-btn brm-btn--primary brm-push" disabled={busy || !ready}>{draft ? 'Save draft' : 'Ask the room'}</button>
        </div>
      </form>
    </Modal>
  );
}
