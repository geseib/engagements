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
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../components/Modal';
import { getAuthToken } from '../auth/authFetch';
import { rememberReturnPath } from '../auth/returnPath';
import reloadPage from '../utils/reloadPage';
import Icon from '../components/Icon';
import DeleteReasonField from '../components/DeleteReasonField';
import webSocketClient from '../WebSocketClient';
import { copyText } from '../utils/copyText';
import { editableRows } from '../utils/questionRows';
import { isBuildRoomSet, buildAskFromQuestion, ASKED_AS, groupReady } from './readyQuestions';
import { OpeningPanel, BriefPath, WallBrief } from './BuildOpening';
import BuildReport from './BuildReport';
import BuildImage, { ImageLoader, ImageViewer } from './BuildImage';
import AskDetail from './BuildAskDetail';
import MockupViewer, { ViewerContext, backLabelFor } from './MockupViewer';
import BuildWheel from './BuildWheel';
import { useKeepOnScreen } from './keepOnScreen';
import { W } from './words';
import BuildLaterPoints from './BuildLaterPoints';
import BuildPointRequest from './BuildPointRequest';
import { PointStage, ShownPointCard, TakeDownOffer } from './BuildPointStage';
import { AskPath } from './BuildAskPath';
import BuildPointsVote from './BuildPointsVote';
import BuildPointsResults from './BuildPointsResults';
import { RunPanel, RunConfirm, RunStage } from './BuildRun';
import ActionRow from './BuildActionRow';
import { WhatsNext, DecidedList, decidedAsks } from './BuildWhatsNext';
import { isTypingTarget, dialogOpen } from './useNextFocus';
import BuildStageDecide from './BuildStageDecide';
import { useRosterMode, rosterRevealFor } from '../hooks/useRosterReveal';
import { joinedRoster } from '../config/anonymity';
import { WifiChip, WifiOffer, WallBuildQr, BuildScreenQr, wifiLink } from './BuildWifiShare';
import { shouldOfferWifi, wifiState } from './wifiShare';
import BuildSessionPanel, { HandoverStrip } from './BuildSessionPanel';
import useBuildPlayers, { askingOf } from './useBuildPlayers';
import useSessionPanelKey from '../components/stage/useSessionPanelKey';
import {
  pluginInstallCommand,
  pluginConnectCommand, projectSlug, cleanFolder, startCommand,
  hostImageUrl,
  apiBase, buildApi, createBuildSession, buildRoomPath, connectCommand, safeHref,
} from './buildHostApi';
import './BuildRoom.css';
import {
  SCREENS, isProjected, screenForKey, togglePresent, waitingCount, askPill, latestBuild, stageModel, winnerOf, directionFor, defaultDirection, decideBody, settleMove,
  questionAnswer, claudeState, VOTE_IDEAS_MAX, latestDecisionLine, mockupsReady, looksWords, decisionMethod, METHOD_WORDS, RATING_SCALE, ratingAnswer, ratingStep, unheard, agentStopped,
  queueItems, QUEUE_FILTERS, filterQueue, laterItems, defaultKind, whatsNextMoves, CLAUDE_KINDS, HOST_KINDS, claudeKindLabel, asField,
  roomStory, filterStory, artifactsOf, pickVerdict, combineText,
  defaultSubject, shownPointIdeas, takeDownIdeas, shownPointOf, nowFlags, POINT_OPEN,
  isPointsVote, highlightOf, highlightedPointIds, rowIsLive, pointVoteRows, runOf, runRunning,
} from './buildScreens';
import Stage from '../components/stage/Stage';
import Rail from '../components/stage/Rail';
import RoomMeter from '../components/stage/RoomMeter';
import Dock from '../components/stage/Dock';
import { loadProfile } from '../config/displayProfile';
import {
  CrewBoard, CrewDialog, CrewIncoming, CrewTasks, EarlyLook, EarlyLookDialog, StageTabs, featuredShare,
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
/** The row that told Claude about an ask: the newest that went to it (a sent-later direction), else the decision's own. */
const toldEntry = (room, askId) => {
  const rows = ((room && room.log) || []).filter((l) => l.askId === askId);
  const sent = rows.filter((l) => l.forAgent);
  return sent.length ? sent[sent.length - 1] : rows.filter((l) => l.kind === 'decision').pop() || null;
};
const askById = (room, askId) => ((room && room.asks) || []).find((a) => a.askId === askId) || null;

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
  // WHO DECIDES WHAT TO BUILD (owner, 2026-10-07): the room, unless the host
  // has set the goal. Set, it answers the opening's "What are we making?".
  const [decides, setDecides] = useState('room');
  const [visibility, setVisibility] = useState('public');
  const [accessCode, setAccessCode] = useState('');
  const [review, setReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!title.trim()) { setError('Give the room a title.'); return; }
    if (decides === 'host' && !goal.trim()) { setError('Write the goal, or let the room decide.'); return; }
    if (visibility === 'private' && !accessCode.trim()) { setError('A private room needs an access code.'); return; }
    setBusy(true);
    setError('');
    try {
      const gameId = await createBuildSession({ title, goal, visibility, accessCode });
      if (decides === 'host') {
        try { await buildApi(gameId).openingAction('answer', { step: 'kind', text: goal.trim() }); } catch (e) { /* the host can answer it in the room */ }
      }
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
        <fieldset className="brm-field brm-fieldset">
          <legend className="brm-lbl">What to build</legend>
          <label className="brm-check"><input type="radio" name="brm-decides" checked={decides === 'room'} onChange={() => setDecides('room')} /> The room decides</label>
          <label className="brm-check"><input type="radio" name="brm-decides" checked={decides === 'host'} onChange={() => setDecides('host')} /> I&apos;ve set the goal</label>
          <span className="brm-hint">{decides === 'room'
            ? 'The title is only the session\'s name. The room picks what to make in the opening, and Claude waits for it.'
            : 'Claude builds toward your goal. The opening starts from who it is for.'}</span>
        </fieldset>
        <label className="brm-field">
          <span className="brm-lbl">{decides === 'room' ? 'Goal (optional): a starting idea for the room' : 'Goal: what should exist when we\'re done?'}</span>
          <textarea className="brm-input brm-ta" value={goal} maxLength={2000} onChange={(e) => setGoal(e.target.value)} placeholder="A one-page site where a volunteer can pick a shift in under a minute, on a phone." />
          <span className="brm-hint">It shows on the wall and at the top of the report.</span>
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
  // THE PAST-ASK WINDOW and THE MOCKUP VIEWER (owner, 2026-10-08). The viewer
  // records where it was opened from so Back returns there and leaves that
  // place exactly as it was.
  const [detailAskId, setDetailAskId] = useState(null);
  const [viewer, setViewer] = useState(null); // {askId, label, from, backLabel}
  const openViewer = useCallback((askId, label, from = 'host') => {
    const a = askById(room, askId);
    if (!a || !(a.options || []).some((o) => o.imageId)) return;
    setViewer({ askId, label, from, backLabel: backLabelFor(from, askId) });
  }, [room]);
  // A screenshot on its own opens the same viewer, one picture, and Back
  // names the screen it was opened from.
  const openImage = useCallback((image) => {
    if (!image || !image.imageId) return;
    setViewer({ image, from: screen, backLabel: backLabelFor(screen, null) });
  }, [screen]);
  const closeViewer = useCallback(() => setViewer(null), []);
  // A pick waiting for the host to confirm it (owner, 2026-10-06): {ask, id}.
  const [confirmPick, setConfirmPick] = useState(null);
  // The host answers for the room (the path's Send step, spoken), and the
  // line that says what Claude was just sent (owner, 2026-10-07).
  // Answering is held for one ask in one status (`askId:status`), so a new
  // ask never inherits it, not even for one frame.
  const [answeringKey, setAnsweringKey] = useState('');
  const [sent, setSent] = useState('');
  // UNSENT DIRECTIONS, KEPT PER ASK (Review Focus 2): what the host typed in
  // Send survives another ask opening. {askId: {direction, as, chosen, pickId, spoken}}.
  const [drafts, setDrafts] = useState({});
  // The opening step the host chose in the brief (null: the next one).
  const [openFocus, setOpenFocus] = useState(null);
  // BETWEEN ASKS (owner, 2026-10-07; host-flow H1, combine P1/P2). The
  // Composer's words live here so Combine can fill them; the Decided ticks
  // and when each answer went into a prompt are this session's only (never
  // saved), so a refetch keeps them. `composeFocus` counts the times the
  // cursor is sent to the Composer; `voteIdeas` is What's next's vote dialog.
  const [composeText, setComposeText] = useState('');
  const [composeFocus, setComposeFocus] = useState(0);
  const [ticked, setTicked] = useState(() => new Set());
  const [used, setUsed] = useState({});
  const [voteIdeas, setVoteIdeas] = useState(null);
  /** The Later list's ticks (keys from laterItems); What's next leads with a vote while 2 to 6 are ticked. */
  const [laterTicked, setLaterTicked] = useState([]);
  /** The Points tab's ticks (point ids). While any are ticked the Points action row holds the one orange. */
  const [pointTicked, setPointTicked] = useState([]);
  /** Counts the times What's next sent the host to the Points tab. */
  const [pointsTab, setPointsTab] = useState(0);
  /** Take it down, with 2 or more ideas in (T4c): the ideas offered a vote, else null. */
  const [takeDown, setTakeDown] = useState(null);
  /** Picks per person the vote window opens with: 1 by default, 3 from the take-down offer. */
  const [votePicks, setVotePicks] = useState(1);
  /** Put N to a vote from the Points tab (T5): the ticked ids while the window is open, else null. */
  const [pointVote, setPointVote] = useState(null);
  /** The highlight at a points vote's results (T6): the host's own labels per ask, else the top three. */
  const [highlights, setHighlights] = useState({});
  /** What a move at the highlight step said ("Saved 2 for later"), per ask. */
  const [pointsSaid, setPointsSaid] = useState({});
  /** Next pressed before Claude reported the item done (T7): the confirm is open. */
  const [runConfirm, setRunConfirm] = useState(false);
  /** The finished or stopped list the host put away (its runId). */
  const [runHidden, setRunHidden] = useState('');
  // The confirm belongs to one item of one list: it goes when the list moves on.
  const runKey = room && room.run ? `${room.run.runId}:${room.run.cur}:${room.run.status}` : '';
  useEffect(() => { setRunConfirm(false); }, [runKey]);
  const [dialog, setDialog] = useState(null); // 'connect' | 'wrap' | 'end' | 'crew' | {compose: kind}
  // Crew mode: which stage shows (the room's asks, or the crew board), and the early look open.
  const [stage, setStage] = useState('room');
  const [openShareId, setOpenShareId] = useState(null);
  const [wallQr, setWallQr] = useState(false);
  const now = useNow(5000);
  // The wall QR is put away the moment sharing stops or the session ends, so
  // it cannot come back on the projector when sharing next turns on.
  const sharingNow = Boolean(room) && ['on', 'quiet'].includes(wifiState(room.lan, now).state);
  const endedNow = Boolean(room) && room.state === 'ENDED';
  useEffect(() => { if (!sharingNow || endedNow) setWallQr(false); }, [sharingNow, endedNow]);

  // ── THE SESSION PANEL (owner, 2026-10-09) ───────────────────────────────
  // The roster is read here, not in the panel, because the count on SESSION
  // and the request strip need it while the panel is shut. The websocket says
  // when it moved (a name asked for, a player removed or brought back, on this
  // device or the host's other one); the room's own player count is the
  // fallback when a socket message is missed.
  const [roster, loadPlayers] = useBuildPlayers(api);
  const askingNow = askingOf(roster.players);
  const [panel, setPanel] = useState(null); // {tab: 'players'|'settings', group}
  const openPanel = useCallback((tab = 'players', group = '') => setPanel({ tab, group }), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const [qrOpen, setQrOpen] = useState(false);
  const narrow = useNarrowHeader();
  const playerCount = room ? room.playerCount : undefined;
  useEffect(() => { loadPlayers(); }, [loadPlayers, playerCount]);
  // Backslash opens it (the panel's own listener closes it); never while a dialog is up.
  useSessionPanelKey({ enabled: !panel, onOpen: () => { if (!dialogOpen()) openPanel(); } });

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
    // The room and the roster are both re-read on the fallback poll, so a missed socket message heals.
    const poll = setInterval(() => { refresh(); loadPlayers(); }, POLL_MS);
    webSocketClient.onMessage('buildChanged', () => refresh());
    // Claude's live activity carries its own lines: show them, no refetch.
    webSocketClient.onMessage('buildActivity', (msg) => {
      const items = msg && Array.isArray(msg.items) ? msg.items : null;
      if (items) setRoom((r) => (r ? { ...r, activity: items } : r));
    });
    webSocketClient.onMessage('gameEnded', () => refresh());
    // Somebody asked to take a name, or the host's other device removed or restored someone.
    webSocketClient.onMessage('handoverRequested', () => loadPlayers());
    // The host's OTHER device answered (grant, Not now, Lock again): the strip clears here too.
    webSocketClient.onMessage('playersChanged', () => loadPlayers());
    webSocketClient.onMessage('playerRemoved', () => { loadPlayers(); refresh(); });
    webSocketClient.onMessage('playerRestored', () => { loadPlayers(); refresh(); });
    webSocketClient.onReconnected(() => { refresh(); loadPlayers(); });
    webSocketClient.connect(gameId, null, true, { hostTicket: () => api.hostTicket() });
    return () => {
      clearInterval(poll);
      webSocketClient.disconnect();
      webSocketClient.offMessage('buildChanged');
      webSocketClient.offMessage('buildActivity');
      webSocketClient.offMessage('gameEnded');
      webSocketClient.offMessage('handoverRequested');
      webSocketClient.offMessage('playersChanged');
      webSocketClient.offMessage('playerRemoved');
      webSocketClient.offMessage('playerRestored');
      webSocketClient.onReconnected(null);
    };
  }, [api, gameId, refresh, loadPlayers]);

  // 1-4 pick a screen; P flips between Host and the last screen the room saw.
  // Never while somebody is typing, never with a modifier, never inside a dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('[role="dialog"]')) return;
      if (dialogOpen()) return;
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

  // SPACE ON THE HOST SCREEN (owner, 2026-10-07) presses the open step's
  // primary (`data-next-primary`), with the Stage dock's guards: never while
  // typing, never with a modifier, never when a control or a dialog has focus.
  useEffect(() => {
    if (screen !== 'host') return undefined;
    const onKey = (e) => {
      if (e.key !== ' ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTypingTarget(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea, label, [role="button"], [role="radio"], [role="switch"], [role="dialog"]')) return;
      if (dialogOpen()) return;
      const b = document.querySelector('.brm-host [data-next-primary]');
      // Send to Claude is never one key away (ruling 2026-10-07): Ctrl/Cmd+Enter sends.
      if (b && !b.disabled && !b.hasAttribute('data-no-space')) { e.preventDefault(); b.click(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  // CTRL OR CMD ENTER ON THE HOST SCREEN presses the Points row's main button
  // while points are ticked and that row leads (Space never does: an accidental
  // tick plus Space must do nothing). Same guards as Space: no dialog, no typing.
  useEffect(() => {
    if (screen !== 'host') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat || isTypingTarget(e.target)) return;
      if (dialogOpen()) return;
      const b = document.querySelector('.brm-host [data-points-primary]');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  // A new current ask, or the same one moving on (closed, reopened), starts
  // its path afresh: no spoken answer carried over, and a reopened ask drops
  // the pick it had, so closing it again settles from the new count.
  const curAsk = room ? (room.asks || []).find((a) => a.askId === room.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null : null;
  const curKey = curAsk ? `${curAsk.askId}:${curAsk.status}` : '';
  useEffect(() => {
    if (curAsk && ['live', 'voting'].includes(curAsk.status)) setPick((p) => (p && p.askId === curAsk.askId ? null : p));
  }, [curKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const answering = Boolean(curKey) && answeringKey === curKey;
  const setAnswering = useCallback((on) => setAnsweringKey(on ? curKey : ''), [curKey]);
  // A new spin of the same ask settles again: the pick made from the last
  // landing no longer stands.
  const spinsSeen = useRef({ askId: null, n: 0 });
  const spinsNow = curAsk && curAsk.wheel ? (curAsk.wheel.spins || []).length : 0;
  useEffect(() => {
    const was = spinsSeen.current;
    const id = curAsk ? curAsk.askId : null;
    if (id && was.askId === id && spinsNow > was.n) setPick((p) => (p && p.askId === id ? null : p));
    spinsSeen.current = { askId: id, n: spinsNow };
  }, [curAsk && curAsk.askId, spinsNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Sent to Claude as Do now: ..." for six seconds after a decision goes.
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(() => setSent(''), 6000);
    return () => clearTimeout(t);
  }, [sent]);
  const onSent = useCallback(({ as, send, direction }) => {
    const short = direction.length > 80 ? `${direction.slice(0, 80).trimEnd()}…` : direction;
    if (!send) setSent(`Recorded in the timeline: ${short}`);
    else if (as === 'later') setSent(`${W.savedLater}: ${short}`);
    else setSent(`Sent to Claude as ${claudeKindLabel(as)}: ${short}`);
  }, []);

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

  /**
   * The room's own choice, picked with no question (the path's "Go with B").
   * Picking while the room still answers closes the vote first, as the
   * confirm below does for a click on an option.
   */
  const choosePick = async (ask, id) => {
    if (['live', 'voting'].includes(ask.status)) {
      const ok = await run(() => api.askAction(ask.askId, { action: 'close' }));
      if (ok === undefined) return;
    }
    setPick({ askId: ask.askId, id });
  };

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
  // The request strip's two answers: one handover to the device that asked, or Not now.
  const grantAsker = (name) => run(async () => { await api.playerHandover(name, { bindToRequester: true }); await loadPlayers(); });
  const refuseAsker = (name) => run(async () => { await api.playerHandover(name, { refuse: true }); await loadPlayers(); });
  // A dialog opened from the panel shows on the Host screen, whichever screen the panel was opened over.
  const dialogFromPanel = (d) => { setScreen('host'); setDialog(d); };
  const headerTools = {
    room, now, host, ended, connection, onReconnect: reconnect, pill: askPill(room), onScreen: setScreen,
    onWifi: () => openPanel('settings', 'room'),
    onQr: () => setQrOpen(true),
    onPlayers: () => openPanel('players'),
  };
  // The Wi-Fi QR on the wall sits on the Stage, which has no header of its own.
  const wallQrLink = wallQr && sharingNow ? wifiLink(room) : '';
  const asks = room.asks || [];
  const proposed = asks.filter((a) => a.status === 'proposed');
  const current = asks.find((a) => a.askId === room.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null;
  // A draft left on an ask that is no longer current, and not yet decided.
  const unsentAsk = asks.find((a) => drafts[a.askId] && (!current || a.askId !== current.askId)
    && !['decided', 'discarded'].includes(a.status) && String(drafts[a.askId].direction || '').trim()) || null;
  const firstRun = !asks.length && !(room.log || []).some((l) => l.by === 'agent');
  const crew = room.crew && room.crew.enabled ? room.crew : null;
  const onCrew = Boolean(crew) && stage === 'crew';
  const openShare = crew && openShareId ? (crew.shares || []).find((x) => x.shareId === openShareId) || null : null;
  const onWall = onCrew && present ? featuredShare(crew) : null;
  // The ticks that still name a decided ask (a tick outlives a refetch, never the ask).
  const decidedNow = decidedAsks(asks);
  const tickedNow = new Set(decidedNow.filter((a) => ticked.has(a.askId)).map((a) => a.askId));
  /**
   * COMBINE (P2): the ticked answers, oldest first, go under whatever the host
   * has typed, after a blank line, and nothing typed is lost. They are marked
   * "In a prompt", the ticks clear, and the cursor waits at the end.
   */
  const combine = () => {
    const chosen = decidedNow.filter((a) => tickedNow.has(a.askId));
    if (!chosen.length) return;
    const lines = combineText(chosen);
    setComposeText((t) => (String(t).trim() ? `${String(t).replace(/\s+$/, '')}\n\n${lines}` : lines));
    const at = new Date().toISOString();
    setUsed((u) => ({ ...u, ...Object.fromEntries(chosen.map((a) => [a.askId, at])) }));
    setTicked(new Set());
    setComposeFocus((n) => n + 1);
  };
  // Ticks for items that have since left Later (sent, removed, voted) no longer count.
  const laterLive = new Set(laterItems(room).map((x) => x.key));
  const laterTickedNow = laterTicked.filter((k) => laterLive.has(k)).length;
  const moveAsk = () => whatsNextMoves(room).find((m) => m.key === 'open-proposed') || null;
  /** What's next's moves (whatsNextMoves' keys). */
  const onMove = (key) => {
    if (key === 'combine') combine();
    else if (key === 'tell') setComposeFocus((n) => n + 1);
    else if (key === 'talk-points') setPointsTab((n) => n + 1);
    else if (key === 'new-ask') setDialog({ compose: 'suggest' });
    else if (key === 'starter') setDialog({ compose: 'suggest', library: true });
    else if (key === 'connect') setDialog('connect');
    else if (key === 'open-proposed') {
      const ask = moveAsk(key);
      if (ask) run(() => api.askAction(ask.askId, { action: 'open' }));
    } else if (key === 'vote-mockups') {
      const looks = mockupsReady(room);
      if (looks) run(() => api.askAction(looks.ask.askId, { action: 'open' }));
    } else if (key === 'vote-later') {
      const keys = new Set(laterTicked);
      setVoteIdeas(voteEntries(room, laterItems(room).filter((x) => keys.has(x.key))));
    } else if (key === 'vote-ideas') setVoteIdeas((room.ideas || []).filter((i) => i.status === 'new').slice(0, VOTE_IDEAS_MAX));
  };

  // ── Talking points ────────────────────────────────────────────────────────
  // ONE ORANGE: while points are ticked the Points action row holds it, and
  // What's next's lead turns to an outline button. When an ask, the opening or
  // the starter question holds it instead, the row's main button is outline.
  const pointsList = (room.points && room.points.items) || [];
  const pointTickedNow = pointTicked.filter((id) => pointsList.some((p) => p.id === id && POINT_OPEN.includes(p.status))).length;
  const whatsNextShown = !onCrew && !current && !(room.opening && room.opening.phase === 'opening') && nowFlags(room).whatsNext;
  const pointsLead = pointTickedNow > 0 && whatsNextShown;
  const sendPointRequest = (kind, subject) => run(() => api.pointRequest(kind, subject));
  // Put N to a vote opens the window (T5); its Open voting makes the ask.
  const putPointsToVote = (ids) => { setPointVote(ids); return undefined; };
  const openPointsVote = async (body) => {
    const out = await run(() => api.votePoints(body));
    if (out !== undefined) { setPointVote(null); setPointTicked([]); }
    return out;
  };
  const hidePoint = (p) => run(() => api.pointAction(p.id, 'hide'));
  const savePointLater = (p) => run(() => api.pointAction(p.id, 'later'));
  /** Take it down: with 2 or more new ideas about it, offer them a vote first (T4c). */
  const takePointDown = (p) => {
    const ideas = takeDownIdeas(room);
    if (ideas.length >= 2) setTakeDown({ point: p, ideas });
    else hidePoint(p);
  };
  const shownPoint = shownPointOf(room);

  // ── The highlight at a points vote's results, and the run list ───────────
  // The highlight step replaces the Settle step for a vote made from points
  // (T6). The Stage dock reads the same highlight and presses the same moves.
  const pointsResults = current && current.status === 'results' && isPointsVote(current) && !current.wheel && !current.revotedAs ? current : null;
  const toggleHighlight = (ask, label) => {
    setPointsSaid((m) => ({ ...m, [ask.askId]: '' }));
    setHighlights((h) => {
      const on = highlightOf(ask, room, h[ask.askId]);
      return { ...h, [ask.askId]: on.includes(label) ? on.filter((x) => x !== label) : [...on, label] };
    });
  };
  /** 'send' | 'run' | 'later-rest' move the highlighted forward; 'close' records a vote that has nothing left to move. */
  const moveForward = async (ask, then) => {
    const override = highlights[ask.askId];
    const labels = highlightOf(ask, room, override);
    const ids = highlightedPointIds(ask, room, override);
    const rows = pointVoteRows(ask, room);
    const recordOnly = (chosen, text) => run(() => api.askAction(ask.askId, decideBody(ask, { direction: text, chosen, send: false })));
    if (then === 'close') return recordOnly([], W.movedForwardDone);
    if (then !== 'later-rest' && !ids.length) return undefined;
    const rest = rows.filter((r) => rowIsLive(r) && !labels.includes(r.label)).length;
    const out = await run(() => api.askAction(ask.askId, { action: 'forward', pointIds: ids, then }));
    if (out === undefined) return undefined;
    if (then === 'later-rest') {
      setPointsSaid((m) => ({ ...m, [ask.askId]: W.savedForLater((out.saved || []).length || rest) }));
      return out;
    }
    // Sent or started: the server settled the vote in the same write, so it has left the Now column.
    return out;
  };
  const list = runOf(room);
  const listRunning = runRunning(room);
  const nextItem = async (force = false) => {
    if (!list) return undefined;
    // Claude has not reported the item done: ask before sending the next over it.
    if (!force && !list.claudeDone) { setRunConfirm(true); return undefined; }
    let confirmNeeded = false;
    const out = await run(async () => {
      try {
        return await api.runNext({ from: list.cur, runId: list.runId, ...(force ? { force: true } : {}) });
      } catch (e) {
        // The server's own refusal, when the list moved under us: ask the same question.
        if (e && e.status === 409 && e.body && e.body.needsConfirm) { confirmNeeded = true; return {}; }
        throw e;
      }
    });
    if (confirmNeeded) setRunConfirm(true);
    return out;
  };
  // A refused press (the list moved, or ended) leaves the page behind: read it again.
  const listCall = async (fn) => {
    const out = await run(fn);
    if (out === undefined) await refresh();
    return out;
  };
  const skipItem = () => (list ? listCall(() => api.runSkip({ from: list.cur, runId: list.runId })) : undefined);
  const stopList = () => (list ? listCall(() => api.runStop({ runId: list.runId })) : undefined);
  const reorderList = (order, ver, runId) => listCall(() => api.runReorder(order, ver, runId));
  // Next holds the one orange while the list runs and nothing else does: no ask,
  // no opening, no dialog, not the crew board. The Points row and What's next
  // stand aside for it.
  const runLeads = listRunning && !current && !(room.opening && room.opening.phase === 'opening') && !onCrew
    && !pointVote && !takeDown && !voteIdeas && !dialog;

  return (
    <ImageLoader.Provider value={loadImage}>
    <ViewerContext.Provider value={openViewer}>
    <ImageViewer.Provider value={openImage}>
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
          draft={current ? drafts[current.askId] || null : null}
          onSent={(out) => { if (current) setDrafts(({ [current.askId]: _gone, ...rest }) => rest); onSent(out); }}
          onHost={() => setScreen('host')}
          onSession={() => (panel ? closePanel() : openPanel())}
          panelOpen={Boolean(panel)}
          askingCount={askingNow.length}
          listNames={Boolean(room.settings && room.settings.listNames)}
          onTakeDown={takePointDown}
          onPointLater={savePointLater}
          highlight={current ? highlights[current.askId] : undefined}
          onPointsMove={moveForward}
          onRunNext={() => nextItem(false)} onRunSkip={skipItem} onRunStop={stopList}
          pickId={pick && current && pick.askId === current.askId ? pick.id : null}
          onPick={(id) => {
            if (current) setConfirmPick({ ask: current, id });
          }}
        />
      ) : (
      <>
      <RoomHeader
        room={room}
        now={now}
        host={host}
        screen={screen}
        onScreen={setScreen}
        ended={ended}
        connection={connection}
        onReconnect={reconnect}
        narrow={narrow}
        onSession={() => (panel ? closePanel() : openPanel())}
        panelOpen={Boolean(panel)}
        askingCount={askingNow.length}
        onPlayers={() => openPanel('players')}
        onWifi={() => openPanel('settings', 'room')}
        onQr={() => setQrOpen(true)}
      />
      {/* SOMEONE ASKS TO TAKE A NAME (S6a): named, on the Host screen only. */}
      {screen === 'host' && !ended && (
        <HandoverStrip asking={askingNow} busy={busy} onGrant={grantAsker} onRefuse={refuseAsker} onSee={() => openPanel('players')} />
      )}
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
      {host && ended && (
        <div className="brm-notice brm-notice--bar brm-row brm-gap" data-testid="brm-endedbar">
          <span>This session has ended. The timeline, the wrap-up and the report are still yours to edit.</span>
        </div>
      )}
      {!host && ended && <div className="brm-notice brm-notice--bar">This session has ended. The timeline, the wrap-up and the report are still yours to edit.</div>}
      {/* WRAPPED, NOT YET ENDED (owner, 2026-10-06): the next steps in one place. */}
      {host && !ended && room.outcome && (
        <div className="brm-notice brm-notice--bar brm-row brm-gap" data-testid="brm-wrappedbar">
          <span>Claude has wrapped up. Look over the report, then end the session when the room is done.</span>
          <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={() => goView('report')}>Report</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" onClick={() => setDialog('end')}>End session</button>
        </div>
      )}

      {screen === 'build' && <BuildScreen room={room} now={now} />}
      {screen === 'history' && <HistoryScreen room={room} onOpenAsk={setDetailAskId} />}
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
                <button type="button" className="brm-btn" onClick={() => setDialog('connect')}>
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
              {!ended && shouldOfferWifi(room) && <WifiOffer busy={busy} run={run} api={api} />}
              {unsentAsk && (
                <p className="brm-notice brm-unsent" role="status">
                  You had an unsent direction for Ask {askNumber(unsentAsk.askId)}. It is kept; reopen Ask {askNumber(unsentAsk.askId)} to send it.
                </p>
              )}
              {sent && <p className="brm-sentline" role="status">{sent}</p>}
              {shownPoint && (
                <ShownPointCard
                  point={shownPoint} ideas={shownPointIdeas(room).length} busy={busy} ended={ended}
                  onTakeDown={() => takePointDown(shownPoint)} onSaveLater={() => savePointLater(shownPoint)}
                />
              )}
              {list && runHidden !== list.runId && (
                <RunPanel
                  run={list} busy={busy} ended={ended} leads={runLeads} confirming={runConfirm}
                  onNext={() => nextItem(false)} onSkip={skipItem} onStop={stopList} onReorder={reorderList}
                  onHide={() => setRunHidden(list.runId)}
                />
              )}
              {current ? (
                <div className="brm-now">
                  {/* THE ASK AS FOUR STEPS (owner, 2026-10-07). "Go with B"
                      is the room's choice and goes straight on; a click on
                      another option still asks first. */}
                  {pointsResults ? (
                    <BuildPointsResults
                      key={`${current.askId}:points`}
                      ask={current} room={room} busy={busy} ended={ended}
                      override={highlights[current.askId]} said={pointsSaid[current.askId] || ''}
                      onToggle={(label) => toggleHighlight(current, label)}
                      onMove={(then) => moveForward(current, then)}
                      quiet={Boolean(pointVote || runConfirm)}
                    />
                  ) : (
                  <AskPath
                    key={current.askId}
                    ask={current} room={room} busy={busy} ended={ended} run={run} api={api}
                    pickId={pick && pick.askId === current.askId ? pick.id : null}
                    onPick={(id, opts) => (opts && opts.confirmed ? choosePick(current, id) : setConfirmPick({ ask: current, id }))}
                    answering={answering} setAnswering={setAnswering}
                    onSent={(out) => { setDrafts(({ [current.askId]: _gone, ...rest }) => rest); onSent(out); }}
                    draft={drafts[current.askId] || null}
                    onDraft={(d) => setDrafts((m) => ({ ...m, [current.askId]: d }))}
                    quiet={Boolean(pointVote || runConfirm)}
                  />
                  )}
                </div>
              ) : (
                room.opening && room.opening.phase === 'opening'
                  ? <OpeningPanel room={room} focus={openFocus} setFocus={setOpenFocus} busy={busy} ended={ended} run={run} api={api} onShowWall={() => setScreen('stage')} />
                  : <NowBuilding room={room} now={now} ended={ended} busy={busy} run={run} api={api} onShowBuild={() => setScreen('build')} onCompose={(kind, extra) => setDialog({ compose: kind, ...extra })} ticked={tickedNow} laterTicked={laterTickedNow} onMove={onMove} leadOutline={pointsLead || listRunning} />
              )}
            </>
          )}

          {!ended && <Composer agent={room.agent} busy={busy} run={run} api={api} onCompose={(kind) => setDialog({ compose: kind })} text={composeText} setText={setComposeText} focusKey={composeFocus} leadShows />}
        </main>

        {/* WAITING FOR YOU: Claude's proposed asks first (Claude is waiting on
            them), then the room's ideas (C1, C2). */}
        <section className="brm-hostcol" aria-labelledby="brm-waiting-h">
          <h2 className="brm-h5" id="brm-waiting-h">
            Waiting for you{waitingCount(room) > 0 ? ` · ${waitingCount(room)}` : ''}
          </h2>
          <UnheardNotice room={room} />
          {freshWallComment(room, now) && (
            <div className="brm-notice brm-row brm-gap brm-onwall" role="status">
              <span><b>On the wall now:</b> &ldquo;{room.wallComment.text}&rdquo;</span>
              <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={() => run(() => api.clearWall())}>Take it down</button>
            </div>
          )}
          {onCrew ? (
            <>
              {proposed.map((ask) => (
                <ReviewCard key={`${ask.askId}:${ask.status}`} ask={ask} openAsk={openAskOf(room)} busy={busy} ended={ended} run={run} api={api} connected={room.agent?.connected} />
              ))}
              <CrewIncoming crew={crew} busy={busy} run={run} api={api} onOpen={setOpenShareId} />
            </>
          ) : (
            <Queue
              room={room} current={current} busy={busy} ended={ended} run={run} api={api}
              laterTicked={laterTicked} setLaterTicked={setLaterTicked}
              onVoteLater={(items) => setVoteIdeas(voteEntries(room, items))}
              onAskRoom={(text) => setDialog({ compose: 'suggest', prompt: text })}
              pointTicked={pointTicked} setPointTicked={setPointTicked} leadsRow={pointsLead && !pointVote && !listRunning} askOpen={Boolean(current)} openPoints={pointsTab}
              onRequest={(kind) => setDialog({ points: kind })} onVotePoints={putPointsToVote}
            />
          )}
        </section>

        {/* WHAT HAPPENED (owner, 2026-10-05): the timeline, the asks and the
            screenshots, one open at a time; the open one fills the column and
            scrolls inside itself, so the page never scrolls. */}
        <aside className="brm-hostcol brm-hostcol--stack">
          {current && !ended && <ClaudeActivity activity={room.activity || []} agent={room.agent} now={now} full />}
          <HistoryStack
            items={[
              ...(room.opening && room.opening.phase === 'opening' ? [{
                key: 'opening', label: 'The opening',
                count: (room.opening.steps || []).filter((x) => ['done', 'skipped'].includes(x.status)).length,
                body: <BriefPath room={room} focus={openFocus} setFocus={setOpenFocus} busy={busy} ended={ended} run={run} api={api} />,
              }] : []),
              // DECIDED (P1): every decided ask with a tick, to combine into one prompt.
              { key: 'decided', label: 'Decided', count: decidedNow.length, skip: !decidedNow.length, hint: ended ? '' : 'Tick to combine', body: <DecidedList asks={asks} ticked={tickedNow} setTicked={setTicked} used={used} onCombine={combine} ended={ended} /> },
              { key: 'timeline', label: 'Timeline', count: (room.log || []).length, body: <Timeline log={room.log || []} host={host} stopped={agentStopped(room.agent)} busy={busy} ended={ended} run={run} api={api} deleteAs={room.deleteAs} /> },
              { key: 'asks', label: 'Asks', count: asks.length, body: asks.length
                ? <AskList asks={asks} host={host} busy={busy} ended={ended} run={run} api={api} currentAskId={room.currentAskId} />
                : <div className="brm-empty">No asks yet.</div> },
              { key: 'shots', label: 'Screenshots', count: (room.images || []).length, body: <ShotsPanel images={room.images || []} busy={busy} run={run} api={api} deleteAs={room.deleteAs} /> },
              { key: 'brief', label: 'Room brief', count: briefCount(room.brief), body: <BriefPanel brief={room.brief} busy={busy} ended={ended} run={run} api={api} /> },
            ]}
          />
        </aside>
      </div>
      )}
      </>
      )}

      {qrOpen && <QrZoom playUrl={`${window.location.origin}/play?gameId=${room.gameId}`} gameId={room.gameId} onClose={() => setQrOpen(false)} />}
      {panel && (
        <BuildSessionPanel
          room={room} now={now} ended={ended} busy={busy} run={run} api={api} connected={connection === 'live'}
          roster={roster} reloadPlayers={loadPlayers}
          tab={panel.tab} focusGroup={panel.group} onTab={(t) => setPanel({ tab: t, group: '' })} onClose={closePanel}
          topLine={narrow || screen === 'stage' ? <HeaderTools {...headerTools} host /> : null}
          slots={{
            agentChip: <AgentChip room={room} now={now} />,
            autoSwitch: ended ? null : <AutoSwitch settings={room.settings} busy={busy} run={run} api={api} />,
          }}
          listNames={Boolean(room.settings && room.settings.listNames)} onListNames={(on) => run(() => api.saveSettings({ listNames: on }))}
          onConnect={() => dialogFromPanel('connect')}
          onCrew={() => dialogFromPanel('crew')}
          onWrap={() => dialogFromPanel('wrap')}
          onReport={() => goView('report')}
          onEnd={() => dialogFromPanel('end')}
          onShowQr={() => setQrOpen(true)}
          onWifiWall={() => { setScreen('stage'); setWallQr(true); }}
          wifiLink={wifiLink(room)}
        />
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
      {confirmPick && (
        <PickConfirm
          ask={confirmPick.ask} id={confirmPick.id} busy={busy}
          onClose={() => setConfirmPick(null)}
          onConfirm={async () => {
            const { ask, id } = confirmPick;
            // Picking while the room is still answering closes the vote first.
            if (['live', 'voting'].includes(ask.status)) {
              const ok = await run(() => api.askAction(ask.askId, { action: 'close' }));
              if (ok === undefined) return;
            }
            setConfirmPick(null);
            setPick({ askId: ask.askId, id });
            setScreen('host');
          }}
        />
      )}
      {host && dialog === 'end' && (
        <EndDialog api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog && dialog.compose && (
        <AskComposer kind={dialog.compose} prompt={dialog.prompt || ''} detail={dialog.detail || ''} library={Boolean(dialog.library)} asks={asks} api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog && dialog.points && (
        <BuildPointRequest
          kind={dialog.points} initial={defaultSubject(room)} connected={Boolean(room.agent && room.agent.connected)} busy={busy}
          onSend={sendPointRequest} onClose={() => setDialog(null)}
        />
      )}
      {host && pointVote && (() => {
        const live = pointVote.map((id) => pointsList.find((p) => p.id === id && POINT_OPEN.includes(p.status))).filter(Boolean);
        return live.length >= 2 ? (
          <BuildPointsVote
            key={live.map((p) => p.id).join(',')}
            points={live} openAsk={openAskOf(room)} busy={busy}
            onOpen={openPointsVote} onClose={() => setPointVote(null)}
          />
        ) : null;
      })()}
      {runConfirm && listRunning && !list.claudeDone && (
        <RunConfirm
          run={list} busy={busy}
          onWait={() => setRunConfirm(false)}
          onSend={async () => { setRunConfirm(false); await nextItem(true); }}
        />
      )}
      {takeDown && (
        <TakeDownOffer
          ideas={takeDown.ideas} busy={busy}
          onClose={() => setTakeDown(null)}
          onNotNow={async () => { const ok = await hidePoint(takeDown.point); if (ok !== undefined) setTakeDown(null); }}
          onVote={async () => {
            const { point, ideas } = takeDown;
            const ok = await hidePoint(point);
            if (ok === undefined) return;
            setTakeDown(null);
            setVotePicks(3);
            setVoteIdeas(ideas);
          }}
        />
      )}
      {host && voteIdeas && voteIdeas.length >= 2 && (
        <VoteFromIdeasDialog
          ideas={voteIdeas} picks={votePicks} connected={Boolean(room.agent && room.agent.connected)} openAsk={openAskOf(room)} busy={busy} run={run} api={api}
          onClose={() => { setVoteIdeas(null); setVotePicks(1); }}
          onDone={() => { setVoteIdeas(null); setVotePicks(1); setLaterTicked([]); }}
        />
      )}
      {wallQrLink && <WallBuildQr link={wallQrLink} onClose={() => setWallQr(false)} />}
      {detailAskId && askById(room, detailAskId) && (
        <AskDetail ask={askById(room, detailAskId)} entry={toldEntry(room, detailAskId)} held={((room.brief && room.brief.later) || []).some((i) => i.askId === detailAskId)} onClose={() => setDetailAskId(null)} onViewMockup={(label) => openViewer(detailAskId, label, 'history')} />
      )}
      {viewer && viewer.image && (
        <MockupViewer key={`img:${viewer.image.imageId}:${viewer.from}`} image={viewer.image} backLabel={viewer.backLabel} onBack={closeViewer} />
      )}
      {viewer && !viewer.image && askById(room, viewer.askId) && (
        <MockupViewer key={`${viewer.askId}:${viewer.label}:${viewer.from}`} ask={askById(room, viewer.askId)} startLabel={viewer.label} backLabel={viewer.backLabel} onBack={closeViewer} />
      )}
    </div>
    </ImageViewer.Provider>
    </ViewerContext.Provider>
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
function AgentChip({ room, now }) {
  const agent = room && room.agent;
  const st = claudeState(room, now);
  const text = st.key === 'paused' && agent && agent.lastSeenAt ? `${st.headline} · last seen ${agoText(agent.lastSeenAt, now)}` : st.headline;
  const [copied, setCopied] = useState('');
  const quiet = agentStopped(agent);
  const cls = `brm-agentchip${agent && agent.connected ? ' is-on' : ''}${quiet ? ' is-quiet' : ''}`;
  if (!quiet) {
    const tip = !agent || !agent.lastSeenAt
      ? 'Claude Code has not connected yet. Use More, then Connect Claude Code.'
      : agent.listening
        ? 'Claude Code is waiting for your next direction.'
        : 'Claude Code is connected and working.';
    return <span className={cls} data-testid="brm-agentchip" data-state={st.key} title={tip}>{text}</span>;
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
      data-state={st.key}
      title={`Claude Code has stopped. Click to copy ${CONTINUE_COMMAND}, then paste it into the Claude Code window and press Enter.`}
      onClick={copy}
    >
      {copied || text}
    </button>
  );
}

/**
 * CLAUDE HAS NOT HEARD THIS (owner, 2026-10-06): a direction sent while Claude
 * Code has stopped waits on the server until Claude calls Engage again, which
 * it only does after /engage:continue. Say so where the host is looking, with
 * the command one click away.
 */
export function UnheardNotice({ room }) {
  const [copied, setCopied] = useState('');
  const waiting = unheard(room);
  if (!waiting.length || !agentStopped(room && room.agent)) return null;
  const copy = async () => {
    const ok = await copyText(CONTINUE_COMMAND);
    setCopied(ok ? 'Copied. Paste it into Claude Code and press Enter.' : `Copy failed. Type ${CONTINUE_COMMAND} into Claude Code.`);
    setTimeout(() => setCopied(''), 5000);
  };
  const n = waiting.length;
  return (
    <div className="brm-notice brm-unheard" role="status" data-testid="brm-unheard">
      <p className="brm-unheard-t">
        <b>Claude Code has stopped.</b> It has not heard {n === 1 ? 'your last direction' : `${n} directions`} yet.
        Run <code>{CONTINUE_COMMAND}</code> in Claude Code and it picks {n === 1 ? 'it' : 'them'} up.
      </p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--sm" onClick={copy}>Copy {CONTINUE_COMMAND}</button>
        {copied && <span className="brm-hint">{copied}</span>}
      </div>
    </div>
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
function SessionMenu({ children, label = 'More', groupLabel = 'Session', ariaLabel, buttonClass = 'brm-btn brm-btn--sm brm-btn--ghost', placeKey }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  useKeepOnScreen(panelRef, open, placeKey);
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
      <button type="button" className={buttonClass} aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((o) => !o)}>
        {label}{label ? ' ' : ''}<Icon name="CaretDown" size={14} />
      </button>
      {open && (
        <div className="brm-more-panel" role="group" aria-label={groupLabel} ref={panelRef}>
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
/**
 * THE LIVE BUILD (owner, 2026-10-08: "no obvious link to the live demo"): the
 * address of what Claude is running. The Wi-Fi share's address when sharing is
 * on (it works on every phone and laptop in the room), else the newest link
 * Claude posted, else the wrap-up's demo.
 */
function liveBuildLink(room, now) {
  const sharing = ['on', 'quiet'].includes(wifiState(room.lan, now).state);
  return (sharing && wifiLink(room)) || latestBuild(room).link || '';
}

/** One always-visible control: opens the build in a new tab, or says why it cannot yet. */
function LiveBuildButton({ link, className = 'brm-btn brm-btn--sm brm-livebuild', onPick }) {
  const href = safeHref(link);
  if (!href) {
    return <button type="button" className={className} disabled title="Claude hasn't started the app yet">{W.openBuild} <Icon name="ArrowSquareOut" size={14} /></button>;
  }
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer" title={`Opens ${href} in a new tab`} onClick={onPick}>{W.openBuild} <Icon name="ArrowSquareOut" size={14} /></a>;
}

/** True at 480px and narrower. No matchMedia (jsdom, an old browser) reads as wide. */
const NARROW_QUERY = '(max-width: 480px)';
function useNarrowHeader() {
  const read = () => {
    try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches; } catch (e) { return false; }
  };
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(read());
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    on();
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else if (mq.removeListener) mq.removeListener(on); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return narrow;
}

/**
 * The header's right-hand tools, in one place: the live build, the Wi-Fi chip,
 * Claude's status, the connection, the join code and the joined count. Wide, they
 * sit in the header; at 480px and narrower they are the Session panel's top line
 * instead (owner, 2026-10-09: the three-dot menu is gone).
 */
function HeaderTools({ room, now, host, ended, connection, onReconnect, onWifi, onQr, onPlayers, pill, onScreen, withPill = true }) {
  const showWifi = host && !ended;
  return (
    <>
      {withPill && pill && (
        <button type="button" className={`brm-askpill${pill.results ? ' is-results' : ''}`} title="Show it on the Stage (2)" onClick={() => onScreen('stage')}>
          {pill.text}
        </button>
      )}
      <LiveBuildButton link={liveBuildLink(room, now)} />
      {showWifi && <WifiChip lan={room.lan} now={now} open={false} onOpen={onWifi} />}
      <span className="brm-agentwrap"><AgentChip room={room} now={now} /></span>
      {host && <ConnectionChip connection={connection} onReconnect={onReconnect} />}
      <button type="button" className="brm-codewrap brm-codebtn" title="Show the QR code" aria-label={`Join code ${room.gameId}. Show the QR code`} onClick={onQr}>
        <span className="brm-muted brm-small">Join</span> <span className="brm-code">{room.gameId}</span>
      </button>
      <button type="button" className="brm-chip brm-chip--btn" title="Who is in the room" onClick={onPlayers}>{room.playerCount || 0} joined</button>
    </>
  );
}

function RoomHeader({
  room, now, host, screen, onScreen, ended, connection, onReconnect, narrow,
  onSession, panelOpen, askingCount, onPlayers, onWifi, onQr,
}) {
  const waiting = waitingCount(room);
  const pill = askPill(room);
  const tucked = narrow;
  const tools = { room, now, host, ended, connection, onReconnect, onWifi, onQr, onPlayers, pill, onScreen };
  return (
    <header className="brm-hbar">
      {/* MAIN MENU (B5, 2026-10-08): always the first control, on every host
          screen and in every state. Leaving does not end the session. */}
      <a className="brm-btn brm-btn--sm brm-btn--ghost brm-mainmenu" href="/">
        <Icon name="House" size={14} /> {W.mainMenu}
      </a>
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
      {/* THE ROOM SEES THIS HEADER on Build and History, so the cue there names
          nobody: an amber pill and the count on SESSION (S6b). The Host screen
          has the named strip instead. */}
      {askingCount > 0 && !host && (
        <button type="button" className="brm-askpill" onClick={onPlayers}>{W.askingToTake(askingCount)}</button>
      )}
      <div className="brm-hbar-tools">
        {!tucked && <HeaderTools {...tools} />}
        {/* SESSION (owner, 2026-10-09): the same word and key as the other
            engagements, last on the right where the three-dot menu was. */}
        <button type="button" className={`brm-btn brm-btn--sm brm-sess${panelOpen ? ' is-on' : ''}`} aria-haspopup="dialog" aria-expanded={panelOpen} onClick={onSession}>
          SESSION <kbd>\</kbd>
          {askingCount > 0 && <span className="brm-sess-n">{askingCount}<span className="brm-sr"> asking to take a name</span></span>}
        </button>
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
const briefCount = (b) => (b ? (b.forWhom ? 1 : 0) + (b.keep || []).length : 0);

/**
 * THE ROOM BRIEF (step 7c, C14): who it is for and what Claude keeps in mind.
 * Keep in mind fills it as the host sends; the host edits it here. What is held
 * back lives on the Later list on the Host screen (BuildLater.jsx). Claude re-reads it on every change.
 */
export function BriefPanel({ brief, busy, ended, run, api }) {
  const b = brief || { forWhom: '', keep: [], later: [] };
  const [forWhom, setForWhom] = useState(b.forWhom || '');
  const [adding, setAdding] = useState({ keep: '' });
  useEffect(() => { setForWhom(b.forWhom || ''); }, [b.forWhom]);
  const save = (body) => run(() => api.editBrief(body));
  const remove = (list, id) => save({ [list]: b[list].filter((i) => i.id !== id).map(({ id: i, text }) => ({ id: i, text })) });
  const add = async (list) => {
    const text = adding[list].trim();
    if (!text) return;
    const ok = await save({ [list]: [...b[list].map(({ id, text: t }) => ({ id, text: t })), { text }] });
    if (ok !== undefined) setAdding((a) => ({ ...a, [list]: '' }));
  };
  const section = (list, title, empty) => (
    <div className="brm-brief-sec">
      <h3 className="brm-h5">{title} · {b[list].length}</h3>
      {!b[list].length && <p className="brm-hint">{empty}</p>}
      <ul className="brm-brief-list">
        {b[list].map((i) => (
          <li key={i.id}>
            <span className="brm-brief-t">{i.text}</span>
            <span className="brm-who">{i.from}</span>
            {!ended && <button type="button" className="brm-x" aria-label={`Remove: ${i.text}`} disabled={busy} onClick={() => remove(list, i.id)}><Icon name="X" size={12} /></button>}
          </li>
        ))}
      </ul>
      {!ended && (
        <form className="brm-row brm-gap" onSubmit={(e) => { e.preventDefault(); add(list); }}>
          <input className="brm-input brm-input--sm" aria-label={`Add to ${title}`} placeholder={`Add to ${title}`} value={adding[list]} maxLength={300} onChange={(e) => setAdding((a) => ({ ...a, [list]: e.target.value }))} />
          <button type="submit" className="brm-btn brm-btn--sm" disabled={busy || !adding[list].trim()}>Add</button>
        </form>
      )}
    </div>
  );
  return (
    <section className="brm-brief" aria-label="The room brief">
      <p className="brm-hint">Claude reads who it is for and Keep in mind whenever they change. At wrap-up Claude says which rules are worth keeping in the project, and you choose.</p>
      <div className="brm-brief-sec">
        <h3 className="brm-h5">Who it is for</h3>
        {ended ? <p>{b.forWhom || 'Not set.'}</p> : (
          <form className="brm-row brm-gap" onSubmit={(e) => { e.preventDefault(); save({ forWhom: forWhom.trim() }); }}>
            <input className="brm-input brm-input--sm" aria-label="Who it is for" placeholder="e.g. busy volunteers, often on an old phone" value={forWhom} maxLength={300} onChange={(e) => setForWhom(e.target.value)} />
            {forWhom.trim() !== (b.forWhom || '') && <button type="submit" className="brm-btn brm-btn--sm" disabled={busy}>Save</button>}
          </form>
        )}
      </div>
      {section('keep', 'Keep in mind', 'Send something to Claude as Keep in mind and it lands here.')}
    </section>
  );
}

function HistoryStack({ items }) {
  // The first item opens, unless it has nothing in it yet (`skip`: an empty
  // Decided); an item that has gone (The opening, once building starts) opens
  // the first one again.
  const first = () => (items.find((it) => !it.skip) || items[0]).key;
  const [chosen, setOpen] = useState(first);
  const open = items.some((it) => it.key === chosen) ? chosen : first();
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
              {it.hint && <span className="brm-muted brm-stackhint">{` · ${it.hint}`}</span>}
            </button>
            {isOpen && <div className="brm-stackbody" id={`brm-stack-${it.key}`}>{it.body}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── The Stage screen ────────────────────────────────────────────────────────

/** The dock hint's verb: what Space does for the move beside it. */
function hintVerb(move) {
  if (move.action === 'to-claude') return move.verb || 'send';
  if (move.action === 'points-send') return 'send';
  if (move.action === 'run-next') return `send ${move.k}`;
  if (move.action === 'points-close') return 'close the vote';
  if (move.action === 'close') return 'show results';
  if (move.action === 'spin' || move.action === 'wheel') return 'spin';
  if (move.action === 'open' || move.action === 'vote') return 'open voting';
  if (move.action === 'edit') return 'change before sending';
  if (move.action === 'reopen') return 'reopen it';
  return 'go';
}

/**
 * STAGE: what the room reads during an ask, drawn by the regular host stage's
 * own parts (components/stage/: Stage, Rail, RoomMeter, Dock), so a Build Room
 * ask looks and behaves like any other session on the projector: the same
 * display profiles and fitter, the phase chip and join code in the rail, the
 * count in the meter, one move in the dock on Space. The rail is this screen's
 * header; HOST at the dock's edge (or 1, or P) goes back, as SESSION does on
 * the regular stage. Everything on it is room-safe (stageModel). At results the
 * host decides here: Send B to Claude sends the room's choice, Change before sending opens the send
 * window (StageDecide), and a click on an option or a wheel slice opens that
 * window with the pick made (owner, 2026-10-08).
 */
function BuildStage({ room, current, crewOn, crew, onWall, busy, ended, run, api, now, onHost, onSession = () => {}, panelOpen = false, askingCount = 0, listNames = false, pickId, onPick, draft = null, onSent = () => {}, onTakeDown = () => {}, onPointLater = () => {}, highlight = undefined, onPointsMove = () => undefined, onRunNext = () => undefined, onRunSkip = () => undefined, onRunStop = () => undefined }) {
  const [profile] = useState(() => loadProfile(window.localStorage, window.innerWidth));
  const [qr, setQr] = useState(false);
  // The picks wait for the wheel to stop (a wheel already still on arrival is settled).
  const spinsOf = (current && current.wheel && current.wheel.spins) || [];
  const lastSpinId = spinsOf.length ? spinsOf[spinsOf.length - 1].spinId : null;
  const [settledSpin, setSettledSpin] = useState(lastSpinId);
  const wheelTurning = Boolean(lastSpinId && lastSpinId !== settledSpin);
  const m = stageModel(room, current, now, { crewOn, draft, turning: wheelTurning, highlight });
  const [editing, setEditing] = useState(false);
  const [editPick, setEditPick] = useState(null); // an option clicked on the board
  // The window belongs to one ask at results: it goes when that ask moves on.
  // A vote made from points settles by highlight (T6), not by the send window.
  const pointsVote = Boolean(current && isPointsVote(current) && !current.wheel && !current.revotedAs);
  const editable = Boolean(current && current.status === 'results' && !ended && !crewOn && !pointsVote);
  const editKey = current ? `${current.askId}:${current.status}` : '';
  useEffect(() => { setEditing(false); setEditPick(null); }, [editKey]);
  const waiting = waitingCount(room);
  const liveLink = liveBuildLink(room, now);
  // A click on an option or a wheel slice at results opens the send window
  // with that pick made; while the room is still answering it asks first, as before.
  const boardPick = (id) => {
    if (editable) { setEditPick(id); setEditing(true); return; }
    onPick(id);
  };
  const move = !ended && m.primary ? m.primary : null;
  const doMove = useCallback((m) => {
    if (!m || busy) return;
    // The turning wheel offers nothing: a pick waits for it to stop, as the Host's button does.
    if (m.action === 'noop' || m.disabled || (m.action === 'to-claude' && wheelTurning)) return;
    // A pick waits for the wheel to stop, as the Host's button does.
    if (m.action === 'noop' || m.disabled || (m.action === 'to-claude' && wheelTurning)) return;
    // EDIT opens the send window here; TO CLAUDE sends the room's choice with
    // its own sentence, as the Host's panel would (owner, 2026-10-08).
    if (m.action === 'edit') { if (editable) setEditing(true); return; }
    // A TALKING POINT is up: Take it down (which may offer the ideas a vote) or save it for later.
    if (m.action === 'take-down') { if (m.point) onTakeDown(m.point); return; }
    if (m.action === 'point-later') { if (m.point) onPointLater(m.point); return; }
    // THE HIGHLIGHT AND THE RUN LIST: the same moves as the Host's rows.
    if (m.action === 'points-send') { onPointsMove(current, 'send'); return; }
    if (m.action === 'points-run') { onPointsMove(current, 'run'); return; }
    if (m.action === 'points-later') { onPointsMove(current, 'later-rest'); return; }
    if (m.action === 'points-close') { onPointsMove(current, 'close'); return; }
    if (m.action === 'run-next') { onRunNext(); return; }
    if (m.action === 'run-skip') { onRunSkip(); return; }
    if (m.action === 'run-stop') { onRunStop(); return; }
    if (m.action === 'to-claude') {
      // The same move as the Host's Settle press, including a direction the host already changed.
      const go = settleMove(current, draft);
      if (!go) return;
      run(async () => {
        const out = await api.askAction(current.askId, decideBody(current, { direction: go.direction, chosen: go.chosen, as: go.kind }));
        onSent({ as: go.kind, send: true, direction: go.direction });
        return out;
      });
      return;
    }
    run(() => api.askAction(m.askId || current.askId, { action: m.action }));
  }, [busy, run, api, current, editable, wheelTurning, room, onTakeDown, onPointLater, onPointsMove, onRunNext, onRunSkip, onRunStop]);
  const act = useCallback(() => doMove(move), [doMove, move]);
  // Space fires the dock's move: never while typing, and never when a focused
  // control would take the Space itself.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('button, a, [role="button"], [role="dialog"]')) return;
      if (dialogOpen()) return;
      // Next before Claude has reported the item done is never one stray key away.
      if (move && move.action === 'run-next' && !move.claudeDone) return;
      e.preventDefault();
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, move]);
  // WHO IS IN THE ROOM, on hover (owner, 2026-10-07): the regular stage's
  // lobby list, the same hover, focus, pin and Escape. Only while no ask is
  // up: the list is the joined set, and an ask phase names the waiting set.
  const [rosterMode, setRosterMode] = useRosterMode();
  const { reveal, handlers } = rosterRevealFor(rosterMode, setRosterMode, `IDLE#${room.currentAskId || (room.asks || []).length}`);
  // A pinned list does not outlive the quiet moment it was asked for: when an
  // ask is up it is put away, and it is not there when the ask ends.
  const askUp = Boolean(m.phase);
  useEffect(() => { if (askUp) setRosterMode(null); }, [askUp, setRosterMode]);
  const joined = m.phase ? null : joinedRoster({ players: (room.players || []).map((name) => ({ name })) });
  // OFF BY DEFAULT (owner, 2026-10-09): the meter lists who has joined only when
  // the host turned "List names on the room meter" on in the Session panel.
  const joinedWaiting = joined && listNames ? { names: joined, mode: reveal, ...handlers } : null;
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
        <BuildWheel wheel={current.wheel} size="lg" onSettled={setSettledSpin} />
        {/* SAME GOES FOR SPIN (owner, 2026-10-06): after it lands, the host may
            take the wheel's pick or an alternate, with the same question. */}
        {!ended && current.wheel.landed && !wheelTurning && (
          <div className="brm-wheelpicks" role="group" aria-label="Pick">
            {(current.wheel.slices || []).map((sl) => (
              <button key={sl.id} type="button" className={`brm-btn${sl.id === current.wheel.landed ? ' is-landed' : ''}`} onClick={() => boardPick(sl.id)}>
                {sl.label ? `${sl.label} · ` : ''}{sl.text}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  } else if (current) {
    content = <AskStage key={`${current.askId}:${current.status}`} ask={current} room={room} host={false} busy={busy} ended={ended} run={run} api={api} pickId={editPick || pickId} onPick={pointsVote ? null : boardPick} />;
  } else if (room.opening && room.opening.phase === 'opening') {
    // THE OPENING (O3): between steps, the wall reads back the brief so far.
    content = <WallBrief room={room} />;
  } else if (m.point) {
    content = <PointStage point={m.point} />;
  } else if (m.run) {
    content = <RunStage run={m.run} />;
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
        meter={<RoomMeter phase={m.phase || 'LOBBY'} heading={m.meter.heading} body={body} waiting={joinedWaiting} />}
        dock={(
          <Dock status={liveLink ? (
            <>
              {m.status}
              {/* A small link, not a button: it must never compete with the main button. */}
              {safeHref(liveLink) && <a className="brm-dockbuild" href={safeHref(liveLink)} target="_blank" rel="noopener noreferrer" title="Opens in a new tab"><Icon name="ArrowSquareOut" size={14} /> {W.openBuildTab}</a>}
            </>
          ) : m.status}
          >
            {!ended && (m.extras || []).map((x) => <button key={x.action} type="button" className="btn ghost" disabled={busy || x.disabled} onClick={() => doMove(x)}>{x.label}</button>)}
            {!ended && m.secondary && <button type="button" className="btn ghost" disabled={busy || m.secondary.disabled} onClick={() => doMove(m.secondary)}>{m.secondary.label}</button>}
            {move && <button type="button" className="btn" disabled={busy || move.disabled || (move.action === 'to-claude' && wheelTurning)} onClick={act}>{move.label}</button>}
            {/* The key sits beside the move it fires, as on the regular stage; HOST stays last. */}
            {move && !move.disabled && !(move.action === 'run-next' && !move.claudeDone) && <span className="brm-dockhint">Press <b>Space</b> to {hintVerb(move)}</span>}
            <button type="button" className="dock-more" onClick={onHost} aria-label="Host screen" title="Host screen (1 or P)">
              <span className="dock-more-lbl">HOST</span>
              {waiting > 0 && <span className="brm-screen-n">{waiting}</span>}
            </button>
            {/* SESSION is last, so it is never the lead. The count lights it when someone
                asks to take a name; nothing on the Stage names the person. */}
            <button type="button" className={`dock-more${askingCount > 0 ? ' brm-dock-lit' : ''}`} aria-haspopup="dialog" aria-expanded={panelOpen} onClick={onSession} title="Session (\)">
              <span className="dock-more-lbl">SESSION</span>
              {askingCount > 0 && <span className="brm-screen-n">{askingCount}<span className="brm-sr"> asking to take a name</span></span>}
            </button>
          </Dock>
        )}
      >
        <div className="content"><div className="fitbox">{content}</div></div>
      </Stage>
      <WallComment comment={freshWallComment(room, now)} />
      {editing && editable && (
        <BuildStageDecide key={`${current.askId}:${editPick || ''}`} initialPick={editPick} draft={draft} onSent={onSent} ask={current} busy={busy} run={run} api={api} onClose={() => { setEditing(false); setEditPick(null); }} />
      )}
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
  const openViewer = useContext(ViewerContext);
  // A newest screenshot that is a choice ask's option opens the viewer (R2).
  const shotAsk = shot && shot.askId ? askById(room, shot.askId) : null;
  const shotOpt = shotAsk && shotAsk.kind === 'choice' ? (shotAsk.options || []).find((o) => o.label === shot.label) : null;
  const shareLink = ['on', 'quiet'].includes(wifiState(room.lan, now).state) ? wifiLink(room) : '';
  return (
    <section className="brm-screenbody brm-buildscreen" aria-label="The build">
      <WallComment comment={freshWallComment(room, now)} />
      <div className="brm-row">
        <h2 className="brm-q">What Claude has built so far</h2>
        {link && <span className="brm-push"><OpenLink href={link} label="Open the build" primary /></span>}
      </div>
      {shot ? (
        <BuildImage imageId={shot.imageId} caption={shot.caption} className="brm-shot brm-shot--build" onOpen={shotOpt && openViewer ? () => openViewer(shotAsk.askId, shotOpt.label, 'build') : null} />
      ) : (
        <div className="brm-empty">Nothing to show yet. When Claude previews the work, its newest screenshot appears here.</div>
      )}
      <BuildScreenQr link={shareLink} />
    </section>
  );
}

/**
 * HISTORY: the room's story so far, to look back on together. The decisions,
 * the timeline as the wall shows it (no host notes, no idea authors), and
 * every screenshot. Nothing here edits; the Host screen does that.
 */
/**
 * HISTORY (step 5, C9 and C10): the session's story for the room, on the
 * wall. Everything is what Claude showed, what was decided and how, and what
 * the room said, newest first, with the pictures at the moment they were
 * made; Decisions is the decisions alone; Artifacts is every picture, each
 * saying what it was for; Full timeline is the room's whole timeline. Nothing
 * here edits: that stays on the Host screen.
 */
const HISTORY_FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'timeline', label: 'Full timeline' },
];

export function StoryItem({ item, onOpen = null }) {
  // A decided item opens its ask's window (History, R1); a click anywhere on
  // it does, except on a link or button of its own.
  const openable = Boolean(onOpen) && item.type === 'decided' && item.askId;
  return (
    <li
      className={`brm-story-it brm-story-it--${item.type}${openable ? ' is-openable' : ''}`}
      onClick={openable ? (e) => { if (!(e.target.closest && e.target.closest('a, button'))) onOpen(item.askId); } : undefined}
    >
      <span className="brm-story-tm">{clockTime(item.at)}</span>
      <span className="brm-story-dot" aria-hidden="true" />
      <div className="brm-story-body">
        {openable
          ? <button type="button" className="brm-story-h brm-story-open" aria-label={`Open Ask ${askNumber(item.askId)}`} onClick={() => onOpen(item.askId)}>{item.heading}</button>
          : <span className="brm-story-h">{item.heading}</span>}
        <p className="brm-story-t">{item.text}</p>
        {item.chain.length > 0 && (
          <p className="brm-story-chain" aria-label="How it was decided">
            {item.chain.map((c, i) => (
              <React.Fragment key={c}>
                {i > 0 && <span className="brm-story-arrow" aria-hidden="true">→</span>}
                <span className="brm-story-step">{c}</span>
              </React.Fragment>
            ))}
          </p>
        )}
        {item.imageIds.length > 0 && (
          <div className="brm-story-pics">
            {item.imageIds.map((id) => (
              <BuildImage key={id} imageId={id} alt={item.text} linked={!openable} className={`brm-shot brm-story-pic${(item.chosenLabels || []).length && item.imageIds[0] === id ? ' is-chosen' : ''}`} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function HistoryScreen({ room, onOpenAsk }) {
  const [filter, setFilter] = useState('all');
  const asks = room.asks || [];
  const story = roomStory({ log: room.log || [], asks, images: room.images || [] });
  const arts = artifactsOf({ images: room.images || [], asks });
  const shown = filterStory(story, filter === 'decisions' ? 'decisions' : 'all');
  const decided = asks
    .filter((a) => a.status === 'decided' && a.decision)
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  const ideas = room.ideas || [];
  const usedIdeas = ideas.filter((i) => i.status === 'promoted').length;
  const noop = () => undefined;
  return (
    <div className="brm-screenbody brm-histscreen">
      <div className="brm-histmain">
        {filter === 'timeline' && <Timeline log={room.log || []} host={false} busy={false} ended run={noop} api={null} deleteAs="" />}
        {filter === 'artifacts' && (arts.length ? (
          <ul className="brm-arts" aria-label="Artifacts">
            {arts.map((a) => (
              <li key={a.imageId} className={`brm-art${a.chosen ? ' is-chosen' : ''}`}>
                <BuildImage imageId={a.imageId} alt={a.title} className="brm-shot brm-art-img" />
                <span className="brm-art-t">{a.title}</span>
                <span className="brm-who">{a.meta} · {clockTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="brm-empty">Claude&apos;s screenshots and mockups collect here as it works.</p>)}
        {(filter === 'all' || filter === 'decisions') && (shown.length ? (
          <ol className="brm-story" aria-label={filter === 'decisions' ? 'Decisions' : 'The story so far'}>
            {shown.map((it) => <StoryItem key={it.id} item={it} onOpen={onOpenAsk} />)}
          </ol>
        ) : (
          <p className="brm-empty">{filter === 'decisions' ? 'Nothing decided yet.' : 'What Claude shows, what the room decides and what it says collect here.'}</p>
        ))}
      </div>
      <div className="brm-histside">
        <div className="brm-qfilters" role="group" aria-label="Show">
          {HISTORY_FILTERS.map((f) => (
            <button key={f.key} type="button" className={`brm-qchip${filter === f.key ? ' is-on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}{f.key === 'artifacts' ? ` · ${arts.length}` : ''}
            </button>
          ))}
        </div>
        <section className="brm-panel" aria-labelledby="brm-decided-h">
          <h2 className="brm-h" id="brm-decided-h">Decided so far</h2>
          {decided.length ? (
            <ol className="brm-list brm-decided">
              {decided.map((a) => (
                <li key={a.askId}>
                  <button type="button" className="brm-decided-open" onClick={() => onOpenAsk(a.askId)}>
                    {a.decision.direction || a.prompt}
                    {a.decision.method && <span className="brm-muted brm-small">{` · ${METHOD_WORDS[a.decision.method] || a.decision.method}`}</span>}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="brm-hint">Nothing decided yet.</p>
          )}
        </section>
        <section className="brm-panel" aria-labelledby="brm-made-h">
          <h2 className="brm-h" id="brm-made-h">Made so far</h2>
          <p className="brm-made">
            {arts.length} {arts.length === 1 ? 'screenshot' : 'screenshots'} · {ideas.length} {ideas.length === 1 ? 'idea' : 'ideas'}{ideas.length ? `, ${usedIdeas} used` : ''}
          </p>
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

function ReviewCard({ ask, openAsk = null, busy, ended, run, api, connected }) {
  const [prompt, setPrompt] = useState(ask.prompt);
  const [detail, setDetail] = useState(ask.detail || '');
  const [options, setOptions] = useState(() => (ask.options || []).map((o) => ({ ...o })));

  const optionsDirty = JSON.stringify(options.map(({ title, detail: d, url }) => [title, d, url]))
    !== JSON.stringify((ask.options || []).map(({ title, detail: d, url }) => [title, d, url]));
  const dirty = prompt !== ask.prompt || detail !== (ask.detail || '') || optionsDirty;

  const editBody = () => ({
    action: 'edit',
    prompt,
    detail,
    ...(ask.kind === 'choice' ? { options: options.map(({ title, detail: d, url }) => ({ title, detail: d, url })) } : {}),
  });

  const save = () => run(() => api.askAction(ask.askId, editBody()));
  const open = () => run(async () => {
    if (dirty) await api.askAction(ask.askId, editBody());
    return api.askAction(ask.askId, { action: 'open' });
  });
  const discard = () => run(() => api.askAction(ask.askId, { action: 'discard' }));
  const lineUp = (action) => run(() => api.askAction(ask.askId, { action }));
  // THE VOTE THAT WAITS FOR MOCKUPS (C3b): hidden until the pictures are in,
  // then Ready; it opens only when the host opens it, or lined up next.
  const mockups = ask.mockups || null;
  const waitingOnClaude = Boolean(mockups && !mockups.ready);
  const blocking = openAsk && openAsk.askId !== ask.askId ? openAsk : null;
  let openLabel = 'Open to the room';
  if (blocking) openLabel = `Close ask ${askNumber(blocking.askId)} and open this`;
  else if (waitingOnClaude) openLabel = 'Open now, without the rest';
  const setOpt = (i, key, value) => setOptions((list) => list.map((o, j) => (j === i ? { ...o, [key]: value } : o)));
  const openViewer = useContext(ViewerContext);
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
        <span className="brm-chip brm-chip--amber">{ask.source === 'agent' ? 'Proposed by Claude' : ask.fromIdeas ? `Your vote, from ${ask.fromIdeas.length} ideas` : 'Draft'} · not shown to the room</span>
        {mockups && (mockups.ready
          ? <span className="brm-chip brm-chip--live" data-testid="brm-mockups-ready">Mockups ready</span>
          : <span className="brm-chip" data-testid="brm-mockups-wait">Claude is making mockups · {mockups.have} of {mockups.total}</span>)}
        {ask.next && <span className="brm-chip">Opens after ask {blocking ? askNumber(blocking.askId) : ''}</span>}
        {ask.source === 'agent' && connected && <span className="brm-muted brm-small brm-push">Claude is waiting</span>}
      </div>
      <div className="brm-row brm-gap">
        <h2 className="brm-h">Ask {askNumber(ask.askId)} · {KIND_LABEL[ask.kind]}</h2>
        {ask.kind === 'choice' && <span className="brm-hint brm-push">Options can change until someone answers</span>}
      </div>
      {!mockups && <p className="brm-stagehint">{stageHint(ask)}</p>}
      {/* WHAT THE ROOM WOULD SEE, then the edits folded (C2): most of
          Claude's asks open as written, so the fields are one click away. */}
      <p className="brm-reviewq">{prompt || ask.prompt}</p>
      {ask.kind === 'choice' && mockups && (
        // C3b: a tile per option, its picture as Claude attaches it.
        <ul className="brm-mocktiles">
          {(ask.options || []).map((o, i) => (
            <li key={o.label || i}>
              {o.imageId
                ? <BuildImage imageId={o.imageId} alt={`Choice ${letter(i)}`} className="brm-mocktile-img" onOpen={openViewer ? () => openViewer(ask.askId, o.label, 'host') : null} />
                : <span className="brm-mocktile-wait">{i === (ask.options || []).findIndex((x) => !x.imageId) ? 'Claude is making it' : 'Waiting'}</span>}
              <span className="brm-mocktile-t"><b>{letter(i)}</b> {o.title}</span>
            </li>
          ))}
        </ul>
      )}
      {ask.kind === 'choice' && !mockups && (
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
      {ask.kind === 'rating' && <p className="brm-hint">1 means {RATING_SCALE.lowLabel.toLowerCase()} · 5 means {RATING_SCALE.highLabel.toLowerCase()}</p>}
      {mockups && !ended && (
        <p className="brm-hint" role="status">
          {mockups.ready
            ? (blocking ? `Ask ${askNumber(blocking.askId)} is still open. Open next puts this vote on the room's screens as soon as you close ask ${askNumber(blocking.askId)}.` : 'Every option has its picture. Open it when you are ready.')
            : `The room cannot see it yet. It is marked Ready when all ${mockups.total} are in; you open it.`}
        </p>
      )}
      {missing.length > 0 && !ended && !mockups && (
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
        </div>
      </details>
      {!ended && (
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--ghostdanger" disabled={busy} title={ask.fromIdeas ? 'The ideas go back to the queue' : undefined} onClick={discard}>{ask.fromIdeas ? 'Cancel the vote' : 'Discard'}</button>
          {dirty && <button type="button" className="brm-btn brm-btn--ghost brm-push" disabled={busy} onClick={save}>Save edits</button>}
          {!answering && (
            <button type="button" className={`brm-btn brm-btn--ghost${dirty ? '' : ' brm-push'}`} disabled={busy || !prompt.trim()} onClick={() => setAnswering(true)}>Answer for the room</button>
          )}
          {blocking && (ask.next
            ? <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} title="Take it out of line; it waits here" onClick={() => lineUp('notNext')}>Not next</button>
            : <button type="button" className="brm-btn" disabled={busy || !prompt.trim()} title={`Opens as soon as ask ${askNumber(blocking.askId)} closes`} onClick={() => lineUp('openNext')}>Open next</button>)}
          <button type="button" className={`brm-btn${answering && !dirty ? ' brm-push' : ''}`} disabled={busy || !prompt.trim()} onClick={open}>{openLabel}</button>
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
              <b>{ask.status === 'voting' ? 'Vote' : KIND_LABEL[ask.kind]}</b> · Ask {askNumber(ask.askId)} · {ask.source === 'agent' ? 'Claude asks' : 'Host asks'}
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
 * THE WHEEL, OR A REVOTE (owner, 2026-10-05): "if a tie, it's either a wheel
 * spin or revote, host's choice", and the wheel any time at results. A random
 * person in the room spins it from their phone; the host can always spin;
 * if the room groans, spin again or hand it to someone else. Where it lands
 * fills in the direction below, which the host can still change.
 */
export function WheelPanel({ ask, busy, run, api, primary = false, spinInRow = false, onSettled = null }) {
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
          <button type="button" className={`brm-btn${primary ? ' brm-btn--primary' : ''}`} disabled={busy} onClick={() => act('wheel')}>{W.spin}</button>
          {tied.length >= 2 && <button type="button" className="brm-btn" disabled={busy} onClick={() => act('revote')}>{W.voteAgain}</button>}
        </div>
        <p className="brm-hint">Someone in the room spins it from their phone. You can always spin it yourself.</p>
      </section>
    );
  }
  const w = ask.wheel;
  return (
    <section className="brm-panel brm-wheelpanel" aria-label="The wheel">
      <BuildWheel wheel={w} size="sm" busy={busy} onSpin={spinInRow ? null : () => act('spin')} spinLabel={w.landed ? W.spinAgain : W.spin} spinPrimary={primary} spinSecondary={!primary} onSettled={onSettled} />
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

/**
 * THE HOST'S PICK, CONFIRMED (owner, 2026-10-06: "it asks if you want to pick
 * the preferred choice of the room ... or an alternate one (not the room's
 * preference). same goes for spin. ask the host to confirm and let them know
 * they have picked an alternate choice"). On the Host screen and the Stage.
 */
export function PickConfirm({ ask, id, busy, onConfirm, onClose }) {
  const v = pickVerdict(ask, id);
  const name = (c) => (c ? `${c.label ? `${c.label} · ` : ''}${c.text}` : '');
  const short = (c) => (c && c.label ? c.label : 'this one');
  const open = ['live', 'voting'].includes(ask.status);
  const why = v.by === 'wheel' ? 'where the wheel landed' : v.preferred ? `the room's pick, ${v.preferred.count} of ${v.total}` : '';
  let body;
  if (v.isPreferred) body = `${name(v.pick)} is ${why}.`;
  else if (v.preferred) body = `The room preferred ${name(v.preferred)} (${why}). You are picking ${name(v.pick)} instead. It is recorded as your pick, not the room's.`;
  else body = `${v.tied.length ? `The room is tied between ${v.tied.join(' and ')}.` : 'The room has not voted yet.'} You are picking ${name(v.pick)}. It is recorded as your pick.`;
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm" onClose={onClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-pick-title">
      <DialogHead id="brm-pick-title" title={v.isPreferred ? W.pickRoomChoice : 'Pick an alternate?'} onClose={onClose} />
      <p data-testid="brm-pick-body">{body}</p>
      {open && <p className="brm-hint">This closes the vote.</p>}
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy} onClick={onConfirm}>
          {v.isPreferred ? W.pick(short(v.pick)) : `Yes, pick ${short(v.pick)} instead`}
        </button>
      </div>
    </Modal>
  );
}

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
      {!sorted.length && <div className="brm-empty">Suggestions appear here as phones send them. Anonymous on the wall.</div>}
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
  if (ask.kind === 'rating') return chosen[0] ? questionAnswer(ask.prompt, ratingAnswer(chosen[0])) : '';
  return '';
}

/**
 * `next` (owner, 2026-10-07): this is the open step of the Host screen's path,
 * so the cursor lands in the direction. Send carries `data-next-primary` for
 * the contract but `data-no-space` too: Space never sends (controller ruling,
 * 2026-10-07); Ctrl or Cmd Enter in the direction does.
 * `onSent({ as, send, direction })` hears a decision that went through.
 * `draft` ({direction, as, chosen}) is where it starts when the host left an
 * unsent direction here; `onDraft` hears every change the host makes.
 */
export function DecidePanel({ ask, busy, run, api, playerCount, spoken = false, onCancel, beforeDecide, pickId = null, next = false, onSent, draft = null, onDraft }) {
  // An alternate to the room's choice says so where the host sends it.
  const verdict = !spoken && pickId ? pickVerdict(ask, pickId) : null;
  const alternate = verdict && !verdict.isPreferred && verdict.preferred ? verdict : null;
  const [direction, setDirection] = useState(() => {
    if (draft) return draft.direction;
    if (spoken) return '';
    return pickId ? directionFor(ask, pickId) : defaultDirection(ask);
  });
  const [edited, setEdited] = useState(Boolean(draft));
  const [note, setNote] = useState('');
  // WHAT CLAUDE GETS (step 7c): as the ready question's set says, else Do now.
  // Later is a list, never a kind (owner, 2026-10-08): a set that says `later` starts at Do now.
  const [as, setAs] = useState(() => {
    const first = (draft && draft.as) || defaultKind(ask);
    return first === 'later' ? 'do-now' : first;
  });
  const inflight = useRef(false);
  const [folded, setFolded] = useState(() => new Set());
  const sources = foldSources(ask);
  const topChoice = !spoken && ask.kind === 'choice'
    ? [...((ask.results && ask.results.options) || [])].sort((a, b) => b.count - a.count).filter((o) => o.count)[0]
    : null;
  const [chosen, setChosen] = useState(() => {
    if (draft && draft.chosen) return draft.chosen;
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
  // Once the host has changed anything, every change is kept as a draft.
  const dirty = useRef(false);
  const touch = () => { dirty.current = true; };
  useEffect(() => {
    if (dirty.current && onDraft) onDraft({ direction, as, chosen });
  }, [direction, as, chosen]); // eslint-disable-line react-hooks/exhaustive-deps
  // In spoken mode the sentence follows the picks until the host types in it.
  const pick = (next) => {
    touch();
    setChosen(next);
    if (spoken && !edited) setDirection(spokenDirection(ask, next));
  };

  const toggleFold = (s) => {
    touch();
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

  // Send B to Claude, Save for later (a decision of kind `later`, which lands
  // in Later), or Record only (the timeline, nothing to Claude). One at a time.
  const decide = async ({ send = true, kind = as } = {}) => {
    if (inflight.current) return undefined;
    inflight.current = true;
    try {
      const said = direction.trim();
      const out = await run(async () => {
        if (beforeDecide) await beforeDecide();
        return api.askAction(ask.askId, decideBody(ask, { direction: said, chosen, note, send, as: kind, spoken }));
      });
      if (out !== undefined && onSent) onSent({ as: kind, send, direction: said });
      return out;
    } finally { inflight.current = false; }
  };
  const sendLabel = (() => {
    if (spoken) return W.sendPlain;
    if (ask.kind === 'choice') return chosen.length === 1 ? W.send(chosen[0]) : W.sendPlain;
    if (ask.kind === 'rating') {
      const a = ask.results && ask.results.rating && ask.results.rating.avg;
      return a !== null && a !== undefined ? W.send(a) : W.sendPlain;
    }
    return W.sendPlain;
  })();
  const total = ask.results?.total || 0;
  const cannot = busy || (!direction.trim() && (spoken || !total));
  // Ctrl+Enter (Cmd+Enter on a Mac) sends from the direction box.
  const onBoxKey = (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!cannot) decide();
  };

  return (
    <section className="brm-panel brm-decide" aria-labelledby={`brm-decide-${ask.askId}`}>
      <h2 className="brm-h" id={`brm-decide-${ask.askId}`}>{spoken ? 'Answer for the room' : 'Direction for Claude'}</h2>
      <p className="brm-sub">{spoken
        ? 'For when people talk instead of tapping. Pick what the room said; Claude builds from the sentence below and is told it was said out loud.'
        : `Claude builds from this sentence, not from the counts. Edit it freely. ${total} of ${playerCount || 0} answered.`}</p>
      {alternate && (
        <div className="brm-notice" role="status" data-testid="brm-alternate">
          <b>You picked an alternate.</b> The room preferred {alternate.preferred.label ? `${alternate.preferred.label} · ` : ''}{alternate.preferred.text}{alternate.by === 'wheel' ? ' (where the wheel landed)' : ''}. This goes on the record as your pick.
        </div>
      )}
      {spoken && ask.kind === 'rating' && (
        <div className="brm-field">
          <span className="brm-lbl">The room&apos;s rating</span>
          <div className="brm-foldchips">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`brm-fold${chosen[0] === String(n) ? ' is-in' : ''}`} aria-pressed={chosen[0] === String(n)} onClick={() => pick([String(n)])}>
                {ratingStep(n)}
              </button>
            ))}
          </div>
        </div>
      )}
      <textarea className="brm-input brm-ta brm-dirbox" aria-label="Direction for Claude" data-next-focus={next || undefined} value={direction} maxLength={2000} onKeyDown={onBoxKey} onChange={(e) => { touch(); setEdited(true); setDirection(e.target.value); }} placeholder={spoken ? 'What did the room decide?' : 'What should Claude do now?'} />
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
      <div className="brm-field">
        <span className="brm-lbl">Claude gets it as</span>
        <div className="brm-seg brm-seg--kinds" role="radiogroup" aria-label="Claude gets it as">
          {HOST_KINDS.map((k) => (
            <button key={k.key} type="button" role="radio" aria-checked={as === k.key} className={`brm-segbtn${as === k.key ? ' is-on' : ''}`} title={k.hint} onClick={() => { touch(); setAs(k.key); }}>{k.label}</button>
          ))}
        </div>
        <span className="brm-hint">{(HOST_KINDS.find((k) => k.key === as) || HOST_KINDS[0]).hint}{ask.claudeNote ? ` With it, from the set: "${ask.claudeNote}"` : ''}</span>
      </div>
      <ActionRow pinned={next} space={next} hint={next ? <span title={W.ctrlEnterTitle}>{W.ctrlEnterSends}</span> : ''}>
        {onCancel && <button type="button" className="brm-btn brm-btn--ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="brm-btn brm-btn--ghost" disabled={cannot} onClick={() => decide({ send: false })}>{W.recordOnly}</button>
        <button type="button" className="brm-btn" disabled={cannot} onClick={() => decide({ kind: 'later' })}>{W.saveLater}</button>
        <button type="button" className={`brm-btn${next ? ' brm-btn--primary' : ''}`} data-next-primary={next || undefined} data-no-space={next || undefined} disabled={cannot} onClick={() => decide()}>
          <Icon name="PaperPlaneTilt" size={16} /> {sendLabel}
        </button>
      </ActionRow>
    </section>
  );
}

// ── Between asks ────────────────────────────────────────────────────────────


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
  // ONE STATUS (owner, 2026-10-07): the same rule the dock, the host's Now
  // card and the header chip read, so the wall never says two things.
  const st = claudeState(room, now);
  const decision = latestDecisionLine(room);
  const looks = mockupsReady(room);
  if (looks) {
    const w = looksWords(looks.images);
    return (
      <section className="brm-stage brm-stage--idle brm-plain brm-looks" aria-label="Mockups to compare">
        <div className="brm-plain-main">
          <div className="brm-building" data-state="waiting">
            <span className="brm-sdot brm-sdot--waiting" aria-hidden="true" />
            <h2 className="brm-q">{w.headline}</h2>
          </div>
          <p className="brm-nowtext">{w.line}</p>
          <div className="brm-looks-grid">
            {looks.images.map((im) => (
              <div className="brm-look" key={im.label}>
                <BuildImage imageId={im.imageId} alt={`Mockup ${im.label}`} className="brm-shot brm-shot--look" />
                <div className="brm-look-cap"><b>{im.label}</b> {im.title}</div>
              </div>
            ))}
          </div>
        </div>
        <aside className="brm-plain-side">
          <div>
            <div className="brm-kind">Next</div>
            <div className="brm-tx">{w.next}</div>
          </div>
        </aside>
      </section>
    );
  }
  const sinceAt = st.since ? new Date(st.since) : null;
  const sinceText = st.key === 'building' && sinceAt && Number.isFinite(sinceAt.getTime())
    ? sinceAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <section className="brm-stage brm-stage--idle brm-plain" aria-label="Claude">
      <div className="brm-plain-main">
        <div className="brm-building" data-state={st.key}>
          <span className={`brm-sdot brm-sdot--${st.key}`} aria-hidden="true" />
          <h2 className="brm-q">{st.headline}</h2>
        </div>
        {st.line && (
          <p className="brm-nowtext">
            {st.line}{sinceText && <span className="brm-muted"> · since {sinceText}</span>}
          </p>
        )}
        {host && st.key === 'none' && <p className="brm-stagehint">Connect Claude Code, then paste the Kick off prompt.</p>}
        {latestShot && <BuildImage imageId={latestShot.imageId} caption={latestShot.caption} className="brm-shot brm-shot--latest" />}
      </div>
      {decision && (
        <aside className="brm-plain-side">
          <div>
            <div className="brm-kind">We decided</div>
            <div className="brm-tx">{decision}</div>
          </div>
        </aside>
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
 * NOW, BETWEEN ASKS (C1; host-flow H1, H5): Claude's line and What's next,
 * the host's moves most likely first with the lead one focused; then the two
 * things the host does with the build: show it to the room (the Build
 * screen) or ask Claude to run it and send a screenshot. When Claude has
 * gone quiet, the Continue prompt is one click away. The latest decision is
 * in the right column's Decided now, with every other one.
 */
export const STARTER_PROMPT = 'What should we build?';

function NowBuilding({ room, now, ended, busy, run, api, onShowBuild, onCompose, ticked = null, laterTicked = 0, onMove = null, leadOutline = false }) {
  const [sent, setSent] = useState(false);
  if (room.outcome && room.outcome.summary) return <WrappedStage outcome={room.outcome} agent={room.agent} images={room.images || []} />;
  const agent = room.agent || {};
  const quiet = !(agent.listening || agent.connected);
  const line = ended ? 'This session has ended.' : claudeState(room, now).headline;
  // A ROOM THAT BEGINS WITH AN ASK (owner, 2026-10-05): before anything is
  // built, the room picks what to build. The host lists the options or the
  // room suggests; a tie goes to the wheel or a revote (WheelPanel); and the
  // host can pick one and send it to Claude at any point.
  // Just out of the opening, before any building ask: the way back is right here.
  const flags = nowFlags(room);
  const framed = flags.framed;
  const starter = flags.starter && onCompose;
  // WHAT'S NEXT (H1): between asks, once the room has something to build on.
  const whatsNext = !ended && !starter && onMove;
  return (
    <section className="brm-panel brm-nowcard" aria-labelledby="brm-now-h">
      <h2 className="brm-h5" id="brm-now-h">Now</h2>
      {framed && !ended && (
        <div className="brm-notice brm-row brm-gap" data-testid="brm-backtoopening">
          <span>The opening is over and Claude has the brief. Pressed Start building too soon?</span>
          <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={() => run(() => api.openingAction('resume', {}))}>Back to the opening</button>
        </div>
      )}
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
      {whatsNext
        ? <WhatsNext room={room} now={now} ticked={ticked || new Set()} laterTicked={laterTicked} onMove={onMove} continueOn={quiet && Boolean(CONTINUE_PROMPT)} outline={leadOutline} />
        : <p className="brm-nowline">{line}</p>}
      {!ended && <ClaudeActivity activity={room.activity || []} agent={room.agent} now={now} full />}
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
 * SEND TO CLAUDE, IN FOUR KINDS (step 7c, C14): one click is Do now, as
 * before; the caret offers Keep in mind, Later and Ask Claude, each saying
 * what Claude will do with it.
 */
export function SendToClaude({ onSend, busy, disabled = false, small = false, primary = false, submit = false }) {
  const size = small ? ' brm-btn--sm' : '';
  return (
    <span className="brm-split">
      <button
        type={submit ? 'submit' : 'button'}
        className={`brm-btn${size}${primary ? ' brm-btn--primary' : ''}`}
        disabled={busy || disabled}
        title="Do now: the next thing Claude builds"
        onClick={submit ? undefined : () => onSend('do-now')}
      >
        <Icon name="PaperPlaneTilt" size={16} /> {W.sendPlain}
      </button>
      <SessionMenu label="" groupLabel="Send to Claude as" ariaLabel="Send to Claude as" buttonClass={`brm-btn${size}${primary ? ' brm-btn--primary' : ''} brm-split-caret`}>
        {(close) => HOST_KINDS.map((k) => (
          <button key={k.key} type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-kindopt" disabled={busy || disabled} onClick={() => { close(); onSend(k.key); }}>
            <b>{k.label}</b><span>{k.hint}</span>
          </button>
        ))}
      </SessionMenu>
    </span>
  );
}

/**
 * THE ONE COMPOSER (C1): everything the host types, written once, then sent
 * where it belongs. It replaces "What next?" (Tell Claude, Ask the room) and
 * the timeline's own log form, which were two boxes for one act.
 *   Send to Claude  a direction, delivered on Claude's next call
 *   Save for later  the host's own idea, onto the Later list (step 4)
 *   Log it          into the timeline as what the room said, a host note or
 *                   a milestone; "Also tell Claude" sends it too
 *   Ask the room    Ideas, Choose or Rate (the Ask the room dialog)
 */
function Composer({ agent, busy, run, api, onCompose, text, setText, focusKey = 0, leadShows = true }) {
  const [said, setSaid] = useState('');
  const box = useRef(null);
  // What's next's Combine and Write send the cursor here, at the end of the words.
  useEffect(() => {
    const el = box.current;
    if (!focusKey || !el) return;
    el.focus();
    const end = el.value.length;
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(end, end);
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [focusKey]);
  const [logKind, setLogKind] = useState('verbal');
  const [alsoTell, setAlsoTell] = useState(false);
  const words = text.trim();
  const tellAs = async (as) => {
    if (!words) return;
    const ok = await run(() => api.postDirection(words, as));
    if (ok !== undefined) { setText(''); setSaid(`Sent${as && as !== 'do-now' ? ` as ${claudeKindLabel(as)}` : ''}: ${words}`); }
  };
  const tell = (e) => { e.preventDefault(); tellAs('do-now'); };
  // QUEUE IT (step 4, C1): the host's own idea, waiting in the queue for later.
  const queue = async () => {
    if (!words) return;
    // On the Later list, not just in the queue: the idea is made, then parked.
    const ok = await run(async () => {
      const made = await api.queueIdea(words);
      const id = made && made.idea && made.idea.ideaId;
      if (id) await api.ideaAction(id, 'later');
      return made;
    });
    if (ok !== undefined) { setText(''); setSaid(`${W.savedLater}.`); }
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
          ref={box}
          id="brm-compose"
          className="brm-input brm-ta brm-ta--sm"
          placeholder="An idea, what the room said out loud, or a note for Claude"
          value={text}
          maxLength={2000}
          onChange={(e) => { setText(e.target.value); setSaid(''); }}
        />
        <p className="brm-hint">{deliveryLine(agent)}</p>
        <div className="brm-row brm-gap">
          {/* The one orange button is the step's or What's next's lead; Send is outline while one shows. */}
          <SendToClaude onSend={tellAs} busy={busy} disabled={!words} primary={!leadShows} submit />
          <button type="button" className="brm-btn" disabled={busy || !words} title="Keep it on your Later list" onClick={queue}>{W.saveLater}</button>
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

function TimelineEntry({ entry, host, stopped = false, busy, ended, run, api, deleteAs }) {
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
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy || !text.trim()} onClick={save}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <span className="brm-by">{byLabel(entry)}</span>
            <span className="brm-tl-text">{entry.text}</span>
            {entry.detail && !['direction', 'image'].includes(entry.kind) && <span className="brm-tl-detail">{entry.detail}</span>}
            {entry.kind === 'image' && <BuildImage imageId={entry.detail} alt={entry.text} className="brm-shot brm-shot--tl" />}
            {safeHref(entry.link) && <SafeLink className="brm-lnk brm-block" href={entry.link}>{entry.link}</SafeLink>}
            {host && entry.held && <span className="brm-tl-flag">{W.laterHeld}</span>}
            {host && entry.forAgent && <span className="brm-tl-flag">{entry.as && entry.as !== 'do-now' ? `${claudeKindLabel(entry.as)} · ` : ''}{entry.deliveredAt ? 'Claude has it' : stopped ? `Waiting for Claude · run ${CONTINUE_COMMAND}` : 'Waiting for Claude'}</span>}
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

function Timeline({ log, host, stopped = false, busy, ended, run, api, deleteAs }) {
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
            <TimelineEntry key={`${entry.logId}:${entry.editedAt || ''}`} entry={entry} host={host} stopped={stopped} busy={busy} ended={ended} run={run} api={api} deleteAs={deleteAs} />
          ))}
        </ul>
      ) : (
        <div className="brm-empty">Claude&apos;s progress, the room&apos;s decisions and what people say out loud collect here.</div>
      )}
    </section>
  );
}

// ── The queue (host only, step 4) ───────────────────────────────────────────

/** What happened to a handled idea, in the host's words. */
const HANDLED = { promoted: 'used', acknowledged: 'acknowledged', dismissed: 'dismissed' };

/** The ask the room is answering now, or null. */
const openAskOf = (room) => (room.asks || []).find((a) => a.askId === room.currentAskId && ['live', 'voting'].includes(a.status)) || null;

/** "Dee · idea", "You · queued", "Sam · on the preview". */
function ideaWho(idea) {
  if (idea.source === 'host') return 'You · queued';
  return `${idea.playerName} · ${idea.aboutLogId ? 'on the preview' : 'idea'}`;
}

/**
 * THE QUEUE (step 4, C1–C3b): everything waiting on the host in one list,
 * Claude's asks first, then oldest first. Filters by who it came from; tick
 * ideas to act on several at once, or put them to a vote.
 */
function Queue({ room, current, busy, ended, run, api, laterTicked = [], setLaterTicked = () => {}, onVoteLater = () => {}, onAskRoom = () => {}, pointTicked = [], setPointTicked = () => {}, leadsRow = false, askOpen = false, openPoints = 0, onRequest = () => {}, onVotePoints = () => undefined }) {
  const [filter, setFilter] = useState('all');
  const [ticked, setTicked] = useState([]);
  const [voteOf, setVoteOf] = useState(null);
  const items = queueItems(room);
  const shown = filterQueue(items, filter);
  const ideas = room.ideas || [];
  const live = new Set(items.filter((x) => x.type === 'idea').map((x) => x.idea.ideaId));
  const tickedLive = ticked.filter((id) => live.has(id));
  const handled = ideas.filter((i) => ['promoted', 'acknowledged', 'dismissed'].includes(i.status));
  const freshRoom = items.filter((x) => x.type === 'idea' && x.from === 'room');
  const canSuggest = Boolean(current && current.kind === 'suggest' && ['live', 'voting'].includes(current.status));
  const openAsk = openAskOf(room);
  const connected = Boolean(room.agent && room.agent.connected);
  const count = (key) => filterQueue(items, key).length;

  const toggle = (id) => setTicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const act = (idea, action, extra) => run(() => api.ideaAction(idea.ideaId, action, extra));
  const bulk = async (action) => {
    const ids = tickedLive;
    const ok = await run(async () => { for (const id of ids) await api.ideaAction(id, action); return true; });
    if (ok !== undefined) setTicked([]);
  };
  const toVote = (ids) => setVoteOf(ids.map((id) => ideas.find((i) => i.ideaId === id)).filter(Boolean));

  return (
    <section className="brm-queue" aria-label="The queue">
      <div className="brm-qfilters" role="group" aria-label="Show">
        {QUEUE_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`brm-qchip${filter === f.key ? ' is-on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}{f.key !== 'all' ? ` · ${count(f.key)}` : ''}
          </button>
        ))}
        <span className="brm-hint brm-push">Claude first, then oldest</span>
      </div>

      {!ended && tickedLive.length > 0 && (
        <div className="brm-qbulk" role="group" aria-label="Ticked ideas">
          <b>{tickedLive.length} ticked</b>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy || tickedLive.length < 2 || tickedLive.length > 6} title={tickedLive.length < 2 ? 'Tick at least 2' : tickedLive.length > 6 ? 'A vote takes at most 6' : undefined} onClick={() => toVote(tickedLive)}>
            Put {tickedLive.length} to a vote
          </button>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => bulk('direct')}><Icon name="PaperPlaneTilt" size={14} /> {W.sendPlain}</button>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Not now. They wait on your Later list; nothing goes to Claude." onClick={() => bulk('later')}>{W.saveLater}</button>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => bulk('acknowledge')}>Acknowledge</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-push" onClick={() => setTicked([])}>Clear</button>
        </div>
      )}

      {/* A burst of reactions after Claude shows something: clear them in one go. */}
      {!ended && freshRoom.length >= 2 && !tickedLive.length && (
        <div className="brm-row brm-gap brm-ackall">
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" disabled={busy} title="Mark every new one as seen. Nothing goes to Claude." onClick={() => run(() => api.acknowledgeAll())}>
            Acknowledge all {freshRoom.length}
          </button>
        </div>
      )}

      {!items.length && <p className="brm-empty">Nothing waiting. Phones can send an idea at any time, and Claude&apos;s questions land here first.</p>}
      {items.length > 0 && !shown.length && <p className="brm-hint">Nothing from {QUEUE_FILTERS.find((f) => f.key === filter).label.toLowerCase()} right now.</p>}

      {shown.map((x) => (x.type === 'ask' ? (
        <ReviewCard key={`${x.ask.askId}:${x.ask.status}`} ask={x.ask} openAsk={openAsk} busy={busy} ended={ended} run={run} api={api} connected={connected} />
      ) : (
        <QueueIdea
          key={x.idea.ideaId} idea={x.idea} busy={busy} ended={ended}
          ticked={tickedLive.includes(x.idea.ideaId)} onTick={() => toggle(x.idea.ideaId)}
          onAct={(action, extra) => act(x.idea, action, extra)}
          canSuggest={canSuggest}
          onVote={() => toVote(tickedLive.includes(x.idea.ideaId) ? tickedLive : [...tickedLive, x.idea.ideaId])}
          voteCount={tickedLive.includes(x.idea.ideaId) ? tickedLive.length : tickedLive.length + 1}
        />
      )))}

      <BuildLaterPoints
        room={room} ended={ended} busy={busy} run={run} api={api}
        laterTicked={laterTicked} setLaterTicked={setLaterTicked} onVoteLater={onVoteLater} onAskRoom={onAskRoom}
        pointTicked={pointTicked} setPointTicked={setPointTicked} leadsRow={leadsRow} askOpen={askOpen} openPoints={openPoints} onRequest={onRequest} onVotePoints={onVotePoints}
      />

      {handled.length > 0 && (
        <details className="brm-handled">
          <summary>{handled.length} handled</summary>
          {handled.map((idea) => (
            <div className="brm-idea brm-idea--done" key={idea.ideaId}>
              <div className="brm-idea-text">{idea.text}</div>
              <div className="brm-who">{ideaWho(idea)} · {idea.walled ? 'on the wall' : idea.promotedTo ? `in ask ${askNumber(idea.promotedTo)}` : HANDLED[idea.status] || idea.status}</div>
              {!ended && ['dismissed', 'acknowledged'].includes(idea.status) && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--link" disabled={busy} onClick={() => act(idea, 'restore')}>Restore</button>
              )}
            </div>
          ))}
        </details>
      )}

      {voteOf && (
        <VoteFromIdeasDialog
          ideas={voteOf} connected={connected} openAsk={openAsk} busy={busy} run={run} api={api}
          onClose={() => setVoteOf(null)}
          onDone={() => { setVoteOf(null); setTicked([]); }}
        />
      )}
    </section>
  );
}

/** One idea in the queue (C1): tick it, or send it where it belongs. */
function QueueIdea({ idea, busy, ended, ticked, onTick, onAct, canSuggest, onVote, voteCount }) {
  return (
    <div className={`brm-idea brm-qidea${ticked ? ' is-ticked' : ''}`}>
      <div className="brm-row brm-gap">
        {!ended && (
          <input type="checkbox" className="brm-qtick" checked={ticked} onChange={onTick} aria-label={`Tick: ${idea.text}`} />
        )}
        <span className="brm-who">{ideaWho(idea)} · {clockTime(idea.createdAt)}</span>
      </div>
      <div className="brm-idea-text">{idea.text}</div>
      {!ended && (
        <div className="brm-idea-acts">
          <SendToClaude small busy={busy} onSend={(as) => onAct('direct', asField(as))} />
          <SessionMenu label="Ask the room" groupLabel="Ask the room">
            {(close) => (
              <>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy || voteCount < 2 || voteCount > 6} title={voteCount < 2 ? 'Tick another idea to vote between them' : undefined} onClick={() => { close(); onVote(); }}>
                  {voteCount < 2 ? 'Put to a vote (tick another idea first)' : `Put ${voteCount} ideas to a vote`}
                </button>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy || !canSuggest} title={canSuggest ? undefined : 'Open an Ideas ask first'} onClick={() => { close(); onAct('suggest'); }}>Add to the open Ideas ask</button>
                {/* WALL (owner, 2026-10-05): on the Stage for 20 seconds, no name. */}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} title="On the Stage for 20 seconds, without a name. Nothing goes to Claude." onClick={() => { close(); onAct('wall'); }}>Show on the wall</button>
              </>
            )}
          </SessionMenu>
          {/* SAVE FOR LATER (owner, 2026-10-08): the host's "not now", onto the one Later list. Nothing goes to Claude. */}
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Not now. It waits on your Later list; nothing goes to Claude." onClick={() => onAct('later')}>{W.saveLater}</button>
          {/* ACKNOWLEDGE (owner, 2026-10-05): heard, not a job for Claude. */}
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Mark it as seen. Their phone says so; nothing goes to Claude." onClick={() => onAct('acknowledge')}>Acknowledge</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => onAct('dismiss')}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

/**
 * PUT N IDEAS TO A VOTE (C3): Pick one by default (owner, 2026-10-05). With
 * "Ask Claude for a quick mockup of each first", the vote waits in the queue,
 * hidden from the room, until the pictures are in (C3b).
 */
/**
 * Later items as the vote dialog's entries: an idea is the room's own idea
 * object; a held direction stands in as `{ laterId, text, source: 'host' }`.
 */
function voteEntries(room, items) {
  return items.map((x) => (x.type === 'idea'
    ? (room.ideas || []).find((i) => i.ideaId === x.id)
    : { laterId: x.id, text: x.text, source: 'host' })).filter(Boolean);
}

export function VoteFromIdeasDialog({ ideas, picks: startPicks = 1, connected, openAsk, busy, run, api, onClose, onDone }) {
  const [prompt, setPrompt] = useState('Which should Claude build next?');
  // The picks offered are 1, then 2 with three options, 3 with four or more.
  const [maxPicks, setMaxPicks] = useState(() => Math.max(1, Math.min(startPicks, ideas.length > 3 ? 3 : ideas.length > 2 ? 2 : 1)));
  const [mockups, setMockups] = useState(false);
  const n = ideas.length;
  const letter = (i) => String.fromCharCode(65 + i);
  const send = async (extra) => {
    const laterIds = ideas.filter((i) => i.laterId).map((i) => i.laterId);
    const out = await run(() => api.askFromIdeas({ ideaIds: ideas.filter((i) => i.ideaId).map((i) => i.ideaId), ...(laterIds.length ? { laterIds } : {}), prompt: prompt.trim(), maxPicks, ...extra }));
    if (out !== undefined) onDone();
  };
  const picks = [1, ...(n > 2 ? [2] : []), ...(n > 3 ? [3] : [])];
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-vote-title">
      <DialogHead id="brm-vote-title" title={ideas.some((i) => i.laterId) ? W.putToVote(n) : `Put ${n} ideas to a vote`} onClose={onClose} />
      <label className="brm-field"><span className="brm-lbl">Question for the room</span><input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
      <div className="brm-field">
        <span className="brm-lbl">How people vote · Pick one is the default</span>
        <div className="brm-seg" role="radiogroup" aria-label="How people vote">
          {picks.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={maxPicks === k} className={`brm-segbtn${maxPicks === k ? ' is-on' : ''}`} onClick={() => setMaxPicks(k)}>
              {k === 1 ? `Pick one (${ideas.map((_, i) => letter(i)).join(', ')})` : `Pick up to ${k}`}
            </button>
          ))}
        </div>
      </div>
      <ul className="brm-reviewopts">
        {ideas.map((idea, i) => (
          <li key={idea.ideaId || idea.laterId}>
            <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letter(i)}</span>
            <span className="brm-reviewopt-t">{idea.text}</span>
            <span className="brm-who brm-push">{idea.source === 'host' ? 'You' : idea.playerName}</span>
          </li>
        ))}
      </ul>
      <p className="brm-hint">Names are not shown to the room. When you decide, the winner goes to Claude as a direction and each idea is marked as used.</p>
      <label className="brm-check brm-field">
        <input type="checkbox" checked={mockups} disabled={!connected && !mockups} onChange={(e) => setMockups(e.target.checked)} />
        Ask Claude for a quick mockup of each first
      </label>
      {mockups && (
        <div className="brm-notice brm-unheard">
          The vote waits in your queue, hidden from the room, until Claude has made the mockups. Meanwhile you can ask the room other things. When they are in, the vote is marked Ready and you open it.
        </div>
      )}
      {!connected && <p className="brm-hint">Claude Code is not connected, so it cannot make mockups now.</p>}
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Cancel</button>
        {!mockups && <button type="button" className="brm-btn brm-btn--ghost brm-push" disabled={busy || !prompt.trim()} onClick={() => send({ open: false })}>Save as a draft</button>}
        {mockups ? (
          <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !prompt.trim()} onClick={() => send({ askForMockups: true })}>Ask Claude for {n} mockups</button>
        ) : (
          <button type="button" className="brm-btn brm-btn--primary" disabled={busy || !prompt.trim()} onClick={() => send({ open: true })}>
            {openAsk ? `Close ask ${askNumber(openAsk.askId)} and open the vote` : W.openVoting}
          </button>
        )}
      </div>
    </Modal>
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
  // STEP 4 (owner, 2026-10-07): green once Claude ran /engage:kickoff. An
  // older plugin never says so; it counts once Claude has posted to the room
  // or listened for the host.
  const kickedOff = Boolean(agent.kickedOffAt) || (connected && (Boolean(agent.listenedAt) || (room.log || []).some((l) => l.by === 'agent')));
  const crew = Boolean(room.crew && room.crew.enabled);
  const command = minted ? connectCommand({ origin: window.location.origin, api: apiBase(), key: minted.key }) : '';
  const install = pluginInstallCommand({ origin: window.location.origin, api: apiBase() });
  const connectLine = minted ? pluginConnectCommand(minted.key) : '';
  // THE START CAP (owner, 2026-10-06): a new folder named for the project,
  // ~/build-room/<name>; the host may rename it before copying.
  const [folder, setFolder] = useState(() => projectSlug(room.title));
  const folderName = cleanFolder(folder) || projectSlug(room.title);
  const startLine = minted ? startCommand(folderName, minted.key) : '';
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
    const ok = await copyText(startCommand(folderName, out.key));
    setCopied(ok ? 'Copied. Paste it into a terminal.' : 'Copy it with the button below.');
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
      <p className="brm-sub">Claude Code runs on this laptop. The Engage plugin connects it to the room and keeps the project tidy in git: one commit per decision, never pushed.</p>

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
            <p className="brm-hint">If your Mac asks whether node may accept incoming connections, click Allow. That is how the room&apos;s phones, laptops and tablets on this Wi-Fi reach the build.</p>
          </div>
        </li>

        <li className={step(Boolean(minted) || connected, !minted && !connected)}>
          <span className="brm-n">2</span>
          <div className="brm-step-body">
            <span className="brm-step-title">Mint a key and copy the start command</span>
            <label className="brm-field">
              <span className="brm-lbl">Project folder</span>
              <span className="brm-row brm-gap">
                <span className="brm-mono">~/build-room/</span>
                <input className="brm-input brm-input--sm" aria-label="Project folder" value={folder} maxLength={60} onChange={(e) => setFolder(e.target.value)} />
              </span>
              <span className="brm-hint">A new folder for this build, named for the session. Claude sets up git there: README, DECISIONS and a first commit.</span>
            </label>
            {minted ? (
              <>
                <div className="brm-keywarn"><Icon name="Lock" size={16} color="var(--primary)" />
                  <div><b>This key is shown once.</b> It only works for this room and stops when you revoke it or the session ends. Lost it? Mint a new one; the old key stops working immediately.</div>
                </div>
                <pre className="brm-cmd" data-testid="brm-start">{startLine}</pre>
                <div className="brm-row brm-gap">
                  <CopyButton text={startLine} label="Copy again" />
                  <span className="brm-hint" role="status">{copied} Key …{minted.key.slice(-4)}, minted just now.</span>
                </div>
                <p className="brm-hint">Already running Claude Code in the right folder? Paste this into it instead:</p>
                <pre className="brm-cmd" data-testid="brm-connect">{connectLine}</pre>
                <div className="brm-row brm-gap"><CopyButton text={connectLine} label="Copy" /></div>
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
            <span className="brm-step-title">Paste it into a terminal</span>
            <span className="brm-hint">{connected
              ? 'Claude Code has called in.'
              : `It makes ~/build-room/${folderName}, starts Claude Code there and connects it to this room.`}</span>
          </div>
        </li>

        <li className={step(kickedOff, connected && !kickedOff)}>
          <span className="brm-n">4</span>
          <div className="brm-step-body">
            <span className="brm-step-title">Kick off</span>
            {kickedOff && <span className="brm-hint">Claude has kicked off.</span>}
            <pre className="brm-cmd" data-testid="brm-kickoff">{kickoff}</pre>
            <div className="brm-row brm-gap">
              <CopyButton text={kickoff} label="Copy" />
              <span className="brm-hint">Run it in Claude Code. Claude reads the room, restates the goal and posts its plan.{crew ? '' : ' Claude commits once per decision or milestone, and each turn is kept as a hidden snapshot. Nothing is pushed.'}</span>
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
                <span className="brm-hint">Run it in Claude Code. It makes the base branch, shares the repo with the room and proposes the first tasks. Claude commits once per decision here, and each turn is kept as a hidden snapshot. Nothing is pushed.</span>
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

/**
 * READY QUESTIONS (step 7b, C13): the questions of every set this host can
 * read that carries the `build-room` tag, grouped as a session meets them.
 * Picking one fills the form beside it, editable, with what Claude gets and
 * the set's note for Claude. A set it cannot reach, or no ready set at all,
 * leaves the library empty and the form as it always was.
 */
/**
 * ASKED ALREADY (owner, 2026-10-06: "pick a question likely 1 at a time and
 * then mark it as asked ... they might reask based on changes in the work,
 * but at least they are aware it was asked"). An ask the room saw counts; a
 * draft or a discarded one does not. Matched by the ready question it came
 * from, or, for an ask made before that was recorded, by its words.
 */
const ROOM_SAW = ['live', 'voting', 'results', 'decided'];
export function askedIndex(asks) {
  const byKey = new Map();
  const byWords = new Map();
  for (const a of asks || []) {
    if (!ROOM_SAW.includes(a.status)) continue;
    if (a.fromQuestion) byKey.set(a.fromQuestion, a.askId);
    byWords.set(String(a.prompt || '').trim().toLowerCase(), a.askId);
  }
  return (key, prompt) => byKey.get(key) || byWords.get(String(prompt || '').trim().toLowerCase()) || null;
}

function ReadyLibrary({ api, asks, selectedKey, onPick, autoFocus = false }) {
  const [sets, setSets] = useState(null);
  // Opened from What's next's starter move: the cursor starts in the library.
  const search = useRef(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!autoFocus || focused.current || !search.current) return;
    // Never take the focus from the host typing somewhere else (the composer).
    if (isTypingTarget(document.activeElement) && document.activeElement !== search.current) { focused.current = true; return; }
    focused.current = true;
    search.current.focus();
  });
  const [active, setActive] = useState('');
  const [loaded, setLoaded] = useState({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const setKey = (st) => `${st.scope || ''}:${st.id}`;
  useEffect(() => {
    let live = true;
    Promise.resolve(api && api.questionSets ? api.questionSets() : [])
      .then((list) => {
        if (!live) return;
        const ready = (list || []).filter((st) => isBuildRoomSet(st) && ['call-and-answer', 'poll'].includes(st.engagementType));
        setSets(ready);
        if (ready.length) setActive(setKey(ready[0]));
      })
      .catch(() => { if (live) setSets([]); });
    return () => { live = false; };
  }, [api]);
  const set = (sets || []).find((st) => setKey(st) === active) || null;
  useEffect(() => {
    if (!set || loaded[active]) return undefined;
    let live = true;
    api.setQuestions(set)
      .then((payload) => {
        if (!live) return;
        const items = editableRows(payload, set.engagementType)
          .map((row) => ({ row, out: buildAskFromQuestion(row, set) }))
          .filter((x) => x.out.ask)
          .map((x) => ({ key: `${active}:${x.row.sk}`, category: x.row.category, ask: x.out.ask, setName: set.name || 'Ready questions' }));
        setLoaded((l) => ({ ...l, [active]: items }));
      })
      .catch(() => { if (live) setLoaded((l) => ({ ...l, [active]: [] })); });
    return () => { live = false; };
  }, [active, set, loaded, api]);

  if (sets === null) return <aside className="brm-lib" aria-label="Ready questions"><p className="brm-hint">Loading ready questions…</p></aside>;
  if (!sets.length) {
    return (
      <aside className="brm-lib" aria-label="Ready questions">
        <p className="brm-hint">No ready questions yet. Tag a Call and Answer or Poll set <b>build-room</b> and its questions appear here.</p>
      </aside>
    );
  }
  const askedIn = askedIndex(asks);
  const items = loaded[active] ? loaded[active].map((it) => ({ ...it, askedIn: askedIn(it.key, it.ask.prompt) })) : null;
  const q = query.trim().toLowerCase();
  const shown = (items || []).filter((it) => (category === 'all' || it.category === category) && (!q || it.ask.prompt.toLowerCase().includes(q)));
  const cats = [...new Set((items || []).map((it) => it.category))];
  return (
    <aside className="brm-lib" aria-label="Ready questions">
      <input ref={search} className="brm-input brm-input--sm" type="search" aria-label="Search ready questions" placeholder="Search ready questions" value={query} onChange={(e) => setQuery(e.target.value)} />
      {sets.length > 1 && (
        <div className="brm-qfilters" role="group" aria-label="Ready sets">
          {sets.map((st) => (
            <button key={setKey(st)} type="button" className={`brm-qchip${active === setKey(st) ? ' is-on' : ''}`} aria-pressed={active === setKey(st)} onClick={() => { setActive(setKey(st)); setCategory('all'); }}>
              {st.name}
            </button>
          ))}
        </div>
      )}
      {cats.length > 1 && (
        <div className="brm-qfilters" role="group" aria-label="Categories">
          {['all', ...cats].map((c) => (
            <button key={c} type="button" className={`brm-qchip${category === c ? ' is-on' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{c === 'all' ? 'All' : c}</button>
          ))}
        </div>
      )}
      {items === null && <p className="brm-hint">Loading…</p>}
      {items && !shown.length && <p className="brm-hint">No ready question matches.</p>}
      {items && items.length > 0 && <p className="brm-hint">{items.filter((it) => it.askedIn).length} of {items.length} asked in this room</p>}
      <div className="brm-lib-list">
        {groupReady(shown).map((g) => (
          <section key={g.category} aria-label={g.category}>
            <h3 className="brm-h5">{g.category}</h3>
            {g.items.map((it) => (
              <button key={it.key} type="button" className={`brm-lib-q${selectedKey === it.key ? ' is-on' : ''}${it.askedIn ? ' is-asked' : ''}`} aria-pressed={selectedKey === it.key} onClick={() => onPick(it)}>
                <span className="brm-chip">{ASKED_AS[it.ask.kind]}</span>
                <span className="brm-lib-t">{it.ask.prompt}</span>
                {it.askedIn
                  ? <span className="brm-chip brm-chip--live">Asked · ask {askNumber(it.askedIn)}</span>
                  : <span className="brm-who">{claudeKindLabel(it.ask.claudeGets)}</span>}
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

export function AskComposer({ kind: initialKind, prompt: initialPrompt = '', detail: initialDetail = '', library = false, asks = [], api, run, busy, onClose }) {
  const [kind, setKind] = useState(initialKind);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [detail, setDetail] = useState(initialDetail);
  const [options, setOptions] = useState([{ title: '', url: '' }, { title: '', url: '' }]);
  const [draft, setDraft] = useState(false);
  // WHAT CLAUDE GETS (step 7c), and where the question came from (step 7b).
  const [claudeGets, setClaudeGets] = useState('do-now');
  const [claudeNote, setClaudeNote] = useState('');
  const [from, setFrom] = useState(null);
  const dirty = Boolean(prompt || detail || options.some((o) => o.title));
  const requestClose = () => {
    if (dirty && !window.confirm('Discard this question?')) return;
    onClose();
  };
  const pickReady = (it) => {
    const a = it.ask;
    setKind(a.kind);
    setPrompt(a.prompt);
    setDetail(a.detail || '');
    if (a.kind === 'choice') setOptions(a.options.map((o) => ({ title: o.title, url: '' })));
    setClaudeGets(a.claudeGets || 'do-now');
    setClaudeNote(a.claudeNote || '');
    setFrom(it);
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
      ...(kind === 'choice' && from && from.ask.maxPicks > 1 ? { maxPicks: from.ask.maxPicks } : {}),
      ...(from || claudeGets !== 'do-now' ? { claudeGets } : {}),
      ...(claudeNote.trim() ? { claudeNote: claudeNote.trim() } : {}),
      ...(from ? { fromQuestion: from.key } : {}),
      ...(draft ? { draft: true } : {}),
    };
    const ok = await run(() => api.createAsk(body));
    if (ok !== undefined) onClose();
  };
  const setOpt = (i, k, v) => setOptions((l) => l.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--lib" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brm-compose-title">
      <DialogHead id="brm-compose-title" title="Ask the room" onClose={requestClose} />
      <div className="brm-libgrid">
        <ReadyLibrary api={api} asks={asks} selectedKey={from ? from.key : ''} onPick={pickReady} autoFocus={library} />
        <form onSubmit={submit}>
          <div className="brm-row brm-gap">
            <div className="brm-seg" role="radiogroup" aria-label="Kind of ask">
              {['suggest', 'choice', 'rating'].map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`brm-segbtn${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            {from && <span className="brm-hint brm-push">from {from.setName} · {from.category}</span>}
          </div>
          {from && from.askedIn && (
            <p className="brm-notice" role="status">You asked this in ask {askNumber(from.askedIn)}. Ask again if the work has changed since.</p>
          )}
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
          {kind === 'rating' && <p className="brm-hint">The room rates 1 to 5: 1 means needs work, 5 means great.</p>}
          <div className="brm-field">
            <span className="brm-lbl">When it is decided, Claude gets it as</span>
            <div className="brm-seg brm-seg--kinds" role="radiogroup" aria-label="When it is decided, Claude gets it as">
              {/* Later is not a kind to choose (owner, 2026-10-08): Save for later is the one way in. A ready question preset to later keeps it. */}
              {CLAUDE_KINDS.filter((k) => k.key !== 'later').map((k) => (
                <button key={k.key} type="button" role="radio" aria-checked={claudeGets === k.key} className={`brm-segbtn${claudeGets === k.key ? ' is-on' : ''}`} title={k.hint} onClick={() => setClaudeGets(k.key)}>{k.label}</button>
              ))}
            </div>
            <span className="brm-hint">{CLAUDE_KINDS.find((k) => k.key === claudeGets).hint}</span>
          </div>
          <label className="brm-field">
            <span className="brm-lbl">Note for Claude (optional; never shown to the room)</span>
            <textarea className="brm-input brm-ta brm-ta--sm" value={claudeNote} maxLength={1000} onChange={(e) => setClaudeNote(e.target.value)} placeholder="How Claude should use the answer" />
          </label>
          <label className="brm-check brm-field"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Save as a draft; don&apos;t open it yet</label>
          <div className="brm-row brm-gap">
            <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>Cancel</button>
            <button type="submit" className="brm-btn brm-btn--primary brm-push" disabled={busy || !ready}>{draft ? 'Save draft' : 'Ask the room'}</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
