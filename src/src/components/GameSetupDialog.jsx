/**
 * The create-engagement screen.
 *
 * ── THE 30 OCT 2026 REDESIGN (docs/design/new-engagement) ─────────────────
 * The owner: "a great user experience creating a new engagement when the user
 * has very little experience with the site. also a user with lots of
 * experience, doesn't feel like its too overbearing". Three decisions, then
 * Create: Name it → Format → Questions, on one page; everything else sits
 * under "Optional — every one has a safe default".
 *
 *   FULL     (a host with no sessions yet) min(1240px, 100vw−48px), a form on
 *            the left and a 420px side pane: the preview, a status-only
 *            checklist and "What happens next" (components/CreateSummary).
 *            The formats are a gallery of cards with "Planning a…" meeting
 *            chips and a Compare view until a set is picked, then a chip row.
 *   COMPACT  (a host with history) a fixed 880px single column: format chips
 *            with the last-used one chosen, the recents list, a one-line
 *            briefing, no helper copy and no side pane unless asked for.
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
import { anonymityApplies } from '../config/anonymity';
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
  readLayoutOverride, writeLayoutOverride, isMacPlatform, createShortcutLabel, isCreateShortcut,
} from '../config/formatGuide';
import SetChooser from './SetChooser';
import FormatPicker from './FormatPicker';
import FormatCompare from './FormatCompare';
import MeetingTypeChips from './MeetingTypeChips';
import CreateSummary, { SummaryRows } from './CreateSummary';
import OtherFormatHandoff from './OtherFormatHandoff';
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

/** The fold that the names line's "Change" opens, and the control it focuses. */
function openAdvancedAt(root, selector) {
  const fold = root && root.querySelector('details.gsd-adv');
  if (!fold) return;
  fold.open = true;
  const target = fold.querySelector(selector);
  if (target && target.focus) target.focus();
  if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
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
   * (compact layout) and the newest one's format (chosen on open). A novice
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

  /* ── layout: full or compact (README §6) ───────────────────────────────── */
  // "I know these" / "Always show the guide" — a per-viewer convenience in
  // localStorage (wrapped; it may throw or come back empty). No preferences
  // API exists yet; README §7 Q1 asks whether to build one.
  const [layoutOverride, setLayoutOverride] = useState(() => (isEdit ? '' : readLayoutOverride()));
  const compactByDefault = !isEdit && (layoutOverride ? layoutOverride === 'compact' : hasCreated);
  // "Show preview" in compact: the side pane for this open only.
  const [peek, setPeek] = useState(false);
  const compact = compactByDefault && !peek;
  const chooseLayout = (value) => {
    setLayoutOverride(value);
    writeLayoutOverride(value);
    setPeek(false);
  };

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

  // The page reloads the voices that suit this format.
  useEffect(() => {
    if (engagementType && !isHandoffFormat(engagementType)) onFormatChange?.(engagementType);
  }, [engagementType]); // eslint-disable-line react-hooks/exhaustive-deps

  const tellPageSet = (key) => {
    if (!key) { onQuestionSetChange?.('', DEFAULT_SCOPE); return; }
    const ref = parseSetRefKey(key);
    onQuestionSetChange?.(ref.id, ref.scope);
  };

  const chooseFormat = (typeId) => {
    if (typeId === engagementType) return;
    formatTouched.current = true;
    if (engagementType) setByFormat.current[engagementType] = newGameSetKey;
    setEngagementType(typeId);
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

  const submit = () => {
    if (!canCreate || busy) return;
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
  useEffect(() => {
    if (confirmingClose) {
      confirmShown.current = true;
      keepEditingRef.current?.focus();
    } else if (confirmShown.current) {
      cancelRef.current?.focus();
    }
  }, [confirmingClose]);

  const requestClose = () => {
    // Read now, not from the render: the history read can re-baseline the form
    // in an effect after this render was drawn.
    if (snapshot === openedAs.current) { onCancel?.(); return; }
    setConfirmingClose(true);
  };
  /** Escape — the Modal's one close path. While the foot asks, it is Keep editing. */
  const escape = () => {
    if (confirmingClose) setConfirmingClose(false);
    else if (view === 'compare') setView('form');
    else requestClose();
  };

  /* ── the title moves on, and ⌘/Ctrl+Enter creates ─────────────────────── */
  const bodyRef = useRef(null);
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
  latest.current = { canCreate, busy, isOther, confirmingClose, submit };
  useEffect(() => {
    const onKey = (event) => {
      if (!isCreateShortcut(event)) return;
      const root = bodyRef.current && bodyRef.current.closest('[role="dialog"]');
      if (!root || !root.contains(event.target)) return;
      const now = latest.current;
      if (now.confirmingClose) return;
      event.preventDefault();
      // NEVER LEAVES on the shortcut (README §6): a hand-off format moves the
      // focus to its own labelled Continue and says so; only Enter or a click
      // there navigates.
      if (now.isOther) {
        primaryRef.current?.focus();
        setAnnounce(`${shortcut} moved to Continue. Press Enter there to go.`);
        return;
      }
      if (now.canCreate && !now.busy) now.submit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  /* ── the format options ───────────────────────────────────────────────── */
  const formatOptions = offeredIds.map((id) => {
    const handoff = isHandoffFormat(id);
    const guide = formatGuide(id);
    return {
      id,
      label: handoff ? kindLabel(id) : gameTypeMeta(id).label,
      icon: handoff ? kindIcon(id) : gameTypeMeta(id).icon,
      short: guide.short,
      good: guide.good,
      handoff,
      lastUsed: !isEdit && hasCreated && id === lastFormat,
    };
  });
  const meetingTypes = MEETING_TYPES.filter((m) => offeredIds.includes(m.format));
  const pickMeeting = (m) => {
    setMeeting(m.id);
    chooseFormat(m.format);
  };
  const meetingReason = meeting ? MEETING_TYPES.find((m) => m.id === meeting) : null;
  const showGallery = !compact && !isEdit && !galleryDone;

  /* ── the foot ─────────────────────────────────────────────────────────── */
  let footNote = null;
  let footIcon = 'Lock';
  if (isEdit) footNote = 'This session has not started, so nobody can join it yet.';
  else if (isSurvey) { footNote = 'People can answer as soon as you open it. There is no separate Start.'; footIcon = 'Warning'; }
  else if (isOther) { footNote = `Nothing is created yet. ${shortcut} moves to Continue; press Enter there to go.`; footIcon = 'Info'; }
  else if (view === 'compare') { footNote = 'Comparing formats. Choose one to go back to the form.'; footIcon = 'Info'; }
  else footNote = 'Nobody can join until you start it.';

  let primaryLabel;
  if (busy) primaryLabel = isEdit ? 'Saving…' : (isSurvey ? 'Opening…' : 'Creating…');
  else if (isEdit) primaryLabel = 'Save changes';
  else if (OTHER_LABELS[engagementType]) primaryLabel = OTHER_LABELS[engagementType];
  else if (categoriesLoading) primaryLabel = 'Loading topics…';
  else primaryLabel = isSurvey ? 'Open the survey' : 'Create engagement';
  let primaryTitle;
  if (isCallAndAnswer && briefingWorking) primaryTitle = 'Waiting for Workie to finish the briefing';
  else if (goalProblem) primaryTitle = goalProblem;

  /* ── the side pane's rows ─────────────────────────────────────────────── */
  const topicCount = shownCategories.length;
  const pickedTopics = shownCategories.filter((c) => selectedCats.has(c.name));
  const topicWords = () => {
    if (!chosenSet) return 'Not yet';
    const qs = `${chosenCount} question${chosenCount === 1 ? '' : 's'}`;
    if (isSurvey || topicCount === 0) return qs;
    if (pickedTopics.length === 0 || pickedTopics.length === topicCount) return `${qs}, all ${topicCount} topics`;
    return `${pickedTopics.length} of ${topicCount} topics`;
  };
  const advancedChanged = randomizeQuestions !== true || (anonymityApplies(engagementType) && !anonymousResponses)
    || Boolean(newGamePersonaId || newGamePromptId || gameAiContext || eventDetails) || target !== null
    || (isSurvey && namesChoice !== NAMES_DEFAULT);
  const createRows = isOther ? [
    { label: 'Title', value: title.trim() ? 'Goes with you' : 'On the next page', done: Boolean(title.trim()) },
    { label: 'Format', value: formatLabel, done: true },
    ...(engagementType === BUILD_KIND
      ? [{ label: 'Goal', value: 'On the next page' }, { label: 'Claude Code', value: 'Connected on the next page' }]
      : [{ label: 'Day and place', value: 'On the next page' }, { label: 'Agenda', value: 'On the next page' }]),
  ] : [
    { label: 'Title', value: title.trim() ? 'Done' : 'Not yet', done: Boolean(title.trim()) },
    { label: 'Format', value: formatLabel || 'Not yet', done: hasFormat },
    { label: 'Questions', value: topicWords(), done: Boolean(chosenSet) },
    ...(isCallAndAnswer ? [{ label: 'Background for Workie', value: briefing && briefing.text ? 'Added' : 'Not added — that’s fine' }] : []),
    ...(hasFormat ? [{ label: 'Advanced', value: advancedChanged ? 'Changed — see the Advanced line' : 'Defaults' }] : []),
  ];
  const allDone = !isOther && title.trim() && hasFormat && chosenSet;
  let nextSteps = null;
  if (isSurvey) {
    nextSteps = { heading: 'What happens next', steps: [
      { b: 'Open', text: 'the join code and QR go up, and people can answer straight away.' },
      { b: 'Collect', text: 'answers arrive in their own time; you watch the totals.' },
      { b: 'Close', text: 'when you have enough; the results freeze for the report.' },
    ] };
  } else if (!isOther) {
    nextSteps = { heading: 'What happens next', steps: [
      { b: 'Create', text: 'waits in your Sessions list. Nobody can join; you can still edit it.' },
      { b: 'Start', text: 'the join code and QR go up; people join on their phones.' },
      { b: 'Run', text: 'you move the room on; every phone follows.' },
    ] };
  }

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

  const showSide = !compact && !chooserOpen && view === 'form';
  const stepMark = (n, done) => (
    <span className={`gsd-step-n${done ? ' is-done' : ''}`} aria-hidden="true">
      {done ? <Icon name="Check" size={13} weight="bold" /> : n}
    </span>
  );
  const headingText = isEdit ? 'Edit session' : (isFirstEngagement ? 'New engagement' : 'Start a new engagement');

  /* ── the make-your-own routes (frame 5c) ──────────────────────────────── */
  const makeRoutes = isEdit || !hasFormat || isOther ? [] : [
    { id: 'manual', icon: 'PencilSimple', label: 'Write your own questions', desc: 'Opens your question sets with a new set started, where you can write them yourself or use a template.', onPick: () => openSets('manual') },
    { id: 'ai', icon: 'Sparkle', label: 'Make a set with Workie', desc: 'Describe your meeting and Workie, Engage’s AI assistant, drafts questions for you to review.', onPick: () => openSets('ai') },
    { id: 'template', icon: 'FileText', label: 'Fill in a spreadsheet', desc: 'Download the template, add your questions, upload it.', onPick: () => openSets('template') },
  ];

  /* ── the Questions step (step 3) ──────────────────────────────────────── */
  const questionsStep = !hasFormat ? (
    <section className="gsd-step is-later">
      <h3 className="gsd-step-h" id="gsd-step3">{stepMark(3, false)}Questions</h3>
      <p className="gsd-later">Choose a format first, then pick a ready-made set or make your own.</p>
    </section>
  ) : isOther ? (
    <section className="gsd-step">
      <h3 className="gsd-step-h" id="gsd-step3">{stepMark(3, false)}Next: {engagementType === BUILD_KIND ? 'the Build Room page' : 'the event page'}</h3>
      <OtherFormatHandoff
        kind={engagementType}
        title={title}
        blocked={eventBlocked}
        planName={eventsAccess && eventsAccess.offerPlanName}
        billingHref={billingHref}
      />
    </section>
  ) : (
    <section className="gsd-step">
      <h3 className="gsd-step-h" id="gsd-set-label">
        {stepMark(3, Boolean(chosenSet) || (isEdit && Boolean(newGameSetId)))}Question set
        {chooserOpen && !compact && <span className="gsd-req">Required</span>}
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
        onMakeSet={isEdit ? null : () => openSets('')}
        otherFormats={isEdit ? [] : PICKER_GAME_TYPES
          .filter((type) => type.id !== engagementType)
          .map((type) => ({
            label: type.label,
            sets: sessionSets.filter((set) => set.engagementType === type.id),
            onPick: () => chooseFormat(type.id),
          }))}
        makeRoutes={makeRoutes}
        makeRoutesNote="A set you upload is picked for this engagement as soon as it is saved, and stays in Your question sets. A set Workie drafts waits for your review first."
        recentsFirst={!isEdit}
        closeSignal={chooserClose}
        idPrefix="gsd-set"
        theme="dark"
        wide
        onOpenChange={setChooserOpen}
      />
      {/* THE ENTRY POINT, always offered in create mode — "fix the title on
          the set I made last week" is as common as "I have none". */}
      {!isEdit && (
        <p className="gsd-setlinks">
          <button type="button" className="gsd-setlink" onClick={() => openSets('')}>
            {setsForType.length === 0 ? 'Make a question set' : 'Your question sets'}
          </button>
          {setsForType.length > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <button type="button" className="gsd-setlink" onClick={() => openSets('template')}>Make a new set</button>
            </>
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
        noun="topics"
        hint={compact ? '' : 'Switch off any you want to skip.'}
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
  if (isCallAndAnswer && !chooserOpen) {
    namesBlock = (
      <div className={`gsd-namesline${compact ? ' is-compact' : ''}`} data-testid="gsd-namesline">
        <Icon name={anonymousResponses ? 'EyeSlash' : 'Eye'} size={16} />
        <div>
          <b>{anonymousResponses ? 'Names are hidden until the vote closes' : 'Names are shown from the start'}</b>
          {!compact && (
            <span>
              {anonymousResponses
                ? ' While people answer and vote, nobody sees who wrote what, not even you. Names are shown with the results.'
                : ' Every answer carries its author’s name from the moment voting opens.'}
            </span>
          )}
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
  } else if (isSurvey && !chooserOpen) {
    namesBlock = (
      <div className="gsd-namesline is-compact" data-testid="gsd-namesline">
        <Icon name="EyeSlash" size={16} />
        <div><b>Names: {namesMode(namesChoice).label}</b>{compact ? '' : ' · locked when it opens'}</div>
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
  const optionalBlock = hasFormat && !isOther ? (
    <div hidden={chooserOpen || undefined}>
      {!compact && <h3 className="gsd-optional-h">Optional — every one has a safe default</h3>}
      {isCallAndAnswer && (compact ? (
        <details className="gsd-brief-fold">
          <summary>
            <span className="gsd-adv-k"><i className="gsd-chev" aria-hidden="true" />Background for Workie</span>
            <span className="gsd-adv-s">optional · add a document or write key points</span>
          </summary>
          <SessionBriefing value={briefing} onChange={setBriefing} onWorkingChange={setBriefingWorking} heading="Background for Workie" intro={workieIntro} />
        </details>
      ) : (
        <SessionBriefing value={briefing} onChange={setBriefing} onWorkingChange={setBriefingWorking} heading="Background for Workie" intro={workieIntro} />
      ))}
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
      />
    </div>
  ) : null;

  /* ── the format step (step 2) ─────────────────────────────────────────── */
  const formatStep = (
    <section className="gsd-step">
      <div className="gsd-step-row">
        <h3 className="gsd-step-h" id="gsd-format-label">{stepMark(2, hasFormat)}{showGallery ? 'Pick a format' : 'Format'}</h3>
        {!isEdit && (
          <span className="gsd-step-acts">
            <button type="button" className="gsd-btn gsd-btn--link" onClick={() => setView('compare')}>
              <Icon name="ListBullets" size={14} /> {showGallery ? 'Compare side by side' : 'Format guide'}
            </button>
            {!compact && !compactByDefault && (
              <button type="button" className="gsd-btn gsd-btn--link" onClick={() => chooseLayout('compact')}>I know these — show compact</button>
            )}
            {!compact && compactByDefault && (
              <>
                <button type="button" className="gsd-btn gsd-btn--link" onClick={() => setPeek(false)}>Back to compact</button>
                <button type="button" className="gsd-btn gsd-btn--link" onClick={() => chooseLayout('full')}>Always show the guide</button>
              </>
            )}
          </span>
        )}
      </div>
      {showGallery && (
        <MeetingTypeChips types={meetingTypes} value={meeting} onPick={pickMeeting} />
      )}
      {showGallery && meetingReason && (
        <p className="gsd-reason" aria-live="polite">
          For a {meetingReason.label.toLowerCase()}: <b>{kindLabel(meetingReason.format)}</b>. {meetingReason.reason}
        </p>
      )}
      <FormatPicker
        options={formatOptions}
        value={engagementType}
        onChange={(id) => { setMeeting(''); chooseFormat(id); }}
        skin={showGallery ? 'gallery' : 'chips'}
        disabled={isEdit}
        labelledBy="gsd-format-label"
      />
      {/* `blurb` from config/gameTypes.js — the chip row's one line. */}
      {!showGallery && hasFormat && (
        <p className="gsd-blurb">{isOther ? formatGuide(engagementType).short : gameTypeMeta(engagementType).blurb}</p>
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
      <h3 className="gsd-step-h">
        {stepMark(1, Boolean(title.trim()))}
        <label id="gsd-title-label" htmlFor="gsd-title">Name it</label>
      </h3>
      <input
        ref={titleRef}
        id="gsd-title"
        type="text"
        value={title}
        onChange={(e) => changeTitle(e.target.value)}
        onKeyDown={titleKey}
        placeholder="e.g. Q3 Leadership Offsite — Pricing Strategy"
        className="dialog-input"
        aria-describedby={compact ? undefined : 'gsd-title-help'}
      />
      {!compact && <small className="dialog-help-text" id="gsd-title-help">The room sees this on the main screen and on their phones.</small>}
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
      {questionsStep}
      {topicsBlock}
      {namesBlock}
      {optionalBlock}
    </>
  );

  return (
    <Modal
      overlayClassName="new-game-overlay"
      contentClassName={`new-game-dialog gsd ${compact ? 'gsd--compact' : 'gsd--full'}${isEdit ? ' gsd--edit' : ''}`}
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
        <h2 id="gsd-heading">{headingText}</h2>
        {!compact && !isEdit && <p className="gsd-sub">Three decisions. Everything else has a sensible default.</p>}
        <span className="gsd-head-acts">
          {compact && (
            <button type="button" className="gsd-btn" onClick={() => setPeek(true)}>
              <Icon name="Monitor" size={14} /> Show preview
            </button>
          )}
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

      <div className={`gsd-body${showSide ? ' has-side' : ''}`} ref={bodyRef}>
        <div className="dialog-content gsd-main">
          {view === 'compare' ? (
            <>
              {!isEdit && <MeetingTypeChips types={meetingTypes} value={meeting} onPick={(m) => setMeeting(m.id)} idPrefix="gsd-meet-cmp" />}
              <FormatCompare
                options={formatOptions}
                value={engagementType}
                suggested={meetingReason ? meetingReason.format : ''}
                suggestedFor={meetingReason ? meetingReason.label : ''}
                onUse={(id) => {
                  chooseFormat(id);
                  setView('form');
                  setTimeout(focusFormat, 0);
                }}
                onBack={() => { setView('form'); setTimeout(focusFormat, 0); }}
              />
            </>
          ) : form}
        </div>
        {showSide && (
          <CreateSummary
            edit={isEdit}
            format={engagementType}
            anonymous={anonymousResponses}
            setName={chosenSet ? chosenSet.name : ''}
            notice={refusalNode}
            rowsHeading={isEdit ? 'Editing this session' : (isOther ? 'When you continue' : (allDone ? 'Your choices' : 'Three decisions'))}
            rows={isEdit ? [
              { label: 'Status', value: 'Created, not started: nobody can join', done: true },
              { label: 'Changed', value: editChanged.length ? editChanged.join(', ') : 'Nothing yet', done: editChanged.length > 0 },
            ] : createRows}
            next={isEdit ? null : nextSteps}
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
      {compact && !isOther && view === 'form' && !chooserOpen && hasFormat && chosenSet && (
        <div className="gsd-compact-sum"><SummaryRows heading="Ready" rows={[{ label: 'Questions', value: topicWords(), done: true }]} /></div>
      )}

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
          <button type="button" className="gsd-discard" onClick={() => onCancel?.()}>
            Discard
          </button>
        </div>
      ) : (
        <div className="dialog-actions">
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
            disabled={!canCreate || busy}
            aria-describedby={goalProblem ? 'gsd-blocked-reason' : undefined}
            aria-keyshortcuts={isEdit || isOther ? undefined : 'Meta+Enter Control+Enter'}
            title={primaryTitle}
          >
            {primaryLabel}
            {isOther && !busy && <Icon name="ArrowRight" size={14} />}
            {/* Keycaps for the host who uses them: compact only (README §6). */}
            {compact && !isEdit && !isOther && !busy && (
              <kbd className="gsd-kbd" aria-hidden="true">{shortcut}</kbd>
            )}
          </button>
        </div>
      )}
    </Modal>
  );
}
