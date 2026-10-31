/**
 * The create-engagement screen.
 *
 * ── THE 30 OCT 2026 REDESIGN (docs/design/new-engagement) ─────────────────
 * The owner: "a great user experience creating a new engagement when the user
 * has very little experience with the site. also a user with lots of
 * experience, doesn't feel like its too overbearing". Three decisions, then
 * Create: Name it → Format → Question set, on one page.
 *
 *   SHOW THE NEXT DECISION, NOT ALL OF THEM (round 4; the owner: "less
 *            daunting if we revealed the sections as needed"). One rule for
 *            every host, derived from the decisions on screen: Name it and
 *            Format always; Question set once a format is chosen; the names
 *            card, Background for Workie and Advanced once a set has been
 *            picked in this dialog. Nothing shown is taken away again while
 *            the dialog is open. A host with history has their last format
 *            chosen, so Question set is there on open. A reveal never moves
 *            focus; it fades in once (180ms, none under reduced motion) and
 *            says so once in the one polite live region. Create stays in the
 *            foot, aria-disabled with "Still needed: …"; pressed early, it
 *            takes the focus to the first gap.
 *
 *   ONE LAYOUT (owner round 3, option A) min(1240px, 100vw−48px): the form
 *            on the left and a 420px pane, "How <format> runs", a storyboard
 *            to scroll through (components/FormatWalkthrough); before a
 *            format is chosen, one quiet example stage. Its Hide folds it to a 56px rail, "Show how <format>
 *            runs", remembered in this browser; the form takes the width. A
 *            first-time host gets a gallery of cards with "Planning a…"
 *            meeting chips; a host with history gets chips. On a phone the
 *            storyboard is a fold under Format.
 *   GUIDE    "Compare formats" opens the Format guide: the card widens to min(1760px,
 *            100vw−48px) for the walkthrough and seven format cards
 *            (components/FormatCompare), and narrows back on leaving.
 *
 *   NEITHER CHANGES SIZE WHILE OPEN. The card used to widen from 680 to
 *   1120px while the set list was open and narrow again on a pick, so the
 *   whole dialog moved twice. Now only the body swaps (Compare, the open
 *   chooser), and `gsd--wide` is gone (gameSetupPalette.test.js holds it so).
 *
 * THE BUG THE OWNER REPORTED ("the catagories of the old question set stay
 * up and the modal alignment is all wrong", README §2): the topics now sit
 * UNDER the set, full width, never in a shared row; they are not rendered at
 * all while the chooser is open; and they show only when the page says they
 * belong to the chosen set (`categoryStatus`, hooks/useSetCategoryLoader.js).
 * Until then: still placeholders at a stable height, Create reads "Loading
 * topics…", and a failure is a sentence with Retry. The payload's
 * categoryIds are filtered to the chosen set's list, so Create can never send
 * one set's categories for another.
 *
 * Kept from before, unchanged in substance: A COMPONENT, NOT A ROUTE (App.jsx
 * is a pathname switch with no history; a route would destroy the host
 * session). WHAT IT OWNS is the form; `eventTitle`, `categories` and
 * `activeCategoryIds` are per-game keys the page owns (config/gameSession.js).
 * WHAT IT RAISES is one payload with the selected category ids. RESET is
 * non-sticky (rendered by an early return, so each open mounts fresh — the
 * set is remembered PER FORMAT only while the dialog is open, README §6, and
 * the owner's "should not remember or preselect that last picked question
 * set" still holds). ONE WAY OUT, THREE DOORS: the X, Cancel and Escape go
 * through requestClose(); work in hand turns the foot into an inline
 * "Discard?". WHERE A HOST MAKES A SET: beside the picker, through
 * <HostQuestionSetsDialog> in the sibling layer (never a modal inside the
 * modal); `localSets` merges what it hands back so a new set can be picked
 * the moment it exists.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PICKER_GAME_TYPES, gameTypeMeta, normalizeGameType } from '../config/gameTypes';
import { NAMES_DEFAULT, namesMode } from '../config/surveyNames';
import Icon from './Icon';
import { setRefKey, parseSetRefKey, sameSetRef, DEFAULT_SCOPE } from '../utils/setRef';
import {
  isUnreadableSet, unreadableSetName, UNREADABLE_REASON,
} from '../utils/unreadableSet';
import HostQuestionSetsDialog from './HostQuestionSetsDialog';
import SessionOptions, { SessionCategories, SessionBriefing } from './SessionOptions';
import goalRules from '../../../lambda-functions/websocket/session-goal';
import Modal from './Modal';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import PlanLimitNotice from './PlanLimitNotice';
import StatusMessage from './StatusMessage';
import { BUILD_KIND, EVENT_KIND, kindLabel, kindIcon } from '../config/engagementKinds';
import { offeredForSessions } from '../config/setFinder';
import {
  formatGuide, isHandoffFormat, MEETING_TYPES,
  readHowHidden, writeHowHidden, isMacPlatform, createShortcutLabel, isCreateShortcut,
} from '../config/formatGuide';
import SetChooser from './SetChooser';
import { ENGAGE } from '../utils/setOwnerTag';
import FormatPicker from './FormatPicker';
import FormatCompare from './FormatCompare';
import MeetingTypeChips from './MeetingTypeChips';
import CreateSummary from './CreateSummary';
import FormatWalkthrough from './FormatWalkthrough';
import OtherFormatHandoff from './OtherFormatHandoff';
import { walkthroughFor } from '../config/formatWalkthrough';
import { setOwnerTag, YOURS } from '../utils/setOwnerTag';
import './GameSetupDialog.css';

const EMPTY_USES = new Map();

/*
  EVENT AND BUILD ROOM ARE FORMATS HERE TOO (2026-10-04), each with its own
  setup screen: picking one hands the title over (`onChooseOther`). Create
  mode only; Event only while events are switched on for the tier
  (`eventsAccess.enabled`), and on Free it says which plan brings them.
*/
const OTHER_LABELS = Object.freeze({
  [BUILD_KIND]: 'Set up the Build Room',
  [EVENT_KIND]: 'Continue to the event',
});

/** True while the window is at most `px` wide (false where there is no window). */
function useNarrow(px) {
  const query = `(max-width: ${px}px)`;
  const get = () => {
    try { return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false; } catch (e) { return false; }
  };
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else if (mq.removeListener) mq.removeListener(on); };
  }, [query]);
  return narrow;
}

/** The fold that the names line's "Change" opens, and the control it focuses. */
function openAdvancedAt(root, selector) {
  const fold = root && root.querySelector('details.gsd-adv');
  if (!fold) return;
  fold.open = true;
  const target = fold.querySelector(selector);
  if (target && target.focus) target.focus();
  if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
}

function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia)
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/*
  THE ENTRANCE, ONCE PER SECTION PER DIALOG (README round 4, "Motion"). A
  section that arrives after the dialog opened carries `gsd-reveal` for the
  length of its fade, then lets go of it, so swapping its contents later (a
  format change, a hand-off and back) never plays it again. A section on
  screen at open never fades. Under reduced motion the class is never put on
  (and the stylesheet declares the animation only under no-preference).
*/
function Reveal({ id, seen, ready, className = '', children, ...rest }) {
  const [animate, setAnimate] = useState(() => ready.current && !seen.current.has(id) && !prefersReducedMotion());
  useEffect(() => {
    seen.current.add(id);
    if (!animate) return undefined;
    const t = setTimeout(() => setAnimate(false), 400);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`gsd-slot${className ? ` ${className}` : ''}${animate ? ' gsd-reveal' : ''}`} data-reveal={id} {...rest}>
      {children}
    </div>
  );
}

