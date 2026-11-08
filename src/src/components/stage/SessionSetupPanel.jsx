import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../Icon';
import Button from '../ui/Button';
import {
  setupPanelTabs, sessionMenuSection, categoryRows, questionsRemaining, categoriesSummary,
  rosterRows, departedRows, questionKey,
  scoreboardButton, eventPlace,
} from '../../config/setupPanel';
import {
  anonymityApplies, anonymityActive, waitingNamesCaution,
} from '../../config/anonymity';
import { roundSubtitle, hasSummary } from '../../config/sessionHistory';
import { hasScoreboard, SCOREBOARD_STYLES, STYLE_LABELS } from '../../config/scoreboard';
import { canEndSession, isLobbyState, isSurveyType } from '../../config/hostControls';
import QueueList, { PutAsideList } from './QueueList';
import OwnQuestionComposer from '../OwnQuestionComposer';
import { ownQuestionWords as OQW } from '../../config/ownQuestion';
import YoursMark from '../YoursMark';
import WorkieSettings from './WorkieSettings';
import { nextRoundPickersApply } from '../../config/workieOptions';
import HelpButton from '../HelpButton';
import { helpFor } from '../../config/help/screens';
import LateList from '../LateList';
import LW from '../../config/lateWords';
import BrandMark from '../BrandMark';
import RW from '../../config/roundWords';
import ScreensGroup, { ScreenSizeRow } from './ScreensGroup';
import { TWO_SURFACE_TYPES, oneScreenWhy } from '../../config/surfaces';
import PrivateReveal from '../needs/PrivateReveal';
import HW, { SESSION_MENU_WORDS as SMW } from '../../config/hostWords';
import { EVENT_WORDS } from '../../config/eventAgenda';
import MoreOptions, { moreOptionsStored } from './MoreOptions';
import SessionPeople from './SessionPeople';
import './SessionMenu.css';

/** The late list's count for the room's eyes: a number, never a text or a name. */
export function lateSummary(late) {
  const items = (late && Array.isArray(late.rounds) ? late.rounds : [])
    .flatMap((r) => (Array.isArray(r.items) ? r.items : []))
    .filter((it) => !it.reviewed);
  if (!items.length) return 'Nothing late to review';
  return items.length === 1 ? '1 late item to review' : `${items.length} late items to review`;
}

/** The header `?`'s section for each section (config/help/screens.js). */
export const TAB_HELP = {
  'up-next': 'host-session-up-next',
  history: 'host-session-history',
  people: 'host-session-players',
  screens: 'host-session-screens',
  joining: 'host-session-joining',
  run: 'host-session-run',
  close: 'host-session-close',
  results: 'host-session-results',
};

/** The words this menu says that no other surface does. */
export const MENU_WORDS = Object.freeze({
  upNext: 'Up next',
  choose: 'Choose a question',
  categories: 'Categories',
  change: 'Change',
  categorySwitches: 'Category switches',
  putAside: (n) => `Put aside this session (${n})`,
  putAsideNote: 'Never asked unless you restore it.',
  goal: 'Goal',
  oneScreenWrite: 'Write a question asks where first: on your phone, or here where the room will see.',
  reportTitle: 'Session report',
  reportSoFar: (n) => (n === 1 ? 'Round 1 so far, with Workie\'s read. It grows as you go.' : `Rounds 1–${n} so far, with Workie's reads. It grows as you go.`),
  reportEnded: (n) => (n === 1 ? 'The one round played, with Workie\'s read.' : `All ${n} rounds, with Workie's reads.`),
  openReport: 'Open the report',
  noRoundsYet: 'The report and each round appear here once a round has been played.',
  loadingRounds: 'Loading rounds…',
  rounds: 'Rounds',
  roundsHint: 'Press one to read it again',
  review: 'Review',
  hideLate: 'Hide',
  lateInReport: 'Late items in the report',
  phoneHeading: 'Your phone as a remote',
  phoneNote: 'Drive the room from your own phone. You sign in once.',
  connectPhone: 'Connect your phone',
  hidePhone: 'Hide the code',
  scoreboard: 'Scoreboard',
  scoreboardLook: 'Scoreboard look',
  screenSize: 'Screen size',
  howItWorks: 'Show how this works',
  howItWorksButton: 'Show how this works on the room\'s screen →',
  keys: 'Keys',
  joinAt: 'Players join at',
  code: 'Code',
  calendarInvite: 'Calendar invite',
  names: 'Names',
  pace: 'Pace',
  whoWaiting: 'Who is still waiting',
  wallComments: 'Comments on the wall',
  workie: 'Workie\'s voice and approach',
  redo: 'Redo Workie\'s read',
  results: 'Survey results',
  resultsReady: 'The report is ready once the survey closes.',
  resultsOpen: 'The survey\'s report: every question, its counts and Workie\'s read.',
  surveyEndFirst: 'Close the survey first',
  afterClose: 'After it closes',
});

/**
 * Everything the host needs and the room does not, behind one top-bar button:
 * the Session menu (docs/design/session-menu, approved 3 Nov 2026).
 *
 * SIX SECTIONS AS TABS (fork F1), the same names on every round type:
 * Up next · Rounds so far · People · Screens · Joining · How it runs. A survey
 * swaps the first two for Close survey · Results. Each opens on a short
 * default view and one "More options" line that names what it holds (README
 * D2): the owner's complaint was one long scroll with "a ton of options at the
 * bottom". An event's item adds one line above the tabs (item N of M, ‹
 * Agenda, Bring everyone here), not a tab; End session and Main menu are the
 * sheet's foot, in every section (fork F2). Sign out and Admin are not in the
 * live menu (fork F5): Home has both, one press away through Main menu, which
 * leaves the session running.
 *
 * A SIBLING OF <Stage>, NOT A CHILD, and the geometry is not negotiable:
 * `position: fixed` with `bottom: var(--dock-measured, var(--dock-h, 0px))`,
 * the rule reasoned out at styles.css:400-447. `.stage` is `height:100dvh` and
 * this is an overlay, so mounting it outside the measured subtree is what keeps
 * `useStageFit` from re-entering.
 *
 * IT DOES NOT JOIN `anyOverlayOpen`. SPACE landing on a focused button in here
 * would advance the round instead of pressing it, so HostActionBar ignores
 * SPACE whose target is inside `.setup-panel`. THAT CLASS NAME IS
 * LOAD-BEARING — renaming it disables the guard silently.
 *
 * THE ROOM MUST NEVER SEE AN EMAIL ADDRESS, and on one screen the room sees
 * this panel: its private parts (the running order's titles, the late list,
 * Workie's settings, name requests and the people list) draw only after
 * "Show on this screen" (components/needs/PrivateReveal.jsx).
 *
 * The word "Console" is the internal name for this thing and stays internal.
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]';

/* The running order's default view: the round on screen and four more. */
const ORDER_ROWS = 4;

