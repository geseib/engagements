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
import Modal from '../components/Modal';
import { getAuthToken } from '../auth/authFetch';
import { rememberReturnPath } from '../auth/returnPath';
import reloadPage from '../utils/reloadPage';
import Icon from '../components/Icon';
import DeleteReasonField from '../components/DeleteReasonField';
import webSocketClient from '../WebSocketClient';
import { copyText } from '../utils/copyText';
import { editableRows } from '../utils/questionRows';
import {
  isBuildRoomSet, buildAskFromQuestion, ASKED_AS, groupReady, rankSetsForKind, KIND_NAMES, claudeSetItems, draftsFromClaudeSet,
  typeOfItem, typeCounts,
} from './readyQuestions';
import { useReadyForClaude } from './readyForClaude';
import { OpeningPanel, BriefPath } from './BuildOpening';
import BuildReport from './BuildReport';
import BuildImage, { ImageLoader, ImageViewer } from './BuildImage';
import AskDetail from './BuildAskDetail';
import MockupViewer, { ViewerContext, backLabelFor } from './MockupViewer';
import BuildWheel from './BuildWheel';
import { useKeepOnScreen } from './keepOnScreen';
import HostAlert from './BuildHostAlert';
import { W } from './words';
import InfoTip from './InfoTip';
import HelpButton from '../components/HelpButton';
import { helpFor } from '../config/help/screens';
import BuildLaterPoints from './BuildLaterPoints';
import BuildPointRequest from './BuildPointRequest';
import { ShownPointCard, TakeDownOffer } from './BuildPointStage';
import { AskPath } from './BuildAskPath';
import BuildPointsVote from './BuildPointsVote';
import BuildPointsResults from './BuildPointsResults';
import { RunPanel, RunConfirm } from './BuildRun';
import ActionRow from './BuildActionRow';
import { WhatsNext, DecidedList, decidedAsks } from './BuildWhatsNext';
import { isTypingTarget, dialogOpen } from './useNextFocus';
import { ShareDemo, DemoNudge, wifiLink, demoOnStage } from './BuildWifiShare';
import { shouldOfferDemo, demoRunnable } from './wifiShare';
import BuildSessionPanel, { HandoverStrip } from './BuildSessionPanel';
import PendingInvites from '../components/PendingInvites';
import useBuildPlayers, { askingOf } from './useBuildPlayers';
import useSessionPanelKey from '../components/stage/useSessionPanelKey';
import RoomWindowStatus from '../components/stage/RoomWindowStatus';
import RoomWindowLink from '../components/stage/RoomWindowLink';
import { storedRoomScreen, storeRoomScreen, SCREEN_WORDS } from '../config/roomScreen';
import { presentStatusFrom, windowIsOpen } from '../config/presentStatus';
import { presentHref } from '../config/surfaces';
import { openRoomWindow } from '../present/roomWindow';
import {
  pluginInstallCommand, projectSlug, cleanFolder, startCommand, resumeCommand, shellFolder, hostImageUrl, apiBase, buildApi,
  createBuildSession, buildRoomPath, connectCommand, safeHref,
} from './buildHostApi';
import './BuildRoom.css';
import {
  SCREENS, isProjected, screenForKey, togglePresent, waitingCount, askPill, latestBuild, directionFor, defaultDirection,
  decideBody, questionAnswer, claudeState, VOTE_IDEAS_MAX, mockupsReady, mockupsCard, readyMockupAsks, RATING_SCALE, ratingDirection, ratingStep,
  unheard, agentStopped, agentNeverCame, claudeEverConnected, queueItems, hostAlert, QUEUE_FILTERS, filterQueue, laterItems, defaultKind,
  whatsNextMoves, CLAUDE_KINDS, HOST_KINDS, claudeKindLabel, asField, pickVerdict, combineText, defaultSubject,
  shownPointIdeas, takeDownIdeas, shownPointOf, nowFlags, POINT_OPEN, isPointsVote, highlightOf, highlightedPointIds,
  rowIsLive, pointVoteRows, runOf, runRunning, roomSees, heldPosts, roomStory, contributionsOf, doingLine,
  wheelPossible,
} from './buildScreens';
import { QueuePost, ReleaseAll } from './BuildHeldPosts';
import { ConsiderContext, ConsiderPanel, ItemTools, ItemMark } from './BuildConsider';
import { sentMarks, itemKeys, storyHolds } from './sentMarks';
import MockupsReady from './BuildMockupsReady';
import {
  SendOptionsProvider, SendExtras, HideFromRoom, useMirror,
} from './BuildSendOptions';
import useStageMoves from './useStageMoves';
import BuildSetup from './BuildSetup';
import { buildControls } from './buildControls';
import BuildConsole, {
  PeopleList, SessionSlot, ClaudeLine, NowCard, ConsolePoint,
} from './BuildConsole';
import BuildConsoleAsk from './BuildConsoleAsk';
import {
  BCW, consoleMoment, consoleStrip, consolePart, nextOnWall, peopleRows, nowCard,
} from './buildConsole';
import {
  CrewBoard, CrewDialog, CrewIncoming, CrewTasks, EarlyLookDialog, StageTabs,
} from './BuildCrew';
// THE ROOM'S SCREENS AND WHAT THEY DRAW (parity PLAN §2.5, B6): display
// components in screens/, which never import this page or the signed-in fetch.
import BuildStageScreen from './screens/BuildStageScreen';
import BuildBuildScreen from './screens/BuildBuildScreen';
import BuildHistoryScreen, { StoryItem } from './screens/BuildHistoryScreen';
import { AskStage } from './screens/AskStage';
import { WrappedStage } from './screens/StageIdle';
import { QrZoom } from './screens/QrZoom';
import { Timeline, NOT_YOURS } from './screens/Timeline';
import {
  KIND_LABEL, pluginCommand, askNumber, askById, clockTime, agoText, byLabel, OpenLink,
  continueCommand, liveBuildLink, WALL_COMMENT_MS, freshWallComment,
} from './screens/common';

// Moved to screens/ in B6; still exported from here, where their importers look.
export {
  KIND_LABEL, pluginCommand, clockTime, agoText, byLabel, OpenLink, continueCommand, WALL_COMMENT_MS, freshWallComment,
  AskStage, QrZoom, StoryItem,
};

export const POLL_MS = 8000;

// ── Words ───────────────────────────────────────────────────────────────────

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
  if (!ask) return '';
  switch (ask.status) {
    case 'proposed': return W.hintHidden;
    case 'live': return ask.kind === 'suggest' ? W.hintIdeasSlow : W.hintAnswersStop;
    case 'voting': return W.hintVotesStop;
    case 'results': return W.hintCheckWords;
    default: return '';
  }
}

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