/** "a title, a format and a question set" — the foot's list of what is missing. */
function neededWords(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export default function GameSetupDialog({
  /* 'create' (default) | 'edit' — edit is the same form pointed at an
     EXISTING unstarted session (`initialValues` from GET
     /games/{id}/host-details); format, set and shuffle are shown fixed. */
  mode = 'create',
  /** THE LAST REFUSAL, if the previous Create was turned away. */
  refusal = null,
  billingHref = '/admin?section=billing',
  initialValues = null,
  /** { enabled, canCreate, offerPlanName } from utils/eventsAccess.js, or null. */
  eventsAccess = null,
  /** (kind, { title }) => void — Event or Build Room chosen. Absent, neither is offered. */
  onChooseOther,
  isFirstEngagement = true,
  eventTitle = '',
  onEventTitleChange,
  /* A seam for a caller with a legitimate seed (a deep link); no caller passes
     it, on purpose — the owner retired remembering the last set. */
  initialSetId = '',
  initialSetScope = '',
  questionSets = [],
  /** The host's own recent uses of sets: the chooser's "Used by you lately". */
  recentSetUses = EMPTY_USES,
  /**
   * WHAT THE HOST'S HISTORY SAYS (README §6), derived by the page from the
   * GET /games read it already makes: has this account created a session
   * (chips, not the gallery) and the newest one's format (chosen on open). A novice
   * gets no format chosen and the full layout.
   */
  hasCreated = false,
  lastFormat = '',
  team = null,
  personas = [],
  categories = [],
  activeCategoryIds = new Set(),
  /**
   * WHOSE CATEGORIES `categories` ARE: { key, loading, error } from
   * hooks/useSetCategoryLoader.js, `key` a set reference key. Absent (an
   * older caller, the edit dialog), `categories` is taken as the chosen set's.
   */
  categoryStatus = undefined,
  /** (setId, scope) => void — the topics failed to load; try again. */
  onRetryCategories = null,
  onToggleCategory,
  onFormatChange,
  onQuestionSetChange,
  onCancel,
  onCreate,
  /* THE PAGE IS STILL WORKING ON THIS PRESS: the button looks taken and
     cannot be pressed twice (a second press was a second session). */
  busy = false,
}) {
  const isEdit = mode === 'edit';
  const seed = initialValues || {};

  /* ── which formats are offered ─────────────────────────────────────────── */
  const otherFormats = isEdit || !onChooseOther ? [] : [
    BUILD_KIND,
    ...(eventsAccess && eventsAccess.enabled ? [EVENT_KIND] : []),
  ];
  const offeredIds = [...PICKER_GAME_TYPES.map((t) => t.id), ...otherFormats];

  /* ── ONE LAYOUT (README round 3, option A) ─────────────────────────────
     The owner: "the guided vs quick is not intuitive". There is no mode: the
     form on the left, "How <format> runs" on the right, open by default. Its
     only control is Hide, which folds it to a rail; hidden, the form takes
     the width and the dialog never changes size. Remembered per browser
     (wrapped localStorage; lost, the pane shows). */
  const [howHidden, setHowHidden] = useState(() => (isEdit ? false : readHowHidden()));
  /* Focus follows the fold: to the rail when hidden, back to Hide when shown. */
  const howFocus = useRef(null);
  const toggleHow = (hidden) => {
    setHowHidden(hidden);
    writeHowHidden(hidden);
    howFocus.current = hidden ? '.gsd-how-rail' : '.gsd-how-hide';
  };
  useEffect(() => {
    const sel = howFocus.current;
    if (!sel) return;
    howFocus.current = null;
    const root = bodyRef.current && bodyRef.current.closest('[role="dialog"]');
    const el = root && root.querySelector(sel);
    if (el && el.focus) el.focus();
  }, [howHidden]);
  /* A PHONE (frames 10, 10b): formats folded behind "More", no meeting chips,
     a one-line head and a full-width Create (live dev tests B2, V1). */
  const phone = useNarrow(600);
  /* No room beside the form: "How it runs" is a fold under Format (frame
     3-A-recommended-390), following the same remembered choice. */
  const narrow = useNarrow(900);
  /* ROUND 4: on a phone the storyboard fold starts CLOSED (review A7): open,
     its stacked stages put the revealed Question set two screens down. Its
     own state, not the remembered Hide, so opening it on a phone never
     changes the pane on a laptop. */
  const [foldOpen, setFoldOpen] = useState(false);
  /* NOTHING CHOSEN YET IS WHEN THE STORYBOARD HELPS MOST (live check, round
     3): the pane shows the gallery card under the pointer or focus, and
     otherwise Call & Answer, said plainly to be an example. Debounced both
     ways, so crossing the gallery does not flicker the pane. */
  const [hoverFormat, setHoverFormat] = useState('');
  const hoverTimer = useRef(null);
  const previewFormat = (id) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverFormat(id || ''), id ? 150 : 250);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Seeded once, not controlled. A novice opens with NO format chosen (README
  // §3.1: a novice never asked to choose never learns a choice exists); a
  // host with history opens on their last one.
  const [engagementType, setEngagementType] = useState(() => {
    if (isEdit) return seed.gameType || 'call-and-answer';
    return offeredIds.includes(lastFormat) ? lastFormat : '';
  });
  const formatTouched = useRef(false);
  // The history read may land after the dialog opened: apply it then, unless
  // the host has already chosen.
  useEffect(() => {
    if (isEdit || formatTouched.current || engagementType) return;
    if (lastFormat && offeredIds.includes(lastFormat)) setEngagementType(lastFormat);
  }, [lastFormat]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    THE SELECTION IS A PAIR, held as the encoded key (utils/setRef.js):
    `teamretro` names a different set in each of platform, org and public.
  */
  const [newGameSetKey, setNewGameSetKey] = useState(() => (isEdit
    ? setRefKey({ id: seed.questionSetId || '', scope: seed.questionSetScope })
    : setRefKey({ id: initialSetId || '', scope: initialSetScope })));
  const newGameSetRef = parseSetRefKey(newGameSetKey);
  const newGameSetId = newGameSetRef.id;
  /* THE SET, PER FORMAT, WHILE THE DIALOG IS OPEN (README §6): arrowing
     C&A → Trivia → C&A restores the C&A set instead of clearing it. */
  const setByFormat = useRef({});
  /* THE REVEAL LATCH (README round 4): true from the first time a set is
     picked in this dialog, and never false again while it is open. Seeded
     true on an edit, where everything shows from the start. */
  const [revealLatch, setRevealLatch] = useState(isEdit || Boolean(newGameSetId));
  const revealed = revealLatch || Boolean(newGameSetId);
  useEffect(() => { if (newGameSetId && !revealLatch) setRevealLatch(true); }, [newGameSetId, revealLatch]);
  /* Which sections have been on screen (each fades in once), and whether the
     dialog has drawn its first frame (what is there at open never fades). */
  const seenSections = useRef(new Set());
  const dialogReady = useRef(false);
  useEffect(() => { dialogReady.current = true; }, []);
  /* The Question set reveal is announced once per dialog (review A2). A slot
     already on screen (a host's last format, the history read landing) has
     nothing to announce. */
  const setAnnounced = useRef(false);
  const [eventDetails, setEventDetails] = useState(isEdit ? (seed.details || '') : '');
  const [gameAiContext, setGameAiContext] = useState(isEdit ? (seed.aiContext || '') : '');
  const [newGamePersonaId, setNewGamePersonaId] = useState(isEdit ? (seed.personaId || '') : '');
  const [newGamePromptId, setNewGamePromptId] = useState(isEdit ? (seed.promptId || '') : '');
  const [randomizeQuestions, setRandomizeQuestions] = useState(isEdit ? seed.randomizeQuestions !== false : true);
  const [anonymousResponses, setAnonymousResponses] = useState(isEdit ? seed.anonymousUntilReveal !== false : true);
  // A SURVEY'S NAMES: seeded from the session, else Anonymous, then from the
  // chosen set's own default until the host picks.
  const [namesChoice, setNamesChoice] = useState(isEdit ? namesMode(seed.names).id : NAMES_DEFAULT);
  const namesTouched = useRef(isEdit);
  // WORKIE'S BRIEFING — Call & Answer only; kept while open even if the format
  // moves away; Create waits while a document is being read.
  const [briefing, setBriefing] = useState(isEdit ? (seed.briefing || null) : null);
  const [briefingWorking, setBriefingWorking] = useState(false);
  const [target, setTarget] = useState(isEdit && Number.isInteger(seed.target) ? seed.target : null);
  const pickNames = (id) => {
    namesTouched.current = true;
    setNamesChoice(namesMode(id).id);
  };
  /** The sets dialog, and the route it opens on ('' | 'manual' | 'ai' | 'template'). */
  const [setsDialog, setSetsDialog] = useState(null);
  /** Sets seen by <HostQuestionSetsDialog>, including any just created. */
  const [localSets, setLocalSets] = useState(null);
  /** The set chooser's full list is open: the body folds to the Questions step. */
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserClose, setChooserClose] = useState(0);
  /** 'form' | 'compare' — the body swap; the card stays the same size. */
  const [view, setView] = useState('form');
  /** The meeting chip pressed, and so the reason line. */
  const [meeting, setMeeting] = useState('');
  /** Full mode shows the gallery until the first set is picked, then chips. */
  const [galleryDone, setGalleryDone] = useState(isEdit);
  /** One polite announcement at a time (the ⌘↵ hand-off, a set picked for you). */
  const [announce, setAnnounce] = useState('');
  /** "Your earlier topic picks were for the other set." */
  const [clearedNote, setClearedNote] = useState('');
  /* ⌘/Ctrl+Enter pressed while the chosen set's topics were still loading:
     the create is QUEUED and happens the moment they arrive (live dev test 2
     E2 — it used to be swallowed silently). */
  const [pendingCreate, setPendingCreate] = useState(false);
  /* Where focus goes back to when Compare closes (live dev test 3 H4). */
  const compareReturn = useRef(null);

  const [localTitle, setLocalTitle] = useState(isEdit ? (seed.title || '') : '');
  // EDIT OWNS ITS OWN CATEGORY SELECTION: the session edited is not on stage.
  const [editCategoryNames, setEditCategoryNames] = useState(
    () => new Set(isEdit ? (seed.selectedCategoryNames || []) : [])
  );
  const toggleEditCategory = (name) => {
    setEditCategoryNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const selectedCats = isEdit ? editCategoryNames : activeCategoryIds;
  const title = isEdit ? localTitle : eventTitle;
  const changeTitle = (value) => {
    if (isEdit) setLocalTitle(value);
    else onEventTitleChange?.(value);
  };

  const hasFormat = Boolean(engagementType);
  /** Event or Build Room: set up on its own screen, not by this form. */
  const isOther = isHandoffFormat(engagementType);
  const eventBlocked = engagementType === EVENT_KIND && !(eventsAccess && eventsAccess.canCreate);
  const isCallAndAnswer = hasFormat && !isOther && normalizeGameType(engagementType) === 'call-and-answer';
  const isSurvey = hasFormat && !isOther && normalizeGameType(engagementType) === 'survey';
  const formatLabel = hasFormat ? (isOther ? kindLabel(engagementType) : gameTypeMeta(engagementType).label) : '';

  // Merged by the PAIR, page copy first.
  const allSets = useMemo(() => {
    if (!localSets) return questionSets;
    const byRef = new Map(localSets.map((set) => [setRefKey(set), set]));
    for (const set of questionSets) byRef.set(setRefKey(set), set);
    return Array.from(byRef.values());
  }, [questionSets, localSets]);

  const sessionSets = allSets.filter(offeredForSessions);
  const setsForType = hasFormat ? sessionSets.filter((set) => set.engagementType === engagementType) : [];
  const chosenSet = allSets.find((s) => sameSetRef(s, newGameSetRef)) || null;
  const chosenCount = chosenSet ? Number(chosenSet.totalQuestions) || 0 : 0;
  // An edit gates the goal by the whole-number rule only; the PUT checks the
  // pinned version's size (final review Minor 1b).
  const goalBound = isEdit ? 0 : chosenCount;
  const goalProblem = !hasFormat || isSurvey || isOther ? '' : (goalRules.checkTarget(target, goalBound).error || '');

  /*
    ── WHOSE CATEGORIES THESE ARE (README §2b) ───────────────────────────────
    Only the chosen set's list is shown or sent. Anything else — the previous
    set's list still in the page's state, a response on its way — reads as
    loading, never as the old chips.
  */
  const tracked = !isEdit && categoryStatus !== undefined && categoryStatus !== null;
  const catsForChosen = !tracked || categoryStatus.key === newGameSetKey;
  const categoriesLoading = tracked && Boolean(newGameSetId) && (!catsForChosen || categoryStatus.loading);
  const categoriesError = tracked && catsForChosen && !categoryStatus.loading ? (categoryStatus.error || '') : '';
  const shownCategories = categoriesLoading || categoriesError ? [] : categories;

  // A draft still being written would be lost by a Create pressed now; a goal
  // the set cannot meet would only be refused; topics still loading would be
  // the wrong set's.
  const canCreate = isOther
    ? !eventBlocked
    : hasFormat && Boolean(newGameSetId) && title.trim().length > 0
      && !(isCallAndAnswer && briefingWorking) && !goalProblem && !categoriesLoading;

  const chosenSetPromptId = chosenSet ? (chosenSet.promptId || '') : '';
  /* Everything but the topics is ready: the one case a create may wait for. */
  const readyButTopics = !isOther && hasFormat && Boolean(newGameSetId) && title.trim().length > 0
    && !(isCallAndAnswer && briefingWorking) && !goalProblem && categoriesLoading;

  useEffect(() => { if (hasFormat && !isOther) setAnnounced.current = true; });

  // The page reloads the voices that suit this format.
  useEffect(() => {
    if (engagementType && !isHandoffFormat(engagementType)) onFormatChange?.(engagementType);
  }, [engagementType]); // eslint-disable-line react-hooks/exhaustive-deps

  const tellPageSet = (key) => {
    if (!key) { onQuestionSetChange?.('', DEFAULT_SCOPE); return; }
    const ref = parseSetRefKey(key);
    onQuestionSetChange?.(ref.id, ref.scope);
  };

  /*
    THE TOPIC PICKS COME BACK WITH THE SET (live dev tests B8, E5-adjacent):
    arrowing C&A → Trivia → C&A restored the set but turned every topic on
    again. The picks are remembered per format beside the set, and re-applied
    through the page's own toggle once that set's list has arrived.
  */
  const picksByFormat = useRef({});
  const pendingPicks = useRef(null);
  useEffect(() => {
    const want = pendingPicks.current;
    if (!want || want.key !== newGameSetKey || !catsForChosen || categoriesLoading || categories.length === 0) return;
    pendingPicks.current = null;
    for (const c of categories) {
      if (want.picks.has(c.name) !== activeCategoryIds.has(c.name)) onToggleCategory?.(c.name);
    }
  });

  /*
    WHAT A FORMAT CHOICE SAYS (README round 4, "Announcements"): "Question set
    is below." the first time it appears, "Next: the … page, below." on each
    swap to a hand-off format, and nothing otherwise — returning to a session
    format, or arrowing between two, says nothing new.
  */
  const formatMessage = (typeId) => {
    if (isHandoffFormat(typeId)) {
      return `Next: ${typeId === BUILD_KIND ? 'the Build Room page' : 'the event page'}, below.`;
    }
    if (setAnnounced.current || isEdit) return '';
    setAnnounced.current = true;
    return 'Question set is below.';
  };
  const chooseFormat = (typeId, lead = '') => {
    if (typeId === engagementType) return;
    formatTouched.current = true;
    setAnnounce([lead, formatMessage(typeId)].filter(Boolean).join(' '));
    setPendingCreate(false);
    if (engagementType) {
      setByFormat.current[engagementType] = newGameSetKey;
      // Only a real choice is worth restoring: some topics off, the list in.
      picksByFormat.current[engagementType] = !isEdit && newGameSetKey && catsForChosen && !categoriesLoading
        && categories.length > 0 && activeCategoryIds.size > 0 && activeCategoryIds.size < categories.length
        ? { key: newGameSetKey, picks: new Set(activeCategoryIds) } : null;
    }
    const savedPicks = picksByFormat.current[typeId];
    const restoreKey = isHandoffFormat(typeId) ? '' : (setByFormat.current[typeId] || '');
    pendingPicks.current = savedPicks && savedPicks.key === restoreKey ? savedPicks : null;
    setEngagementType(typeId);
    // A hand-off format has no set to pick: fold the gallery to chips so its
    // "Next:" panel is in view (frames 7, 8).
    if (isHandoffFormat(typeId)) setGalleryDone(true);
    // A set belongs to exactly one format — so the previous choice cannot
    // survive the switch — but the set this format had while the dialog has
    // been open comes back (README §6).
    const restored = isHandoffFormat(typeId) ? '' : (setByFormat.current[typeId] || '');
    setNewGameSetKey(restored);
    tellPageSet(restored);
    setClearedNote('');
    // A voice picked for the old format may not exist for the new one, and an
    // approach is written for exactly one format.
    setNewGamePersonaId('');
    setNewGamePromptId('');
  };

  const chooseSet = (key) => {
    pendingPicks.current = null;
    const hadCustomPicks = !isEdit && Boolean(newGameSetKey) && key !== newGameSetKey
      && categories.length > 0 && activeCategoryIds.size > 0 && activeCategoryIds.size < categories.length;
    setNewGameSetKey(key);
    setGalleryDone(true);
    // BOTH HALVES go to the page: the categories and instruction reads are
    // per-partition too.
    tellPageSet(key);
    const set = allSets.find((s) => sameSetRef(s, parseSetRefKey(key)));
    setClearedNote(hadCustomPicks
      ? `Topics refreshed for “${set ? set.name : 'the new set'}”. Your earlier picks were for the other set, so every topic is on again.`
      : '');
    if (isSurvey && !namesTouched.current) setNamesChoice(namesMode(set && set.namesDefault).id);
  };

  /*
    A SET MADE THROUGH ONE OF THE ROUTES COMES BACK PICKED (frame 5c). The
    sets dialog hands back its whole list whenever it changes; a set of this
    format that was not there when the route opened is the one just made.
    A set made by the AI builder is a draft, switched off until reviewed, so
    it is not in that list yet — the route's note says so.
  */
  const knownWhenOpened = useRef(null);
  const takeSets = (list) => {
    setLocalSets(list);
    // The FIRST list the sets dialog reports is its baseline: it is read in
    // its own projection, so comparing it with the page's copy would mistake
    // every set the host already had for a new one.
    if (knownWhenOpened.current === 'baseline') {
      knownWhenOpened.current = new Set((list || []).map(setRefKey));
      return;
    }
    if (!(knownWhenOpened.current instanceof Set) || !hasFormat || isOther) return;
    const fresh = (list || []).find((s) => s.engagementType === engagementType
      && !knownWhenOpened.current.has(setRefKey(s)) && !isUnreadableSet(s));
    if (fresh) {
      knownWhenOpened.current.add(setRefKey(fresh));
      chooseSet(setRefKey(fresh));
      setAnnounce(`“${fresh.name}” is picked for this engagement.`);
    }
  };
  const openSets = (route = '') => {
    knownWhenOpened.current = 'baseline';
    setSetsDialog(route);
  };

  /** SessionOptions reports each change under the payload's own key. */
  const changeOptions = (patch) => {
    if ('anonymousResponses' in patch) setAnonymousResponses(patch.anonymousResponses);
    if ('randomizeQuestions' in patch) setRandomizeQuestions(patch.randomizeQuestions);
    if ('names' in patch) pickNames(patch.names);
    if ('target' in patch) setTarget(patch.target);
    if ('personaId' in patch) setNewGamePersonaId(patch.personaId);
    if ('promptId' in patch) setNewGamePromptId(patch.promptId);
    if ('aiContext' in patch) setGameAiContext(patch.aiContext);
    if ('eventDetails' in patch) setEventDetails(patch.eventDetails);
  };

  /*
    CREATE PRESSED EARLY (README round 4; review A1): the button is never
    inert. Click, Enter or ⌘/Ctrl+Enter takes the focus to the first gap — the
    title, then the format's tab stop, then the set search — and says which.
    Everything in but the topics queues the create, as ⌘↵ always has.
  */
  const pressEarly = () => {
    if (isOther) {
      if (eventBlocked) setAnnounce(`Events come with the ${(eventsAccess && eventsAccess.offerPlanName) || 'paid plan'}, so there is nothing to continue to.`);
      return;
    }
    if (readyButTopics) {
      setPendingCreate(true);
      setAnnounce('Waiting for this set’s topics. It will be created as soon as they arrive.');
      return;
    }
    const root = bodyRef.current;
    if (!title.trim()) {
      if (chooserOpen) setChooserClose((n) => n + 1);
      setTimeout(() => titleRef.current?.focus(), 0);
      setAnnounce('Add a title first.');
      return;
    }
    if (!hasFormat) {
      focusFormat();
      setAnnounce('Pick a format first.');
      return;
    }
    if (!newGameSetId) {
      const search = root && root.querySelector('#gsd-set-search');
      if (search) search.focus();
      setAnnounce('Pick a question set first.');
      return;
    }
    if (isCallAndAnswer && briefingWorking) { setAnnounce('Waiting for Workie to finish the briefing.'); return; }
    if (goalProblem) setAnnounce(goalProblem);
  };

  const submit = () => {
    if (busy) return;
    if (!canCreate) { pressEarly(); return; }
    if (isOther) {
      onChooseOther?.(engagementType, { title: title.trim() });
      return;
    }
    // An edit that deselected every category is refused HERE.
    if (isEdit && categories.length > 0 && editCategoryNames.size === 0) return;
    // NEVER ONE SET'S CATEGORIES FOR ANOTHER (README §2b.4): only names on
    // the chosen set's own list travel.
    const known = new Set(shownCategories.map((c) => c.name));
    const ids = Array.from(selectedCats || []);
    onCreate?.({
      title,
      gameType: engagementType,
      setId: newGameSetId,
      // WHICH LIBRARY that id is in (createGameBody sends questionSetScope).
      setScope: newGameSetRef.scope,
      categoryIds: tracked ? ids.filter((name) => known.has(name)) : ids,
      eventDetails,
      aiContext: gameAiContext,
      personaId: newGamePersonaId,
      promptId: newGamePromptId,
      // A survey is never shuffled, whatever the (hidden) card last said.
      randomizeQuestions: isSurvey ? false : randomizeQuestions,
      anonymousResponses,
      ...(isSurvey ? { names: namesChoice } : {}),
      ...(isSurvey ? {} : { target }),
      ...(isCallAndAnswer
        ? { briefing: briefing && briefing.text && briefing.text.trim() ? briefing : null }
        : {}),
    });
  };

  /* ── WORK IN HAND ─────────────────────────────────────────────────────── */
  const snapshot = JSON.stringify([
    title, engagementType, newGameSetKey, eventDetails, gameAiContext,
    newGamePersonaId, newGamePromptId, randomizeQuestions, anonymousResponses, namesChoice, target,
    isEdit ? Array.from(editCategoryNames).sort() : null,
    briefing ? briefing.text : null, briefingWorking,
  ]);
  const openedAs = useRef(snapshot);
  // The history read choosing the last format is not the host's work.
  useEffect(() => {
    if (!formatTouched.current && !isEdit) openedAs.current = snapshot;
  }, [engagementType]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = snapshot !== openedAs.current;

  const [confirmingClose, setConfirmingClose] = useState(false);
  const keepEditingRef = useRef(null);
  const cancelRef = useRef(null);
  const primaryRef = useRef(null);
  const confirmShown = useRef(false);
  /* Dismissed by going back to the form: the focus stays where the host put it. */
  const quietDismiss = useRef(false);
  useEffect(() => {
    if (confirmingClose) {
      confirmShown.current = true;
      keepEditingRef.current?.focus();
    } else if (confirmShown.current && !quietDismiss.current) {
      cancelRef.current?.focus();
    }
    quietDismiss.current = false;
  }, [confirmingClose]);
  const dismissDiscard = () => {
    if (!confirmingClose) return;
    quietDismiss.current = true;
    setConfirmingClose(false);
  };

  const requestClose = () => {
    // Read now, not from the render: the history read can re-baseline the form
    // in an effect after this render was drawn.
    if (snapshot === openedAs.current) { onCancel?.(); return; }
    setConfirmingClose(true);
  };
  /** Escape — the Modal's one close path. While the foot asks, it is Keep editing. */
  const escape = () => {
    if (confirmingClose) setConfirmingClose(false);
    else if (view === 'compare') { focusAfter.current = compareReturn.current || '.gsd-compare-link'; setView('form'); }
    else requestClose();
  };

  /* ── the title moves on, and ⌘/Ctrl+Enter creates ─────────────────────── */
  const bodyRef = useRef(null);
  /* FOCUS FOLLOWS THE BODY SWAP (live dev test 3 H4): opening Compare puts it
     on Compare's heading; leaving puts it back on the link (or on the format
     "Use …" chose). Never dropped to <body>. */
  const focusAfter = useRef(null);
  useEffect(() => {
    const sel = focusAfter.current;
    if (!sel) return;
    focusAfter.current = null;
    const el = bodyRef.current && bodyRef.current.querySelector(sel);
    if (el && el.focus) el.focus();
  }, [view]);
  const titleRef = useRef(null);
  const focusFormat = () => {
    const stop = bodyRef.current && bodyRef.current.querySelector('.gsd-fmt[tabindex="0"]');
    if (stop) stop.focus();
  };
  /** Enter in the title goes to the next empty decision (README §8). */
  const titleKey = (event) => {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!engagementType) { focusFormat(); return; }
    if (isOther) { primaryRef.current?.focus(); return; }
    if (!newGameSetId) {
      const search = bodyRef.current && bodyRef.current.querySelector('#gsd-set-search');
      if (search) search.focus();
    }
  };
  // Title autofocus on a create (frame 1's focus ring). Not on an edit, where
  // the host came to change something specific.
  // A tick late, on purpose: the Modal records the element that opened it in
  // its own mount effect, which runs after this child's, and must record the
  // opener — not this input — to give focus back on close.
  useEffect(() => {
    if (isEdit) return undefined;
    const t = setTimeout(() => { if (titleRef.current) titleRef.current.focus(); }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mac = useMemo(() => isMacPlatform(), []);
  const shortcut = createShortcutLabel(mac);
  const latest = useRef({});
  latest.current = {
    canCreate, busy, isOther, confirmingClose, submit, readyButTopics, eventBlocked, pressEarly,
    planName: (eventsAccess && eventsAccess.offerPlanName) || 'paid plan',
  };
  useEffect(() => {
    const onKey = (event) => {
      if (!isCreateShortcut(event)) return;
      const root = bodyRef.current && bodyRef.current.closest('[role="dialog"]');
      if (!root) return;
      // Inside the dialog, or on <body> while it is open: a pick that
      // unmounted the focused control must not cost the shortcut (devtest E1).
      const target = event.target;
      const onBody = !target || target === document.body || target === document.documentElement;
      if (!onBody && !root.contains(target)) return;
      const now = latest.current;
      if (now.confirmingClose) return;
      event.preventDefault();
      // NEVER LEAVES on the shortcut (README §6): a hand-off format moves the
      // focus to its own labelled Continue and says so; only Enter or a click
      // there navigates. A disabled Continue takes no focus, so it says why.
      if (now.isOther) {
        if (now.eventBlocked) {
          setAnnounce(`Events come with the ${now.planName}, so there is nothing to continue to.`);
          return;
        }
        primaryRef.current?.focus();
        setAnnounce(`${shortcut} moved to Continue. Press Enter there to go.`);
        return;
      }
      if (now.busy) return;
      if (now.canCreate) { now.submit(); return; }
      // Not ready: the same path as pressing Create (the topics queue first).
      now.pressEarly();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);
  // The queued create goes the moment it can; a failed load cancels it.
  useEffect(() => {
    if (!pendingCreate) return;
    if (canCreate && !busy) { setPendingCreate(false); latest.current.submit(); return; }
    if (!readyButTopics) setPendingCreate(false);
  }, [pendingCreate, canCreate, busy, readyButTopics]);

  /* ── the format options ───────────────────────────────────────────────── */
  const formatOptions = offeredIds.map((id) => {
    const handoff = isHandoffFormat(id);
    const guide = formatGuide(id);
    return {
      id,
      label: handoff ? kindLabel(id) : gameTypeMeta(id).label,
      icon: handoff ? kindIcon(id) : gameTypeMeta(id).icon,
      // The card's one sentence (frame 2-03); "Good for" lives in the guide.
      short: guide.col,
      // A hand-off's three-word line under "Bigger than one session" (round 4).
      tag: guide.tag || '',
      handoff,
      lastUsed: !isEdit && hasCreated && id === lastFormat,
    };
  });
  const meetingTypes = MEETING_TYPES.filter((m) => offeredIds.includes(m.format));
  /* A chip's reason and the reveal are ONE message (review A2): two polite
     messages from one press interrupt each other. */
  const pickMeeting = (m) => {
    setMeeting(m.id);
    const reason = `For a ${m.label.toLowerCase()}: ${kindLabel(m.format)}. ${m.reason}`;
    if (m.format === engagementType) setAnnounce(reason);
    else chooseFormat(m.format, reason);
  };
  /* Any other way of choosing a format lets go of a meeting chip that no
     longer describes the choice (live dev test 1 B4: "Use Trivia" from
     Compare left "For a retro: Call & Answer" on screen). */
  const chooseFormatDirect = (id) => {
    const m = meeting ? MEETING_TYPES.find((x) => x.id === meeting) : null;
    if (!m || m.format !== id) setMeeting('');
    chooseFormat(id);
  };
  const meetingReason = meeting ? MEETING_TYPES.find((m) => m.id === meeting) : null;
  /* The gallery is for someone who has never created a session (README
     round 2, decision 2); a host who has gets chips, in either view. */
  const showGallery = !isEdit && !galleryDone && !hasCreated;

  /* ── the foot ─────────────────────────────────────────────────────────── */
  let footNote = null;
  let footIcon = 'Lock';
  /* STILL NEEDED (README round 4): beside the button it is about, read through
     its aria-describedby, and NOT a live region (review A5) — it changes with
     every keystroke that empties or fills the title. */
  const needed = [
    ...(title.trim() ? [] : ['a title']),
    ...(hasFormat ? [] : ['a format']),
    ...(newGameSetId ? [] : ['a question set']),
  ];
  const showNeed = !canCreate && !isOther && !isEdit && view !== 'compare' && needed.length > 0;
  if (showNeed) { footNote = null; footIcon = 'Info'; }
  else if (isEdit) footNote = 'This session has not started, so nobody can join it yet.';
  else if (isSurvey) { footNote = 'People can answer as soon as you open it. There is no separate Start.'; footIcon = 'Warning'; }
  else if (isOther) { footNote = `Nothing is created yet. ${shortcut} moves to Continue; press Enter there to go.`; footIcon = 'Info'; }
  else if (view === 'compare') { footNote = 'Choosing a format. Use one, or go back to the form.'; footIcon = 'Info'; }
  else footNote = 'Nobody can join until you start it.';

  let primaryLabel;
  if (busy) primaryLabel = isEdit ? 'Saving…' : (isSurvey ? 'Opening…' : 'Creating…');
  else if (isEdit) primaryLabel = 'Save changes';
  else if (OTHER_LABELS[engagementType]) primaryLabel = OTHER_LABELS[engagementType];
  else if (pendingCreate) primaryLabel = 'Waiting for topics…';
  else if (categoriesLoading) primaryLabel = 'Loading topics…';
  else if (isSurvey) primaryLabel = 'Open the survey';
  // Frame 10: one word where the foot is a phone's width.
  else primaryLabel = phone ? 'Create' : 'Create engagement';
  let primaryTitle;
  if (isCallAndAnswer && briefingWorking) primaryTitle = 'Waiting for Workie to finish the briefing';
  else if (goalProblem) primaryTitle = goalProblem;

  const editChanged = [];
  if (isEdit) {
    if (title !== (seed.title || '')) editChanged.push('title');
    const seededCats = new Set(seed.selectedCategoryNames || []);
    const off = Array.from(seededCats).filter((n) => !editCategoryNames.has(n)).length;
    const on = Array.from(editCategoryNames).filter((n) => !seededCats.has(n)).length;
    if (off) editChanged.push(`${off} topic${off === 1 ? '' : 's'} switched off`);
    if (on) editChanged.push(`${on} topic${on === 1 ? '' : 's'} switched on`);
    if (dirty && editChanged.length === 0) editChanged.push('options');
  }

  const refusalNode = refusal && refusal.blocked ? (
    <PlanLimitNotice refusal={refusal} outcome="Nothing was created." surface="dusk" billingHref={billingHref} />
  ) : refusal ? (
    <div className="gsd-refusal" role="alert" data-testid="gsd-refusal">
      Could not create the session: {refusal.message || 'unknown error'}.
    </div>
  ) : null;

  const showSide = !chooserOpen && view === 'form';
  const hovered = !hasFormat && hoverFormat && offeredIds.includes(hoverFormat) ? hoverFormat : '';
  const paneFormat = hasFormat ? engagementType : (hovered || 'call-and-answer');
  let panePreview = '';
  if (!hasFormat) panePreview = hovered ? 'hover' : 'example';
  /* Fork 1 A: nothing chosen and nothing pointed at — the quiet pane. */
  const paneExampleOnly = !hasFormat && !hovered;
  const paneLabel = isHandoffFormat(paneFormat) ? kindLabel(paneFormat) : gameTypeMeta(paneFormat).label;
  const paneStages = (walkthroughFor(paneFormat) || { stages: [] }).stages.length;
  const headingText = isEdit ? 'Edit session' : (isFirstEngagement ? 'New engagement' : 'Start a new engagement');

  /* ── the make-your-own routes (frame 5c) ──────────────────────────────── */
  const makeRoutes = isEdit || !hasFormat || isOther ? [] : [
    { id: 'manual', icon: 'PencilSimple', label: 'Write your own questions', desc: 'Opens a new set of this format for you to write.', onPick: () => openSets('manual') },
    { id: 'ai', icon: 'Sparkle', label: 'Make a set with Workie', desc: 'Describe your meeting and Workie, Engage’s AI assistant, drafts questions for you to review.', onPick: () => openSets('ai') },
    { id: 'template', icon: 'FileText', label: 'Fill in a spreadsheet', desc: 'Download the template, add your questions, upload it.', onPick: () => openSets('template') },
  ];
  // ONE SENTENCE FOR ALL THREE (live dev test 1 C8: the note and the cards disagreed).
  const routesNote = 'Whichever way you make it, the new set is picked for this engagement once it is saved and switched on. A set Workie drafts waits for your review first.';

  /* ── the Question set slot (README round 4) ──────────────────────────────
     Not drawn until a format is chosen. A hand-off format puts its "Next:"
     panel in the SAME slot; a session format brings the set back. */
  const ownsSetOfFormat = setsForType.some((set) => setOwnerTag(set) === YOURS);
  const setIntro = 'The questions you will ask. Start from a ready-made set; you can switch topics off once it is picked.';
  const questionsStep = !hasFormat ? null : isOther ? (
    <section className="gsd-step" aria-labelledby="gsd-next-label">
      <h3 className="gsd-step-h" id="gsd-next-label">Next: {engagementType === BUILD_KIND ? 'the Build Room page' : 'the event page'}</h3>
      <OtherFormatHandoff
        kind={engagementType}
        title={title}
        blocked={eventBlocked}
        planName={eventsAccess && eventsAccess.offerPlanName}
        billingHref={billingHref}
      />
    </section>
  ) : (
    <section className="gsd-step" aria-labelledby="gsd-set-label">
      <h3 className="gsd-step-h" id="gsd-set-label">
        Question set
        {chooserOpen && <span className="gsd-req">Required</span>}
      </h3>
      {/* THE SET CHOOSER (issue #41): pair keys, the refusal of an unreadable
          set and the pinned set on an edit all carry over. */}
      <SetChooser
        key={engagementType}
        sets={setsForType}
        value={newGameSetKey}
        onChange={(key) => chooseSet(key)}
        keyOf={setRefKey}
        recent={recentSetUses}
        formatLabel={formatLabel}
        teamName={(team && team.name) || ''}
        otherTeams={(team && team.others) || []}
        onSwitchTeam={team && team.onSwitch ? team.onSwitch : null}
        isUnreadable={isUnreadableSet}
        unreadableLabel={(set) => `${unreadableSetName(set)}: unreadable, cannot be used`}
        unreadableReason={UNREADABLE_REASON}
        disabled={isEdit}
        pinnedLabel={newGameSetId}
        // "Make a new set" lands on the new-set panel, never the library above it (devtest 1 B3).
        onMakeSet={isEdit ? null : () => openSets('template')}
        otherFormats={isEdit ? [] : PICKER_GAME_TYPES
          .filter((type) => type.id !== engagementType)
          .map((type) => ({
            label: type.label,
            sets: sessionSets.filter((set) => set.engagementType === type.id),
            onPick: () => chooseFormatDirect(type.id),
          }))}
        makeRoutes={makeRoutes}
        makeRoutesNote={routesNote}
        shortPlaceholder={phone}
        recentsFirst={!isEdit}
        intro={isEdit ? '' : setIntro}
        ownerLabels={{ [ENGAGE]: 'Ready-made' }}
        ownerHeading="Whose"
        hideUnfiled
        closeSignal={chooserClose}
        idPrefix="gsd-set"
        theme="dark"
        wide
        onOpenChange={setChooserOpen}
      />
      {/* THE ENTRY POINT in create mode. "Your question sets" only for a host
          who owns a set of this format; otherwise one link (round 4). While
          the chooser is open it carries its own Make a new set. */}
      {!isEdit && !chooserOpen && (
        <p className="gsd-setlinks">
          {ownsSetOfFormat ? (
            <>
              <button type="button" className="gsd-setlink" onClick={() => openSets('')}>Your question sets</button>
              <span aria-hidden="true"> · </span>
              <button type="button" className="gsd-setlink" onClick={() => openSets('template')}>Make a new set</button>
            </>
          ) : (
            <button type="button" className="gsd-setlink" onClick={() => openSets('template')}>Make your own set</button>
          )}
        </p>
      )}
      {!isEdit && setsForType.length === 0 && (
        <small className="dialog-help-text">
          No {formatLabel} sets yet. Make one now: write your own, ask Workie, or fill in a spreadsheet.
        </small>
      )}
      {isEdit && (
        <p className="gsd-fixed"><Icon name="Lock" size={13} /> Fixed once a session is created.</p>
      )}
    </section>
  );

  /* ── the topics, UNDER the set, never beside it (README §2a) ──────────── */
  const topicsBlock = hasFormat && !isOther && !isSurvey && newGameSetId && !chooserOpen ? (
    <>
      {clearedNote && <StatusMessage message={clearedNote} tone="pending" className="status-message gsd-cleared" />}
      <SessionCategories
        categories={shownCategories}
        selected={selectedCats}
        editing={isEdit}
        label="Topics in this set"
        bareCount
        noun="topics"
        hint="Switch off any you want to skip."
        loading={categoriesLoading}
        error={categoriesError}
        onRetry={onRetryCategories ? () => onRetryCategories(newGameSetId, newGameSetRef.scope) : null}
        onAllOn={isEdit
          ? () => setEditCategoryNames(new Set(categories.map((c) => c.name)))
          : null}
        onToggle={(name) => (isEdit ? toggleEditCategory(name) : onToggleCategory?.(name))}
      />
    </>
  ) : null;

  /* ── the names, stated plainly where the decision is made (README §6) ─── */
  const advRoot = () => bodyRef.current;
  let namesBlock = null;
  if (isCallAndAnswer && !chooserOpen && revealed) {
    namesBlock = (
      <div className="gsd-namesline" data-testid="gsd-namesline">
        <Icon name={anonymousResponses ? 'EyeSlash' : 'Eye'} size={16} />
        <div>
          <b>{anonymousResponses ? 'Names are hidden until the vote closes' : 'Names are shown from the start'}</b>
          <span>
            {anonymousResponses
              ? ' While people answer and vote, nobody sees who wrote what, not even you. Names are shown with the results.'
              : ' Every answer carries its author’s name from the moment voting opens.'}
          </span>
        </div>
        <button
          type="button"
          className="gsd-btn"
          aria-label="Change how names are shown"
          onClick={() => openAdvancedAt(advRoot(), '.gsd-opt-head input[type="checkbox"]')}
        >
          Change
        </button>
      </div>
    );
  } else if (isSurvey && !chooserOpen && revealed) {
    namesBlock = (
      <div className="gsd-namesline is-compact" data-testid="gsd-namesline">
        <Icon name="EyeSlash" size={16} />
        <div><b>Names: {namesMode(namesChoice).label}</b> · locked when it opens</div>
        <button
          type="button"
          className="gsd-btn"
          aria-label="Change the names rule"
          onClick={() => openAdvancedAt(advRoot(), '.gsd-three-opt[aria-checked="true"]')}
        >
          Change
        </button>
      </div>
    );
  }

  const workieIntro = 'Workie is Engage’s AI assistant: after each round it sums up what the room said. Background makes that summary speak to your situation.';
  const optionalBlock = hasFormat && !isOther && revealed ? (
    <div className="gsd-optional" hidden={chooserOpen || undefined}>
      {/* TWO QUIET FOLD LINES (round 4: no "Optional — every one has a safe
          default" header). Open on its own when it holds a briefing. */}
      {isCallAndAnswer && (
        <details className="gsd-brief-fold" open={Boolean((briefing && briefing.text) || briefingWorking) || undefined}>
          <summary>
            <span className="gsd-adv-k"><i className="gsd-chev" aria-hidden="true" />Background for Workie</span>
            <span className="gsd-adv-s">
              {briefing && briefing.text ? 'added · Workie will use it' : 'Optional'}
            </span>
          </summary>
          <SessionBriefing value={briefing} onChange={setBriefing} onWorkingChange={setBriefingWorking} heading="Background for Workie" intro={workieIntro} />
        </details>
      )}
      <SessionOptions
        idPrefix="gsd"
        gameType={engagementType}
        value={{
          anonymousResponses,
          randomizeQuestions,
          names: namesChoice,
          target,
          personaId: newGamePersonaId,
          promptId: newGamePromptId,
          aiContext: gameAiContext,
          eventDetails,
        }}
        onChange={changeOptions}
        personas={personas}
        setPromptId={chosenSetPromptId}
        namesDefault={chosenSet ? chosenSet.namesDefault : ''}
        shuffleLocked={isEdit}
        questionCount={chosenCount}
        boundBySize={!isEdit}
        briefSummary
        namesStated={isCallAndAnswer || isSurvey}
      />
    </div>
  ) : null;

  /* ── the format step (step 2) ─────────────────────────────────────────── */
  const openCompare = () => {
    compareReturn.current = '.gsd-compare-link';
    focusAfter.current = '#gsd-compare-t';
    setView('compare');
  };
  /* "Compare formats" (frame 3-A1), top right of the step. It sits BEFORE
     the radio group, so the Tab path from the formats to the set search has
     nothing between them (live dev test 5 N1). It opens the Format guide. */
  const formatActs = !isEdit && (
    <span className="gsd-step-acts">
      <button type="button" className="gsd-btn gsd-btn--link gsd-compare-link" onClick={openCompare}>
        <Icon name="ListBullets" size={14} /> {phone ? 'Compare' : 'Compare formats'}
      </button>
    </span>
  );
  /* Enter on a format goes on to the questions, as Enter in the title does
     (live dev test 5 N1: Tab · ← · Enter · Enter · ⌘↵ = 5 keys). */
  const afterFormatEnter = () => {
    setTimeout(() => {
      const next = bodyRef.current && (bodyRef.current.querySelector('#gsd-set-search')
        || bodyRef.current.querySelector('.schs-picked .schs-btn'));
      if (next) next.focus(); else primaryRef.current?.focus();
    }, 0);
  };
  const formatStep = (
    <section className="gsd-step gsd-step--format">
      <h3 className="gsd-step-h" id="gsd-format-label">{showGallery ? 'Pick a format' : 'Format'}</h3>
      {formatActs}
      {showGallery && !phone && (
        <MeetingTypeChips types={meetingTypes} value={meeting} onPick={pickMeeting} />
      )}
      {showGallery && meetingReason && (
        /* Spoken through the one live region, joined to the reveal (A2). */
        <p className="gsd-reason">
          For a {meetingReason.label.toLowerCase()}: <b>{kindLabel(meetingReason.format)}</b>. {meetingReason.reason}
        </p>
      )}
      <FormatPicker
        options={formatOptions}
        value={engagementType}
        onChange={chooseFormatDirect}
        skin={showGallery ? 'gallery' : 'chips'}
        disabled={isEdit}
        labelledBy="gsd-format-label"
        collapseAfter={phone && !isEdit ? 3 : 0}
        onEnter={afterFormatEnter}
        onPreview={showGallery ? previewFormat : null}
      />
      {/* `blurb` from config/gameTypes.js — the chip row's plain line. */}
      {!showGallery && hasFormat && (
        <p className="gsd-blurb">{isOther ? formatGuide(engagementType).short : gameTypeMeta(engagementType).blurb}</p>
      )}
      {narrow && !isEdit && (
        <details
          className="gsd-how-fold"
          open={foldOpen}
          onToggle={(event) => setFoldOpen(event.currentTarget.open)}
        >
          <summary>
            <i className="gsd-chev" aria-hidden="true" />
            {hasFormat ? `How ${paneLabel} runs, ${paneStages} stages` : 'How it runs — an example'}
          </summary>
          {foldOpen && (
            <FormatWalkthrough key={paneFormat} format={paneFormat} label={paneLabel} preview={hasFormat ? '' : 'example'} exampleOnly={!hasFormat} layout="phone" idPrefix="gsd-fold-wt" />
          )}
        </details>
      )}
      {isEdit && (
        /* DISABLED, NOT HIDDEN, AND THE NOTE SAYS WHY: the format and set pin
           derived rows at create time; the PUT whitelist refuses them. */
        <small className="dialog-help-text">
          The format and question set are fixed once a session is created — create a
          new session to change either.
        </small>
      )}
    </section>
  );

  const titleStep = (
    <section className="gsd-step">
      {/* The help beside its label, which saves a line (round 4). */}
      <div className="gsd-step-row gsd-title-row">
        <h3 className="gsd-step-h">
          <label id="gsd-title-label" htmlFor="gsd-title">Name it</label>
        </h3>
        <small className="dialog-help-text gsd-title-help" id="gsd-title-help">The room sees this on the main screen and on their phones.</small>
      </div>
      <input
        ref={titleRef}
        id="gsd-title"
        type="text"
        value={title}
        onChange={(e) => changeTitle(e.target.value)}
        onKeyDown={titleKey}
        placeholder="e.g. Q3 Leadership Offsite — Pricing Strategy"
        className="dialog-input"
        aria-describedby="gsd-title-help"
      />
    </section>
  );

  /* While the chooser is open, name and format fold to one line (frame 5a). */
  const foldedLine = (
    <p className="gsd-folded">
      <Icon name="Check" size={14} />
      <b>{title.trim() || 'Untitled'}</b>
      <span aria-hidden="true">·</span>
      <span>{formatLabel}</span>
      <button type="button" className="gsd-btn gsd-btn--link" onClick={() => setChooserClose((n) => n + 1)}>Edit</button>
    </p>
  );

  const form = (
    <>
      {chooserOpen ? foldedLine : null}
      <div hidden={chooserOpen || undefined}>
        {titleStep}
        {formatStep}
      </div>
      {questionsStep && (
        <Reveal id="set" seen={seenSections} ready={dialogReady}>{questionsStep}</Reveal>
      )}
      {topicsBlock}
      {(namesBlock || optionalBlock) && (
        <Reveal id="after" seen={seenSections} ready={dialogReady}>
          {namesBlock}
          {optionalBlock}
        </Reveal>
      )}
    </>
  );

  return (
    <Modal
      overlayClassName="new-game-overlay"
      contentClassName={`new-game-dialog gsd gsd--full${view === 'compare' ? ' gsd--guide' : ''}${isEdit ? ' gsd--edit' : ''}${phone ? ' gsd--phone' : ''}`}
      labelledBy="gsd-heading"
      onClose={escape}
      /* THE BACKDROP STAYS INERT: there is nothing behind the overlay to go
         back to, and a stray click would throw away a half-filled form. */
      closeOnBackdrop={false}
      afterContent={setsDialog !== null ? (
        /* A SIBLING OF THE DIALOG, INSIDE THE OVERLAY — not a child: the
           scrim has to cover the create screen. */
        <HostQuestionSetsDialog
          engagementType={engagementType && !isOther ? engagementType : 'call-and-answer'}
          initialRoute={setsDialog}
          onClose={() => setSetsDialog(null)}
          onSetsChanged={takeSets}
        />
      ) : null}
    >
      {/* THE HEAD STAYS, so the X is always on screen. */}
      <div className="gsd-head">
        <h2 id="gsd-heading">{phone && view === 'compare' ? 'Format guide' : headingText}</h2>
        <span className="gsd-head-acts">
          <HelpButton {...helpFor('host-create')} variant="inline" size="small" tooltip="Help: creating an engagement" className="help-button-quiet" />
          {/* THE X goes through requestClose(), exactly like Cancel and Escape. */}
          <button
            type="button"
            className="gsd-close"
            onClick={requestClose}
            aria-label={isEdit ? 'Close without saving changes' : 'Close without creating'}
            title={isEdit ? 'Close without saving changes' : 'Close without creating'}
          >
            ×
          </button>
        </span>
      </div>

      <div
        className={`gsd-body${showSide && !(howHidden && !isEdit) ? ' has-side' : ''}${showSide && howHidden && !isEdit ? ' has-rail' : ''}`}
        ref={bodyRef}
        /* THE DISCARD QUESTION NEVER HIDES CREATE FOR LONG (live dev test 1
           B5): going back to the form is "keep editing". */
        onPointerDownCapture={dismissDiscard}
        onFocusCapture={dismissDiscard}
      >
        <div className={`dialog-content gsd-main${view === 'compare' ? ' is-compare' : ''}`}>
          {view === 'compare' ? (
            <>
              <FormatCompare
                options={formatOptions}
                value={engagementType}
                suggested={meetingReason ? meetingReason.format : ''}
                suggestedFor={meetingReason ? meetingReason.label : ''}
                onUse={(id) => {
                  chooseFormatDirect(id);
                  focusAfter.current = `.gsd-fmt[data-format="${id}"]`;
                  setView('form');
                }}
                onBack={() => { focusAfter.current = compareReturn.current || '.gsd-compare-link'; setView('form'); }}
                phone={phone}
              />
            </>
          ) : form}
        </div>
        {showSide && (
          <CreateSummary
            edit={isEdit}
            hidden={howHidden}
            onToggleHidden={isEdit ? null : toggleHow}
            format={paneFormat}
            label={paneLabel}
            preview={panePreview}
            exampleOnly={paneExampleOnly}
            notice={refusalNode}
            rowsHeading="Editing this session"
            rows={isEdit ? [
              { label: 'Status', value: 'Created, not started: nobody can join', done: true },
              { label: 'Changed', value: editChanged.length ? editChanged.join(', ') : 'Nothing yet', done: editChanged.length > 0 },
            ] : []}
          />
        )}
      </div>

      {/* THE GOAL'S PROBLEM, REPEATED OUTSIDE THE FOLD (final review Minor 1a). */}
      {goalProblem && (
        <p className="gsd-blocked-reason" role="alert" id="gsd-blocked-reason">
          {goalProblem}
        </p>
      )}

      {/* Compact (and the open chooser) has no side pane: a refusal sits above the foot. */}
      {!showSide && refusalNode}
      {/* (The pinned "Questions" row compact used to draw here covered the
          topics at 1280×720 — live dev tests B7, E7. Compact has no checklist,
          as frame 3b draws.) */}

      <p className="gsd-sr" aria-live="polite">{announce}</p>

      {confirmingClose ? (
        <div className="dialog-actions is-confirm" role="alertdialog" aria-labelledby="gsd-confirm-t">
          <p className="gsd-confirm-t" id="gsd-confirm-t">
            {isEdit
              ? <><b>Discard your changes?</b> The session stays as it was.</>
              : <><b>Discard this engagement?</b> Nothing has been created yet, and what you filled in is lost.</>}
          </p>
          <button type="button" className="btn-secondary" ref={keepEditingRef} onClick={() => setConfirmingClose(false)}>
            Keep editing
          </button>
          {/* DISCARD MEANS DISCARD (devtest 7 R1 / 8 R3-2): in create mode the
              title is the page's, so it outlived the dialog and reopened
              ticked done, with new typing appended to it. Empty it first. */}
          <button
            type="button"
            className="gsd-discard"
            onClick={() => { if (!isEdit) onEventTitleChange?.(''); onCancel?.(); }}
          >
            Discard
          </button>
        </div>
      ) : (
        <div className="dialog-actions">
          {showNeed && (
            <p className="gsd-foot-note gsd-foot-need" id="gsd-need">
              <Icon name="Info" weight="bold" size={14} color="currentColor" />
              <span><b>Still needed:</b> {neededWords(needed)}.</span>
            </p>
          )}
          {footNote && (
            <p className="gsd-foot-note">
              <Icon name={footIcon} weight="bold" size={14} color="currentColor" />
              <span>{footNote}</span>
            </p>
          )}
          <button type="button" className="btn-secondary" ref={cancelRef} onClick={requestClose}>
            Cancel
          </button>
          {/* The guard: no set, no questions; no title, nothing to name. A
              survey is created AND opened by this press. */}
          <button
            type="button"
            ref={primaryRef}
            className="btn-primary"
            onClick={submit}
            /* NEVER INERT (review A1): aria-disabled keeps it in the Tab order
               and described by its reason; pressed early, it takes the focus
               to the gap. Truly disabled only while a create is in flight. */
            disabled={busy}
            aria-disabled={(!canCreate && !busy) || undefined}
            aria-describedby={[showNeed ? 'gsd-need' : '', goalProblem ? 'gsd-blocked-reason' : ''].filter(Boolean).join(' ') || undefined}
            aria-keyshortcuts={isEdit || isOther ? undefined : 'Meta+Enter Control+Enter'}
            title={primaryTitle}
          >
            {primaryLabel}
            {isOther && !busy && <Icon name="ArrowRight" size={14} />}
            {/* Keycaps for every host (README round 3): there is no "quick"
                host to keep them for. aria-hidden; the shortcut is in
                aria-keyshortcuts. */}
            {!isEdit && !isOther && !busy && (
              <kbd className="gsd-kbd" aria-hidden="true">{shortcut}</kbd>
            )}
          </button>
        </div>
      )}
    </Modal>
  );
}