export default function SessionSetupPanel({
  onClose = () => {},
  wsConnected = false,
  // Players
  players = [],
  gameState = '',
  playersWhoAnswered = [],
  playersWhoVoted = [],
  /* WHO LEFT, kept out of `players` by get-players.js so that every count the
     host page derives from `players.length` is automatically a count of the
     room rather than a count of the session's history. Passed separately
     because the Players tab is the only place a removal can be undone. */
  removedPlayers = [],
  /* Both host-gated (template-clean.yaml). Defaulted to no-ops so the panel
     stays presentational and mountable without the page — every other action
     on it is wired the same way. */
  onRemovePlayer = () => {},
  onRestorePlayer = () => {},
  onGrantHandover = () => {},
  /* THE SCOREBOARD (docs/superpowers/specs/2026-09-25-scoreboard-design.md):
     the server's board as the page mirrors it, whether it may open
     (config/scoreboard.js scoreboardAvailability), and the two ways this panel
     changes it — the Players tab's button and the Settings tab's look. */
  scoreboard = { open: false, style: 'departure' },
  scoreboardAvailability = { show: false, enabled: false, reason: '' },
  onToggleScoreboard = () => {},
  onScoreboardStyle = () => {},

  // Questions — categories
  categories = [],
  categoryCounts = null,
  categoryBitmasks = null,
  activeCategoryIds = new Set(),
  isTogglingCategory = false,
  onToggleCategory = () => {},

  // Questions — the browser
  questions = [],
  loadingQuestions = false,
  usedQuestionIds = [],
  onSelectQuestion = () => {},
  /* CHOOSE A QUESTION (docs/design/question-picker D3): Up next's door to
     the one picker. Null draws no door. */
  onChoose = null,

  /*
    Questions — THE QUEUE.

    Presentational like everything else on this panel: the list arrives as an
    array of canonical keys and every action goes back out as a prop. The panel
    never fetches and never reorders locally — `GameHostPage` owns the optimistic
    update because it also owns the WebSocket that corrects it, and a second
    optimistic copy in here would fight that one.

    `queueBusyKeys` names the rows with a request in flight, so a host cannot
    press ↑ three times on a 200ms round trip and send three ops for one intent.
  */
  questionQueue = [],
  queueBusyKeys = [],
  upNext = [],
  /* Queue entries the plan cannot serve right now (not in this set, no
     reachable category), straight from GET /up-next. QueueList turns each
     into a visible "parked" tag on the row the host already sees. */
  upNextBlocked = [],
  /* Served-but-labeled one-offs (category off) and the host's veto list —
     the other two GET /up-next projections QueueList renders. */
  upNextAdvisories = [],
  upNextExcluded = [],
  onQueueQuestion = () => {},
  /* "Ask next": the `first` queue op, by canonical key — the top of the
     running order, with the round on screen left alone. `onSelectQuestion`
     above is "Ask now". The owner: "'ask next' in most people's mind means put
     it at the top of the queue, not run it now." */
  onQueueFirst = () => {},
  onQueueMove = () => {},
  onQueueRemove = () => {},
  /* Rearranging an AUTO row — materialises the displayed plan into the queue
     and applies the move. The semantics and the ops live in
     config/questionQueue.js:materializePlanOps. */
  onAutoMove = () => {},
  /* The disable/restore pair for the per-session veto list. */
  onDisableQuestion = () => {},
  onRestoreQuestion = () => {},
  /* THE HOST'S OWN QUESTION (impromptu ask, README D2): the composer is an
     inline second step of Rounds → Running order, never a modal over this
     sheet. `ownComposer` is the composer's props from the page (null =
     closed); `onWriteQuestion` opens it (the page decides whether one screen
     needs its choice first); `ownQuestions`, `onEditOwn`, `onRemoveOwn` are
     the queue's Yours rows. */
  ownQuestions = [],
  /* ONE NUMBERING WITH THE RAIL (config/roundNumbers.js): the round the
     session is on, and the round on screen as { title, key }. QueueList. */
  queueRoundBase = null,
  queueNowRound = null,
  ownComposer = null,
  onWriteQuestion = null,
  onEditOwn = null,
  onRemoveOwn = null,
  /* The status line that confirms an own question, with Undo (D5): { text, rest, undoKey }. */
  ownNotice = null,
  onOwnUndo = null,
  /* While the composer is open its own Escape is the way out (one
     requestClose), so this panel's Esc and `\\` stand down, as for a dialog. */
  composing = false,

  // Settings
  gameId = '',
  playUrl = '',
  remoteUrl = '',
  joinLinkCopied = false,
  onCopyJoinLink = () => {},
  onInvite = () => {},
  /*
    Silence this panel's own document-level keydown while a dialog it opened is
    on screen. That handler answers Escape AND `\` unconditionally, and it is
    hand-rolled, so `Modal`'s topmost-by-DOM-containment logic cannot see it —
    without this, Escape inside the invite dialog closes the dialog and the
    panel underneath it, and `\` types a backslash nowhere while toggling the
    panel shut.
  */
  suppressKeys = false,
  onShowJoinCode = () => {},
  profile = 'room',
  onProfileChange = () => {},
  /* THE SCREENS GROUP (owner, 16 Oct; docs/design/settings-consolidation):
     the lobby chooser's stored choice ('two' | 'classic') and the page's
     chooseRoomScreen, the room's window and whether it is up. Offered only
     for the game types two screens cover, and only with a handler. */
  roomScreen = 'classic',
  onRoomScreenChange = null,
  presentHref = '',
  presentDetail = null,
  /* WHO MAY SIGN IN ON THE PHONE: config/remoteSignIn.js's words, built by
     the page (the only thing that can reach useAuth), or null until known. */
  remoteWho = null,

  // Settings — the two name decisions the owner moved out of the code.
  //
  // BOTH ARE SESSION-LEVEL AND NEITHER HAS A PER-ROUND OVERRIDE: *"Just leave
  // the decision to the host."* `anonymousUntilReveal` is not a new flag — it
  // is the per-game flag chosen at setup (config/anonymity.js's
  // createPayloadFor), read back by get-game.js, surfaced here so a host can
  // change their mind mid-session. The checkbox below is its inverse, because
  // the host-facing question is "show the names?" and the stored flag is
  // "withhold them?".
  //
  // `profile` IS NOT AN INPUT TO EITHER, and that is a ruling rather than an
  // oversight: *"Don't use screen type for name reveal decision. I often have a
  // projector with a team of four."* A display profile is not a proxy for room
  // size, audience or sensitivity. Nothing in this section may read it.
  gameType = '',
  anonymousUntilReveal = true,
  onAnonymousUntilRevealChange = () => {},
  nameWaitingWhenAnonymous = true,
  onNameWaitingChange = () => {},
  // Whether a feedback round's comments arrive on the wall (text and what
  // they are about, never the author) or only their count does.
  wallComments = true,
  onWallCommentsChange = () => {},
  // "Include items not reviewed" (Settings › Report; late items Task 5).
  // Applies now: it changes only the next report, never the room.
  includeNotReviewed = true,
  onIncludeNotReviewedChange = () => {},
  /* AUTO-MODE — the session advances itself when everyone has responded,
     paging through responses and Workie prose at reading pace first. The
     decisions live in config/autoMode.js and the timer in GameHostPage; this
     panel only renders the switch, presentational by the same rule as
     everything else here. */
  autoMode = false,
  onAutoModeChange = () => {},
  /* SETTINGS FROM THE NEXT ROUND (session flow v3; owner, 14 Oct). While a
     round is live the page holds a change in `pendingSettings` (keys:
     anonymousUntilReveal, nameWaiting, wallComments, scoreboardStyle) and
     applies it when round `nextRoundNumber` starts. This panel shows the held
     value and says it is waiting; Pace and Display apply now. */
  pendingSettings = {},
  settingsRoundLive = false,
  nextRoundNumber = null,
  // The round's response count and reveal state — the caution's quantity, never
  // a threshold that decides anything. See config/anonymity.js's
  // MIN_ANONYMOUS_ANSWERS for what this used to gate.
  answerCount = 0,
  authorsRevealed = false,
  onViewReports = () => {},
  onShowHowToPlay = () => {},
  onSwitchGame = () => {},
  /* AN EVENT'S ITEM (experience plan §3.2a "Session menu: same + Agenda";
     2d, first in the menu since 2h): `{ onAgenda, onBringHere, busy }`.
     Agenda is always there in an event, up one level, never instead of Main
     menu (which means home); Bring everyone here only while the room is
     somewhere else (a preview, or the event moved on). Null outside an event. */
  event = null,
  // Task 4, 2026-09-26 bug sweep: what pressing "End session" does. Whether
  // it is offered at all is `canEndSession(gameType, gameState)` below, from
  // the two props this panel already carries — the same pattern
  // `anonymityActive` and `hasScoreboard` use elsewhere in this file. The
  // confirm lives on the action the page builds, not here — this panel stays
  // presentational.
  onEndSession = () => {},
  /* Sign out and Admin are not in the live menu (docs/design/session-menu
     fork F5): Home has both. `onSignOut` and `isAdmin` are no longer read. */
  /* The rounds played so far, already normalised by config/sessionHistory.js.
     Props rather than a fetch: this panel is presentational by rule, and the
     page owns the request. */
  rounds = [],
  historyLoading = false,
  onOpenRound = () => {},
  /* THE GOAL (events M1b): session-goal.js goalProgress for the live round,
     or null. The Questions tab says "Question 3 of 5" — the host's, not
     the room's, which is why it is here and not on the rail. */
  goal = null,
  /* WHERE IT OPENS (fork F7): Up next during play, Rounds so far once ended,
     unless a place was asked for. A section id or an old name
     (config/setupPanel.js LEGACY_SECTIONS: players, questions, history,
     settings, running-order, agenda, rounds, remote, phone, end). The running
     order asked for by name ("Set the running order"; ?panel=questions,
     config/runningOrder.js) opens Up next with the whole order in view. */
  initialTab = '',
  focusRunningOrder = false,
  /* THE FRAME DRAWS PEOPLE (the console mid-session): the People column is
     the at-a-glance view, and its "All N, and who left" opens this menu's
     People section, which is there in every version. */
  peopleColumn = false,
  /* A SURVEY'S CLOSE AND END, from the page's own controls (hostControls):
     `{ close, warn, end, closed, onAct }`, each control or null. */
  surveyActs = null,
  /* WORKIE'S HOST OPTIONS (QA drive #21): the voice, the approach, the
     briefing note and Redo, moved here off the room-facing What We Heard
     beat. The page's state and handlers, passed through to WorkieSettings;
     null draws nothing. */
  workie = null,
  /* THE LATE LIST (late items Task 4): `{ rounds, ended, commentsClosedAt,
     onShow, onMarkReviewed, onCloseComments }` from the page, which owns the
     reads and the writes; null draws nothing. In the Rounds tab, so one
     screen (the dock's count) and two (the rail's "Review them") reach it. */
  late = null,
  /* THE ROOM CAN SEE THIS PANEL (experience plan §2 principle 3, step 1e;
     audit B §2.3). On one screen the laptop IS the room's screen and this
     panel opens over it, so its private parts — a name request with its
     name, the late answers and their authors, Workie's voice, briefing and
     read-check warning, the upcoming question titles — draw only after "Show
     on this screen" for that one part (components/needs/PrivateReveal.jsx).
     What stays: counts, the roster and scores (owner, 25 Sep), the settings. */
  oneScreen = false,
  /* Not now and Lock again for every round type (experience plan 1a): wired
     where the page passes them, as the Build Room always has. */
  onRefuseHandover = null,
  onLockHandover = null,
}) {
  const screenChoiceOffered = typeof onRoomScreenChange === 'function'
    && TWO_SURFACE_TYPES.includes(gameType || 'call-and-answer');
  const held = pendingSettings || {};
  const heldOr = (key, value) => (Object.prototype.hasOwnProperty.call(held, key) ? held[key] : value);
  const shownAnonymous = heldOr('anonymousUntilReveal', anonymousUntilReveal);
  const shownNameWaiting = heldOr('nameWaiting', nameWaitingWhenAnonymous);
  const shownWallComments = heldOr('wallComments', wallComments);
  const shownBoardStyle = heldOr('scoreboardStyle', scoreboard.style);
  /** A group's scope: only the exception is printed (review R4), "From the
      next round", plus "waiting for round N" while a change is held. */
  const scope = (keys) => {
    if (!keys) return null;
    const waiting = settingsRoundLive && keys.some((k) => Object.prototype.hasOwnProperty.call(held, k));
    return (
      <span className="setup-scope">
        {` · ${RW.view.fromNextRound}`}
        {waiting && nextRoundNumber ? <b className="setup-held">{` · ${RW.view.heldFor(nextRoundNumber)}`}</b> : null}
      </span>
    );
  };
  const survey = isSurveyType(gameType);
  const hasAgenda = Boolean(event && typeof event.onAgenda === 'function');
  const tabs = setupPanelTabs({ survey });
  const ended = gameState === 'ENDED';
  const [tab, setTab] = useState(() => sessionMenuSection(initialTab, tabs, { ended: ended || Boolean(survey && surveyActs && surveyActs.closed) }));
  /* Up next's More options, controlled: "Change" opens it on the switches. */
  const [upMore, setUpMore] = useState(() => moreOptionsStored('up-next'));
  const [focusCats, setFocusCats] = useState(false);
  /* The phone's QR, inline in Screens; open at once when the phone was asked for. */
  const [phoneOpen, setPhoneOpen] = useState(() => ['remote', 'phone'].includes(initialTab));
  /* Rounds so far's late line: Review opens the list in place. */
  const [lateOpen, setLateOpen] = useState(false);
  /* "Include items not reviewed" said it failed, rather than flipping back in silence. */
  const [includeFailed, setIncludeFailed] = useState(false);
  const changeInclude = async (include) => {
    setIncludeFailed(false);
    const r = await onIncludeNotReviewedChange(include);
    if (r && r.ok === false) setIncludeFailed(true);
  };

  const panelRef = useRef(null);
  // Where focus came from, so it can go back. A keyboard host who opens this
  // and closes it must not be dropped at the top of the document mid-session.
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  // Esc and `\` both close, because `\` is what opened it.
  useEffect(() => {
    const onKeyDown = (e) => {
      // A dialog this panel opened is on top: its Escape is its own.
      if (suppressKeys) return;
      if (composing) return;
      if (e.key === 'Escape' || e.key === '\\') {
        if (e.key === '\\' && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, suppressKeys, composing]);

  /**
   * Focus stays inside while it is open. Without this, Tab walks out of the
   * panel and onto the dock's primary action, where the next Space or Enter
   * advances a live round the host was still setting up.
   */
  const trapFocus = (e) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll(FOCUSABLE));
    if (focusables.length === 0) return;
    const firstEl = focusables[0];
    const lastEl = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  /* THE RUNNING ORDER, IN VIEW, on the landing that asked for it
     ("Set the running order"; ?panel=questions). */
  useEffect(() => {
    if (!focusRunningOrder || tab !== 'up-next') return;
    const order = panelRef.current && panelRef.current.querySelector('.setup-q');
    if (order && typeof order.scrollIntoView === 'function') {
      order.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }, [focusRunningOrder, tab]);

  /* "Change" opened More options: put focus on the first category switch. */
  useEffect(() => {
    if (!focusCats || !upMore) return;
    const first = panelRef.current && panelRef.current.querySelector('[data-testid="category-toggle"]');
    if (first && typeof first.focus === 'function') first.focus();
    setFocusCats(false);
  }, [focusCats, upMore]);

  const roster = rosterRows({ players, gameState, playersWhoAnswered, playersWhoVoted });
  const sbButton = scoreboardButton({ board: scoreboard, availability: scoreboardAvailability });
  const departed = departedRows(removedPlayers);

  const catRows = useMemo(
    () => categoryRows({ categories, categoryCounts, categoryBitmasks, activeCategoryIds }),
    [categories, categoryCounts, categoryBitmasks, activeCategoryIds],
  );
  const remaining = questionsRemaining(catRows);

  /* "Ask now" from the running order hands `onSelectQuestion` a question, as
     the browser rows do, so the page has one ask-now path. */
  const askNowByKey = (key, { title = '' } = {}) => {
    const found = questions.find((q) => questionKey(String(q?.id ?? '')) === key);
    onSelectQuestion(found || { id: key, title });
  };

  const lateCount = (late && Array.isArray(late.rounds) ? late.rounds : [])
    .flatMap((r) => (Array.isArray(r.items) ? r.items : []))
    .filter((it) => !it.reviewed).length;

  const goWrite = () => { if (onWriteQuestion) onWriteQuestion(); };

  /* ------------------------------------------------------------ the parts */

  /* WHO IS STILL WAITING (How it runs · More): the switch and its caution. */
  const waitingGroup = anonymityApplies(gameType) && anonymityActive({ gameType, anonymousUntilReveal }) ? (
    <section className="setup-group" aria-labelledby="setup-g-waiting">
      <h4 className="setup-h setup-h--sub" id="setup-g-waiting">{MENU_WORDS.whoWaiting}{scope(['nameWaiting'])}</h4>
      <label className="setup-toggle">
        <input
          type="checkbox"
          data-testid="name-waiting"
          checked={shownNameWaiting !== false}
          onChange={(e) => onNameWaitingChange(e.target.checked)}
        />
        <span>Name who is still waiting</span>
      </label>
      <p className="setup-note">
        The room meter can list who has not responded yet — only while you
        hover or click it, and never who has.
      </p>
      {(() => {
        const caution = waitingNamesCaution({
          answerCount, gameType, anonymousUntilReveal, authorsRevealed,
        });
        if (!caution) return null;
        return (
          <p
            className={`setup-note${caution.strong ? ' setup-note--warn' : ''}`}
            data-testid="waiting-caution"
            data-strong={String(caution.strong)}
          >
            {'Naming who is still waiting also names who has answered — the room '
              + 'can subtract one list from the other. '}
            {caution.text}
          </p>
        );
      })()}
    </section>
  ) : null;

  /* COMMENTS ON THE WALL (How it runs · More). */
  const wallGroup = (
    <section className="setup-group" aria-labelledby="setup-g-wall">
      <h4 className="setup-h setup-h--sub" id="setup-g-wall">{MENU_WORDS.wallComments}{scope(['wallComments'])}</h4>
      <label className="setup-toggle">
        <input
          type="checkbox"
          data-testid="wall-comments"
          checked={shownWallComments !== false}
          onChange={(e) => onWallCommentsChange(e.target.checked)}
        />
        <span>Show comments on the wall as they arrive</span>
      </label>
      <p className="setup-note">
        In a feedback round the room meter shows the latest comments — what
        they say and what they are about, never who wrote them. Press one to
        put it up for everyone with its author. Off, the wall shows only the count.
      </p>
    </section>
  );

  /* WORKIE (How it runs · More): the voice, the approach, the briefing note,
     and the copy of Redo kept while a read is up (fork F4: Redo also sits
     beside the read itself on a private laptop). Behind Show on this screen
     on one screen, as before. */
  const workieGroup = workie ? (
    <PrivateReveal oneScreen={oneScreen} testId="private-workie" summary="Workie's voice, approach and briefing">
      <WorkieSettings
        {...workie}
        showNextRound={nextRoundPickersApply({
          gameType,
          gameState,
          remaining: catRows.length ? remaining : null,
        })}
      />
    </PrivateReveal>
  ) : null;
  const workieShows = Boolean(workie) && (
    nextRoundPickersApply({ gameType, gameState, remaining: catRows.length ? remaining : null })
    || workie.briefed || typeof workie.onRedo === 'function'
  );

  /* INCLUDE ITEMS NOT REVIEWED (Rounds so far / Results · More): it changes
     only the report. */
  const reportGroup = (
    <section className="setup-group" aria-labelledby="setup-g-report">
      <h4 className="setup-h setup-h--sub" id="setup-g-report">{LW.report.settingHeading}</h4>
      <label className="setup-toggle">
        <input
          type="checkbox"
          data-testid="include-not-reviewed"
          checked={includeNotReviewed !== false}
          onChange={(e) => changeInclude(e.target.checked)}
        />
        <span>{LW.report.settingLabel}</span>
      </label>
      {includeFailed && <p className="setup-note" role="alert">{LW.report.settingFailed}</p>}
      <p className="setup-note">{LW.report.settingNote}</p>
    </section>
  );

  /* PACE (How it runs · default). */
  const paceGroup = (
    <section className="setup-group" aria-labelledby="setup-g-pace">
      <h4 className="setup-h setup-h--sub" id="setup-g-pace">{MENU_WORDS.pace}</h4>
      <label className="setup-toggle">
        <input
          type="checkbox"
          data-testid="auto-mode"
          checked={autoMode === true}
          onChange={(e) => onAutoModeChange(e.target.checked)}
        />
        <span>Auto-advance when everyone has responded</span>
      </label>
      <p className="setup-note">
        Once every player has answered — and voted, on formats that vote — the
        session moves on by itself after a short beat, paging responses and the
        AI summary at reading pace. Opening anything pauses it, and your own
        controls always work.
      </p>
    </section>
  );

  /* NAMES (How it runs · default, where it applies): the one control that
     changes what the room learns about a colleague. */
  const namesGroup = anonymityApplies(gameType) ? (
    <section className="setup-group" aria-labelledby="setup-g-names">
      <h4 className="setup-h setup-h--sub" id="setup-g-names">{MENU_WORDS.names}{scope(['anonymousUntilReveal', 'nameWaiting'])}</h4>
      <label className="setup-toggle">
        <input
          type="checkbox"
          data-testid="attribute-authors"
          checked={shownAnonymous === false}
          onChange={(e) => onAnonymousUntilRevealChange(!e.target.checked)}
        />
        <span>Show who wrote each response from the start</span>
      </label>
      {/* WHAT OFF DOES, and the trade-off stated before the press: closing the
          vote reveals the round (get-results.js enterResultsState). */}
      <p className="setup-note">
        Off (the default), responses are numbered while the room answers and
        votes; when voting closes, each shows its author and points.{' '}
        <b>Turning it on shows names to everyone and cannot be taken back.</b>{' '}
        Turning it off again takes them off the room&apos;s screen; it does not un-send them.
      </p>
    </section>
  ) : null;

  /* THE PHONE AS A REMOTE (Screens, D7). The word "join" must not appear
     here: this QR is behind the host sign-in. */
  const phoneGroup = remoteUrl ? (
    <section className="setup-group setup-remote" aria-labelledby="setup-g-remote" data-testid="screens-phone">
      <div className="smenu-line">
        <div className="smenu-line__k">
          <h4 className="setup-h setup-h--sub" id="setup-g-remote">{MENU_WORDS.phoneHeading}</h4>
          <p className="setup-note">{MENU_WORDS.phoneNote}</p>
        </div>
        <Button variant="secondary" size={36} aria-expanded={phoneOpen} onClick={() => setPhoneOpen((v) => !v)} data-testid="connect-phone">
          <Icon name="DeviceMobile" weight="bold" size={15} color="currentColor" />
          {` ${phoneOpen ? MENU_WORDS.hidePhone : MENU_WORDS.connectPhone}`}
        </Button>
      </div>
      {phoneOpen ? (
        <div className="smenu-phone" data-testid="phone-qr">
          {/* SCANNABLE BY MORE THAN THE iPHONE CAMERA (owner, 4 Nov 2026: Google
              Lens on an iPhone 15 could not read this off a 14in MacBook until
              the screen was zoomed 1.5x). At 160px with an 8px pad the code had
              ~5.5px modules and a third of the quiet zone the spec asks for, on
              a dark panel; Lens needs both. Now 256px with the four-module
              white margin drawn inside the code. */}
          <QRCodeSVG value={remoteUrl} size={256} marginSize={4} />
          <p className="setup-note">Scan with your own phone to drive the room from it.</p>
          <p className="setup-url">{remoteUrl}</p>
          {remoteWho ? (
            <div className="setup-remote__who">
              <p>{remoteWho.lead}<b>{remoteWho.who}</b>{remoteWho.tail}</p>
              {remoteWho.laptop ? <p>{remoteWho.laptop}</p> : null}
            </div>
          ) : (
            <p className="setup-note">You will be asked to sign in.</p>
          )}
        </div>
      ) : null}
    </section>
  ) : null;

  /* ------------------------------------------------------------ sections */

  const upNextSection = () => {
    if (ownComposer) {
      return (
        <section className="setup-questions setup-own" aria-label="Write a question">
          <OwnQuestionComposer {...ownComposer} />
        </section>
      );
    }
    const asideRows = onRestoreQuestion ? upNextExcluded : [];
    const moreGroups = [
      catRows.length ? { label: MENU_WORDS.categorySwitches } : null,
      asideRows.length ? { label: MENU_WORDS.putAside(asideRows.length) } : null,
      goal && goal.progress ? { label: MENU_WORDS.goal } : null,
    ];
    return (
      <section className="setup-questions" aria-label="What comes next">
        {/* The status line that confirms an own question, with Undo (D5). */}
        {ownNotice ? (
          <p className="setup-own-notice" role="status" data-testid="own-notice">
            <Icon name="Check" weight="bold" size={14} color="currentColor" />
            <span><b>{ownNotice.text}</b>{ownNotice.rest ? ` ${ownNotice.rest}` : ''}</span>
            {onOwnUndo ? (
              <Button variant="tertiary" className="setup-own-undo" onClick={onOwnUndo} data-testid="own-undo">{OQW.undo}</Button>
            ) : null}
          </p>
        ) : null}
        <PrivateReveal
          oneScreen={oneScreen}
          testId="private-questions"
          shown={focusRunningOrder}
          summary={`${questionQueue.length} in the running order · ${remaining} questions left`}
        >
          <QueueList
            rowMenu
            limit={focusRunningOrder ? null : ORDER_ROWS}
            showExcluded={false}
            queue={questionQueue}
            questions={questions}
            busyKeys={queueBusyKeys}
            upNext={upNext}
            blocked={upNextBlocked}
            advisories={upNextAdvisories}
            excludedRows={upNextExcluded}
            onMove={onQueueMove}
            onRemove={onQueueRemove}
            onAutoMove={onAutoMove}
            onDisable={onDisableQuestion}
            onRestore={onRestoreQuestion}
            onAskNext={onQueueFirst}
            onAskNow={askNowByKey}
            ownQuestions={ownQuestions}
            onWrite={null}
            onEditOwn={onEditOwn}
            onRemoveOwn={onRemoveOwn}
            base={queueRoundBase}
            nowRound={queueNowRound}
          />
        </PrivateReveal>
        {/* THE TWO WAYS TO ADD A ROUND (D4). Write a question is not behind
            the reveal: on one screen the page answers it with the host-only
            choice first (impromptu ask D8). */}
        <div className="setup-row smenu-adds">
          {onWriteQuestion ? (
            <Button variant="secondary" size={36} onClick={goWrite} data-testid="queue-write">
              <Icon name="Plus" weight="bold" size={14} color="currentColor" />
              {OQW.write}
            </Button>
          ) : null}
          {/* THE MENU'S DOOR TO THE QUESTION PICKER (question picker D3): a
              link, not a copy. The page closes this sheet and opens the one
              picker every door opens; its way back returns here. */}
          {onChoose ? (
            <Button variant="secondary" size={36} onClick={onChoose} data-testid="up-next-choose">
              <Icon name="MagnifyingGlass" weight="bold" size={14} color="currentColor" />
              {MENU_WORDS.choose}
            </Button>
          ) : null}
        </div>
        {oneScreen && onWriteQuestion ? <p className="setup-note">{MENU_WORDS.oneScreenWrite}</p> : null}
        {catRows.length && !upMore ? (
          <div className="smenu-cats" data-testid="categories-summary">
            <span><b>{MENU_WORDS.categories}</b>{` · ${categoriesSummary(catRows)}`}</span>
            <Button
              variant="tertiary"
              size={36}
              className="smenu-cats__change"
              onClick={() => { setUpMore(true); setFocusCats(true); }}
              data-testid="categories-change"
            >
              {MENU_WORDS.change}
            </Button>
          </div>
        ) : null}
        <MoreOptions section="up-next" groups={moreGroups} open={upMore} onOpenChange={setUpMore}>
          {catRows.length ? (
            <section className="setup-group" aria-labelledby="setup-g-cats">
              <h4 className="setup-h setup-h--sub" id="setup-g-cats">
                {MENU_WORDS.categories}
                <span className="setup-scope" data-testid="questions-remaining">{` · ${remaining} questions left`}</span>
              </h4>
              {/* The bitmask arithmetic is config/setupPanel.js's; `exhausted`
                  at zero stops a host enabling a category that cannot yield. */}
              <div className="setup-cats">
                {catRows.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    data-testid="category-toggle"
                    className={`setup-cat ${row.enabled ? 'selected' : ''} ${row.exhausted ? 'exhausted' : ''}`}
                    onClick={() => onToggleCategory(row)}
                    disabled={isTogglingCategory}
                    aria-pressed={row.enabled}
                    aria-label={`${row.name} — ${row.remaining} left, ${row.enabled ? 'on' : 'off'}`}
                  >
                    <span className="setup-cat__name">{row.name}</span>
                    <span className="setup-cat__count">{`${row.remaining} left`}</span>
                    {/* The state in words, not only in colour. */}
                    <span className="setup-cat__state">{row.enabled ? 'on' : 'off'}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {asideRows.length ? (
            <section className="setup-group" aria-labelledby="setup-g-aside">
              <h4 className="setup-h setup-h--sub" id="setup-g-aside">
                {MENU_WORDS.putAside(asideRows.length).replace(/ \(\d+\)$/, '')}
                <span className="setup-scope">{` · ${MENU_WORDS.putAsideNote}`}</span>
              </h4>
              <PrivateReveal oneScreen={oneScreen} testId="private-aside" summary={MENU_WORDS.putAside(asideRows.length)}>
                <PutAsideList rows={asideRows} onRestore={onRestoreQuestion} />
              </PrivateReveal>
            </section>
          ) : null}
          {goal && goal.progress ? (
            <section className="setup-group" aria-labelledby="setup-g-goal">
              <h4 className="setup-h setup-h--sub" id="setup-g-goal">{MENU_WORDS.goal}</h4>
              <p className="setup-note" data-testid="goal-progress">
                {goal.reached ? `${goal.progress} · goal reached` : goal.progress}
              </p>
            </section>
          ) : null}
        </MoreOptions>
      </section>
    );
  };

  /* THE SESSION REPORT, FIRST (D3; the owner's "move the report button to
     the rounds page, at the top"). Before round 1 it says so and draws no
     dead button (review R5). */
  const reportCard = (count, { survey: forSurvey = false } = {}) => (
    <div className="smenu-report" data-testid="session-report">
      <Icon name="FileText" weight="duotone" size={22} color="var(--primary)" />
      <div className="smenu-report__t">
        <b>{MENU_WORDS.reportTitle}</b>
        <span className="setup-note">
          {forSurvey
            ? (surveyActs && surveyActs.closed) || ended ? MENU_WORDS.resultsOpen : MENU_WORDS.resultsReady
            : ended ? MENU_WORDS.reportEnded(count) : MENU_WORDS.reportSoFar(count)}
        </span>
      </div>
      {(!forSurvey || (surveyActs && surveyActs.closed) || ended) ? (
        <Button variant="secondary" size={36} onClick={onViewReports} data-testid="open-report">{MENU_WORDS.openReport}</Button>
      ) : null}
    </div>
  );

  const lateLine = late ? (
    <div className="late-section smenu-late" data-testid="late-line">
      <div className="late-heading-row">
        <h4 className="late-heading smenu-late__h">{LW.heading}</h4>
        <span className="smenu-late__t">{` · ${lateSummary(late)}`}</span>
        <HelpButton {...helpFor('host-late-items')} variant="inline" size="small" tooltip={`Help: ${LW.heading}`} className="setup-panel__help" />
        {lateCount > 0 || lateOpen ? (
          <Button variant="tertiary" size={36} className="smenu-late__review" aria-expanded={lateOpen} onClick={() => setLateOpen((v) => !v)} data-testid="late-review">
            {lateOpen ? MENU_WORDS.hideLate : MENU_WORDS.review}
          </Button>
        ) : null}
      </div>
      {lateOpen ? (
        <PrivateReveal oneScreen={oneScreen} testId="private-late" summary={lateSummary(late)}>
          <LateList {...late} />
        </PrivateReveal>
      ) : null}
    </div>
  ) : null;

  const historySection = () => (
    <section className="setup-history" aria-label="Rounds so far">
      {rounds.length === 0 ? (
        <p className="setup-empty" data-testid="history-empty">
          {historyLoading ? MENU_WORDS.loadingRounds : MENU_WORDS.noRoundsYet}
        </p>
      ) : reportCard(rounds.length)}
      {lateLine}
      {rounds.length ? (
        <>
          <h4 className="setup-h setup-h--sub" id="setup-g-history">
            {MENU_WORDS.rounds}<span className="setup-scope">{` · ${MENU_WORDS.roundsHint}`}</span>
          </h4>
          <ul className="setup-history__list" aria-labelledby="setup-g-history">
            {rounds.map((round, i) => (
              <li key={round.number}>
                <button type="button" className="setup-history__row" onClick={() => onOpenRound(i)}>
                  <span className="setup-history__num">{round.ordinal}</span>
                  <span className="setup-history__text">
                    <span className="setup-history__title">{round.title}</span>
                    <span className="setup-history__sub">{roundSubtitle(round)}</span>
                  </span>
                  {/* Yours (D5), not on one screen, where the room is never told (F6). */}
                  {round.own && !oneScreen ? <YoursMark /> : null}
                  {hasSummary(round) && (
                    <span className="setup-history__badge" title="Has an AI summary">AI</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <MoreOptions section="history" groups={[{ label: MENU_WORDS.lateInReport }]}>
        {reportGroup}
      </MoreOptions>
    </section>
  );

  const resultsSection = () => (
    <section className="setup-history" aria-label={MENU_WORDS.results}>
      {reportCard(0, { survey: true })}
      {lateLine}
      <MoreOptions section="results" groups={[{ label: MENU_WORDS.lateInReport }]}>
        {reportGroup}
      </MoreOptions>
    </section>
  );

  const closeSection = () => (
    <section className="setup-group" aria-labelledby="setup-g-close">
      <h3 className="setup-h" id="setup-g-close">{SMW.closeSurvey}</h3>
      {surveyActs && surveyActs.close ? (
        <>
          <p className="setup-note">{SMW.closeNote}</p>
          <div className="setup-row">
            {surveyActs.warn ? (
              <Button variant="secondary" size={36} onClick={() => surveyActs.onAct(surveyActs.warn)}>{surveyActs.warn.label}</Button>
            ) : null}
            <Button variant="secondary" size={36} data-testid="session-menu-close-survey" onClick={() => surveyActs.onAct(surveyActs.close)}>{surveyActs.close.label}</Button>
          </div>
        </>
      ) : (
        <p className="setup-note">{surveyActs && surveyActs.closed ? SMW.surveyClosed : SMW.surveyNotOpen}</p>
      )}
    </section>
  );

  const screensMoreGroups = [
    { label: MENU_WORDS.screenSize },
    scoreboardAvailability.show ? { label: MENU_WORDS.scoreboardLook } : null,
    { label: MENU_WORDS.howItWorks },
    { label: MENU_WORDS.keys },
  ];
  const screensSection = () => (
    <>
      {/* One screen: Connect your phone near the top (PLAN §3.3). */}
      {oneScreen ? phoneGroup : null}
      <section className="setup-group setup-group--screens" aria-labelledby="setup-g-screens">
        <h3 className="setup-h" id="setup-g-screens">Screens</h3>
        <ScreensGroup
          choice={roomScreen === 'two' ? 'two' : 'classic'}
          offerChoice={screenChoiceOffered}
          why={oneScreenWhy(gameType)}
          onChoose={(choice) => onRoomScreenChange && onRoomScreenChange(choice)}
          presentHref={presentHref}
          presentDetail={presentDetail}
          profile={profile}
          onProfileChange={onProfileChange}
          showSize={false}
        />
      </section>
      {!oneScreen ? phoneGroup : null}
      {sbButton.show ? (
        <section className="setup-group setup-group--scoreboard" aria-labelledby="setup-g-scoreboard">
          <div className="smenu-line">
            <div className="smenu-line__k">
              <h4 className="setup-h setup-h--sub" id="setup-g-scoreboard">{MENU_WORDS.scoreboard}</h4>
              <p className="setup-note">
                {sbButton.reason || 'The full standings on the room\'s screen. Key S.'}
              </p>
            </div>
            <Button
              variant="secondary"
              size={36}
              data-testid="scoreboard-toggle"
              aria-pressed={Boolean(scoreboard.open)}
              disabled={sbButton.disabled}
              onClick={() => {
                const opening = !scoreboard.open;
                onToggleScoreboard(opening);
                // The menu stands over the stage; put it away so the room
                // sees the board it just asked for.
                if (opening) onClose();
              }}
            >
              {sbButton.label}
            </Button>
          </div>
        </section>
      ) : null}
      <MoreOptions section="screens" groups={screensMoreGroups}>
        <section className="setup-group" aria-label={MENU_WORDS.screenSize}>
          <div className="scr"><ScreenSizeRow profile={profile} onProfileChange={onProfileChange} /></div>
        </section>
        {scoreboardAvailability.show ? (
          <section className="setup-group" aria-labelledby="setup-g-sblook">
            <h4 className="setup-h setup-h--sub" id="setup-g-sblook">{MENU_WORDS.scoreboardLook}{scope(['scoreboardStyle'])}</h4>
            <label className="setup-field">
              <span>Scoreboard style</span>
              <select value={shownBoardStyle || 'departure'} onChange={(e) => onScoreboardStyle(e.target.value)}>
                {SCOREBOARD_STYLES.map((style) => (
                  <option key={style} value={style}>{STYLE_LABELS[style]}</option>
                ))}
              </select>
            </label>
            <p className="setup-note">How the standings look on the room&apos;s screen. Press V to change it while the board is up.</p>
          </section>
        ) : null}
        <section className="setup-group" aria-label={MENU_WORDS.howItWorks}>
          {/* Puts an explanation on the ROOM'S screen; the host guides are
              the header's `?`. */}
          <div className="setup-row">
            <Button variant="secondary" size={36} onClick={onShowHowToPlay}>{MENU_WORDS.howItWorksButton}</Button>
          </div>
        </section>
        <section className="setup-group" aria-labelledby="setup-g-keys">
          <h4 className="setup-h setup-h--sub" id="setup-g-keys">{MENU_WORDS.keys}</h4>
          <ul className="setup-keys">
            <li><kbd>Space</kbd> or <kbd>→</kbd> advance</li>
            <li><kbd>←</kbd> step back a beat</li>
            {hasScoreboard(gameType) && (
              <>
                <li><kbd>S</kbd> show or hide the scoreboard</li>
                <li><kbd>V</kbd> change the scoreboard&apos;s look, while it is up</li>
              </>
            )}
            <li><kbd>\</kbd> open and close this menu</li>
            <li><kbd>Esc</kbd> close</li>
          </ul>
        </section>
      </MoreOptions>
    </>
  );

  const joiningSection = () => (
    <>
      <section className="setup-group setup-group--joining smenu-join" aria-labelledby="setup-g-joining">
        <div className="smenu-join__qr">{playUrl ? <QRCodeSVG value={playUrl} size={112} /> : null}</div>
        <div className="smenu-join__t">
          <h3 className="setup-h" id="setup-g-joining">{MENU_WORDS.joinAt}</h3>
          <p className="setup-url">{playUrl}</p>
          {gameId && <p className="setup-note smenu-join__code">{`Session code ${gameId}`}</p>}
        </div>
      </section>
      <div className="setup-row">
        <Button variant="secondary" size={36} onClick={onCopyJoinLink}>
          {joinLinkCopied ? 'Copied!' : 'Copy join link'}
        </Button>
        <Button variant="secondary" size={36} onClick={onShowJoinCode}>{HW.showJoinCode}</Button>
      </div>
      <MoreOptions section="joining" groups={[{ label: MENU_WORDS.calendarInvite }]}>
        <section className="setup-group" aria-label={MENU_WORDS.calendarInvite}>
          {/* A calendar-invite blob, not a url — distinct from the link above. */}
          <div className="setup-row">
            <Button variant="secondary" size={36} onClick={onInvite}>{'Invite…'}</Button>
          </div>
        </section>
      </MoreOptions>
    </>
  );

  const runMoreGroups = [
    waitingGroup ? { label: MENU_WORDS.whoWaiting } : null,
    { label: MENU_WORDS.wallComments },
    workieShows ? { label: workie && typeof workie.onRedo === 'function' ? `${MENU_WORDS.workie} · ${MENU_WORDS.redo}` : MENU_WORDS.workie } : null,
  ];
  const runSection = () => (
    <>
      {/* Changes during a round wait for the next one (D8, the lede). */}
      {settingsRoundLive ? <p className="setup-note setup-scope-note">{RW.view.settingsScope}</p> : null}
      {survey ? <h3 className="setup-h">{MENU_WORDS.afterClose}</h3> : null}
      {namesGroup}
      {survey ? null : paceGroup}
      <MoreOptions section="run" groups={runMoreGroups}>
        {waitingGroup}
        {wallGroup}
        {workieGroup}
      </MoreOptions>
    </>
  );

  const sections = {
    'up-next': upNextSection,
    history: historySection,
    people: () => (
      <SessionPeople
        rows={roster}
        departed={departed}
        players={players}
        gameState={gameState}
        oneScreen={oneScreen}
        gameId={gameId}
        peopleColumn={peopleColumn}
        onGrant={onGrantHandover}
        onRefuse={onRefuseHandover}
        onLock={onLockHandover}
        onRemove={onRemovePlayer}
        onRestore={onRestorePlayer}
      />
    ),
    screens: screensSection,
    joining: joiningSection,
    run: runSection,
    close: closeSection,
    results: resultsSection,
  };
  const draw = sections[tab] || sections[tabs[0].id];

  /* THE FOOT (fork F2): End session and Main menu, in every section. */
  const endButton = (() => {
    if (survey) {
      const end = surveyActs && surveyActs.end;
      return (
        <Button
          variant="secondary"
          size={36}
          className="smenu-end"
          data-testid="session-menu-end"
          disabled={!end}
          title={end ? SMW.endSurveyNote : (ended ? SMW.ended : SMW.endSurveyFirst)}
          onClick={end ? () => surveyActs.onAct(end) : undefined}
        >
          {end ? `${end.label}…` : (ended ? HW.endSession : `${HW.endSession}…`)}
        </Button>
      );
    }
    if (!canEndSession(gameType, gameState)) return null;
    return (
      <Button
        variant="secondary"
        size={36}
        className="smenu-end"
        data-testid="session-menu-end"
        onClick={onEndSession}
        title={isLobbyState(gameState) ? SMW.endLobbyNote : SMW.endNote}
      >
        {`${HW.endSession}…`}
      </Button>
    );
  })();

  const place = hasAgenda ? eventPlace(event || {}) : '';

  return (
    <>
      <div className="setup-panel-scrim" onClick={onClose} aria-hidden="true" />
      {/* Never wide now: choosing a question is the question picker
          (components/stage/QuestionPicker.jsx), over the content area, not a
          step in here. data-theme="dark": the panel is painted dusk, so its
          tokens must be dusk too. */}
      <aside
        className="setup-panel smenu"
        data-theme="dark"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={HW.sessionMenu}
        onKeyDown={trapFocus}
      >
        <div className="setup-panel__header">
          {/* The mark, NOT a link: a tap here must never leave a live round. */}
          <BrandMark size={20} />
          <h2 className="setup-panel__title">{HW.sessionMenu}</h2>
          {/* The only WebSocket status on the host page, in the header so it
              is there whichever section is open. */}
          <span
            className={`setup-panel__ws ${wsConnected ? 'connected' : 'connecting'}`}
            aria-live="polite"
          >
            <Icon
              name={wsConnected ? 'Broadcast' : 'WifiSlash'}
              weight="bold"
              size={15}
              color={wsConnected ? 'var(--success)' : 'var(--muted)'}
            />
            {wsConnected ? ' Connected' : ' Connecting…'}
          </span>
          {/* THE HOST GUIDES, beside Close: one `?`, opening the guide for the
              section on show (Help Phase 3). */}
          <HelpButton
            {...helpFor(TAB_HELP[tab] || 'host-session-panel')}
            variant="inline"
            size="small"
            tooltip="Help and feedback"
            className="setup-panel__help"
            reports={{ context: 'host', gameId }}
          />
          <button
            type="button"
            className="setup-panel__close"
            onClick={onClose}
            aria-label={HW.closeSessionMenu}
          >
            <Icon name="X" weight="bold" size={18} color="currentColor" />
          </button>
        </div>

        {/* AN EVENT'S ITEM (D5): one line, in every section, instead of an
            Agenda tab. ‹ Agenda goes up one level (never instead of Main
            menu); Bring everyone here only while the room is elsewhere. */}
        {hasAgenda ? (
          <div className="setup-panel__event" role="group" aria-label={EVENT_WORDS.menuK} data-testid="session-menu-event">
            <span className="setup-panel__event-t">
              <b className="setup-panel__event-k">{EVENT_WORDS.menuK}</b>
              {place ? <span className="setup-panel__event-place">{` · ${place}`}</span> : null}
            </span>
            <span className="setup-panel__event-acts">
              {typeof event.onBringHere === 'function' ? (
                <Button variant="tertiary" size={36} onClick={event.onBringHere} disabled={Boolean(event.busy)} title={EVENT_WORDS.bringHereHint} data-testid="session-menu-bring">
                  {EVENT_WORDS.bringHere}
                </Button>
              ) : null}
              <Button
                variant="tertiary"
                size={36}
                onClick={event.onAgenda}
                disabled={Boolean(event.busy)}
                title={EVENT_WORDS.agendaHint}
                aria-label={EVENT_WORDS.agenda}
                data-testid="session-menu-agenda"
              >
                {EVENT_WORDS.agendaCrumb}
              </Button>
            </span>
          </div>
        ) : null}

        <div className="setup-panel__tabs" role="tablist" aria-label={`${HW.sessionMenu} sections`}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`setup-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`setup-panel-${t.id}`}
              className={`setup-panel__tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="setup-panel__body">
          <div
            className={`setup-settings smenu-pane smenu-pane--${tab}`}
            role="tabpanel"
            id={`setup-panel-${tab}`}
            aria-labelledby={`setup-tab-${tab}`}
          >
            {draw()}
          </div>
        </div>

        <div className="setup-panel__foot" data-testid="session-menu-foot">
          {endButton}
          {/* MAIN MENU, NOT "EXIT", AND THE DIFFERENCE IS FACTUAL: this does
              not end anything. The page shows Home while the SESSION STAYS
              LIVE on the server and is rejoinable through Continue. The
              "Leave without ending" explanation is its tooltip (D6). */}
          <Button variant="secondary" size={36} className="smenu-main" onClick={onSwitchGame} title={HW.mainMenuHint} data-testid="session-menu-main">
            <Icon name="House" weight="bold" size={15} color="currentColor" />
            {` ${HW.mainMenu}`}
          </Button>
        </div>
      </aside>
    </>
  );
}