/** The row that told Claude about an ask: the newest that went to it (a sent-later direction), else the decision's own. */
const toldEntry = (room, askId) => {
  const rows = ((room && room.log) || []).filter((l) => l.askId === askId);
  const sent = rows.filter((l) => l.forAgent);
  return sent.length ? sent[sent.length - 1] : rows.filter((l) => l.kind === 'decision').pop() || null;
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

// ── Page ────────────────────────────────────────────────────────────────────

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
      {/* A team invitation, where the reviewer lost it (docs/design/pending-invite-notice R4). */}
      <PendingInvites stay />
      <form className="brm-card brm-create" onSubmit={submit} aria-labelledby="brm-create-title">
        <div className="brm-dh">
          <h1 id="brm-create-title">New Build Room</h1>
          {/* The Build Room guide's setting-up section (Help Phase 3). */}
          <HelpButton {...helpFor('build-create')} variant="inline" size="small" tooltip="Help: New Build Room" className="help-button-quiet brm-dh-help" />
          <a className="brm-x" href="/" aria-label="Close"><Icon name="X" size={16} /></a>
        </div>
        <p className="brm-sub">A room of people and your own Claude Code build something together. Claude asks the room at real decision points; you shape every answer before it reaches Claude.</p>
        <p className="brm-needline"><span>{W.needLine}</span><a className="brm-push" href="/build-room#before-you-start" target="_blank" rel="noopener noreferrer">{W.beforeYouStart}<span className="brm-sr">{` (${W.opensNewTab})`}</span></a></p>
        <label className="brm-field">
          <span className="brm-lbl">Title</span>
          <input className="brm-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Volunteer sign-up for the food bank" />
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
          <textarea className="brm-input brm-ta" value={goal} maxLength={2000} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. A one-page site where a volunteer can pick a shift in under a minute, on a phone." />
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

/** Fire and forget: what the room's window shows (POST build/wall). A failure is healed by the next. */
function sendWall(api, body) {
  try {
    Promise.resolve(api.wall(body)).catch(() => {});
  } catch (e) { /* never in the host's way */ }
}

export function BuildRoom({ gameId, initialView = 'room' }) {
  const api = useMemo(() => buildApi(gameId), [gameId]);
  // Screenshots are private: fetched with the host's sign-in (buildHostApi).
  const loadImage = useCallback((imageId) => hostImageUrl(gameId, imageId), [gameId]);
  const [room, setRoom] = useState(null);
  // The room's ready questions for Claude, once it has said what it is making (question-sets plan step 4).
  useReadyForClaude(room, api, { ended: Boolean(room && room.state === 'ENDED') });
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
  // Stage, Build or History, by any door (2/3/4, P, the header tabs): the room's window shows it too.
  useEffect(() => {
    if (isProjected(screen)) sendWall(api, { screen });
  }, [screen, api]);
  const [view, setView] = useState(initialView);
  // THE HOST ALERT (owner, 2026-10-10): what this device has just marked seen (before the server answers), and the line to jump to.
  const [seenLocal, setSeenLocal] = useState({ ids: [], allAt: '' });
  const [alertFocus, setAlertFocus] = useState(null);
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
  // WHAT THE COMPOSER WAS FILLED FROM (parity PLAN §2.8, H1): the decided asks
  // Combine put in it. Sent with the direction; gone once the box is emptied.
  const [composeFrom, setComposeFrom] = useState([]);
  useEffect(() => { if (!String(composeText).trim()) setComposeFrom((f) => (f.length ? [] : f)); }, [composeText]);
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
  // What's next's Ask Claude for points draws the Points tab before there are any (simplify PLAN item 18).
  const [pointsAsked, setPointsAsked] = useState(false);
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
  // THE CODES ON THE STAGE (two codes, owner 2026-10-11): one card, Join and
  // the demo. It stays up while nobody has opened the demo (no auto-hide);
  // when sharing stops or fails the demo half leaves and Join stays. Only the
  // host, or the session ending, takes it down.
  const [codesUp, setCodesUp] = useState(false);
  // THE CONSOLE ON TWO SCREENS (parity PLAN B8): the decide panel's own send,
  // handed to the "Your part now" card's main button; the queue or Later opened
  // into the main area; the moves the card presses, kept current every render.
  const consoleSend = useRef(null);
  const [centre, setCentre] = useState(null); // 'queue' | 'later' | null
  const consoleHandlers = useRef({});
  // THE ROOM'S WINDOW FOLLOWS (parity PLAN §2.6, B7): what the room is shown
  // goes to the server too, fire and forget, so a window on the projector
  // (/present?type=build) draws the same. The laptop's own screen changes as
  // it always did; a failed post is healed by the next one.
  const postWall = useCallback((body) => { sendWall(api, body); }, [api]);
  const hideCodes = useCallback(() => { setCodesUp(false); postWall({ codes: 'none' }); }, [postWall]);
  const now = useNow(5000);
  const endedNow = Boolean(room) && room.state === 'ENDED';
  useEffect(() => { if (endedNow) setCodesUp(false); }, [endedNow]);
  // THE CODES CARD FOLLOWS THE SERVER (§2c): when the server takes the codes down
  // (an ask opened, PLAN §2.3), the laptop's card comes down too. Until the server
  // has heard this laptop put them up, an older read saying "none" is not a take-down.
  const codesAsked = useRef(false);
  const serverCodes = room && room.wall ? room.wall.codes || '' : '';
  const serverWallRev = room && room.wall ? Number(room.wall.rev) || 0 : 0;
  useEffect(() => {
    if (!serverCodes) return;
    if (serverCodes !== 'none') codesAsked.current = false;
    else if (!codesAsked.current) setCodesUp(false);
  }, [serverCodes, serverWallRev]);
  // THE ROOM'S COPY (§2c): the laptop's own Stage, Build and History are projected, so
  // they never draw a post or screenshot the host has not released.
  const roomView = useMemo(() => roomSees(room), [room]);

  // ── TWO SCREENS ON THE LAPTOP (owner, 19 Oct 2026: "yes do 1-4") ────────
  // While the room's window is really up (the server's `presenting` and
  // `presentDetail`, config/presentStatus.js), this laptop stays where it is:
  // 2, 3, 4, P, the header's "The room sees" and every "show it on the Stage"
  // send the screen to the window only (POST build/wall). With no window open
  // nothing changes: one screen, as before. HOST and 1 always come home.
  const wallHref = room && room.wallKey ? presentHref(gameId, { type: 'build', k: room.wallKey }) : '';
  const windowDetail = room && Number(room.presenting) > 0 ? room.presentDetail : null;
  const windowOpen = Boolean(room) && windowIsOpen(room.presenting, room.presentDetail, now);
  const windowOpenRef = useRef(false);
  windowOpenRef.current = windowOpen;
  // Two screens: the browser chose them, or a window is up (assigned once the choice is read, below).
  const twoRef = useRef(false);
  const wallRevRef = useRef(0);
  wallRevRef.current = serverWallRev;
  // What this laptop last sent, until a read carries a newer rev than the one it was sent over.
  const [wallSent, setWallSent] = useState(null); // {screen, rev}
  const serverWallScreen = room && room.wall && isProjected(room.wall.screen) ? room.wall.screen : 'stage';
  const wallScreen = wallSent && serverWallRev <= wallSent.rev ? wallSent.screen : serverWallScreen;
  /** A screen the room sees, by any door: the window's alone while one is open, else this laptop's (and the window's). */
  const showRoom = useCallback((next) => {
    // On two screens (a window up, or the choice made) the laptop is private and stays where it is (B8).
    if (isProjected(next) && (windowOpenRef.current || twoRef.current)) {
      lastShown.current = next;
      setWallSent({ screen: next, rev: wallRevRef.current });
      sendWall(api, { screen: next });
      return;
    }
    setScreen(next);
  }, [api, setScreen]);

  // "WHERE WILL THE ROOM WATCH?" (parity PLAN §2.7, B9): the same question and
  // the same stored choice as Call & Answer's (config/roomScreen.js), asked on
  // the Host screen until this browser has chosen, and in Settings, Screens.
  // Two screens opens the room's window inside the click, placed as Quick
  // start's is (present/roomWindow.js), unless one is already up.
  const [roomChoice, setRoomChoice] = useState(() => {
    try { return storedRoomScreen(window.localStorage); } catch (e) { return null; }
  });
  const [windowBlocked, setWindowBlocked] = useState(false);
  twoRef.current = Boolean(room) && (roomChoice === 'two' || windowOpen);
  const chooseRoom = (choice) => {
    try { storeRoomScreen(window.localStorage, choice); } catch (e) { /* private mode: this visit only */ }
    setRoomChoice(choice);
    if (choice === 'two' && wallHref && !windowOpen) {
      const opened = openRoomWindow(wallHref);
      setWindowBlocked(!opened.window);
    } else {
      setWindowBlocked(false);
    }
  };
  useEffect(() => { if (windowOpen) setWindowBlocked(false); }, [windowOpen]);

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
  // The enlarged Join QR on the laptop, for an ended session (the Stage shows no codes then).
  const [joinZoom, setJoinZoom] = useState(false);
  // J shows and hides the codes, as on Call & Answer; set each render below.
  const toggleCodesRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'j' && e.key !== 'J') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || dialogOpen()) return;
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('.setup-panel')) return;
      if (!toggleCodesRef.current) return;
      e.preventDefault();
      toggleCodesRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // Escape takes the codes down on the two-screen console too (the Stage
  // screen has its own); set each render below, null while there is nothing to take down.
  const escCodesRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !escCodesRef.current || dialogOpen()) return;
      escCodesRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
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
    // The room's window reported itself: its status is on the host's read (presentDetail).
    webSocketClient.onMessage('presentChanged', () => refresh());
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
      webSocketClient.offMessage('presentChanged');
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
        // With the room's window up the laptop stays: P sends the last screen the room saw.
        if (windowOpenRef.current || twoRef.current) { showRoom(isProjected(lastShown.current) ? lastShown.current : 'stage'); return; }
        setScreenState((cur) => {
          const next = togglePresent(cur, lastShown.current);
          if (isProjected(next)) lastShown.current = next;
          return next;
        });
        return;
      }
      const picked = screenForKey(e.key);
      if (picked) showRoom(picked);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showRoom]);

  // SPACE ON THE HOST SCREEN (owner, 2026-10-07) presses the open step's
  // primary (`data-next-primary`), with the Stage dock's guards: never while
  // typing, never with a modifier, never when a control or a dialog has focus.
  useEffect(() => {
    if (screen !== 'host') return undefined;
    const onKey = (e) => {
      if (e.key !== ' ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTypingTarget(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea, label, [role="button"], [role="radio"], [role="switch"], [role="dialog"]')) return;
      if (dialogOpen()) return;
      // On two screens (B8) the card's main button has Space (HostActionBar); with none
      // (between asks, answer (b)) Space presses What's next's lead in the main area, as on one screen.
      const onConsole = Boolean(document.querySelector('.hc--build'));
      if (onConsole && document.querySelector('.hc-now .host-action-bar')) return;
      const b = document.querySelector(onConsole ? '.hc-main [data-next-primary]' : '.brm-host [data-next-primary]');
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
      const b = document.querySelector('.brm-host [data-points-primary], .hc [data-points-primary]');
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
  // THE CONSOLE'S WHEEL (B8): a spin already still when the ask arrives is
  // settled; a new one turns until the console's wheel says it stopped, and
  // until then the card's send waits, as the dock's does.
  const cLastSpin = curAsk && curAsk.wheel && (curAsk.wheel.spins || []).length ? curAsk.wheel.spins[curAsk.wheel.spins.length - 1].spinId : null;
  const [cSettled, setCSettled] = useState(cLastSpin);
  useEffect(() => { setCSettled(cLastSpin); }, [curAsk && curAsk.askId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cTurning = Boolean(cLastSpin && cLastSpin !== cSettled);
  // A new ask, or the same one moving on, brings the main area back to the moment.
  useEffect(() => { setCentre(null); }, [curKey]);
  const consoleDraft = curAsk ? drafts[curAsk.askId] || null : null;
  const consoleMove = useStageMoves({
    current: curAsk,
    draft: consoleDraft,
    busy,
    run: (fn) => consoleHandlers.current.run(fn),
    api: room ? api : null,
    wheelTurning: cTurning,
    editable: Boolean(curAsk && curAsk.status === 'results'),
    onEdit: () => {
      const box = document.querySelector('.hc .brm-decide textarea');
      if (box) { if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' }); box.focus(); }
    },
    onSent: (out) => consoleHandlers.current.onSent(out),
    onHideCodes: () => consoleHandlers.current.onHideCodes(),
    onTakeDown: (p) => consoleHandlers.current.onTakeDown(p),
    onPointLater: (p) => consoleHandlers.current.onPointLater(p),
    onPointsMove: (ask, then) => consoleHandlers.current.onPointsMove(ask, then),
    onRunNext: (force) => consoleHandlers.current.onRunNext(force),
    onRunSkip: () => consoleHandlers.current.onRunSkip(),
    onRunStop: () => consoleHandlers.current.onRunStop(),
  });
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
    if (!send) setSent(W.logged(short));
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
        ? W.signedOut
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

  // ── CONSIDER, AND THE SENT MARKS (docs/design/build-room-consider) ───────
  // One panel for every list (`considering`), what was typed in it kept per
  // item so Esc loses nothing, and the marks every list reads. A mark opens
  // History at its entry: on the Host screen the History section in the side
  // column, elsewhere the History screen (`historyFocus`).
  const [considering, setConsidering] = useState(null);
  const [considerDrafts, setConsiderDrafts] = useState({});
  const [historyFocus, setHistoryFocus] = useState(null); // {target, n}
  const marks = useMemo(() => sentMarks(room), [room]);
  const openHistory = useCallback((target) => {
    setHistoryFocus((f) => ({ target, n: ((f && f.n) || 0) + 1, on: screen === 'host' ? 'section' : 'screen' }));
    if (screen !== 'host') setScreen('history');
  }, [screen, setScreen]);
  const considerValue = useMemo(() => ({
    marks, openHistory, open: setConsidering, ended: Boolean(room && room.state === 'ENDED'),
  }), [marks, openHistory, room]);

  // ── The Host alert (owner, 2026-10-10) ───────────────────────────────────
  // A line on the Stage or the Build / History header jumps to where the host
  // handles it. `alertFocus` is that request; it is served once the Host screen
  // has rendered the target, and then cleared.
  useEffect(() => {
    if (!alertFocus || screen !== 'host' || !room) return;
    const t = alertFocus.target;
    const el = (t.kind === 'ask' && document.querySelector(`[data-alert-ask="${t.id}"]`)) || document.getElementById('brm-waiting-h');
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    el.focus({ preventScroll: true });
    setAlertFocus(null);
  }, [alertFocus, screen, room]);

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
  const alert = hostAlert(room, seenLocal);
  // SHARE DEMO (D1 B): on the Stage the nudge is one grey line in the HOST list, never a pop-up.
  const demoOffered = !ended && shouldOfferDemo(room);
  const stageAlert = demoOffered ? hostAlert(room, seenLocal, { demoReady: true }) : alert;
  const nudgeShot = demoOffered ? latestBuild(room).shot : null;
  /**
   * Mark seen on the room (every device of the host hears it); this device counts it at once.
   * A line's ids come oldest first: at most the newest 200 are sent (the room keeps 200, and an
   * older one pushed out would count again), in posts of at most 50. A failure puts back only the
   * ids that were not saved, says so, and reads the room again.
   */
  const markSeen = (body) => {
    const before = seenLocal;
    const ids = body.all ? [] : body.ids.slice(-SEEN_KEEP);
    const posts = body.all ? [{ all: true }] : Array.from({ length: Math.ceil(ids.length / SEEN_POST) }, (_, i) => ({ ids: ids.slice(i * SEEN_POST, (i + 1) * SEEN_POST) }));
    // The clock here is only for the instant before the server answers; the server's own time replaces it (items are dated on the server's clock, so a skewed laptop would hide or show the wrong ones).
    setSeenLocal((cur) => (body.all ? { ids: [], allAt: new Date().toISOString() } : { ...cur, ids: [...new Set([...cur.ids, ...ids])] }));
    (async () => {
      let saved = 0;
      try {
        for (const post of posts) {
          const out = await api.markSeen(post);
          saved += post.ids ? post.ids.length : 0;
          if (post.all && out && out.seen && out.seen.allAt) setSeenLocal((cur) => ({ ...cur, allAt: out.seen.allAt }));
        }
        await refresh();
      } catch (e) {
        const failed = new Set(ids.slice(saved));
        setSeenLocal((cur) => (body.all ? { ...cur, allAt: before.allAt } : { ...cur, ids: cur.ids.filter((id) => !failed.has(id) || before.ids.includes(id)) }));
        errorKind.current = '';
        setError((e && e.message) || 'That did not work.');
        await refresh();
      }
    })();
  };
  const alertGo = (line) => {
    // The demo line goes to the Host screen, where the nudge leads the Now column.
    if (line.target.kind === 'share') { setScreen('host'); return; }
    markSeen({ ids: line.ids });
    // Ideas open Waiting for you on the Room filter; an ask opens it on All, so the ask is there to focus.
    setAlertFocus({ target: line.target, filter: line.target.kind === 'ask' ? 'all' : 'room' });
    setScreen('host');
  };
  const alertAll = () => markSeen({ all: true });
  // The request strip's two answers: one handover to the device that asked, or Not now.
  const grantAsker = (name) => run(async () => { await api.playerHandover(name, { bindToRequester: true }); await loadPlayers(); });
  const refuseAsker = (name) => run(async () => { await api.playerHandover(name, { refuse: true }); await loadPlayers(); });
  // A dialog opened from the panel shows on the Host screen, whichever screen the panel was opened over.
  const dialogFromPanel = (d) => { setScreen('host'); setDialog(d); };
  const showCodes = () => { showRoom('stage'); codesAsked.current = true; setCodesUp(true); postWall({ codes: demoOnStage(room, now, wifiLink(room)) ? 'both' : 'join' }); };
  // The chip's Show on the Stage opens the same card (ruling 3).
  const share = { busy, run, api, onShowWall: showCodes };
  // THE HEADER'S JOIN, THE RAIL'S CODE AND J: one toggle, as on Call & Answer
  // (owner, 18 Oct 2026: "use the approach we now have for call and answer").
  // The codes go to the Stage and the room's window as a side panel, the demo's
  // beside the join while it is shared; press again to take them down. Until
  // then, with no demo live, Join opened a QR on the laptop alone and the room
  // never saw it. An ended session keeps the enlarged code on the laptop.
  const demoLive = demoOnStage(room, now, wifiLink(room));
  const toggleCodes = () => (codesUp ? hideCodes() : showCodes());
  const onJoinCode = ended ? () => setJoinZoom(true) : toggleCodes;
  toggleCodesRef.current = ended ? null : toggleCodes;
  const headerTools = {
    room, now, host, ended, connection, onReconnect: reconnect, pill: askPill(room), onScreen: showRoom, share,
    onQr: onJoinCode, bothCodes: demoLive, codesUp: codesUp && !ended,
    onPlayers: () => openPanel('players'),
  };
  const asks = room.asks || [];
  const proposed = asks.filter((a) => a.status === 'proposed');
  const current = asks.find((a) => a.askId === room.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null;
  // A draft left on an ask that is no longer current, and not yet decided.
  const unsentAsk = asks.find((a) => drafts[a.askId] && (!current || a.askId !== current.askId)
    && !['decided', 'discarded'].includes(a.status) && String(drafts[a.askId].direction || '').trim()) || null;
  // CONNECT stays until Claude has really called in (host review, 25 Oct 2026):
  // not until the first ask, and not until a key is minted.
  const claudeAway = !ended && !claudeEverConnected(room.agent) && !(room.log || []).some((l) => l.by === 'agent');
  // On the first view (no ask yet) Connect is the one orange button; later the card stays, its button plain.
  const connectLeads = claudeAway && !asks.length;
  // BEFORE THE ROOM STARTS (simplify PLAN item 10, smaller; owner, 26 Oct 2026): one card,
  // three rows, no gate, in place of How a Build Room works and the screen chooser. It
  // stays while Claude has not called in (as the old card did), and through the opening
  // until its rows are done; done, it folds to one line until the opening ends.
  const framingNow = Boolean(room.opening && room.opening.phase === 'opening');
  const setupNode = !ended && (claudeAway || framingNow) ? (
    <BuildSetup
      s={{
        connected: !claudeAway,
        folder: (room.agent && room.agent.folder) || '',
        connectLeads,
        joined: room.playerCount || 0,
        code: room.gameId,
        codesUp,
        two: roomChoice === 'two' || windowOpen,
        windowOpen,
        onConnect: () => setDialog('connect'),
        onCodes: toggleCodes,
        onTwo: () => chooseRoom('two'),
      }}
    />
  ) : null;
  const crew = room.crew && room.crew.enabled ? room.crew : null;
  const onCrew = Boolean(crew) && stage === 'crew';
  const openShare = crew && openShareId ? (crew.shares || []).find((x) => x.shareId === openShareId) || null : null;
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
    setComposeFrom((f) => [...new Set([...f, ...chosen.map((a) => a.askId)])]);
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
    else if (key === 'ask-points') {
      // The Points tab, drawn now with its four requests and the focus on it; on two screens, in the main area.
      setPointsAsked(true);
      setPointsTab((n) => n + 1);
      if (twoRef.current) setCentre('later');
      // The tab is drawn by this press, so the focus follows it once it is there.
      window.setTimeout(() => { const tab = document.getElementById('brm-tab-points'); if (tab) tab.focus(); }, 0);
    }
    else if (key === 'ask-room') setDialog({ compose: 'suggest' });
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
  const sendPointRequest = (kind, subject, extra) => run(() => api.pointRequest(kind, subject, extra));
  // Preview the work from the composer's More: the Now card's own button, once a build is there to open.
  const previewWork = () => run(() => api.postDirection(PREVIEW_PROMPT.text, 'do-now', null, { hideFromRoom: true }));
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
  // The Share demo nudge takes the orange from What's next while it shows (owner,
  // 2026-10-11); an ask, the opening, the starter question, ticked points or a
  // running list keep it.
  const demoLeads = demoOffered && !onCrew && !current && !(room.opening && room.opening.phase === 'opening')
    && !nowFlags(room).starter && !pointsLead && !listRunning;

  // ── TWO SCREENS: THE LAPTOP'S CONSOLE (parity PLAN §2 B8) ─────────────────
  // When this browser chose two screens, or a room's window is up, the Host
  // screen is the console: Call & Answer's, with the Build Room's panels in
  // it (BuildConsole.jsx). One screen, a phone, the Stage, Build and History
  // are exactly as before. Every panel below is the Host screen's own.
  const consoleOn = twoRef.current && screen === 'host' && !narrow;
  escCodesRef.current = consoleOn && codesUp && !ended && !panel ? hideCodes : null;
  let consoleNode = null;
  if (consoleOn) {
    const pickNow = pick && current && pick.askId === current.askId ? pick.id : null;
    const moment = consoleMoment(room, current, { crewOn: onCrew });
    const bar = buildControls(room, current, now, {
      crewOn: onCrew, draft: current ? drafts[current.askId] || null : null, turning: cTurning,
      highlight: current ? highlights[current.askId] : undefined, busy,
      decideInline: true, pickId: pickNow, answering,
    });
    consoleHandlers.current = {
      run,
      onSent: (out) => { if (current) setDrafts(({ [current.askId]: _gone, ...rest }) => rest); onSent(out); },
      onHideCodes: hideCodes,
      onTakeDown: takePointDown,
      onPointLater: savePointLater,
      onPointsMove: moveForward,
      onRunNext: (force) => nextItem(Boolean(force)),
      onRunSkip: skipItem,
      onRunStop: stopList,
    };
    // The main button: Send presses the open decide panel's own send (its pick, words and kind); every other move is the dock's.
    const press = (c) => {
      if (!c) return;
      if (c.action === 'to-claude' && consoleSend.current) {
        const s = consoleSend.current;
        if (busy || s.cannot || cTurning) return;
        s.decide();
        return;
      }
      consoleMove(c);
    };
    const overlay = Boolean(panel || confirmPick || joinZoom || takeDown || detailAskId || viewer || dialog || voteIdeas || pointVote || (runConfirm && listRunning));
    // A key the bar leaves to the page: inside a dialog, and Space on a focused control (BuildStageScreen's rule).
    const keepKey = (e) => {
      if (dialogOpen()) return true;
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return false;
      if (t.closest('[role="dialog"]')) return true;
      return e.key === ' ' && Boolean(t.closest('button, a, [role="button"]'));
    };
    const stripNow = consoleStrip(room, current, { pickId: pickNow, answering, moment });
    const people = peopleRows(room, current);
    const later = laterItems(room);
    const ptsCount = ((room.points && room.points.items) || []).length;
    const waiting = waitingCount(room);
    const agent = room.agent || {};
    const agentLive = Boolean(agent.connected || agent.listening);
    const builders = crew ? (crew.builders || []).filter((b) => !b.closed).length : 0;
    const queueNode = onCrew ? (
      <>
        {proposed.map((ask) => (
          <ReviewCard key={`${ask.askId}:${ask.status}`} ask={ask} openAsk={openAskOf(room)} busy={busy} ended={ended} run={run} api={api} connected={room.agent?.connected} />
        ))}
        <CrewIncoming crew={crew} busy={busy} run={run} api={api} onOpen={setOpenShareId} />
      </>
    ) : (
      <Queue
        startFilter={alertFocus && alertFocus.filter ? alertFocus.filter : 'all'}
        room={room} current={current} busy={busy} ended={ended} run={run} api={api}
        laterTicked={laterTicked} setLaterTicked={setLaterTicked}
        onVoteLater={(items) => setVoteIdeas(voteEntries(room, items))}
        onAskRoom={(text) => setDialog({ compose: 'suggest', prompt: text })}
        pointTicked={pointTicked} setPointTicked={setPointTicked} askOpen={Boolean(current)} openPoints={pointsTab}
        onRequest={(kind, extra) => setDialog({ points: kind, ...(extra || {}) })} onVotePoints={putPointsToVote}
        withLater={false}
      />
    );
    const laterNode = (
      <BuildLaterPoints
        room={room} ended={ended} busy={busy} run={run} api={api}
        laterTicked={laterTicked} setLaterTicked={setLaterTicked} onVoteLater={(items) => setVoteIdeas(voteEntries(room, items))}
        onAskRoom={(text) => setDialog({ compose: 'suggest', prompt: text })}
        pointTicked={pointTicked} setPointTicked={setPointTicked} leadsRow={pointsLead && !pointVote && !listRunning} askOpen={Boolean(current)} openPoints={pointsTab}
        onRequest={(kind, extra) => setDialog({ points: kind, ...(extra || {}) })} onVotePoints={putPointsToVote}
        asked={pointsAsked}
      />
    );
    const waitingTop = (
      <>
        <h2 className="brm-sr" id="brm-waiting-h" tabIndex={-1}>{BCW.waiting}</h2>
        {/* THE HOST ALERT on two screens: the slot's count says what waits; what is new since you looked is marked seen here. */}
        <div className="bc-alert" data-capability="host-alert">
          {alert && alert.count > 0 ? (
            <>
              <span className="hc-meta">{BCW.newSinceLooked(alert.count)}</span>
              <button type="button" className="hc-link" onClick={alertAll}>{BCW.markAllSeen}</button>
            </>
          ) : null}
        </div>
        <UnheardNotice room={room} onConnect={() => setDialog('connect')} />
        {freshWallComment(room, now) && (
          <div className="brm-notice brm-row brm-gap brm-onwall" role="status">
            <span><b>On the wall now:</b> &ldquo;{room.wallComment.text}&rdquo;</span>
            <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={() => run(() => api.clearWall())}>Take it down</button>
          </div>
        )}
      </>
    );
    const inMain = (title, body) => (
      <section className="bc-inmain" aria-label={title}>
        <div className="bc-inmain-h">
          <h2 className="hc-h">{title}</h2>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setCentre(null)}>{BCW.backToNow}</button>
        </div>
        {body}
      </section>
    );
    consoleNode = (
      <BuildConsole
        moment={moment}
        top={{ title: room.title || 'Build Room', code: room.gameId, onJoin: onJoinCode, joinHint: joinChipWords(ended, codesUp, demoLive), joinPressed: ended ? undefined : codesUp, presentHref: wallHref, presentDetail: windowDetail, short: true, codeProps: { 'data-capability': 'share-demo' }, leaveLabel: W.mainMenu }}
        onLeave={() => window.location.assign('/')}
        topExtra={(
          <div className="bc-topx">
            {!ended && demoRunnable(room) && (
              <span data-capability="share-demo">
                <ShareDemo lan={room.lan} link={wifiLink(room)} here={room.playerCount || 0} now={now} busy={busy} run={run} api={api} onShowWall={showCodes} nudge={false} />
              </span>
            )}
            <div className="bc-sees" role="group" aria-label={W.wallSees} data-capability="room-window">
              <span className="bc-sees-k">{`${W.wallSees}:`}</span>
              {SCREENS.filter((x) => isProjected(x.key)).map((x) => (
                <button
                  key={x.key}
                  type="button"
                  className={`bc-chip${wallScreen === x.key ? ' is-on' : ''}`}
                  aria-pressed={wallScreen === x.key}
                  aria-label={x.label}
                  title={`${W.wallSendTo(x.label)} (${x.shortcut})`}
                  onClick={() => showRoom(x.key)}
                >
                  {x.label}<kbd aria-hidden="true">{x.shortcut}</kbd>
                </button>
              ))}
              <button type="button" className="bc-chip" title={W.wallSeeHereHint} onClick={() => setScreen(wallScreen)}>{W.wallSeeHere}</button>
            </div>
            <ConnectionChip connection={connection} onReconnect={reconnect} />
          </div>
        )}
        strip={{ strip: stripNow.strip, mode: 'full' }}
        stripIdle={stripNow.idle}
        card={{
          status: { text: bar.status || '', tone: '' },
          part: consolePart(moment, bar, room, current, { answering }),
          nextOnWall: nextOnWall(moment, current),
          controls: bar,
          onAction: press,
          shortcutsEnabled: !overlay,
          ignoreKey: keepKey,
          emptyLabel: BCW.noMainMove,
          capability: bar.primary ? 'ask-moves' : undefined,
          // Mockups ready, a second card under the move, never in its place (owner, 23 Oct 2026).
          extra: <MockupsReady room={room} busy={busy} ended={ended} run={run} api={api} className="brm-mockready--console" />,
        }}
        slots={{
          waiting: {
            title: BCW.waiting, summary: String(waiting), alert: waiting > 0, capability: 'queue',
            body: <>{waitingTop}{centre === 'queue' ? <p className="hc-muted">{BCW.inMainNote}</p> : queueNode}</>,
            // Nothing to open while nothing waits (simplify PLAN item 18).
            link: centre === 'queue' || !queueItems(room).length ? null : BCW.openInMain, onLink: () => setCentre('queue'),
          },
          people: {
            title: BCW.people, summary: people.summary, capability: 'players',
            body: <PeopleList people={people} onPlayers={(g) => openPanel('players', g)} />,
          },
          later: {
            title: BCW.later, summary: `${later.length}${ptsCount ? ` · ${BCW.pointsInside}` : ''}`, capability: 'later',
            body: centre === 'later' ? <p className="hc-muted">{BCW.inMainNote}</p> : laterNode,
            link: centre === 'later' ? null : BCW.openLaterInMain, onLink: () => setCentre('later'),
          },
          session: {
            title: BCW.session, summary: agentLive ? `● ${BCW.claudeConnected}` : BCW.claudeOffline, capability: 'settings',
            body: (
              <SessionSlot
                s={{
                  busy,
                  onConnect: () => setDialog('connect'),
                  keyLine: agentChipText(room.agent, now),
                  onPlugin: () => setDialog('connect-install'),
                  pluginOld: Boolean(room.plugin && room.plugin.outdated) && !ended,
                  continueSlot: !agentLive && !ended && CONTINUE_PROMPT ? <CopyButton text={CONTINUE_PROMPT.text} label="Copy the Continue prompt" className="hc-link" /> : null,
                  onCrew: () => setDialog('crew'),
                  crewLine: crew ? `${builders} ${builders === 1 ? 'builder' : 'builders'}` : '',
                  onLook: (k) => setScreen(k),
                  onPanel: (tab, group) => openPanel(tab, group),
                  onBackToOpening: !ended && room.opening && room.opening.phase === 'building' ? () => run(() => api.openingAction('resume', {})) : null,
                  onWrap: () => setDialog('wrap'),
                  onReport: () => goView('report'),
                  onEnd: ended ? null : () => setDialog('end'),
                }}
              />
            ),
          },
        }}
        side={(
          <>
            {!nowCard(room).empty && <NowCard card={nowCard(room)} />}
            <div data-capability="whats-next" className="bc-folds">
              <HistoryStack
                openKey={historyFocus && historyFocus.on === 'section' ? { key: 'history', n: historyFocus.n } : null}
                items={[
                  ...(room.opening && room.opening.phase === 'opening' ? [{
                    key: 'opening', label: 'The opening', capability: 'opening', keep: true,
                    count: (room.opening.steps || []).filter((x) => ['done', 'skipped'].includes(x.status)).length,
                    body: <BriefPath room={room} focus={openFocus} setFocus={setOpenFocus} busy={busy} ended={ended} run={run} api={api} />,
                  }] : []),
                  { key: 'decided', label: 'Decided', count: decidedNow.length, skip: !decidedNow.length, hint: ended ? '' : 'Tick to combine', body: <DecidedList asks={asks} ticked={tickedNow} setTicked={setTicked} used={used} onCombine={combine} ended={ended} /> },
                  { key: 'timeline', label: 'Timeline', count: (room.log || []).length, body: <Timeline log={room.log || []} host stopped={agentStopped(room.agent)} busy={busy} ended={ended} run={run} api={api} deleteAs={room.deleteAs} /> },
                  { key: 'asks', label: 'Asks', count: asks.length, body: asks.length
                    ? <AskList asks={asks} host busy={busy} ended={ended} run={run} api={api} currentAskId={room.currentAskId} />
                    : <div className="brm-empty">No asks yet.</div> },
                  { key: 'shots', label: 'Screenshots', count: (room.images || []).length, body: <ShotsPanel images={room.images || []} busy={busy} run={run} api={api} deleteAs={room.deleteAs} /> },
                  { key: 'brief', label: 'Room brief', count: briefCount(room.brief), body: <BriefPanel brief={room.brief} busy={busy} ended={ended} run={run} api={api} /> },
                  // HISTORY (Consider, frame 4): a sent mark on the console opens this, at its entry.
                  { key: 'history', label: W.historySection, count: storyCount(room), capability: 'history', body: <HistorySection room={room} now={now} focus={historyFocus && historyFocus.on === 'section' ? historyFocus : null} onOpenAsk={setDetailAskId} /> },
                ]}
              />
            </div>
          </>
        )}
      >
        <PendingInvites variant="bar" stay />
        {!ended && <HandoverStrip asking={askingNow} busy={busy} onGrant={grantAsker} onRefuse={refuseAsker} onSee={() => openPanel('players')} />}
        {error && (
          <div className="brm-alert brm-alert--bar" role="alert">
            {error}
            {['network', 'auth'].includes(errorKind.current) && (
              <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={reconnect}>{errorKind.current === 'auth' ? 'Sign in again' : 'Reconnect'}</button>
            )}
            <button type="button" className={`brm-btn brm-btn--sm brm-btn--ghost${['network', 'auth'].includes(errorKind.current) ? '' : ' brm-push'}`} onClick={() => { errorKind.current = ''; setError(''); }}>Dismiss</button>
          </div>
        )}
        {loadError && (
          <div className="brm-alert brm-alert--bar" role="alert">
            {loadError}
            <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={reconnect}>Reconnect</button>
          </div>
        )}
        {ended && <div className="brm-notice brm-row brm-gap" data-testid="brm-endedbar"><span>{W.endedEdit}</span></div>}
        {!ended && room.outcome && (
          <div className="brm-notice brm-row brm-gap" data-testid="brm-wrappedbar">
            <span>{room.outcome.by === 'agent' ? W.wrappedUp : W.wrapUpSaved}</span>
            <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={() => goView('report')}>Report</button>
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" onClick={() => setDialog('end')}>End session</button>
          </div>
        )}
        {windowBlocked && (
          <div className="brm-notice brm-row brm-gap" role="alert">
            <span>{SCREEN_WORDS.quickBlocked}</span>
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={() => setWindowBlocked(false)}>Dismiss</button>
          </div>
        )}
        {setupNode}
        {/* On the first view the card's Connect row says what this line would; once anything
            has been asked the line is back, to say Queued for Claude (host review F1). */}
        {!ended && !(setupNode && connectLeads) && <ClaudeLine state={claudeState(room, now, { host: true })} />}
        {crew && centre === null && <StageTabs stage={stage} onStage={setStage} crew={crew} host={host} />}
        {centre === 'queue' ? inMain(BCW.queueInMain, <>{waitingTop}{queueNode}</>) : null}
        {centre === 'later' ? inMain(BCW.laterInMain, laterNode) : null}
        {centre === null && onCrew && (
          <>
            <CrewBoard crew={crew} host={host} now={now} busy={busy} run={run} api={api} onOpen={setOpenShareId} playerCount={room.playerCount} />
            <CrewTasks crew={crew} host={!ended} busy={busy} run={run} api={api} />
          </>
        )}
        {centre === null && !onCrew && (
          <>
            {demoOffered && (
              <DemoNudge
                busy={busy} run={run} api={api} lead={demoLeads}
                picture={nudgeShot ? <BuildImage imageId={nudgeShot.imageId} caption={nudgeShot.caption} className="brm-shot" linked={false} /> : null}
              />
            )}
            {unsentAsk && <p className="brm-notice brm-unsent" role="status">{W.unsentDirection(askNumber(unsentAsk.askId))}</p>}
            {sent && <p className="brm-sentline" role="status">{sent}</p>}
            {shownPoint && (
              // Its two moves, Take it down and Save for later, are the card's buttons.
              <ConsolePoint point={shownPoint} ideas={shownPointIdeas(room)} sources={((pointsList.find((x) => x.id === shownPoint.id) || {}).sources) || []} />
            )}
            {list && runHidden !== list.runId && (
              <RunPanel
                run={list} busy={busy} ended={ended} leads={false} confirming={runConfirm}
                onNext={() => nextItem(false)} onSkip={skipItem} onStop={stopList} onReorder={reorderList}
                onHide={() => setRunHidden(list.runId)}
              />
            )}
            {current ? (
              pointsResults ? (
                <div data-capability="ask-path">
                  <BuildPointsResults
                    key={`${current.askId}:points`}
                    ask={current} room={room} busy={busy} ended={ended}
                    override={highlights[current.askId]} said={pointsSaid[current.askId] || ''}
                    onToggle={(label) => toggleHighlight(current, label)}
                    onMove={(then) => moveForward(current, then)}
                    quiet
                  />
                </div>
              ) : (
                <BuildConsoleAsk
                  key={current.askId}
                  ask={current} room={room} busy={busy} ended={ended} run={run} api={api}
                  pickId={pickNow}
                  onPick={(id, opts) => (opts && opts.confirmed ? choosePick(current, id) : setConfirmPick({ ask: current, id }))}
                  answering={answering} setAnswering={setAnswering}
                  onSent={(out) => { setDrafts(({ [current.askId]: _gone, ...rest }) => rest); onSent(out); }}
                  draft={drafts[current.askId] || null}
                  onDraft={(d) => setDrafts((m) => ({ ...m, [current.askId]: d }))}
                  sendRef={consoleSend}
                  onWheelSettled={setCSettled}
                />
              )
            ) : (
              room.opening && room.opening.phase === 'opening'
                ? <OpeningPanel room={room} focus={openFocus} setFocus={setOpenFocus} busy={busy} ended={ended} run={run} api={api} onShowWall={() => showRoom('stage')} calm={connectLeads} />
                : <NowBuilding room={room} now={now} ended={ended} busy={busy} run={run} api={api} onCompose={(kind, extra) => setDialog({ compose: kind, ...extra })} ticked={tickedNow} laterTicked={laterTickedNow} onMove={onMove} leadOutline={Boolean(bar.primary) || pointsLead || listRunning || demoLeads || connectLeads} />
            )}
            {!ended && <Composer agent={room.agent} busy={busy} run={run} api={api} onCompose={(kind) => setDialog({ compose: kind })} text={composeText} setText={setComposeText} fromAskIds={composeFrom} focusKey={composeFocus} leadShows onRequest={(kind) => setDialog({ points: kind })} onPreview={previewWork} />}
          </>
        )}
      </BuildConsole>
    );
  }

  return (
    <ImageLoader.Provider value={loadImage}>
    <ViewerContext.Provider value={openViewer}>
    <ImageViewer.Provider value={openImage}>
    <ConsiderContext.Provider value={considerValue}>
    {/* Don't show the room and the typing mirror, beside every Send to Claude (BuildSendOptions). */}
    <SendOptionsProvider gameId={gameId} twoScreens={twoRef.current}>
    <div className={`brm brm-room${present ? ' brm--present' : ''}${screen === 'host' && !consoleOn ? ' brm-room--host' : ''}${consoleOn ? ' brm-room--console' : ''}`} data-theme="dark">
      {screen === 'stage' ? (
        // ONE SCREEN: the room's Stage with the host's controls on it (parity PLAN §2.5).
        <BuildStageScreen
          room={roomView}
          now={now}
          show={{ crewOn: onCrew, codesUp: codesUp && !ended, pickId: pick && current && pick.askId === current.askId ? pick.id : null }}
          controls={{
            busy,
            run,
            api,
            draft: current ? drafts[current.askId] || null : null,
            highlight: current ? highlights[current.askId] : undefined,
            onSent: (out) => { if (current) setDrafts(({ [current.askId]: _gone, ...rest }) => rest); onSent(out); },
            onPick: (id) => { if (current) setConfirmPick({ ask: current, id }); },
            onHideCodes: hideCodes,
            onToggleCodes: toggleCodes,
            onTakeDown: takePointDown,
            onPointLater: savePointLater,
            onPointsMove: moveForward,
            // Pressed twice before Claude reported (the bar armed it), Next goes anyway.
            onRunNext: (force) => nextItem(Boolean(force)),
            onRunSkip: skipItem,
            onRunStop: stopList,
            // HOST: home in one press, the count a badge (D2; the list is on the Host screen).
            onHost: () => setScreen('host'),
            // The room's window from the Stage too (owner, 19 Oct 2026): the dock's
            // PRESENT, as Call & Answer's, with the window's state in its title.
            // Named "Room's window", the word the header and help use (host review, 25 Oct 2026), never PRESENT.
            present: wallHref ? { href: wallHref, presenting: windowOpen ? 1 : 0, title: presentStatusFrom(windowDetail).label, label: W.dockWindow } : null,
            alert: stageAlert,
            // Claude's mockups are ready (owner, 23 Oct 2026): a cue on the dock; the card is on the Host screen.
            mockups: !ended && mockupsCard(room) ? { count: readyMockupAsks(room).length } : null,
            onSession: () => (panel ? closePanel() : openPanel()),
            panelOpen: Boolean(panel),
            askingCount: askingNow.length,
            overlayOpen: Boolean(panel || confirmPick || joinZoom || takeDown || detailAskId || viewer || (runConfirm && listRunning)),
          }}
        />
      ) : consoleOn ? consoleNode : (
      <>
      <RoomHeader
        room={room}
        now={now}
        host={host}
        screen={screen}
        onScreen={showRoom}
        ended={ended}
        roomWindow={{
          href: wallHref, detail: windowDetail, open: windowOpen, sees: wallScreen, two: roomChoice === 'two',
          onSeeHere: () => setScreen(wallScreen),
        }}
        connection={connection}
        onReconnect={reconnect}
        narrow={narrow}
        onSession={() => (panel ? closePanel() : openPanel())}
        panelOpen={Boolean(panel)}
        askingCount={askingNow.length}
        alert={alert} onAlertGo={alertGo} onAlertAll={alertAll}
        pluginOutdated={Boolean(room.plugin && room.plugin.outdated) && !ended}
        onPlayers={() => openPanel('players')}
        onQr={onJoinCode}
        bothCodes={demoLive}
        codesUp={codesUp && !ended}
        share={{ ...share, nudge: demoOffered && !narrow && (screen === 'build' || screen === 'history') }}
      />
      {/* A TEAM INVITATION (owner, 2026-10-10, option A): a slim bar on the Host
          screen only. Never Stage, Build or History: the room sees those. */}
      {screen === 'host' && <PendingInvites variant="bar" stay />}
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
          <span>{W.endedEdit}</span>
        </div>
      )}
      {!host && ended && <div className="brm-notice brm-notice--bar">{W.endedEdit}</div>}
      {/* WRAPPED, NOT YET ENDED (owner, 2026-10-06): the next steps in one place. */}
      {host && !ended && room.outcome && (
        <div className="brm-notice brm-notice--bar brm-row brm-gap" data-testid="brm-wrappedbar">
          <span>{room.outcome.by === 'agent' ? W.wrappedUp : W.wrapUpSaved}</span>
          <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={() => goView('report')}>Report</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" onClick={() => setDialog('end')}>End session</button>
        </div>
      )}

      {screen === 'build' && <BuildBuildScreen room={roomView} now={now} controls={{ ended, busy, run, api }} />}
      {screen === 'history' && <BuildHistoryScreen room={roomView} now={now} controls={{ onOpenAsk: setDetailAskId }} focus={historyFocus && historyFocus.on === 'screen' ? historyFocus : null} />}
      {screen === 'host' && (
      <div className="brm-host">
        {/* NOW: what Claude or the room is doing, with that moment's controls,
            and the one composer for everything the host types (C1, C4, C5). */}
        <main className="brm-hostcol" aria-label="Now">
          {windowBlocked && (
            <div className="brm-notice brm-row brm-gap" role="alert">
              <span>{SCREEN_WORDS.quickBlocked}</span>
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={() => setWindowBlocked(false)}>Dismiss</button>
            </div>
          )}
          {/* BEFORE THE ROOM STARTS (simplify PLAN item 10): Connect, the code and the room's
              screen, one card; one screen without asking, Use two screens a visible row, and
              Settings, Screens changes it later. Connect is its orange while it leads. */}
          {setupNode}

          {crew && <StageTabs stage={stage} onStage={setStage} crew={crew} host={host} />}

          {onCrew ? (
            <>
              <CrewBoard crew={crew} host={host} now={now} busy={busy} run={run} api={api} onOpen={setOpenShareId} playerCount={room.playerCount} />
              <CrewTasks crew={crew} host={!ended} busy={busy} run={run} api={api} />
            </>
          ) : (
            <>
              {demoOffered && (
                <DemoNudge
                  busy={busy} run={run} api={api} lead={demoLeads}
                  picture={nudgeShot ? <BuildImage imageId={nudgeShot.imageId} caption={nudgeShot.caption} className="brm-shot" linked={false} /> : null}
                />
              )}
              {unsentAsk && (
                <p className="brm-notice brm-unsent" role="status">
                  {W.unsentDirection(askNumber(unsentAsk.askId))}
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
              {/* MOCKUPS READY (owner, 23 Oct 2026): above whatever leads, so they are never only in Waiting for you. */}
              <MockupsReady room={room} busy={busy} ended={ended} run={run} api={api} />
              {current ? (
                <div className="brm-now" data-capability="ask-path">
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
                  ? <OpeningPanel room={room} focus={openFocus} setFocus={setOpenFocus} busy={busy} ended={ended} run={run} api={api} onShowWall={() => showRoom('stage')} calm={connectLeads} />
                  : <NowBuilding room={room} now={now} ended={ended} busy={busy} run={run} api={api} onCompose={(kind, extra) => setDialog({ compose: kind, ...extra })} ticked={tickedNow} laterTicked={laterTickedNow} onMove={onMove} leadOutline={pointsLead || listRunning || demoLeads || connectLeads} />
              )}
            </>
          )}

          {!ended && <Composer agent={room.agent} busy={busy} run={run} api={api} onCompose={(kind) => setDialog({ compose: kind })} text={composeText} setText={setComposeText} fromAskIds={composeFrom} focusKey={composeFocus} leadShows onRequest={(kind) => setDialog({ points: kind })} onPreview={previewWork} />}
        </main>

        {/* WAITING FOR YOU: Claude's proposed asks first (Claude is waiting on
            them), then the room's ideas (C1, C2). */}
        <section className="brm-hostcol" aria-labelledby="brm-waiting-h" data-capability="queue">
          <h2 className="brm-h5" id="brm-waiting-h" tabIndex={-1}>
            Waiting for you{waitingCount(room) > 0 ? ` · ${waitingCount(room)}` : ''}
          </h2>
          <UnheardNotice room={room} onConnect={() => setDialog('connect')} />
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
              startFilter={alertFocus && alertFocus.filter ? alertFocus.filter : 'all'}
              room={room} current={current} busy={busy} ended={ended} run={run} api={api}
              laterTicked={laterTicked} setLaterTicked={setLaterTicked}
              onVoteLater={(items) => setVoteIdeas(voteEntries(room, items))}
              onAskRoom={(text) => setDialog({ compose: 'suggest', prompt: text })}
              pointTicked={pointTicked} setPointTicked={setPointTicked} leadsRow={pointsLead && !pointVote && !listRunning} askOpen={Boolean(current)} openPoints={pointsTab}
              onRequest={(kind, extra) => setDialog({ points: kind, ...(extra || {}) })} onVotePoints={putPointsToVote}
              pointsAsked={pointsAsked}
            />
          )}
        </section>

        {/* WHAT HAPPENED (owner, 2026-10-05): the timeline, the asks and the
            screenshots, one open at a time; the open one fills the column and
            scrolls inside itself, so the page never scrolls. */}
        <aside className="brm-hostcol brm-hostcol--stack" data-capability="whats-next">
          {current && !ended && <ClaudeActivity activity={room.activity || []} agent={room.agent} now={now} doing={room.doing} full />}
          <HistoryStack
            openKey={historyFocus && historyFocus.on === 'section' ? { key: 'history', n: historyFocus.n } : null}
            items={[
              ...(room.opening && room.opening.phase === 'opening' ? [{
                key: 'opening', label: 'The opening', capability: 'opening', keep: true,
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
              // HISTORY (Consider, frame 4): a sent mark anywhere opens this, at its entry.
              { key: 'history', label: W.historySection, count: storyCount(room), capability: 'history', body: <HistorySection room={room} now={now} focus={historyFocus && historyFocus.on === 'section' ? historyFocus : null} onOpenAsk={setDetailAskId} /> },
            ]}
          />
        </aside>
      </div>
      )}
      </>
      )}

      {joinZoom && <QrZoom playUrl={`${window.location.origin}/play?gameId=${room.gameId}`} gameId={room.gameId} onClose={() => setJoinZoom(false)} />}
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
          onUpdatePlugin={() => dialogFromPanel('connect-install')}
          onCrew={() => dialogFromPanel('crew')}
          onWrap={() => dialogFromPanel('wrap')}
          onReport={() => goView('report')}
          onEnd={() => dialogFromPanel('end')}
          onShowCodes={showCodes}
          wifiLink={wifiLink(room)}
          roomChoice={roomChoice}
          onRoomChoice={chooseRoom}
        />
      )}

      {host && (dialog === 'connect' || dialog === 'connect-install') && (
        <ConnectPanel room={room} gameId={gameId} api={api} run={run} busy={busy} atInstall={dialog === 'connect-install'} onClose={() => setDialog(null)} />
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
        <AskComposer
          kind={dialog.compose} prompt={dialog.prompt || ''} detail={dialog.detail || ''} asks={asks} buildKind={room.buildKind || ''}
          claudeSets={room.claudeSets || []} requests={(room.points && room.points.requests) || []} gameId={gameId}
          api={api} run={run} busy={busy} onClose={() => setDialog(null)}
        />
      )}
      {host && dialog && dialog.points && (
        <BuildPointRequest
          kind={dialog.points} initial={dialog.subject !== undefined ? dialog.subject : ['mockups', 'walkthrough'].includes(dialog.points) ? '' : defaultSubject(room)}
          ideaId={dialog.ideaId || ''} plugin={(room.plugin && room.plugin.running) || ''}
          connected={Boolean(room.agent && room.agent.connected)} busy={busy}
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
      {detailAskId && askById(room, detailAskId) && (
        <AskDetail ask={askById(room, detailAskId)} entry={toldEntry(room, detailAskId)} held={((room.brief && room.brief.later) || []).some((i) => i.askId === detailAskId)} onClose={() => setDetailAskId(null)} onViewMockup={(label) => openViewer(detailAskId, label, 'history')} />
      )}
      {viewer && viewer.image && (
        <MockupViewer key={`img:${viewer.image.imageId}:${viewer.from}`} image={viewer.image} backLabel={viewer.backLabel} onBack={closeViewer} />
      )}
      {viewer && !viewer.image && askById(room, viewer.askId) && (
        <MockupViewer key={`${viewer.askId}:${viewer.label}:${viewer.from}`} ask={askById(room, viewer.askId)} startLabel={viewer.label} backLabel={viewer.backLabel} onBack={closeViewer} />
      )}
      {host && considering && (
        <ConsiderPanel
          item={considering} api={api} run={run} busy={busy}
          draft={considerDrafts[considering.key] || null}
          setDraft={(d) => setConsiderDrafts((all) => ({ ...all, [considering.key]: d }))}
          canIdeas={Boolean(current && current.kind === 'suggest' && ['live', 'voting'].includes(current.status))}
          onClose={() => setConsidering(null)}
          onDone={() => setConsiderDrafts(({ [considering.key]: _gone, ...rest }) => rest)}
        />
      )}
    </div>
    </SendOptionsProvider>
    </ConsiderContext.Provider>
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
const STEPS_OPEN_KEY = 'brm-steps-open';
const STEPS_SHOWN = 12;
const readStepsOpen = () => { try { return window.localStorage.getItem(STEPS_OPEN_KEY) === '1'; } catch (e) { return false; } };
const writeStepsOpen = (open) => { try { window.localStorage.setItem(STEPS_OPEN_KEY, open ? '1' : '0'); } catch (e) { /* the fold still works */ } };

/** The last twelve commands, newest first, repeats of one line grouped. */
export function groupSteps(items) {
  const out = [];
  for (const a of (items || []).slice(-STEPS_SHOWN).reverse()) {
    const hit = out.find((g) => g.text === a.text && g.kind === a.kind);
    if (hit) hit.n += 1; else out.push({ text: a.text, kind: a.kind, at: a.at, n: 1 });
  }
  return out;
}

/**
 * THE COMMANDS, FOLDED (owner, 2026-10-10): one row with the count and the
 * newest. Opened, the last twelve with repeats grouped. An opened fold is
 * remembered for this browser.
 */
function StepsFold({ items, now }) {
  const [open, setOpen] = useState(readStepsOpen);
  const newest = items[items.length - 1];
  const groups = open ? groupSteps(items) : [];
  const toggle = () => { writeStepsOpen(!open); setOpen(!open); };
  return (
    <div className="brm-steps" data-testid="brm-steps">
      <button type="button" className="brm-steps-sum" aria-expanded={open} onClick={toggle}>
        <Icon name={open ? 'CaretDown' : 'CaretRight'} size={14} />
        <span>{W.steps} <b>{items.length}</b>{!open && newest ? ` · ${W.stepsLast(newest.text)} · ${agoText(newest.at, now) || 'just now'}` : ''}</span>
      </button>
      {open && (
        <ul className="brm-activity-list">
          {groups.map((g) => (
            <li key={`${g.kind}:${g.text}`}>
              <Icon name={ACTIVITY_ICON[g.kind] || 'Gear'} size={14} />
              <span>{g.n > 1 ? W.stepRepeat(g.text, g.n) : g.text}</span>
              <span className="brm-muted brm-small">{agoText(g.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClaudeActivity({ activity, agent, now, full, doing = null }) {
  const items = (activity || []).slice().reverse();
  const latest = items[0];
  const fresh = latest && now - Date.parse(latest.at) < ACTIVITY_FRESH_MS;
  // The line leads (docs/design/build-room-doing D1); without one, today's panel.
  const dl = claudeState({ agent, activity, doing }, now, { host: true }).doing || null;
  const helperLine = dl ? '' : claudeState({ agent, activity, doing }, now, { host: true }).helperLine || '';
  if (!latest && !dl && !helperLine && !(agent && agent.connected)) return null;
  if (dl) {
    const src = dl.stale
      ? (agent && agent.lastSeenAt ? W.lastSeen(agoText(agent.lastSeenAt, now)) : '')
      : dl.source === 'todo' ? W.doingFromTodo : dl.source === 'claude' ? W.doingFromClaude(clockTime(dl.startedAt)) : '';
    return (
      <section className={`brm-panel brm-activity${dl.stale ? '' : ' is-live'}`} aria-labelledby="brm-activity-h" aria-live="polite">
        <h2 className="brm-h5" id="brm-activity-h">Claude Code</h2>
        <div className="brm-doing" data-testid="brm-doing" data-stale={dl.stale ? 'true' : 'false'}>
          <p className="brm-doing-t"><b>{dl.headline}</b>{!dl.stale && <span className="brm-muted">{` · ${dl.dur}`}</span>}</p>
          {src && <p className="brm-doing-src brm-muted brm-small">{src}</p>}
          {dl.helperLine && <p className="brm-doing-helper">{dl.helperLine}</p>}
        </div>
        {full && items.length > 0 && <StepsFold items={activity || []} now={now} />}
      </section>
    );
  }
  return (
    <section className={`brm-panel brm-activity${fresh ? ' is-live' : ''}`} aria-labelledby="brm-activity-h" aria-live="polite">
      <h2 className="brm-h5" id="brm-activity-h">{fresh ? 'Claude Code is working' : 'Claude Code'}</h2>
      {helperLine && <p className="brm-doing-helper">{helperLine}</p>}
      {latest ? (
        <p className="brm-activity-now" data-testid="brm-activity-now">
          <Icon name={ACTIVITY_ICON[latest.kind] || 'Gear'} size={18} />
          <span>{latest.text}</span>
          <span className="brm-muted brm-small">{agoText(latest.at, now) || 'just now'}</span>
        </p>
      ) : (
        <p className="brm-hint">{W.nothingYet}</p>
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
  const text = st.key === 'paused' && agent && agent.lastSeenAt ? `${st.headline} · ${W.lastSeen(agoText(agent.lastSeenAt, now))}` : st.key === 'building' && st.doing ? `${st.headline} · ${st.doing.dur}` : st.headline;
  const [copied, setCopied] = useState('');
  const quiet = agentStopped(agent);
  const cls = `brm-agentchip${agent && agent.connected ? ' is-on' : ''}${quiet ? ' is-quiet' : ''}`;
  if (!quiet) {
    // The tooltip says what the label says (Revy review, 2026-10-10): one state, claudeState's.
    const tip = st.key === 'none' || st.queued ? W.chipNever : st.key === 'waiting' ? W.chipReady : W.chipWorking;
    return <span className={cls} data-testid="brm-agentchip" data-state={st.queued ? 'queued' : st.key} title={tip}>{text}</span>;
  }
  const copy = async () => {
    const ok = await copyText(continueCommand());
    setCopied(ok ? W.copiedPaste : `Copy failed. Type ${continueCommand()} into Claude Code.`);
    setTimeout(() => setCopied(''), 4000);
  };
  return (
    <button
      type="button"
      className={cls}
      data-testid="brm-agentchip"
      data-state={st.key}
      title={W.tipCopyContinue}
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
export function UnheardNotice({ room, onConnect = null }) {
  const [copied, setCopied] = useState('');
  const waiting = unheard(room);
  const never = agentNeverCame(room && room.agent);
  if (!waiting.length || !(never || agentStopped(room && room.agent))) return null;
  // NEVER CONNECTED (host review, 25 Oct 2026): nothing to continue; the way on is Connect.
  if (never) {
    return (
      <div className="brm-notice brm-unheard" role="status" data-testid="brm-unheard" data-never="">
        <p className="brm-unheard-t"><b>{W.neverCameBefore(waiting.length)}</b></p>
        {onConnect && (
          <div className="brm-row brm-gap">
            <button type="button" className="brm-btn brm-btn--sm" onClick={onConnect}>{W.connectClaude}</button>
          </div>
        )}
      </div>
    );
  }
  const copy = async () => {
    const ok = await copyText(continueCommand());
    setCopied(ok ? W.copiedPaste : `Copy failed. Type ${continueCommand()} into Claude Code.`);
    setTimeout(() => setCopied(''), 5000);
  };
  const n = waiting.length;
  return (
    <div className="brm-notice brm-unheard" role="status" data-testid="brm-unheard">
      <p className="brm-unheard-t">
        <b>{W.stoppedBefore(n)}</b> Run <code>{continueCommand()}</code> in it.
      </p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--sm" onClick={copy}>Copy {continueCommand()}</button>
        {copied && <span className="brm-hint">{copied}</span>}
      </div>
    </div>
  );
}

const CONNECTION = {
  live: { text: 'Live', title: W.tipLive },
  connecting: { text: 'Connecting…', title: 'Opening the live connection to the room.' },
  disconnected: { text: 'Disconnected · Reconnect', title: W.tipDropped },
  offline: { text: 'No internet · Try again', title: W.tipOffline },
  signin: { text: 'Signed out · Sign in again', title: W.tipSignedOut },
};

/**
 * REVIEW CLAUDE'S QUESTIONS (owner, 2026-10-04; one way round since the host
 * review, 25 Oct 2026). On, Claude's questions wait for the host before the
 * room sees them; off, they open to the room as soon as Claude asks. The same
 * words, the same way round, as the create page and the Connect panel. It
 * stores `reviewAgentAsks` as before: on is true.
 */
export function AutoSwitch({ settings, busy, run, api }) {
  const review = settings ? settings.reviewAgentAsks !== false : true;
  return (
    <label className={`brm-auto${review ? '' : ' is-on'}`} title={review ? W.tipReview : W.tipAuto}>
      <input
        type="checkbox"
        role="switch"
        checked={review}
        disabled={busy}
        onChange={(e) => run(() => api.saveSettings({ reviewAgentAsks: e.target.checked }))}
      />
      <span>{W.reviewAsks}</span>
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
/*
 * `focusFirst` (an idea's More, simplify PLAN item 18, phase 2): opening the menu puts the
 * focus on its first move, and Escape closes it with the focus back on the button, so the
 * moves under More are as near to the keyboard as they were on the card.
 */
function SessionMenu({ children, label = 'More', groupLabel = 'Session', ariaLabel, buttonClass = 'brm-btn brm-btn--sm brm-btn--ghost', placeKey, focusFirst = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);
  useKeepOnScreen(panelRef, open, placeKey);
  useEffect(() => {
    if (!open || !focusFirst || !panelRef.current) return;
    const first = panelRef.current.querySelector('button:not([disabled])');
    if (first) first.focus();
  }, [open, focusFirst]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('[role="dialog"]')) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      if (focusFirst && buttonRef.current) buttonRef.current.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, focusFirst]);
  return (
    <div className="brm-more" ref={ref}>
      <button type="button" ref={buttonRef} className={buttonClass} aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((o) => !o)}>
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
 * Opens the build in a new tab. NOT DRAWN BEFORE THERE IS A BUILD (simplify
 * PLAN item 18, F17): with no link yet there is nothing to open, so the header
 * leaves it out rather than showing it disabled.
 */
function LiveBuildButton({ link, className = 'brm-btn brm-btn--sm brm-livebuild', onPick }) {
  const href = safeHref(link);
  if (!href) return null;
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer" title={`Opens ${href} in a new tab`} onClick={onPick}>{W.openBuild} <Icon name="ArrowSquareOut" size={14} /></a>;
}

/** True at 480px and narrower. No matchMedia (jsdom, an old browser) reads as wide. */
const SEEN_POST = 50; // ids per post (the room's limit)
const SEEN_KEEP = 200; // ids the room keeps
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
 * The header's right-hand tools, in one place: the live build, the Share demo
 * chip, Claude's status, the connection, the join code and the joined count.
 * Wide, they sit in the header; at 480px and narrower they are the Session
 * panel's top line instead (owner, 2026-10-09: the three-dot menu is gone).
 * The chip is on every screen with a header (Share demo D1 B, D3): it carries
 * the nudge on Build and History, and Share demo after Not now.
 */
/** The header's Join: what a press does now (a toggle, as on Call & Answer). */
function joinChipWords(ended, codesUp, both) {
  if (ended) return 'Show the QR code';
  if (codesUp) return both ? 'Hide both codes on the Stage' : 'Hide the join code on the Stage';
  return both ? 'Show both codes on the Stage' : 'Show the join code on the Stage';
}

function HeaderTools({ room, now, host, ended, connection, onReconnect, onQr, onPlayers, pill, onScreen, share, bothCodes = false, codesUp = false, withPill = true }) {
  // Share demo appears once there is a running app to share (owner, 2026-10-11).
  const showWifi = !ended && Boolean(share) && demoRunnable(room);
  return (
    <>
      {withPill && pill && (
        <button type="button" className={`brm-askpill${pill.results ? ' is-results' : ''}`} title="Show it on the Stage (2)" onClick={() => onScreen('stage')}>
          {pill.text}
        </button>
      )}
      <LiveBuildButton link={liveBuildLink(room, now)} />
      {showWifi && (
        <ShareDemo
          lan={room.lan} link={wifiLink(room)} here={room.playerCount || 0} now={now}
          busy={share.busy} run={share.run} api={share.api} onShowWall={share.onShowWall} nudge={Boolean(share.nudge)}
        />
      )}
      <span className="brm-agentwrap" data-capability="claude-status"><AgentChip room={room} now={now} /></span>
      {host && <ConnectionChip connection={connection} onReconnect={onReconnect} />}
      <button
        type="button"
        className="brm-codewrap brm-codebtn"
        data-capability="share-demo"
        title={joinChipWords(ended, codesUp, bothCodes)}
        aria-label={`Join code ${room.gameId}. ${joinChipWords(ended, codesUp, bothCodes)}`}
        aria-pressed={ended ? undefined : codesUp}
        onClick={onQr}
      >
        <span className="brm-muted brm-small">Join</span> <span className="brm-code">{room.gameId}</span>
      </button>
      <button type="button" className="brm-chip brm-chip--btn" title="Who is in the room" onClick={onPlayers} data-capability="players">{room.playerCount || 0} joined</button>
    </>
  );
}

/** The header `?`'s section per screen (config/help/screens.js). The Stage's is in its dock. */
export const SCREEN_HELP = { host: 'build-host', build: 'build-build', history: 'build-history' };

/**
 * THE HEADER, the same on all four screens: the title, the screens, the open
 * ask, Claude's status, the join code. On the Host screen it adds the live
 * connection and the session menu; on a screen the room sees, nothing in it
 * is host-only (the Host tab's count is a number, never content).
 */
function RoomHeader({
  room, now, host, screen, onScreen, ended, connection, onReconnect, narrow,
  onSession, panelOpen, askingCount, onPlayers, onQr, bothCodes = false, codesUp = false, pluginOutdated = false,
  alert, onAlertGo, onAlertAll, share, roomWindow = null,
}) {
  const pill = askPill(room);
  const tucked = narrow;
  const tools = { room, now, host, ended, connection, onReconnect, onQr, onPlayers, pill, onScreen, share, bothCodes, codesUp };
  const rw = roomWindow || {};
  // TWO SCREENS (owner, 19 Oct 2026): with the room's window up, the tabs keep
  // this laptop's own place (Host, or the screen it is already on) and "The
  // room sees" sends Stage, Build or History to the window.
  const twoUp = Boolean(rw.open);
  const tabs = twoUp ? SCREENS.filter((s) => s.key === 'host' || s.key === screen) : SCREENS;
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
      <nav className="brm-screens" aria-label={twoUp ? 'This laptop' : 'Screens'}>
        {tabs.map((s) => (s.key === 'host' && screen !== 'host' && alert ? (
          // The Host tab carries the Host alert on Build and History (owner, 2026-10-10); on the Host screen Waiting for you does.
          <HostAlert key={s.key} alert={alert} onHost={() => onScreen('host')} onGo={onAlertGo} onMarkAll={onAlertAll} />
        ) : (
          <button
            key={s.key}
            type="button"
            className={`brm-screen${screen === s.key ? ' is-on' : ''}`}
            aria-pressed={screen === s.key}
            title={`${s.label} (${s.shortcut})`}
            onClick={() => onScreen(s.key)}
          >
            {s.label}
          </button>
        )))}
      </nav>
      {twoUp && (
        <div className="brm-roomsees" role="group" aria-label={W.wallSees}>
          <span className="brm-roomsees-k">{W.wallSees}</span>
          {SCREENS.filter((s) => isProjected(s.key)).map((s) => (
            <button
              key={s.key}
              type="button"
              className={`brm-screen brm-seechip${rw.sees === s.key ? ' is-on' : ''}`}
              aria-pressed={rw.sees === s.key}
              title={`${W.wallSendTo(s.label)} (${s.shortcut})`}
              onClick={() => onScreen(s.key)}
            >
              {s.label}
            </button>
          ))}
          <button type="button" className="brm-seehere" disabled={screen === rw.sees} title={W.wallSeeHereHint} onClick={rw.onSeeHere}>{W.wallSeeHere}</button>
        </div>
      )}
      {/* The room's window and whether it is really up, on Host, Build and
          History (owner, 19 Oct 2026; C&A's console top line, the same part).
          The Stage carries it in its dock. */}
      {/* One screen with no window up (simplify PLAN item 18): the link alone. Its state and
          Open as a tab say nothing until the host uses two screens or a window is up. */}
      {rw.href && !rw.open && !rw.two && (
        <RoomWindowLink className="brm-btn brm-btn--sm brm-btn--ghost brm-rwlink" href={rw.href} data-capability="room-window">{W.wallOpen}</RoomWindowLink>
      )}
      {rw.href && (rw.open || rw.two) && (
        <RoomWindowStatus
          className="rws brm-rws"
          href={rw.href}
          detail={rw.detail}
          short
          linkLabel={W.wallOpen}
          classes={{ link: 'brm-btn brm-btn--sm brm-btn--ghost brm-rwlink', stat: 'brm-winstat', dot: 'brm-windot' }}
        />
      )}
      {/* THE ROOM SEES THIS HEADER on Build and History, so the cue there names
          nobody: an amber pill and the count on SESSION (S6b). The Host screen
          has the named strip instead. */}
      {askingCount > 0 && !host && (
        <button type="button" className="brm-askpill" onClick={onPlayers}>{W.askingToTake(askingCount)}</button>
      )}
      <div className="brm-hbar-tools">
        {!tucked && <HeaderTools {...tools} />}
        {/* HELP (Help Phase 3): the section for the screen that is showing,
            beside SESSION as on the other engagements' panels. It names
            nobody and shows nothing of the session, so it may sit in the
            header the room sees on Build and History; it opens on this
            laptop, never the room's window. */}
        <HelpButton
          {...helpFor(SCREEN_HELP[screen] || 'build-host')}
          variant="inline"
          size="small"
          tooltip="Help and feedback"
          className="help-button-quiet brm-help"
          reports={{ context: 'host', gameId: room.gameId }}
        />
        {/* SESSION (owner, 2026-10-09): the same word and key as the other
            engagements, last on the right where the three-dot menu was. */}
        <button type="button" className={`brm-btn brm-btn--sm brm-sess${panelOpen ? ' is-on' : ''}`} aria-haspopup="dialog" aria-expanded={panelOpen} onClick={onSession} data-capability="settings">
          SESSION <kbd>\</kbd>
          {askingCount > 0 && <span className="brm-sess-n">{askingCount}<span className="brm-sr"> asking to take a name</span></span>}
          {/* The plugin is out of date: a dot, on the Host screen only (never on the Stage, Build or History the room sees). */}
          {host && pluginOutdated && <span className="brm-sess-dot" data-testid="brm-plugin-dot"><span className="brm-sr">{W.pluginDotSr}</span></span>}
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
      <InfoTip text={W.tipBrief} label="About the room brief" />
      <div className="brm-brief-sec">
        <h3 className="brm-h5">Who it is for</h3>
        {ended ? <p>{b.forWhom || 'Not set.'}</p> : (
          <form className="brm-row brm-gap" onSubmit={(e) => { e.preventDefault(); save({ forWhom: forWhom.trim() }); }}>
            <input className="brm-input brm-input--sm" aria-label="Who it is for" placeholder="e.g. busy volunteers, often on an old phone" value={forWhom} maxLength={300} onChange={(e) => setForWhom(e.target.value)} />
            {forWhom.trim() !== (b.forWhom || '') && <button type="submit" className="brm-btn brm-btn--sm" disabled={busy}>Save</button>}
          </form>
        )}
      </div>
      {section('keep', 'Keep in mind', W.keepLands)}
    </section>
  );
}

function HistoryStack({ items: all, openKey = null }) {
  // NOT DRAWN UNTIL IT HAS SOMETHING (simplify PLAN item 18, phase 1; owner,
  // 26 Oct 2026): a fold with nothing in it is left out (`keep` holds one that
  // means something empty: The opening, whose lines are the steps to come).
  // The column stays where it is, with one quiet line when nothing is in it.
  const items = all.filter((it) => it.keep || it.count > 0);
  // The first item opens, unless it has nothing in it yet (`skip`: an empty
  // Decided); an item that has gone (The opening, once building starts) opens
  // the first one again. `openKey` ({key, n}) opens one from outside: a sent
  // mark opening History (Consider), each press once.
  const first = () => ((items.find((it) => !it.skip) || items[0]) || {}).key;
  const [chosen, setOpen] = useState(first);
  const asked = openKey ? `${openKey.key}:${openKey.n}` : '';
  useEffect(() => { if (openKey) setOpen(openKey.key); }, [asked]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = items.some((it) => it.key === chosen) ? chosen : first();
  if (!items.length) return <p className="brm-quiet">{W.sideEmpty}</p>;
  // One fold alone has nothing to fold against: its head is a heading, not a button.
  if (items.length === 1) {
    const it = items[0];
    return (
      <div className="brm-stack">
        <div className="brm-stackitem is-open" data-capability={it.capability}>
          <h2 className="brm-stackhead brm-stackhead--only">
            {it.label}
            <span className="brm-muted">{` · ${it.count}`}</span>
            {it.hint && <span className="brm-muted brm-stackhint">{` · ${it.hint}`}</span>}
          </h2>
          <div className="brm-stackbody" id={`brm-stack-${it.key}`}>{it.body}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="brm-stack">
      {items.map((it) => {
        const isOpen = open === it.key;
        return (
          <div key={it.key} className={`brm-stackitem${isOpen ? ' is-open' : ''}`} data-capability={it.capability}>
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

/** How many entries the History section holds: the story the History screen tells. */
function storyCount(room) {
  return roomStory({ log: room.log || [], asks: room.asks || [], images: room.images || [], gave: contributionsOf(room), ended: room.state === 'ENDED' }).length;
}

/**
 * THE HISTORY SECTION (docs/design/build-room-consider, frame 4): the story in
 * the side column, newest first. With `focus` ({target, n}) it scrolls to the
 * entry a sent mark named and highlights it ("showing the entry").
 */
export function HistorySection({ room, now, focus = null, onOpenAsk = null }) {
  const story = roomStory({ log: room.log || [], asks: room.asks || [], images: room.images || [], doing: doingLine(room.doing, now), gave: contributionsOf(room), ended: room.state === 'ENDED' });
  const ref = useRef(null);
  const target = focus ? focus.target : null;
  useEffect(() => {
    if (!target || !ref.current) return;
    const el = ref.current.querySelector('.is-focus');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [target, focus && focus.n]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!story.length) return <div className="brm-empty">{W.nothingYet}</div>;
  return (
    <div className="brm-histsection" ref={ref}>
      {target && story.some((it) => storyHolds(it, target) || (it.kids || []).some((k) => storyHolds(k, target))) && <p className="brm-hint brm-showing">{W.showingEntry}</p>}
      <ol className="brm-story" aria-label={W.historySection}>
        {story.map((it) => <StoryItem key={it.id} item={it} onOpen={onOpenAsk} focus={target} />)}
      </ol>
    </div>
  );
}

// ── The Stage screen ────────────────────────────────────────────────────────

// ── The Build and History screens ───────────────────────────────────────────

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
  // ASK FOR NEW MOCKUPS (ideas flow E, I7): only on a set the host asked Claude to draw.
  const [remocking, setRemocking] = useState(false);
  const [change, setChange] = useState('');
  const remock = () => run(() => api.askAction(ask.askId, { action: 'remock', change: change.trim() }));
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
      'do-now', null,
      // An instruction about an ask the room has not seen: never the room's Sent to Claude card.
      { hideFromRoom: true },
    ));
    if (out !== undefined) setAskedMockups(true);
  };

  return (
    <section className="brm-panel brm-proposed" aria-label={`Proposed ask ${askNumber(ask.askId)}`} data-alert-ask={ask.askId} tabIndex={-1}>
      <div className="brm-row brm-gap">
        <span className="brm-chip brm-chip--amber">{ask.fromRequest ? W.mockupsForYou : ask.source === 'agent' ? 'Proposed by Claude' : ask.fromIdeas ? `Your vote, from ${ask.fromIdeas.length} ideas` : 'Draft'} · not shown to the room</span>
        {mockups && (mockups.ready
          ? <span className="brm-chip brm-chip--live" data-testid="brm-mockups-ready">Mockups ready</span>
          : <span className="brm-chip" data-testid="brm-mockups-wait">Claude is making mockups · {mockups.have} of {mockups.total}</span>)}
        {ask.next && <span className="brm-chip">Opens after ask {blocking ? askNumber(blocking.askId) : ''}</span>}
        {ask.source === 'agent' && connected && <span className="brm-muted brm-small brm-push">Claude is waiting</span>}
      </div>
      <div className="brm-row brm-gap">
        <h2 className="brm-h">Ask {askNumber(ask.askId)} · {KIND_LABEL[ask.kind]}</h2>
        {ask.kind === 'choice' && <InfoTip text={W.tipEditable} label="About editing the options" />}
        
      </div>
      {!mockups && stageHint(ask) && <p className="brm-stagehint">{stageHint(ask)}</p>}
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
            ? (blocking ? W.opensWhenClose(askNumber(blocking.askId)) : W.picturesIn)
            : W.hiddenUntilIn(mockups.total)}
        </p>
      )}
      {missing.length > 0 && !ended && !mockups && (
        <div className="brm-notice brm-row brm-gap" role="status" data-testid="brm-previews-missing">
          {askedMockups ? (
            <span>{W.askedMockups}</span>
          ) : (
            <span>
              <b>{W.noPictureFor(missing.length === 1 ? `option ${missing[0]}` : `options ${missing.join(', ')}`)}</b>
              {!connected && <>{' '}{W.offlinePreview}</>}
            </span>
          )}
          {connected && !askedMockups && (
            <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={askForMockups}>Ask Claude for mockups</button>
          )}
        </div>
      )}
      <details className="brm-fold brm-editfold" open={editOpen || dirty} onToggle={(e) => setEditOpen(e.currentTarget.open)}>
        <summary>{W.editQuestion}</summary>
        <div className="brm-editbody">
        <label className="brm-field">
          <span className="brm-lbl">Question</span>
          <input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <label className="brm-field">
          <span className="brm-lbl">Context (optional)</span>
          <textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} />
        </label>
        {ask.kind === 'choice' && (
          <div className="brm-field">
            <span className="brm-lbl">Options<InfoTip text={W.tipLettersKept} label="About the letters" /></span>
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
            ? <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} title={W.tipWaitsHere} onClick={() => lineUp('notNext')}>Not next</button>
            : <button type="button" className="brm-btn" disabled={busy || !prompt.trim()} title={`Opens as soon as ask ${askNumber(blocking.askId)} closes`} onClick={() => lineUp('openNext')}>Open next</button>)}
          {ask.fromRequest && !remocking && (
            <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={() => setRemocking(true)}>{W.newMockups}</button>
          )}
          <button type="button" className={`brm-btn${answering && !dirty ? ' brm-push' : ''}`} disabled={busy || !prompt.trim()} onClick={open}>{openLabel}</button>
        </div>
      )}
      {remocking && !ended && (
        <div className="brm-row brm-gap brm-remock">
          <input className="brm-input brm-input--sm" aria-label={W.newMockupsChange} placeholder={W.newMockupsChange} value={change} maxLength={120} onChange={(e) => setChange(e.target.value)} />
          <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={remock}>{W.newMockups}</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setRemocking(false)}>Cancel</button>
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
  // Fewer than two options: no wheel to offer (the server refuses one).
  if (!ask.wheel && !wheelPossible(ask)) return null;
  if (!ask.wheel) {
    return (
      <section className="brm-panel brm-wheelpanel" aria-label="The wheel">
        {tied.length >= 2 ? (
          <p className="brm-notice"><b>{W.tieOf(tied.map(nameOf).join(' and '))}</b></p>
        ) : null}
        <div className="brm-row brm-gap">
          <button type="button" className={`brm-btn${primary ? ' brm-btn--primary' : ''}`} disabled={busy} onClick={() => act('wheel')}>{W.spin}</button>
          {tied.length >= 2 && <button type="button" className="brm-btn" disabled={busy} onClick={() => act('revote')}>{W.voteAgain}</button>}
        </div>
        <p className="brm-hint">{W.spinsToo}</p>
      </section>
    );
  }
  const w = ask.wheel;
  return (
    <section className="brm-panel brm-wheelpanel" aria-label="The wheel">
      <BuildWheel wheel={w} size="sm" busy={busy} onSpin={spinInRow ? null : () => act('spin')} spinLabel={w.landed ? W.spinAgain : W.spin} spinPrimary={primary} spinSecondary={!primary} onSettled={onSettled} />
      <div className="brm-row brm-gap brm-wheelacts">
        <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => act('pass')}>Someone else spins</button>
      </div>
    </section>
  );
}

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
  else if (v.preferred) body = W.preferredLine(name(v.preferred), why, name(v.pick));
  else body = W.tieRecordLine(name(v.pick), v.tied.length ? W.tieOf(v.tied.join(' and ')) : W.noVotesYet);
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm" onClose={onClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-pick-title">
      <DialogHead id="brm-pick-title" title={v.isPreferred ? W.pickRoomChoice : W.pickAlternate} onClose={onClose} />
      <p data-testid="brm-pick-body">{body}</p>
      {open && <p className="brm-hint">This closes the vote.</p>}
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy} onClick={onConfirm}>
          {W.pick(short(v.pick))}
        </button>
      </div>
    </Modal>
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
  if (ask.kind === 'rating') return chosen[0] ? ratingDirection(ask.prompt, chosen[0]) : '';
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
/*
 * `sendRef` (the two-screen console, B8): the console's "Your part now" card
 * holds Send as its main button, so the panel drawn open beside the board
 * hands its own send to that button (`sendRef.current = { decide, label,
 * cannot }`) and draws no Send of its own. Record only, Save for later and
 * the rest stay here. Without it, nothing changes.
 */
export function DecidePanel({ ask, busy, run, api, playerCount, spoken = false, onCancel, beforeDecide, pickId = null, next = false, onSent, draft = null, onDraft, sendRef = null }) {
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
  const [why, setWhy] = useState(() => (draft && draft.why) || '');
  // Don't show the room (owner, 23 Oct 2026): unticked unless the host ticks it.
  const [hide, setHide] = useState(false);
  const mirror = useMirror();
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
    if (dirty.current && onDraft) onDraft({ direction, as, chosen, why });
  }, [direction, as, chosen, why]); // eslint-disable-line react-hooks/exhaustive-deps
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
        return api.askAction(ask.askId, decideBody(ask, { direction: said, chosen, note, send, as: kind, spoken, why: spoken ? '' : why, hide }));
      });
      if (out !== undefined) mirror.done();
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
  if (sendRef) sendRef.current = { decide, label: sendLabel, cannot };
  useEffect(() => () => { if (sendRef) sendRef.current = null; }, [sendRef]);

  return (
    <section className="brm-panel brm-decide" aria-labelledby={`brm-decide-${ask.askId}`}>
      <h2 className="brm-h" id={`brm-decide-${ask.askId}`}>{spoken ? 'Answer for the room' : 'Direction for Claude'}</h2>
      <p className="brm-sub">{spoken
        ? W.saidOutLoud
        : W.buildsFromSentence(total, playerCount || 0)}</p>
      {alternate && (
        <div className="brm-notice" role="status" data-testid="brm-alternate">
          {W.yourPick(`${alternate.preferred.label ? `${alternate.preferred.label} · ` : ''}${alternate.preferred.text}`)}
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
      <textarea className="brm-input brm-ta brm-dirbox" aria-label="Direction for Claude" data-next-focus={next || undefined} value={direction} maxLength={2000} onKeyDown={onBoxKey} onChange={(e) => { touch(); setEdited(true); setDirection(e.target.value); mirror.draft(e.target.value); }} placeholder={spoken ? 'What did the room decide?' : 'What should Claude do now?'} />
      {!spoken && (
        <label className="brm-field brm-decide-why">
          <span className="brm-lbl">{W.considerWhy}</span>
          <input className="brm-input" value={why} maxLength={500} placeholder={W.decideWhyPlaceholder} onChange={(e) => { touch(); setWhy(e.target.value); }} />
          {edited && !why.trim() && <span className="brm-hint">{W.decideWhyHint}</span>}
        </label>
      )}
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
        <span className="brm-lbl">{spoken ? W.saidPeopleOptional : W.saidOptional}</span>
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
      <SendExtras hide={hide} setHide={setHide} disabled={busy} />
      <ActionRow pinned={next} space={next} hint={next ? <span title={W.ctrlEnterTitle}>{W.ctrlEnterSends}</span> : ''}>
        {onCancel && <button type="button" className="brm-btn brm-btn--ghost" onClick={() => { mirror.done(); onCancel(); }}>Cancel</button>}
        <button type="button" className="brm-btn brm-btn--ghost" disabled={cannot} onClick={() => decide({ send: false })}>{W.recordOnly}</button>
        <button type="button" className="brm-btn" disabled={cannot} onClick={() => decide({ kind: 'later' })}>{W.saveLater}</button>
        {!sendRef && (
          <button type="button" className={`brm-btn${next ? ' brm-btn--primary' : ''}`} data-next-primary={next || undefined} data-no-space={next || undefined} disabled={cannot} onClick={() => decide()}>
            <Icon name="PaperPlaneTilt" size={16} /> {sendLabel}
          </button>
        )}
      </ActionRow>
    </section>
  );
}

// ── Between asks ────────────────────────────────────────────────────────────

// ── Screenshots ─────────────────────────────────────────────────────────────

const SHOT_KIND = { mockup: 'Mockup', final: 'Final', progress: 'Progress' };

/** Every screenshot Claude sent, for the host to check or remove. */
/*
  THE OWNER'S DELETE RULE (2026-10-04): GET build/state says the role this
  host would delete in (`deleteAs`). Engage staff give a reason in the same
  inline confirm; '' means this caller may not remove anything here
  (NOT_YOURS, in screens/Timeline.jsx with the timeline's own Delete).
*/
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
  if (agent && agent.listening) return W.actsNow;
  if (agent && agent.connected) return 'Claude reads this on its next step.';
  return W.readsNextCheckin;
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

function NowBuilding({ room, now, ended, busy, run, api, onCompose, ticked = null, laterTicked = 0, onMove = null, leadOutline = false }) {
  const [sent, setSent] = useState(false);
  if (room.outcome && room.outcome.summary) return <WrappedStage outcome={room.outcome} agent={room.agent} images={room.images || []} />;
  const agent = room.agent || {};
  const quiet = !(agent.listening || agent.connected);
  const built = Boolean(latestBuild(room).link);
  const line = ended ? 'Session ended.' : claudeState(room, now).headline;
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
          <span>{W.startedTooSoon}</span>
          <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={() => run(() => api.openingAction('resume', {}))}>Back to the opening</button>
        </div>
      )}
      {starter && (
        <div className="brm-starter">
          <p className="brm-nowline">Start with the room: {STARTER_PROMPT}</p>
          <div className="brm-row brm-gap">
            {/* Outlined while another move holds the one orange (Connect first, host review 25 Oct 2026). */}
            <button type="button" className={`brm-btn${leadOutline ? '' : ' brm-btn--primary'}`} onClick={() => onCompose('choice', { prompt: STARTER_PROMPT, detail: 'Pick the one you most want to see built today.' })}>
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
      {!ended && <ClaudeActivity activity={room.activity || []} agent={room.agent} now={now} doing={room.doing} full />}
      {/* SHOW THE BUILD is the header's Build (3), and on two screens The room sees: Build; the
          Now card no longer repeats it (simplify PLAN item 18, phase 2). PREVIEW THE WORK (owner,
          2026-10-04: one click, Claude builds, serves and screenshots a preview) is here until
          there is a build to open; then Open the build is in the header, and Preview the work is
          under the composer's More with the other things to ask Claude for. */}
      {!ended && (!built || (quiet && CONTINUE_PROMPT)) && (
        <div className="brm-row brm-gap">
          {!built && (
            <button
              type="button"
              className="brm-btn"
              disabled={busy || quiet}
              title={quiet ? 'Connect Claude Code first' : W.tipPreview}
              onClick={async () => { const ok = await run(() => api.postDirection(PREVIEW_PROMPT.text, 'do-now', null, { hideFromRoom: true })); if (ok !== undefined) setSent(true); }}
            >
              Preview the work
            </button>
          )}
          {quiet && CONTINUE_PROMPT && <CopyButton text={CONTINUE_PROMPT.text} label="Copy the Continue prompt" />}
        </div>
      )}
      {sent && <p className="brm-hint" role="status">{W.askedPreview}</p>}
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
 *
 * ONE LINE UNTIL CLICKED (simplify PLAN item 18, phase 1; owner, 26 Oct 2026):
 * "Tell Claude…" and Ask the room, until the host clicks the line, or What's
 * next's Combine or Write sends the cursor here (`focusKey`). A send folds it
 * again; words left in it stay, and the line shows them.
 *
 * ITS MORE (simplify PLAN item 18, phase 2): what the host asks Claude for that
 * is not a direction, Research…, Ideas…, Mockups…, Walkthrough (`onRequest`,
 * the Points requests) and Preview the work (`onPreview`), so none of them
 * needs an empty tab or a button of its own on the Now card.
 */
function Composer({ agent, busy, run, api, onCompose, text, setText, fromAskIds = [], focusKey = 0, leadShows = true, onRequest = null, onPreview = null }) {
  const [said, setSaid] = useState('');
  const [open, setOpen] = useState(false);
  const [focusNow, setFocusNow] = useState(0);
  const box = useRef(null);
  // What's next's Combine and Write open it, and send the cursor here, at the end of the words.
  useEffect(() => { if (focusKey) { setOpen(true); setFocusNow((n) => n + 1); } }, [focusKey]);
  useEffect(() => {
    const el = box.current;
    if (!focusNow || !el) return;
    el.focus();
    const end = el.value.length;
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(end, end);
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [focusNow, open]);
  const [logKind, setLogKind] = useState('verbal');
  const [alsoTell, setAlsoTell] = useState(false);
  const [hide, setHide] = useState(false);
  const mirror = useMirror();
  const words = text.trim();
  const done = (line) => { setText(''); setSaid(line); setOpen(false); };
  const tellAs = async (as) => {
    if (!words) return;
    const ok = await run(() => api.postDirection(words, as, { askIds: fromAskIds }, { hideFromRoom: hide }));
    if (ok !== undefined) { mirror.done(); done(`Sent${as && as !== 'do-now' ? ` as ${claudeKindLabel(as)}` : ''}: ${words}`); }
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
    if (ok !== undefined) done(`${W.savedLater}.`);
  };
  const log = async () => {
    if (!words) return;
    const tells = logKind !== 'note' && alsoTell;
    const ok = await run(() => api.postLog({ kind: logKind, text: words, forAgent: tells, ...(tells && hide ? { hideFromRoom: true } : {}) }));
    if (ok !== undefined) { mirror.done(); setAlsoTell(false); done('Logged.'); }
  };
  if (!open) {
    const kept = words.length > 60 ? `${words.slice(0, 60).trimEnd()}…` : words;
    return (
      <section className="brm-composer brm-composer--line" aria-label={W.tellClaudeHead} data-capability="composer">
        <div className="brm-composeline">
          <button type="button" className="brm-composeline-box" onClick={() => { setOpen(true); setFocusNow((n) => n + 1); }}>{kept || W.tellClaudeLine}</button>
          <button type="button" className="brm-btn brm-btn--sm" onClick={() => onCompose('suggest')}>{W.askRoom}</button>
        </div>
        {said && <p className="brm-hint" role="status">{said}</p>}
      </section>
    );
  }
  return (
    <section className="brm-panel brm-composer" aria-labelledby="brm-compose-h" data-capability="composer">
      <div className="brm-row brm-gap">
        <h2 className="brm-h5" id="brm-compose-h">{W.tellClaudeHead}</h2>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={() => setOpen(false)}>{W.composeClose}</button>
      </div>
      <form onSubmit={tell}>
        <label className="brm-sr" htmlFor="brm-compose">Tell Claude, or log what the room said</label>
        <textarea
          ref={box}
          id="brm-compose"
          className="brm-input brm-ta brm-ta--sm"
          placeholder={W.logPlaceholder}
          value={text}
          maxLength={2000}
          onChange={(e) => { setText(e.target.value); setSaid(''); mirror.draft(e.target.value); }}
        />
        <p className="brm-hint">{deliveryLine(agent)}</p>
        <SendExtras hide={hide} setHide={setHide} disabled={busy} />
        <div className="brm-row brm-gap">
          {/* The one orange button is the step's or What's next's lead; Send is outline while one shows. */}
          <SendToClaude onSend={tellAs} busy={busy} disabled={!words} primary={!leadShows} submit />
          {/* The way into Later while the list is empty and not drawn (simplify PLAN item 18). */}
          <button type="button" className="brm-btn" data-capability="later" disabled={busy || !words} title="Keep it on your Later list" onClick={queue}>{W.saveLater}</button>
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
          <span className="brm-label">{W.askRoom}</span>
          <button type="button" className="brm-btn brm-btn--sm" title="Everyone suggests, then votes" onClick={() => onCompose('suggest')}>Ideas</button>
          <button type="button" className="brm-btn brm-btn--sm" title="A, B or C" onClick={() => onCompose('choice')}>Choose</button>
          <button type="button" className="brm-btn brm-btn--sm" title="A 1 to 5 pulse" onClick={() => onCompose('rating')}>Rate</button>
          {(onRequest || onPreview) && (
            <span className="brm-push" data-capability="points">
              <SessionMenu label={W.composeMore} groupLabel={W.composeMoreHead} focusFirst>
                {(close) => (
                  <>
                    <span className="brm-more-k">{W.composeMoreHead}</span>
                    {onRequest && (
                      <>
                        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" title={W.researchTip} onClick={() => { close(); onRequest('research'); }}>{W.research}</button>
                        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" title={W.ideasTip} onClick={() => { close(); onRequest('ideas'); }}>{W.ideasAsk}</button>
                        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" title={W.mockupsTip} onClick={() => { close(); onRequest('mockups'); }}>{W.mockupsAsk}</button>
                        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" title={W.walkthroughTip} onClick={() => { close(); onRequest('walkthrough'); }}>{W.walkthroughAsk}</button>
                      </>
                    )}
                    {onPreview && (
                      <button
                        type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} title={W.tipPreview}
                        onClick={async () => { close(); const ok = await onPreview(); if (ok !== undefined) setSaid(W.askedPreview); }}
                      >
                        Preview the work
                      </button>
                    )}
                  </>
                )}
              </SessionMenu>
            </span>
          )}
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
                <ItemMark itemKey={itemKeys.ask(a.askId)} />
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

// ── The queue (host only, step 4) ───────────────────────────────────────────

/** What happened to a handled idea, in the host's words. */
const HANDLED = { promoted: 'used', acknowledged: 'acknowledged', dismissed: 'dismissed' };

/** Points in use: Claude has posted one, or a request for some is out. */
const pointsInUse = (room) => Boolean(room.points && (((room.points.items || []).length > 0) || ((room.points.requests || []).length > 0)));

/** The ask the room is answering now, or null. */
const openAskOf = (room) => (room.asks || []).find((a) => a.askId === room.currentAskId && ['live', 'voting'].includes(a.status)) || null;

/** "Dee · idea", "You · queued", "Sam · on the preview". */
function ideaWho(idea) {
  if (idea.source === 'host') return 'You · queued';
  // Made from something the room gave (Consider's Queue for the room): the room's, with no name.
  if (!idea.playerName) return 'From the room · idea';
  return `${idea.playerName} · ${idea.aboutLogId ? 'on the preview' : 'idea'}`;
}

/**
 * THE QUEUE (step 4, C1–C3b): everything waiting on the host in one list,
 * Claude's asks first, then oldest first. Filters by who it came from; tick
 * ideas to act on several at once, or put them to a vote.
 */
function Queue({ startFilter = 'all', room, current, busy, ended, run, api, laterTicked = [], setLaterTicked = () => {}, onVoteLater = () => {}, onAskRoom = () => {}, pointTicked = [], setPointTicked = () => {}, leadsRow = false, askOpen = false, openPoints = 0, onRequest = () => {}, onVotePoints = () => undefined, withLater = true, pointsAsked = false }) {
  const [chosenFilter, setFilter] = useState(startFilter);
  const [ticked, setTicked] = useState([]);
  const [voteOf, setVoteOf] = useState(null);
  // Don't show the room, for every Send to Claude in the queue: one box over the list, unticked by default.
  const [hide, setHide] = useState(false);
  const items = queueItems(room);
  // FILTERS ONLY WHEN THEY SORT SOMETHING (simplify PLAN item 18, phase 1): a source
  // with nothing waiting has no chip, and one source alone has no chips at all.
  const sources = QUEUE_FILTERS.filter((f) => f.key !== 'all' && filterQueue(items, f.key).length > 0);
  const filters = sources.length >= 2 ? QUEUE_FILTERS.filter((f) => f.key === 'all' || sources.includes(f)) : [];
  const filter = filters.some((f) => f.key === chosenFilter) ? chosenFilter : 'all';
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
  const hidden = (action, extra) => (action === 'direct' && hide ? { ...(extra || {}), hideFromRoom: true } : extra);
  const act = (idea, action, extra) => run(() => api.ideaAction(idea.ideaId, action, hidden(action, extra)));
  const bulk = async (action) => {
    const ids = tickedLive;
    const ok = await run(async () => { for (const id of ids) await api.ideaAction(id, action, hidden(action, {})); return true; });
    if (ok !== undefined) setTicked([]);
  };
  const toVote = (ids) => setVoteOf(ids.map((id) => ideas.find((i) => i.ideaId === id)).filter(Boolean));

  return (
    <section className="brm-queue" aria-label="The queue">
      {filters.length > 0 && (
        <div className="brm-qfilters" role="group" aria-label="Show">
          {filters.map((f) => (
            <button key={f.key} type="button" className={`brm-qchip${filter === f.key ? ' is-on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}{f.key !== 'all' ? ` · ${count(f.key)}` : ''}
            </button>
          ))}
          <span className="brm-hint brm-push">Claude first, then oldest</span>
        </div>
      )}
      {!ended && items.some((x) => x.type === 'idea') && <HideFromRoom checked={hide} onChange={setHide} disabled={busy} />}

      {!ended && tickedLive.length > 0 && (
        <div className="brm-qbulk" role="group" aria-label="Ticked ideas">
          <b>{tickedLive.length} ticked</b>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy || tickedLive.length < 2 || tickedLive.length > 6} title={tickedLive.length < 2 ? 'Tick at least 2' : tickedLive.length > 6 ? 'A vote takes at most 6' : undefined} onClick={() => toVote(tickedLive)}>
            Put {tickedLive.length} to a vote
          </button>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => bulk('direct')}><Icon name="PaperPlaneTilt" size={14} /> {W.sendPlain}</button>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title={W.tipSavedLater} onClick={() => bulk('later')}>{W.saveLater}</button>
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => bulk('acknowledge')}>Acknowledge</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-push" onClick={() => setTicked([])}>Clear</button>
        </div>
      )}

      {/* A burst of reactions after Claude shows something: clear them in one go. */}
      {!ended && freshRoom.length >= 2 && !tickedLive.length && (
        <div className="brm-row brm-gap brm-ackall">
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" disabled={busy} title={W.tipMarkAll} onClick={() => run(() => api.acknowledgeAll())}>
            Acknowledge all {freshRoom.length}
          </button>
        </div>
      )}

      {/* THE RELEASE GATE (§2c): Claude's posts, all at once. */}
      <ReleaseAll posts={heldPosts(room)} busy={busy} ended={ended} run={run} api={api} />

      {!items.length && <p className="brm-quiet">{W.waitingEmpty}</p>}
      {items.length > 0 && !shown.length && <p className="brm-hint">Nothing from {QUEUE_FILTERS.find((f) => f.key === filter).label.toLowerCase()} right now.</p>}

      {shown.map((x) => (x.type === 'ask' ? (
        <ReviewCard key={`${x.ask.askId}:${x.ask.status}`} ask={x.ask} openAsk={openAsk} busy={busy} ended={ended} run={run} api={api} connected={connected} />
      ) : x.type === 'post' ? (
        <QueuePost key={x.id} entry={x.entry} busy={busy} ended={ended} run={run} api={api} />
      ) : (
        <QueueIdea
          key={x.idea.ideaId} idea={x.idea} busy={busy} ended={ended}
          ticked={tickedLive.includes(x.idea.ideaId)} onTick={() => toggle(x.idea.ideaId)}
          onAct={(action, extra) => act(x.idea, action, extra)}
          canSuggest={canSuggest}
          onVote={() => toVote(tickedLive.includes(x.idea.ideaId) ? tickedLive : [...tickedLive, x.idea.ideaId])}
          voteCount={tickedLive.includes(x.idea.ideaId) ? tickedLive.length : tickedLive.length + 1}
          onAskIdeas={(idea) => onAskRoom(W.askIdeasPrompt(latestWords(idea)))}
          onMockups={(idea) => onRequest('mockups', { subject: latestWords(idea), ideaId: idea.ideaId })}
          run={run} api={api}
        />
      )))}

      {/* On two screens Later and Points have their own rail slot (B8): `withLater` false.
          The slot is drawn once it has something: Later with its first saved item, Points when
          Claude posts one or a request is out, or when the host asks for points (What's next's
          Ask Claude for points, `pointsAsked`). Before, in the opening and while building alike
          (simplify PLAN item 18, phases 1 and 2), Save for later and Ask Claude for points are
          the ways in. */}
      {withLater && (laterItems(room).length > 0 || pointsInUse(room) || pointsAsked || openPoints > 0) && (
        <BuildLaterPoints
          room={room} ended={ended} busy={busy} run={run} api={api}
          laterTicked={laterTicked} setLaterTicked={setLaterTicked} onVoteLater={onVoteLater} onAskRoom={onAskRoom}
          pointTicked={pointTicked} setPointTicked={setPointTicked} leadsRow={leadsRow} askOpen={askOpen} openPoints={openPoints} onRequest={onRequest} onVotePoints={onVotePoints}
          asked={pointsAsked}
        />
      )}

      {handled.length > 0 && (
        <details className="brm-handled">
          <summary>{handled.length} handled</summary>
          {handled.map((idea) => (
            <div className="brm-idea brm-idea--done" key={idea.ideaId}>
              <div className="brm-idea-text">{idea.text}</div>
              <ItemMark itemKey={itemKeys.idea(idea.ideaId)} />
              <div className="brm-who">{ideaWho(idea)} · {idea.walled ? 'on the wall' : idea.promotedTo ? `in ask ${askNumber(idea.promotedTo)}` : HANDLED[idea.status] || idea.status}</div>
              {!ended && ['dismissed', 'acknowledged'].includes(idea.status) && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--link" disabled={busy} onClick={() => act(idea, 'restore')}>Restore</button>
              )}
              <IdeaThread idea={idea} busy={busy} ended={ended} run={run} api={api} />
            </div>
          ))}
        </details>
      )}

      {voteOf && (
        <VoteFromIdeasDialog
          ideas={voteOf} connected={connected} openAsk={openAsk} busy={busy} run={run} api={api}
          more={items.filter((x) => x.type === 'idea' && !voteOf.some((v) => v.ideaId === x.idea.ideaId)).map((x) => x.idea)}
          onClose={() => setVoteOf(null)}
          onDone={() => { setVoteOf(null); setTicked([]); }}
        />
      )}
    </section>
  );
}

/**
 * One idea in the queue (C1): tick it, or send it where it belongs.
 *
 * THREE ROUTES ON THE CARD (simplify PLAN item 18, second half; owner, 26 Oct
 * 2026: "go to phase 2"): Send to Claude and Ask the room; the idea's words
 * open Consider; Consider…, Send to Claude as, Save for later, Acknowledge,
 * Reply and Dismiss under More. Every item keeps the same routes (owner,
 * 5 Oct); the card shows three of them. The words are a click target, as a
 * Decided row is; More's Consider… is the keyboard's way to the same panel.
 */
function QueueIdea({ idea, busy, ended, ticked, onTick, onAct, canSuggest, onVote, voteCount, onAskIdeas = () => {}, onMockups = null, run, api }) {
  const c = useContext(ConsiderContext);
  const [replying, setReplying] = useState(false);
  const item = { key: itemKeys.idea(idea.ideaId), words: idea.text, type: 'idea', ideaId: idea.ideaId };
  const consider = !ended && c && !c.ended ? () => c.open(item) : null;
  const canReply = idea.source !== 'host' && Boolean(idea.playerName);
  return (
    <div className={`brm-idea brm-qidea${ticked ? ' is-ticked' : ''}`}>
      <div className="brm-row brm-gap">
        {!ended && (
          <input type="checkbox" className="brm-qtick" checked={ticked} onChange={onTick} aria-label={`Tick: ${idea.text}`} />
        )}
        <span className="brm-who">{ideaWho(idea)} · {clockTime(idea.createdAt)}</span>
        {/* The mark once it is queued or sent (Consider, frames 2-3); Consider itself is the words. */}
        <span className="brm-push"><ItemTools item={item} consider={false} /></span>
      </div>
      <div className={`brm-idea-text${consider ? ' is-door' : ''}`} title={consider ? W.ideaWordsTip : undefined} onClick={consider || undefined}>{idea.text}</div>
      {!ended && (
        <div className="brm-idea-acts">
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} title="Do now: the next thing Claude builds" onClick={() => onAct('direct', {})}>
            <Icon name="PaperPlaneTilt" size={14} /> {W.sendPlain}
          </button>
          <SessionMenu label={W.askRoom} groupLabel={W.askRoom}>
            {(close) => (
              <>
                {/* NOTHING GREYED OUT (owner, 18 Oct): a vote opens from one idea and adds others in its dialog;
                    with no Ideas ask open, the card offers to open one about it instead. */}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy || voteCount > 6} onClick={() => { close(); onVote(); }}>
                  {voteCount < 2 ? W.putToAVoteMore : `Put ${voteCount} ideas to a vote`}
                </button>
                {canSuggest ? (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => { close(); onAct('suggest'); }}>Add to the open Ideas ask</button>
                ) : (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => { close(); onAskIdeas(idea); }}>{W.askIdeasAbout}</button>
                )}
                {/* WALL (owner, 2026-10-05): on the Stage for 20 seconds, no name. */}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} title={W.tipWall} onClick={() => { close(); onAct('wall'); }}>Show on the wall</button>
                {/* ASK CLAUDE (ideas flow E, I7): 2 or 3 ways to do it, back to the host first. */}
                {onMockups && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} title={W.mockupsTip} onClick={() => { close(); onMockups(idea); }}>{W.mockupsOfThis}</button>}
              </>
            )}
          </SessionMenu>
          <SessionMenu label={W.ideaMore} groupLabel={W.ideaMore} ariaLabel={W.ideaMoreLabel(idea.text)} focusFirst>
            {(close) => (
              <>
                {consider && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => { close(); consider(); }}>{W.considerItem}</button>}
                {/* SEND TO CLAUDE AS (step 7c, C14): the kinds, each saying what Claude does with it. */}
                <div className="brm-more-grp" role="group" aria-label={W.sendAsHead}>
                  <span className="brm-more-k" aria-hidden="true">{W.sendAsHead}</span>
                  {HOST_KINDS.map((k) => (
                    <button key={k.key} type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-kindopt" disabled={busy} onClick={() => { close(); onAct('direct', asField(k.key)); }}>
                      <b>{k.label}</b><span>{k.hint}</span>
                    </button>
                  ))}
                </div>
                {/* SAVE FOR LATER (owner, 2026-10-08): the host's "not now", onto the one Later list. Nothing goes to Claude. */}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} title={W.tipSavedLater} onClick={() => { close(); onAct('later'); }}>{W.saveLater}</button>
                {/* ACKNOWLEDGE (owner, 2026-10-05): heard, not a job for Claude. */}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} title={W.tipSeen} onClick={() => { close(); onAct('acknowledge'); }}>Acknowledge</button>
                {canReply && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => { close(); setReplying(true); }}>{W.replyTo(idea.playerName)}</button>}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => { close(); onAct('dismiss'); }}>Dismiss</button>
              </>
            )}
          </SessionMenu>
        </div>
      )}
      {run && api && <IdeaThread idea={idea} busy={busy} ended={ended} run={run} api={api} open={replying} setOpen={setReplying} doorOnCard={false} />}
    </div>
  );
}

/** The sender's newest words on an idea: their last private answer, else the idea (ideas flow B, I2-I3). */
export function latestWords(idea) {
  const answers = ((idea && idea.thread) || []).filter((m) => m.by === 'player');
  return answers.length ? answers[answers.length - 1].text : (idea && idea.text) || '';
}

/**
 * REPLY TO JOE (ideas flow B; docs/design/build-room-ideas I2; owner, 18 Oct:
 * "private with Joe able to answer"). Only the host and the person who sent
 * the idea see this: not the room, not the Stage, not Claude. Joe answers from
 * his phone once the host has written. An idea the host typed, or one made
 * from a vote's option, has no one to reply to, so no button.
 */
/*
 * `open`/`setOpen` let the card hold it (Reply to Joe is under the card's More, simplify
 * PLAN item 18); `doorOnCard` false leaves the door off until there is a thread to open.
 */
function IdeaThread({ idea, busy, ended, run, api, open: heldOpen, setOpen: setHeldOpen, doorOnCard = true }) {
  const thread = idea.thread || [];
  const [ownOpen, setOwnOpen] = useState(false);
  const held = typeof setHeldOpen === 'function';
  const open = held ? Boolean(heldOpen) : ownOpen;
  const setOpen = held ? setHeldOpen : setOwnOpen;
  const [draft, setDraft] = useState('');
  if (idea.source === 'host' || !idea.playerName) return null;
  const name = idea.playerName;
  const answered = thread.length > 0 && thread[thread.length - 1].by === 'player';
  const full = thread.length >= THREAD_MAX;
  const send = async (text) => {
    const words = text.trim();
    if (!words) return;
    const out = await run(() => api.ideaAction(idea.ideaId, 'reply', { text: words }));
    if (out !== undefined) setDraft('');
  };
  if (!open) {
    if (ended && !thread.length) return null;
    if (!doorOnCard && !thread.length) return null;
    return (
      <div className="brm-row brm-gap brm-thread-door">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={() => setOpen(true)}>
          {thread.length ? W.threadOpen(name, thread.length) : W.replyTo(name)}
        </button>
        {answered && <span className="brm-thread-new" data-testid="brm-thread-new">{W.threadAnswered(name)}</span>}
      </div>
    );
  }
  return (
    <section className="brm-thread" aria-label={W.threadLabel(name)}>
      <div className="brm-row brm-gap">
        <b className="brm-lbl">{W.threadOnly(name)}</b>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-push" onClick={() => setOpen(false)}>{W.threadHide}</button>
      </div>
      <ol className="brm-thread-list">
        <li className="brm-thread-msg brm-thread-msg--player"><span className="brm-who">{name} · {clockTime(idea.createdAt)}</span> {idea.text}</li>
        {thread.map((m, i) => (
          <li key={`${m.at}-${i}`} className={`brm-thread-msg brm-thread-msg--${m.by}`}>
            <span className="brm-who">{m.by === 'host' ? 'You' : name} · {clockTime(m.at)}</span> {m.text}
          </li>
        ))}
      </ol>
      {!ended && !full && (
        <>
          <textarea
            className="brm-input brm-thread-input" rows={2} maxLength={280} value={draft}
            aria-label={W.replyTo(name)} placeholder={`${W.replyTo(name)}\u2026`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(draft); } }}
          />
          <div className="brm-row brm-gap">
            {!thread.length && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => send(W.gotItThanks)}>{W.gotItThanks}</button>}
            <button type="button" className="brm-btn brm-btn--sm brm-btn--primary brm-push" disabled={busy || !draft.trim()} onClick={() => send(draft)}>{W.threadSend}</button>
          </div>
        </>
      )}
      {full && <p className="brm-hint">{W.threadFull}</p>}
    </section>
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

export function VoteFromIdeasDialog({ ideas: chosen, more = [], picks: startPicks = 1, connected, openAsk, busy, run, api, onClose, onDone }) {
  const [prompt, setPrompt] = useState('Which should Claude build next?');
  // NO TICKING FIRST (owner, 18 Oct: the vote was "greyed out"): the dialog
  // opens from one idea and the others in the queue are added here.
  const [added, setAdded] = useState([]);
  const ideas = [...chosen, ...more.filter((i) => added.includes(i.ideaId))].slice(0, 6);
  // The picks offered are 1, then 2 with three options, 3 with four or more.
  const [wantPicks, setMaxPicks] = useState(() => Math.max(1, Math.min(startPicks, chosen.length > 3 ? 3 : chosen.length > 2 ? 2 : 1)));
  const maxPicks = Math.min(wantPicks, ideas.length > 3 ? 3 : ideas.length > 2 ? 2 : 1);
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
      <DialogHead id="brm-vote-title" title={n < 2 ? W.putToAVote : ideas.some((i) => i.laterId) ? W.putToVote(n) : `Put ${n} ideas to a vote`} onClose={onClose} />
      <label className="brm-field"><span className="brm-lbl">Question for the room</span><input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
      <div className="brm-field">
        <span className="brm-lbl">How people vote</span>
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
      {more.length > 0 && (
        <fieldset className="brm-field brm-voteadd">
          <legend className="brm-lbl">{W.voteAddFromQueue}</legend>
          {more.map((i) => (
            <label key={i.ideaId} className="brm-check">
              <input type="checkbox" checked={added.includes(i.ideaId)} disabled={!added.includes(i.ideaId) && ideas.length >= 6} onChange={() => setAdded((l) => (l.includes(i.ideaId) ? l.filter((x) => x !== i.ideaId) : [...l, i.ideaId]))} />
              <span>{i.text} <span className="brm-who">{i.source === 'host' ? 'You' : (i.playerName || 'From the room')}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {n < 2 && <p className="brm-hint" role="status">{more.length ? W.voteNeedsTwo : W.voteNeedsTwoNoMore}</p>}
      <p className="brm-hint">{W.noNames}</p>
      <label className="brm-check brm-field">
        <input type="checkbox" checked={mockups} disabled={!connected && !mockups} onChange={(e) => setMockups(e.target.checked)} />
        {W.askMockupsFirst}
      </label>
      {mockups && (
        <div className="brm-notice brm-unheard">{W.hiddenUntilMockups}</div>
      )}
      {!connected && <p className="brm-hint">{W.offlineNoMockups}</p>}
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Cancel</button>
        {!mockups && <button type="button" className="brm-btn brm-btn--ghost brm-push" disabled={busy || !prompt.trim() || n < 2} onClick={() => send({ open: false })}>{W.saveDraft}</button>}
        {mockups ? (
          <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !prompt.trim() || n < 2} onClick={() => send({ askForMockups: true })}>Ask Claude for {n} mockups</button>
        ) : (
          <button type="button" className="brm-btn brm-btn--primary" disabled={busy || !prompt.trim() || n < 2} onClick={() => send({ open: true })}>
            {openAsk ? `Close ask ${askNumber(openAsk.askId)} and open the vote` : W.openVoting}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

// `help`: a screen id (config/help/screens.js); its `?` sits beside the X.
function DialogHead({ id, title, onClose, help = '' }) {
  return (
    <div className="brm-dh">
      <h2 className="brm-h" id={id}>{title}</h2>
      {help ? <HelpButton {...helpFor(help)} variant="inline" size="small" tooltip={`Help: ${title}`} className="help-button-quiet brm-dh-help" /> : null}
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

/** "Connected now" (W2): the plugin checked in within this long. It reports every 4-15 s while connected. */
// The server keeps at most this many messages on one idea's private thread (build-store IDEA_THREAD_MAX).
const THREAD_MAX = 20;
export const CONNECTED_NOW_MS = 30 * 1000;

/**
 * WHICH CONNECT WINDOW (docs/design/build-room-connect-resume, owner 18 Oct:
 * "we cant assume they have claude cli running ... think through full
 * scenarios"). Every case is one paste that opens Claude Code in the right
 * folder on kickoff:
 *   'first'  W1  Claude has never called in: install, mint, start command
 *   'now'    W2  the plugin checked in within 30 s: nothing to do
 *   'back'   W3  worked here, quiet now: cd into the folder and kick off
 *   'update' W4  as W3, with the plugin update in front (connected or not)
 *   'all'    W5  the host asked for every step (another laptop, folder gone)
 */
export function connectCase(room, now, { showAll = false } = {}) {
  const agent = (room && room.agent) || {};
  const everConnected = Boolean(agent.lastSeenAt);
  if (!everConnected) return 'first';
  if (showAll) return 'all';
  // Out of date wins even while connected: the update is the one thing to do.
  if (room.plugin && room.plugin.outdated) return 'update';
  const heard = Math.max(Date.parse(agent.lastSeenAt || '') || 0, Date.parse((room.lan && room.lan.reportedAt) || '') || 0);
  return heard && new Date(now).getTime() - heard < CONNECTED_NOW_MS ? 'now' : 'back';
}

/** The plugin line: what runs and whether it is the latest. */
function PluginVersionLine({ plugin }) {
  const p = plugin || {};
  const latest = p.latest || '';
  if (p.outdated && latest) {
    return (
      <p className="brm-ver" data-testid="brm-ver">
        {p.running ? (
          <>
            <span><span className="brm-ver-k">{W.pluginRunning}</span> <b className="brm-ver-old">{p.running}</b></span>
            <span className="brm-ver-k" aria-hidden="true">·</span>
            <span><span className="brm-ver-k">{W.pluginLatest}</span> <b>{latest}</b></span>
          </>
        ) : (
          <span><span className="brm-ver-k">{W.pluginRunning}</span> <b className="brm-ver-old">{W.pluginOlder(latest)}</b></span>
        )}
      </p>
    );
  }
  if (p.running) {
    return (
      <p className="brm-ver" data-testid="brm-ver">
        <span><span className="brm-ver-k">{W.pluginRunning}</span> <b>{p.running}</b></span>
        <span className="brm-ver-ok">{W.pluginCurrent}</span>
      </p>
    );
  }
  return latest ? (
    <p className="brm-ver" data-testid="brm-ver">
      <span><span className="brm-ver-k">{W.pluginLatest}</span> <b>{latest}</b></span>
      <span className="brm-ver-k">{W.pluginUnknown}</span>
    </p>
  ) : null;
}

/** W3 and W4's one step: the paste that brings Claude Code back in its folder. */
function ReturnStep({ room, folder, update, install }) {
  const cmd = update ? `${install} \\\n  && ${resumeCommand(folder)}` : resumeCommand(folder);
  const kick = pluginCommand('kickoff');
  const guess = `~/build-room/${projectSlug(room.title)}`;
  return (
    <ol className="brm-steps brm-steps--connect">
      <li className={update ? 'is-old' : 'is-wait'} data-step="return">
        <span className="brm-n">1</span>
        <div className="brm-step-body">
          <span className="brm-step-title">{update ? W.pasteUpdateReturn : W.pasteToReturn}</span>
          <pre className="brm-cmd" data-testid="brm-return">{cmd}</pre>
          <div className="brm-row brm-gap">
            <CopyButton text={cmd} label="Copy" className="brm-btn brm-btn--sm brm-btn--primary" />
            <span className="brm-hint">{update ? W.closeFirst : (shellFolder(folder) ? W.reopens : W.reopensNoFolder(guess))}</span>
          </div>
          {!update && <p className="brm-hint">{W.typeInsteadKick(kick)}</p>}
        </div>
      </li>
    </ol>
  );
}

export function ConnectPanel({ room, gameId, api, run, busy, onClose, atInstall = false }) {
  // THE KEY IS SHOWN ONCE: it lives in this component's state only, and is
  // gone when the panel closes. The server stores only its sha256.
  const [minted, setMinted] = useState(null);
  const [copied, setCopied] = useState('');
  const [confirmMint, setConfirmMint] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // The window changes by itself when Claude Code goes quiet (W2 → W3) or calls in.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const which = minted && Boolean((room.agent || {}).lastSeenAt) ? 'all' : connectCase(room, now, { showAll });
  // Opened from "Claude's plugin is out of date. Update": the cursor starts at the update.
  const top = useRef(null);
  useEffect(() => {
    if (!atInstall || !top.current) return;
    const btn = top.current.querySelector('[data-step] button, [data-step] summary');
    if (btn) btn.focus();
    if (top.current.scrollIntoView) top.current.scrollIntoView({ block: 'nearest' });
  }, [atInstall]);
  const agent = room.agent || {};
  const liveKey = agent.key;
  const connected = Boolean(agent.lastSeenAt);
  const crew = Boolean(room.crew && room.crew.enabled);
  const command = minted ? connectCommand({ origin: window.location.origin, api: apiBase(), key: minted.key }) : '';
  const install = pluginInstallCommand({ origin: window.location.origin, api: apiBase() });
  const plugin = room.plugin || {};
  const ver = plugin.outdated && plugin.latest ? 'old' : plugin.running && !plugin.outdated ? 'ok' : 'unknown';
  const reported = agent.folder || '';
  const installBody = (
    <>
      <pre className="brm-cmd" data-testid="brm-install">{install}</pre>
      <div className="brm-row brm-gap">
        <CopyButton text={install} label="Copy" className={`brm-btn brm-btn--sm${ver === 'old' ? ' brm-btn--primary' : ''}`} />
        <span className="brm-hint">{ver === 'old' ? W.pluginRerun : W.installNote}</span>
      </div>
      {ver !== 'old' && <p className="brm-hint">{W.macAllow}<InfoTip text={W.tipMacAllow} label="Why?" /></p>}
    </>
  );
  // THE START CAP (owner, 2026-10-06): a new folder named for the project,
  // ~/build-room/<name>; the host may rename it before copying.
  const [folder, setFolder] = useState(() => projectSlug(room.title));
  const folderName = cleanFolder(folder) || projectSlug(room.title);
  const startLine = minted ? startCommand(folderName, minted.key) : '';
  const kickWithKey = minted ? `${pluginCommand('kickoff')} ${minted.key}` : '';
  const shareRepo = pluginCommand('share-repo');

  // Mint, then copy the start command in the same click. A browser may refuse
  // the copy once the click is a network round-trip old; the command is shown
  // either way, with its own Copy button.
  const mint = async () => {
    setConfirmMint(false);
    const out = await run(() => api.mintKey('Claude Code'));
    if (!out || !out.key) return;
    setMinted({ key: out.key, keyId: out.keyId, at: Date.now() });
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
  // STEP 3 IS DONE when Claude Code has called in with the key minted here:
  // the room's live key is that key and it has been used. Without this the
  // step stayed open after the phones already said Claude was connected.
  const usedMinted = Boolean(minted && liveKey && liveKey.keyId === minted.keyId && liveKey.lastUsedAt);
  const kickedOff = usedMinted && Boolean(agent.kickedOffAt) && Date.parse(agent.kickedOffAt) >= minted.at - 60 * 1000;
  const waitingLong = Boolean(minted) && !usedMinted && now - minted.at > 45 * 1000;
  const mintLabel = liveKey ? 'Mint a new key and copy the command' : 'Mint a key and copy the command';
  const lastAt = agent.lastSeenAt ? clockTime(agent.lastSeenAt) : '';
  const showAllRow = (
    <p className="brm-hint brm-otherlaptop">
      {W.otherLaptop}{' '}
      <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={() => setShowAll(true)}>{W.showAllSteps}</button>
    </p>
  );

  // W1 and W5: the whole path, three steps (kickoff takes the key, so there is no fourth).
  const allSteps = (
    <ol className="brm-steps brm-steps--connect">
      <li className={ver === 'old' ? 'is-old' : step(usedMinted || (connected && which !== 'all'), false)} data-step="install">
        <span className="brm-n">1</span>
        <div className="brm-step-body">
          <span className="brm-step-title">{ver === 'old' ? W.pluginUpdateTitle : W.pluginCheckTitle}</span>
          <PluginVersionLine plugin={plugin} />
          {ver === 'ok' ? (
            <details className="brm-verfold">
              <summary>{W.installElsewhere}</summary>
              {installBody}
            </details>
          ) : installBody}
        </div>
      </li>

      <li className={step(Boolean(minted), !minted)}>
        <span className="brm-n">2</span>
        <div className="brm-step-body">
          <span className="brm-step-title">Mint a key and copy the start command</span>
          <label className="brm-field">
            <span className="brm-lbl">Project folder</span>
            <span className="brm-row brm-gap">
              <span className="brm-mono">~/build-room/</span>
              <input className="brm-input brm-input--sm" aria-label="Project folder" value={folder} maxLength={60} onChange={(e) => setFolder(e.target.value)} />
            </span>
            <span className="brm-hint">{W.newFolder}</span>
          </label>
          {minted ? (
            <>
              <div className="brm-keywarn"><Icon name="Lock" size={16} color="var(--accent-text)" />
                <div><b>{W.shownOnce}</b> {W.lostIt}</div>
              </div>
              <pre className="brm-cmd" data-testid="brm-start">{startLine}</pre>
              <div className="brm-row brm-gap">
                <CopyButton text={startLine} label="Copy again" />
                <span className="brm-hint" role="status">{copied} Key …{minted.key.slice(-4)}, minted just now.</span>
              </div>
            </>
          ) : liveKey ? (
            <p className="brm-hint brm-block">
              {W.keyMinted(clockTime(liveKey.createdAt), liveKey.lastUsedAt ? clockTime(liveKey.lastUsedAt) : '')}
            </p>
          ) : null}
          <div className="brm-row brm-gap">
            {confirmMint ? (
              <>
                <span className="brm-hint">{W.oldKeyStops}</span>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirmMint(false)}>Keep it</button>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={mint}>{mintLabel}</button>
              </>
            ) : !minted && (
              // One orange: the update's Copy when the plugin is out of date, otherwise Mint.
              <button type="button" className={`brm-btn brm-btn--sm${ver === 'old' ? '' : ' brm-btn--primary'}`} disabled={busy} onClick={() => (liveKey ? setConfirmMint(true) : mint())}>
                {mintLabel}
              </button>
            )}
            {liveKey && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger brm-push" disabled={busy} onClick={revoke}>Revoke key</button>}
          </div>
        </div>
      </li>

      <li className={step(usedMinted, Boolean(minted) && !usedMinted)} data-step="started">
        <span className="brm-n">3</span>
        <div className="brm-step-body">
          {usedMinted ? (
            <>
              <span className="brm-step-title">{W.connectedTitle}</span>
              <p className="brm-hint" role="status" data-testid="brm-connected">
                {W.connectedAt(clockTime(liveKey.lastUsedAt), reported)} {kickedOff ? W.connectedKicked : W.connectedKicking}
              </p>
            </>
          ) : (
            <>
              <span className="brm-step-title">Paste it into a terminal</span>
              <span className="brm-hint">{W.startOpens}</span>
              {minted && (
                <>
                  <p className="brm-hint">{W.alreadyOpenKick}</p>
                  <pre className="brm-cmd" data-testid="brm-connect">{kickWithKey}</pre>
                  <div className="brm-row brm-gap"><CopyButton text={kickWithKey} label="Copy" /></div>
                  <p className="brm-hint brm-connwait" data-testid="brm-connect-waiting">
                    <span className="brm-connback-dot" aria-hidden="true" /> {W.connectWaiting}
                  </p>
                  {waitingLong && <p className="brm-hint" data-testid="brm-connect-slow">{W.connectSlow}</p>}
                </>
              )}
            </>
          )}
        </div>
      </li>

      {crew && (
        <li className={step(false, false)}>
          <span className="brm-n">4</span>
          <div className="brm-step-body">
            <span className="brm-step-title">Open the project to your crew</span>
            <pre className="brm-cmd" data-testid="brm-share-repo">{shareRepo}</pre>
            <div className="brm-row brm-gap">
              <CopyButton text={shareRepo} label="Copy" />
              <span className="brm-hint">{W.runInClaude}</span>
            </div>
          </div>
        </li>
      )}
    </ol>
  );

  let body;
  if (which === 'now') {
    body = (
      <>
        <div className="brm-connback is-now" data-testid="brm-connect-now">
          <span className="brm-connback-dot" aria-hidden="true" />
          <div><b>{W.connectedNow}</b><span>{W.connectedNowIn(reported)}</span></div>
        </div>
        <PluginVersionLine plugin={plugin} />
        <details className="brm-verfold">
          <summary>{W.restartOrMove}</summary>
          <ReturnStep room={room} folder={reported} update={false} install={install} />
          {showAllRow}
        </details>
      </>
    );
  } else if (which === 'back' || which === 'update') {
    body = (
      <>
        <div className="brm-connback" data-testid="brm-connect-back">
          <span className="brm-connback-dot" aria-hidden="true" />
          <div><b>{W.workedHere(lastAt)}</b><span>{W.inFolderNotNow(reported)}</span></div>
        </div>
        <PluginVersionLine plugin={plugin} />
        <ReturnStep room={room} folder={reported} update={which === 'update'} install={install} />
        {showAllRow}
      </>
    );
  } else {
    body = (
      <>
        <p className="brm-sub">{W.connectIntro}</p>
        {which === 'all' && showAll && (
          <div className="brm-notice brm-unheard" data-testid="brm-connect-elsewhere">
            <b>{W.filesElsewhereHead}</b> {W.filesElsewhereBody}
            {!minted && <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={() => setShowAll(false)}>{W.backToReturn}</button>}
          </div>
        )}
        {allSteps}
      </>
    );
  }

  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--wide" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-connect-title">
      <DialogHead id="brm-connect-title" title="Connect Claude Code" onClose={onClose} help="build-connect" />
      <div ref={top} className="brm-connect-body" data-connect={which}>{body}</div>

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
          <p className="brm-hint">{W.runThenRestart}</p>
          <pre className="brm-cmd" data-testid="brm-command">{command}</pre>
          <CopyButton text={command} label="Copy command" />
        </details>
      )}

      <p className="brm-hint">Game {gameId}.</p>
      <div className="brm-row"><button type="button" className={`brm-btn brm-push${usedMinted ? ' brm-btn--primary' : ''}`} onClick={onClose}>Done</button></div>
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
      <p className="brm-sub">{o.by === 'agent' ? W.wrapLeadAgent : W.wrapLeadRoom}</p>
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
      <p>{W.endBody}</p>
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

/**
 * ASK CLAUDE FOR QUESTIONS (question-sets plan step 7): a host request of kind
 * `questions`. Claude writes the set as a file in the project and sends it;
 * it lands in this library as From Claude.
 */
function AskClaudeForQuestions({ api, run, busy, buildKind, writing }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState('');
  if (writing) return <p className="brm-hint" role="status">{W.claudeWritingSet}</p>;
  if (!open) {
    return (
      <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy || !run} onClick={() => setOpen(true)}>
        <Icon name="Sparkle" size={14} /> {W.askClaudeForQuestions}
      </button>
    );
  }
  const send = async () => {
    const subject = what.trim() || W.askClaudeDefault(KIND_NAMES[buildKind] || '');
    const out = await run(() => api.pointRequest('questions', subject));
    if (out !== undefined) { setOpen(false); setWhat(''); }
  };
  return (
    <div className="brm-row brm-gap brm-askclaude">
      <input className="brm-input brm-input--sm" aria-label={W.askClaudeWhat} placeholder={W.askClaudeWhat} value={what} maxLength={200} onChange={(e) => setWhat(e.target.value)} />
      <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={send}>{W.askClaudeSend}</button>
      <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function ReadyLibrary({
  api, asks, buildKind = '', selectedKey, onPick, claudeSets = [], requests = [], run = null, busy = false, gameId = '',
}) {
  const [sets, setSets] = useState(null);
  const [active, setActive] = useState('');
  const [loaded, setLoaded] = useState({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  // THE TYPE (owner, 24 Oct): kept as the host moves between sets, unlike the category.
  const [askType, setAskType] = useState('all');
  const setKey = (st) => `${st.scope || ''}:${st.id}`;
  useEffect(() => {
    let live = true;
    Promise.resolve(api && api.questionSets ? api.questionSets() : [])
      .then((list) => {
        if (!live) return;
        const ready = (list || []).filter((st) => isBuildRoomSet(st) && ['call-and-answer', 'poll'].includes(st.engagementType));
        setSets(ready);
        // The sets for the room's kind of build first, then the general ones (question-sets plan step 3).
        const r = rankSetsForKind(ready, buildKind);
        const lead = [...r.first, ...r.general, ...r.other][0];
        if (lead) setActive(setKey(lead));
      })
      .catch(() => { if (live) setSets([]); });
    return () => { live = false; };
  }, [api, buildKind]);
  // Claude's sets: listed first, the newest open unless the host picked another.
  const claudeKey = (cs) => `claude:${cs.setId}`;
  const newestClaude = claudeSets.length ? claudeKey(claudeSets[claudeSets.length - 1]) : '';
  const [picked, setPicked] = useState(false);
  useEffect(() => { if (newestClaude && !picked) setActive(newestClaude); }, [newestClaude, picked]);
  const claudeActive = claudeSets.find((cs) => claudeKey(cs) === active) || null;
  const writing = requests.some((r) => r.kind === 'questions' && ['waiting', 'working'].includes(r.status));
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
          .map((x) => ({ key: `${active}:${x.row.sk}`, category: x.row.category, ask: x.out.ask, type: x.out.type, setName: set.name || 'Ready questions' }));
        setLoaded((l) => ({ ...l, [active]: items }));
      })
      .catch(() => { if (live) setLoaded((l) => ({ ...l, [active]: [] })); });
    return () => { live = false; };
  }, [active, set, loaded, api]);

  const askClaude = <AskClaudeForQuestions api={api} run={run} busy={busy} buildKind={buildKind} writing={writing} />;
  if (sets === null) return <aside className="brm-lib" aria-label="Ready questions"><p className="brm-hint">Loading ready questions…</p></aside>;
  if (!sets.length && !claudeSets.length) {
    return (
      <aside className="brm-lib" aria-label="Ready questions">
        <p className="brm-hint">{W.noReadyQuestions}</p>
        {askClaude}
      </aside>
    );
  }
  const saveClaudeSet = (cs) => run(async () => {
    for (const body of draftsFromClaudeSet(cs, gameId)) await api.draftFromBuild(body);
    return api.claudeSetAction(cs.setId, 'saved');
  });
  const askedIn = askedIndex(asks);
  const source = claudeActive ? claudeSetItems(claudeActive) : loaded[active];
  const items = source ? source.map((it) => ({ ...it, askedIn: askedIn(it.key, it.ask.prompt) })) : null;
  const q = query.trim().toLowerCase();
  const ofType = (items || []).filter((it) => askType === 'all' || typeOfItem(it) === askType);
  const shown = ofType.filter((it) => (category === 'all' || it.category === category) && (!q || it.ask.prompt.toLowerCase().includes(q)));
  const cats = [...new Set(ofType.map((it) => it.category))];
  return (
    <aside className="brm-lib" aria-label="Ready questions">
      <input className="brm-input brm-input--sm" type="search" aria-label="Search ready questions" placeholder="Search ready questions" value={query} onChange={(e) => setQuery(e.target.value)} />
      {askClaude}
      {claudeSets.length > 0 && (
        <div className="brm-qfilters" role="group" aria-label="From Claude">
          {claudeSets.map((cs) => (
            <button key={claudeKey(cs)} type="button" className={`brm-qchip brm-qchip--claude${active === claudeKey(cs) ? ' is-on' : ''}`} aria-pressed={active === claudeKey(cs)} onClick={() => { setPicked(true); setActive(claudeKey(cs)); setCategory('all'); }}>
              {W.fromClaudeChip(cs.name)}
            </button>
          ))}
        </div>
      )}
      {claudeActive && (
        <div className="brm-notice" data-testid="brm-claude-set">
          {claudeActive.savedAt ? W.claudeSetSaved : W.fromClaudeUnsaved}
          {claudeActive.file && <span className="brm-hint brm-block">{W.claudeSetFile(claudeActive.file)}</span>}
          {!claudeActive.savedAt && run && (
            <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => saveClaudeSet(claudeActive)}>{W.saveClaudeSet}</button>
          )}
        </div>
      )}
      {(sets.length > 1 || (sets.length && claudeSets.length)) && (() => {
        // THE KIND OF BUILD (question-sets plan step 3): its sets first, then the general
        // ones; sets for other kinds fold away once the room has said what it is making.
        const r = rankSetsForKind(sets, buildKind);
        const shownSets = buildKind ? [...r.first, ...r.general] : [...r.general, ...r.other];
        const chip = (st) => (
          <button key={setKey(st)} type="button" className={`brm-qchip${active === setKey(st) ? ' is-on' : ''}`} aria-pressed={active === setKey(st)} onClick={() => { setPicked(true); setActive(setKey(st)); setCategory('all'); }}>
            {st.name}
          </button>
        );
        return (
          <>
            {buildKind && r.first.length > 0 && <p className="brm-hint">{W.readyForKind(KIND_NAMES[buildKind] || buildKind)}</p>}
            {shownSets.length > 0 && <div className="brm-qfilters" role="group" aria-label="Ready sets">{shownSets.map(chip)}</div>}
            {buildKind && r.other.length > 0 && (
              <details className="brm-verfold" open={r.other.some((st) => setKey(st) === active)}>
                <summary>{W.otherSets(r.other.length)}</summary>
                <div className="brm-qfilters" role="group" aria-label="Other sets">{r.other.map(chip)}</div>
              </details>
            )}
          </>
        );
      })()}
      {items && items.length > 0 && (
        <div className="brm-qfilters" role="group" aria-label="Types">
          {typeCounts(items).map((t) => (
            <button key={t.type} type="button" className={`brm-qchip${askType === t.type ? ' is-on' : ''}`} aria-pressed={askType === t.type} onClick={() => { setAskType(t.type); setCategory('all'); }}>
              {t.label} <span className="brm-qchip-n">{t.count}</span>
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
                <span className="brm-chip">{ASKED_AS[typeOfItem(it)]}</span>
                <span className="brm-lib-t">
                  {it.ask.prompt}
                  {typeOfItem(it) === 'choice' && <span className="brm-lib-opts">{it.ask.options.map((o) => o.title).join(' · ')}</span>}
                </span>
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

export function AskComposer({
  kind: initialKind, prompt: initialPrompt = '', detail: initialDetail = '', asks = [], buildKind = '', claudeSets = [], requests = [], gameId = '', api, run, busy, onClose,
}) {
  const [kind, setKind] = useState(initialKind);
  // The window opens with the cursor in the question and the starter questions beside it.
  const questionRef = useRef(null);
  useEffect(() => { if (questionRef.current) questionRef.current.focus(); }, []);
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
        <ReadyLibrary api={api} asks={asks} buildKind={buildKind} claudeSets={claudeSets} requests={requests} run={run} busy={busy} gameId={gameId} selectedKey={from ? from.key : ''} onPick={pickReady} />
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
            <p className="brm-notice" role="status">{W.askedInAsk(askNumber(from.askedIn))}</p>
          )}
          <label className="brm-field"><span className="brm-lbl">Question</span><input ref={questionRef} className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
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
          {kind === 'rating' && <p className="brm-hint">{W.ratingScale}</p>}
          <div className="brm-field">
            <span className="brm-lbl">{W.claudeGetsAs}</span>
            <div className="brm-seg brm-seg--kinds" role="radiogroup" aria-label="Claude gets it as">
              {/* Later is not a kind to choose (owner, 2026-10-08): Save for later is the one way in. A ready question preset to later keeps it. */}
              {CLAUDE_KINDS.filter((k) => k.key !== 'later').map((k) => (
                <button key={k.key} type="button" role="radio" aria-checked={claudeGets === k.key} className={`brm-segbtn${claudeGets === k.key ? ' is-on' : ''}`} title={k.hint} onClick={() => setClaudeGets(k.key)}>{k.label}</button>
              ))}
            </div>
            <span className="brm-hint">{CLAUDE_KINDS.find((k) => k.key === claudeGets).hint}</span>
          </div>
          <label className="brm-field">
            <span className="brm-lbl">{W.noteForClaudePrivate}</span>
            <textarea className="brm-input brm-ta brm-ta--sm" value={claudeNote} maxLength={1000} onChange={(e) => setClaudeNote(e.target.value)} placeholder="How Claude should use the answer" />
          </label>
          <label className="brm-check brm-field"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {W.saveDraft}</label>
          <div className="brm-row brm-gap">
            <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>Cancel</button>
            <button type="submit" className="brm-btn brm-btn--primary brm-push" disabled={busy || !ready}>{draft ? 'Save draft' : 'Ask the room'}</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
