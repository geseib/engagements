/**
 * The create-engagement screen.
 *
 * Built from `docs/design/host-redesign/20-setup.html`, with the four overrides
 * that design review argued for: the anonymity sentence (the mockup's is false
 * in the dangerous direction — see below), the category grid (the mockup's
 * single-value <select> cannot express a multi-select), the question-set
 * dropdown (the mockup's hardcoded option loses the type filter, the count and
 * the image marker) and the Create button's disabled guard. The mockup also
 * silently drops three fields that work — event details, AI context and
 * Workie's voice — and silence in a mockup is not an instruction to delete.
 *
 * A COMPONENT, NOT A ROUTE. `App.jsx` is a `window.location.pathname` switch
 * with no history integration, so a route would mean a full page load — which
 * destroys the in-memory host session, the WebSocket connection and every
 * per-game value this screen exists to hand off. A route is the one shape that
 * cannot do the job.
 *
 * WHAT IT OWNS is the form and nothing else. `eventTitle`, `categories` and
 * `activeCategoryIds` are per-game keys the live host screen reads and
 * `resetGameSession()` clears (config/gameSession.js), so they stay on the page
 * and arrive as props. `gameSession.test.js` fails if that boundary moves.
 *
 * WHAT IT RAISES is one payload, carrying the selected category ids. That is
 * the point of the extraction: `handleStartNewGame` calls `leaveCurrentGame()`,
 * which clears `activeCategoryIds`, and then used to read them back out of the
 * pre-reset closure. It worked, invisibly, for a reason nothing at the call site
 * showed.
 *
 * RESET BEHAVIOUR, DECIDED RATHER THAN INHERITED. The dialog is rendered by an
 * early return, so closing it unmounts it and every field below goes back to
 * its default on the next open. That includes `anonymousResponses`, which used
 * to be sticky across creates — accidentally, because the state lived on a page
 * that never unmounts. Non-sticky is the right answer: ON is the safe state and
 * the guarantee is spelled out in full on the card, whereas a sticky OFF
 * carries one room's decision silently into the next one.
 *
 * PURE PROPS. Every FORM field arrives as a prop and leaves in one payload,
 * and that stays. The options themselves — the category grid, Workie's
 * briefing and the Advanced fold — are components/SessionOptions.jsx, shared
 * with the event item dialog (events M1b), and the one fetch this file used
 * to make (the prompt library, the evidence behind the Advanced line's claim)
 * moved there with the block it serves.
 *
 * WHERE A HOST MAKES A QUESTION SET, per the owner: *"the interface for entry to
 * this is create engagements."* This screen is the only place in the product
 * where a host has already discovered that a set is the thing a session needs —
 * the picker below is where they find out they haven't got one. So the entry
 * sits beside the picker, and the "no sets yet" help text stops pointing at an
 * editor the host cannot reach. The surface itself is
 * <HostQuestionSetsDialog>, which owns its own fetching for the reason this
 * file's own header gives about routes: keeping the network out of here leaves
 * this component pure-props and testable.
 *
 * `localSets` is why a set can be picked the moment it is made. The page owns
 * `questionSets` and re-reads it on mount, not on demand, and this component
 * cannot ask it to — so the sets dialog hands back the list it already fetched
 * and they are merged by id for the picker. Merged, not replaced: the page's
 * copy carries what the public picker endpoint returns, and losing it would be
 * a regression for every set the host did not just touch.
 *
 * ADVANCED (docs/design/session-setup-redesign, PLAN Phase 1). The owner:
 * "anonymous and random all belong under advance, same goes for workie and
 * voice… this advance section should be an expanding click section." Title,
 * format, set and categories stay in view — they decide WHAT gets asked.
 * Everything with a safe default folds under a native <details>, closed on
 * open: responses, question order, Workie, and what people see on joining.
 * The line on the fold (config/setupDefaults.js) names every default in force
 * and any change first, in amber, so closing it never hides a decision; it
 * replaces the old green plan sentence.
 *
 * ONE WAY OUT, THREE DOORS. The X, Cancel and Escape all go through
 * `requestClose()`: an untouched form closes at once, and a form with work in
 * hand turns the foot into an inline "Discard?" — never a second modal. The
 * head and foot stick, so both exits stay on screen however far the host has
 * scrolled.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PICKER_GAME_TYPES, gameTypeMeta, normalizeGameType } from '../config/gameTypes';
import { NAMES_DEFAULT, namesMode } from '../config/surveyNames';
import Icon from './Icon';
import { setRefKey, parseSetRefKey, sameSetRef, DEFAULT_SCOPE } from '../utils/setRef';
import {
  isUnreadableSet, unreadableSetName, UNREADABLE_REASON,
} from '../utils/unreadableSet';
import { imageMarkerSuffix } from './SetImageBadge';
import HostQuestionSetsDialog from './HostQuestionSetsDialog';
import SessionOptions, { SessionCategories, SessionBriefing } from './SessionOptions';
import goalRules from '../../../lambda-functions/websocket/session-goal';
import Modal from './Modal';
import PlanLimitNotice from './PlanLimitNotice';
import { BUILD_KIND, EVENT_KIND, kindLabel } from '../config/engagementKinds';
import pricing from '../../../lambda-functions/game/pricing';
import './GameSetupDialog.css';

/*
  EVENT AND BUILD ROOM ARE FORMATS HERE TOO (2026-10-04). The owner: events
  and Build Rooms "have connect to the current systems for creating and
  editing those types of engagements". Each already has its own setup screen
  — the new-event dialog and agenda builder, the Build Room setup page — so
  picking one here does not rebuild it: the set, categories and options give
  way to one sentence, and the primary button hands the title over to that
  screen (`onChooseOther`). Create mode only; Event only while events are
  switched on for the tier (`eventsAccess.enabled`), and on Free it says which
  plan brings them instead of going on.
*/
const OTHER_FORMATS = Object.freeze([BUILD_KIND, EVENT_KIND]);
const OTHER_LABELS = Object.freeze({
  [BUILD_KIND]: 'Set up the Build Room',
  [EVENT_KIND]: 'Continue to the event',
});
const OTHER_BLURBS = Object.freeze({
  [BUILD_KIND]: 'Build something with your Claude Code while the room suggests and votes. You decide. You set the goal on the next screen.',
  [EVENT_KIND]: `A whole agenda behind one code: quizzes, polls, talks and breaks, in the order you run them. You set the day and place next, then build the agenda. ${pricing.formatCents(pricing.PER_EVENT_CENTS)} an event, counted when it first goes live.`,
});

export default function GameSetupDialog({
  /*
    'create' (default) | 'edit'. Edit is the same form pointed at an EXISTING
    unstarted session: the page fetches `GET /games/{id}/host-details`, hands the
    result in as `initialValues`, and this component seeds its state from it.
    Still pure-props — no fetch enters this file — and in edit mode the fields
    the backend's PUT whitelist refuses (format, question set, shuffle) are
    shown disabled with a note, not hidden, so the host can see what the
    session is without being able to break its pinned rows. The category
    subset is live here: it is mask state, and the PUT rewrites it.
  */
  mode = 'create',
  /**
   * THE LAST REFUSAL, if the previous Create was turned away. `{ blocked,
   * kind, used, included, message }` from utils/upgradeRequired.js, or a plain
   * `{ message }` for any other failure. It used to be a browser alert() —
   * "Failed to create game: …" — with nothing to click; a 402 that says
   * "upgrade" and offers no way to is the gap the billing handoff opens with.
   */
  refusal = null,
  /** Where the plan lives: the console's Billing section. */
  billingHref = '/admin?section=billing',
  /** What GET /games/{id}/host-details returned — get-game.js's host door. */
  initialValues = null,
  /**
   * May this host make an event here? `{ enabled, canCreate, offerPlanName }`
   * from utils/eventsAccess.js, or null while unknown. Event is offered only
   * when `enabled`.
   */
  eventsAccess = null,
  /**
   * (kind, { title }) => void — Event or Build Room was chosen: the page
   * opens that engagement's own setup screen with the title carried over.
   * Absent, neither is offered.
   */
  onChooseOther,
  isFirstEngagement = true,
  eventTitle = '',
  onEventTitleChange,
  /*
    THE SET THE HOST WAS JUST USING, so Switch game reopens on it.

    NO CALLER PASSES THIS ANY MORE, ON PURPOSE. It existed so a create reopened
    on the last-played set, and the owner retired that: "the create engagement
    should not remember or preselect that last picked question set." The prop
    survives (seeded once, never controlled) only as the seam a future caller
    with a legitimate seed — a deep link, say — would use.
  */
  initialSetId = '',
  /* The other half of `initialSetId`, for the same hypothetical seeded caller.
     Absent reads as platform — see utils/setRef.js. */
  initialSetScope = '',
  questionSets = [],
  personas = [],
  categories = [],
  activeCategoryIds = new Set(),
  onToggleCategory,
  onFormatChange,
  onQuestionSetChange,
  onCancel,
  onCreate,
  /* THE PAGE IS STILL WORKING ON THIS PRESS. The dialog now stays up until
     the page has the next screen ready (GameHostPage handleStartNewGame), so
     the press has to look taken and cannot be pressed twice — a second press
     was a second session. */
  busy = false,
}) {
  const isEdit = mode === 'edit';
  const seed = initialValues || {};

  // Seeded once, not controlled — the dialog is rendered by an early return,
  // so each open mounts fresh and the initializers run against that open's
  // `initialValues`. Defaults match get-game.js's own default-ON rule: only an
  // explicit false reads as off.
  const [engagementType, setEngagementType] = useState(
    isEdit ? (seed.gameType || 'call-and-answer') : 'call-and-answer'
  );
  /*
    THE SELECTION IS A PAIR, held as the encoded key the <select> can carry.
    `teamretro` names a different set in each of platform, org and public
    (utils/setRef.js), so an id alone is not a selection — that is precisely
    what let a session built from an org's set pin Engage's library instead.

    Seeded from whichever half the caller has: an edit carries the session's
    pinned QuestionSetScope when it has one, and a pre-tenancy session has none,
    which parseSetRefKey reads as platform.
  */
  const [newGameSetKey, setNewGameSetKey] = useState(() => (isEdit
    ? setRefKey({ id: seed.questionSetId || '', scope: seed.questionSetScope })
    : setRefKey({ id: initialSetId || '', scope: initialSetScope })));
  const newGameSetRef = parseSetRefKey(newGameSetKey);
  const newGameSetId = newGameSetRef.id;
  const [eventDetails, setEventDetails] = useState(isEdit ? (seed.details || '') : '');
  const [gameAiContext, setGameAiContext] = useState(isEdit ? (seed.aiContext || '') : '');
  const [newGamePersonaId, setNewGamePersonaId] = useState(isEdit ? (seed.personaId || '') : '');
  // The session's summary approach. '' means "what the set says, else the
  // format standard" — the designed default, stated by the Advanced line.
  const [newGamePromptId, setNewGamePromptId] = useState(isEdit ? (seed.promptId || '') : '');
  const [randomizeQuestions, setRandomizeQuestions] = useState(
    isEdit ? seed.randomizeQuestions !== false : true
  );
  const [anonymousResponses, setAnonymousResponses] = useState(
    isEdit ? seed.anonymousUntilReveal !== false : true
  );
  /*
    A SURVEY'S NAMES — what the server records about people (config/
    surveyNames.js; 07-start-survey). Seeded from the session on an edit, else
    Anonymous, and then from the chosen set's own `namesDefault` when it carries
    one — UNTIL the host picks, after which the next set they look at must not
    quietly undo their choice. The ref, not state: whether they have touched it
    changes nothing on screen.
  */
  const [namesChoice, setNamesChoice] = useState(
    isEdit ? namesMode(seed.names).id : NAMES_DEFAULT
  );
  const namesTouched = useRef(isEdit);
  /*
    WORKIE'S BRIEFING (session-setup-redesign Phase 3) — Call & Answer only.
    The map BriefingField edits: { text, source, namesRemoved, draftedAt,
    editedAt } or null. Seeded from the session on an edit (get-game.js's host
    branch returns it decrypted). Kept while the dialog is open even if the
    format moves away, so switching back restores it; it only travels in the
    payload for Call & Answer. `briefingWorking` is true while a document is
    being read or summarised — Create waits for it.
  */
  const [briefing, setBriefing] = useState(isEdit ? (seed.briefing || null) : null);
  const [briefingWorking, setBriefingWorking] = useState(false);
  // THE GOAL (events M1b): how many questions the host plans to ask, or null.
  // Seeded from the session on an edit (get-game.js host-details).
  const [target, setTarget] = useState(isEdit && Number.isInteger(seed.target) ? seed.target : null);
  const pickNames = (id) => {
    namesTouched.current = true;
    setNamesChoice(namesMode(id).id);
  };
  const [showSetsDialog, setShowSetsDialog] = useState(false);
  /** Sets seen by <HostQuestionSetsDialog>, including any just created. */
  const [localSets, setLocalSets] = useState(null);

  /*
    In edit mode the title is LOCAL, seeded from the session being edited. The
    create flow's `eventTitle` stays on the page because the live host screen
    reads it (see the header) — but an edit targets a session that is NOT the
    one on stage, and typing here must not rename the page's current session.
  */
  const [localTitle, setLocalTitle] = useState(isEdit ? (seed.title || '') : '');
  /*
    EDIT OWNS ITS OWN CATEGORY SELECTION. In create mode the PAGE owns
    `activeCategoryIds` (the live host screen reads them); an edit is about a
    session that is not on stage, so a local Set keeps the two from
    contaminating each other. Seeded from `seed.selectedCategoryNames`, which
    the page derives from the session's own HostMask bits
    (convertBitmaskToCategories) — the same bits this save will rewrite.
  */
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

  /** Event or Build Room: set up on its own screen, not by this form. */
  const isOther = OTHER_FORMATS.includes(engagementType);
  const otherFormats = isEdit || !onChooseOther ? [] : [
    BUILD_KIND,
    ...(eventsAccess && eventsAccess.enabled ? [EVENT_KIND] : []),
  ];
  const eventBlocked = engagementType === EVENT_KIND && !(eventsAccess && eventsAccess.canCreate);
  const isCallAndAnswer = !isOther && normalizeGameType(engagementType) === 'call-and-answer';

  // Merged by id, page copy first. A set the host just made exists only in
  // `localSets` until the page next re-reads; a set the page already knows about
  // keeps the page's richer record.
  const allSets = useMemo(() => {
    if (!localSets) return questionSets;
    // KEYED BY THE PAIR. Keyed by id alone this merge silently DELETED one of
    // two same-slug sets — an org's `teamretro` and Engage's collapse into
    // whichever was written last, and the host can no longer pick the other.
    const byRef = new Map(localSets.map((set) => [setRefKey(set), set]));
    for (const set of questionSets) byRef.set(setRefKey(set), set);
    return Array.from(byRef.values());
  }, [questionSets, localSets]);

  const setsForType = allSets.filter((set) => set.engagementType === engagementType);
  /*
    A SURVEY IS A SESSION WITH NO ROUNDS (surveys phase 2). Three cards on this
    screen are about rounds and hide for it: the categories grid (a survey set
    exposes none), the shuffle (a survey is a form, read in the order it was
    written — createGameBody forces it off too), and the call-and-answer
    "Anonymous responses" card, which `anonymityApplies` already hides because
    a survey holds no vote. Names replaces it.
  */
  const isSurvey = !isOther && normalizeGameType(engagementType) === 'survey';
  const chosenSet = allSets.find((s) => sameSetRef(s, newGameSetRef)) || null;
  /*
    THE GOAL is bounded by the chosen set's size — the version a create pins.
    `chosenCount` is that set's CURRENT size, which a create is about to pin,
    so it is the right bound there.
  */
  const chosenCount = chosenSet ? Number(chosenSet.totalQuestions) || 0 : 0;
  /*
    AN EDIT IS DIFFERENT (final review Minor 1b, superseding the T4 park):
    `chosenCount` here is the set's size RIGHT NOW, not necessarily the
    version this session is pinned to. A set can shrink after a session is
    created, and bounding Save by the live count can then refuse a save
    `PUT /games/{id}` would accept — it checks the PINNED version through
    `resolveSetPartition`, not this dialog's live read. So an edit checks only
    the whole-number/ceiling rule (`goalBound` of 0 means "unknown size" to
    `checkTarget`) and leaves the pinned-version bound to the server, whose
    400 sentence reaches the host through `refusal` below. `chosenCount`
    itself still reaches SessionOptions for its "of 47 questions" display —
    only the GATE moves, via `boundBySize={!isEdit}`.
  */
  const goalBound = isEdit ? 0 : chosenCount;
  const goalProblem = isSurvey ? '' : (goalRules.checkTarget(target, goalBound).error || '');
  // A draft still being written would be lost by a Create pressed now, and a
  // goal the set cannot meet would only be refused by the server.
  const canCreate = isOther
    ? !eventBlocked
    : Boolean(newGameSetId) && title.trim().length > 0
      && !(isCallAndAnswer && briefingWorking) && !goalProblem;

  /** The chosen set's own summary prompt, for the Advanced line's claim —
      SessionOptions checks it against the prompt library it reads. */
  const chosenSetPromptId = allSets.find((s) => s.id === newGameSetId)?.promptId || '';

  // The page reloads the voices that suit this format. On mount too, so the
  // default format's list is the one the picker below shows.
  useEffect(() => {
    // Event and Build Room have no voices to load.
    if (!OTHER_FORMATS.includes(engagementType)) onFormatChange?.(engagementType);
  }, [engagementType]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFormat = (typeId) => {
    if (typeId === engagementType) return;
    setEngagementType(typeId);
    // A set belongs to exactly one format, so the previous choice cannot
    // survive the switch. Telling the page too, so it drops that set's
    // categories and custom instruction rather than leaving them stale.
    setNewGameSetKey('');
    onQuestionSetChange?.('', DEFAULT_SCOPE);
    // A voice picked for the old format may not exist for the new one, and an
    // approach is written for exactly one format.
    setNewGamePersonaId('');
    setNewGamePromptId('');
  };

  const chooseSet = (key) => {
    setNewGameSetKey(key);
    // BOTH HALVES go to the page. It loads the categories and the custom
    // instruction from this, and both of those reads are per-partition too.
    const ref = parseSetRefKey(key);
    onQuestionSetChange?.(ref.id, ref.scope);
    // A survey set may carry its own Names default (phase 2's optional
    // set-level setting). It seeds the card only until the host has chosen.
    if (isSurvey && !namesTouched.current) {
      const set = allSets.find((s) => sameSetRef(s, ref));
      setNamesChoice(namesMode(set && set.namesDefault).id);
    }
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
    // An edit that deselected every category is refused HERE, not sent and
    // bounced: the backend would 400 it, but the host is mid-form and the
    // helper line under the grid already says why.
    if (isEdit && categories.length > 0 && editCategoryNames.size === 0) return;
    onCreate?.({
      title,
      gameType: engagementType,
      setId: newGameSetId,
      // WHICH LIBRARY that id is in. createGameBody sends it as
      // questionSetScope and schema-compliant-manager pins it onto the session;
      // without it the session pins `platform` and an org's set resolves to a
      // partition holding nothing.
      setScope: newGameSetRef.scope,
      categoryIds: Array.from(selectedCats || []),
      eventDetails,
      aiContext: gameAiContext,
      personaId: newGamePersonaId,
      promptId: newGamePromptId,
      // A survey is never shuffled, whatever the (hidden) card last said.
      randomizeQuestions: isSurvey ? false : randomizeQuestions,
      anonymousResponses,
      // Only a survey carries Names; createGameBody drops it for anything else.
      ...(isSurvey ? { names: namesChoice } : {}),
      // The goal, for every format but a survey; null is "no goal".
      ...(isSurvey ? {} : { target }),
      // Only Call & Answer carries a briefing: null when there is none, so an
      // edit clears one the host removed. createGameBody/updateGameBody drop
      // it for any other format.
      ...(isCallAndAnswer
        ? { briefing: briefing && briefing.text && briefing.text.trim() ? briefing : null }
        : {}),
    });
  };

  /*
    ── WORK IN HAND ────────────────────────────────────────────────────────────
    The form as a string, compared with the form as it opened. Categories count
    only in edit mode, where this dialog owns them: in create mode the PAGE owns
    the selection and can move it without the host touching anything, and the
    grid only appears once a set is picked — which is already a change.
  */
  const snapshot = JSON.stringify([
    title, engagementType, newGameSetKey, eventDetails, gameAiContext,
    newGamePersonaId, newGamePromptId, randomizeQuestions, anonymousResponses, namesChoice, target,
    isEdit ? Array.from(editCategoryNames).sort() : null,
    // A briefing typed or drafted — or a document still being read — is work.
    briefing ? briefing.text : null, briefingWorking,
  ]);
  const openedAs = useRef(snapshot);
  const dirty = snapshot !== openedAs.current;

  const [confirmingClose, setConfirmingClose] = useState(false);
  const keepEditingRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmShown = useRef(false);
  // The safe answer takes the focus when the question appears, and Cancel
  // gets it back when the question goes — a keyboard user is never dropped at
  // the top of the document by a foot that re-rendered under them.
  useEffect(() => {
    if (confirmingClose) {
      confirmShown.current = true;
      keepEditingRef.current?.focus();
    } else if (confirmShown.current) {
      cancelRef.current?.focus();
    }
  }, [confirmingClose]);

  /** The X and Cancel. Untouched: close. Work in hand: ask, in the foot. */
  const requestClose = () => {
    if (!dirty) { onCancel?.(); return; }
    setConfirmingClose(true);
  };
  /** Escape — the Modal's one close path, since the backdrop is inert. While
      the foot is asking, Escape is "Keep editing", not a second close. */
  const escape = () => {
    if (confirmingClose) setConfirmingClose(false);
    else requestClose();
  };

  /*
    THE FOOT SAYS WHO CAN GET IN, at the moment the host commits. True today:
    a created session waits in history for Start, and every phone is refused
    until it has started (game/session-gate.js). A survey is created AND opened
    by this press, so the sentence would be false there and is not shown.
  */
  const footNote = isEdit
    ? 'This session has not started, so nobody can join it yet.'
    : (isSurvey || isOther ? null : 'Nobody can join until you start it.');

  return (
    <Modal
      overlayClassName="new-game-overlay"
      contentClassName="new-game-dialog gsd"
      labelledBy="gsd-heading"
      onClose={escape}
      /* THE BACKDROP STAYS INERT. This is not a dialog over a screen — the page
         early-returns it, so there is nothing behind the overlay to go back to,
         and a stray click on the margin would throw away a half-filled form
         with no way to recover it. Escape is offered because it is deliberate
         in a way a mis-aimed click is not — and it asks first, like the X. */
      closeOnBackdrop={false}
      afterContent={showSetsDialog ? (
        /* A SIBLING OF THE DIALOG, INSIDE THE OVERLAY — not a child of it.
           `.qsets-scrim--over` has to cover the create screen, and the light
           theme reaches it through `.new-game-overlay`'s descendants. Nesting it
           inside `.new-game-dialog` would clip it to the card. */
        <HostQuestionSetsDialog
          engagementType={engagementType}
          onClose={() => setShowSetsDialog(false)}
          onSetsChanged={setLocalSets}
        />
      ) : null}
    >
      {/* THE HEAD STICKS, so the X is on screen however far down the host is. */}
      <div className="gsd-head">
        <h2 id="gsd-heading">
          {isEdit
            ? 'Edit session'
            : (isFirstEngagement ? 'New engagement' : 'Start a new engagement')}
        </h2>
        {/*
          THE X — reported missing: "when editing, there is no 'x' to close the
          box without saving changes." It goes through requestClose(), exactly
          like Cancel and Escape: one rule for all three, so none is a trap.
        */}
        <button
          type="button"
          className="gsd-close"
          onClick={requestClose}
          aria-label={isEdit ? 'Close without saving changes' : 'Close without creating'}
          title={isEdit ? 'Close without saving changes' : 'Close without creating'}
        >
          ×
        </button>
      </div>

      <div className="dialog-content">
        <div className="form-group">
          <label htmlFor="gsd-title">Event title</label>
          <input
            id="gsd-title"
            type="text"
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            placeholder="e.g. Q3 Leadership Offsite — Pricing Strategy"
            className="dialog-input"
          />
        </div>

        {/* PILLS, FROM THE TABLE. Every option visible at once and a bigger
            target than a <select>, which is how poll went unnoticed for so
            long. Rendered from PICKER_GAME_TYPES so it cannot drift again. */}
        <div className="form-group">
          <span className="gsd-label" id="gsd-format-label">Format</span>
          <div className="gsd-types" role="group" aria-labelledby="gsd-format-label">
            {[...PICKER_GAME_TYPES.map((type) => ({ id: type.id, label: type.label })),
              ...otherFormats.map((id) => ({ id, label: kindLabel(id) }))].map((type) => (
              <button
                key={type.id}
                type="button"
                className={`gsd-pill${type.id === engagementType ? ' on' : ''}`}
                aria-pressed={type.id === engagementType}
                disabled={isEdit}
                onClick={() => chooseFormat(type.id)}
              >
                {type.label}
              </button>
            ))}
          </div>
          {/* `blurb` exists for every type and was rendered nowhere in the
              app — dead data that answers "what is Wavelength?" for the price
              of one line. */}
          <p className="gsd-blurb">{isOther ? OTHER_BLURBS[engagementType] : gameTypeMeta(engagementType).blurb}</p>
          {eventBlocked && (
            <small className="dialog-help-text" data-testid="gsd-event-plan">
              {`Events come with the ${(eventsAccess && eventsAccess.offerPlanName) || 'paid plan'}. `}
              <a href={billingHref}>See plans</a>
            </small>
          )}
          {isEdit && (
            /* DISABLED, NOT HIDDEN, AND THE NOTE SAYS WHY. The format and set
               pin derived rows at create time (question-set version, the
               per-category order shuffles); the PUT whitelist refuses them, so
               live controls here would be a form that lies about what saving
               does. It used to say "and categories" too — above a category
               grid that is live and saves. */
            <small className="dialog-help-text">
              The format and question set are fixed once a session is created — create a
              new session to change either.
            </small>
          )}
        </div>

        {!isOther && (
        <div className="gsd-row">
          <div className="form-group">
            <label htmlFor="gsd-set">Question set</label>
            <select
              id="gsd-set"
              value={newGameSetKey}
              onChange={(e) => chooseSet(e.target.value)}
              className="dialog-select"
              disabled={isEdit}
            >
              <option value="">Select a question set...</option>
              {setsForType.map((set) => (
                /* KEY AND VALUE ARE THE PAIR. Two libraries can hold the same
                   slug, which under `key={set.id}` is a duplicate React key and
                   two <option>s the browser cannot tell apart. */
                /* AND A SET THE SERVER COULD NOT DECRYPT IS NOT A CHOICE.
                   `{set.name} (n questions)` on a nulled name renders the line
                   " (42 questions)" — an option with no subject. Worse, this
                   control ACTS: picking it pins a session to content nobody can
                   read, and that surfaces in front of a room. So it is named by
                   the one field that was never encrypted, told apart from a set
                   nobody titled, and refused. Still OFFERED, though — the
                   handler keeps the row deliberately, and a set visible in the
                   console but missing here is a question with no answer. */
                <option
                  key={setRefKey(set)}
                  value={setRefKey(set)}
                  disabled={isUnreadableSet(set)}
                  title={isUnreadableSet(set) ? UNREADABLE_REASON : undefined}
                >
                  {isUnreadableSet(set)
                    ? `${unreadableSetName(set)} — unreadable, cannot be used`
                    : `${set.name} (${set.totalQuestions} questions)${imageMarkerSuffix(set.hasImages)}`}
                </option>
              ))}
              {/* Editing a session whose set the page's list does not carry —
                  a retired set, or a list fetched for another format — must
                  still DISPLAY the pinned set rather than a blank control. */}
              {isEdit && newGameSetId && !setsForType.some((s) => sameSetRef(s, newGameSetRef)) && (
                <option value={newGameSetKey}>{newGameSetId}</option>
              )}
            </select>
            {/* THE ENTRY POINT. Always offered in create mode, not only when
                the list is empty: "I need to fix the title on the set I made
                last week" is as common as "I have none", and an affordance
                that appears only in the failure state is one nobody finds in
                the success state. Absent in edit mode, where the set cannot
                be changed anyway. */}
            {!isEdit && (
              <button
                type="button"
                className="gsd-setlink"
                onClick={() => setShowSetsDialog(true)}
              >
                {setsForType.length === 0 ? 'Make a question set' : 'Your question sets'}
              </button>
            )}
            {!isEdit && setsForType.length === 0 && (
              /* The old copy sent the host to "the question set editor" —
                 which is the admin console, a screen most hosts cannot open.
                 It named a dead end for the exact person most likely to read
                 it. */
              <small className="dialog-help-text">
                No {gameTypeMeta(engagementType).label} sets yet. Make one now — it takes a
                template and a spreadsheet.
              </small>
            )}
          </div>

          {/* The app's multi-select grid, kept deliberately. A set carries
              4-24 categories with wildly different counts; a single-value
              <select> cannot say "these three, not those five". */}
          {newGameSetId && !isSurvey && (
            <SessionCategories
              categories={categories}
              selected={selectedCats}
              editing={isEdit}
              onToggle={(name) => (isEdit ? toggleEditCategory(name) : onToggleCategory?.(name))}
            />
          )}
        </div>
        )}

        {/*
          WORKIE'S BRIEFING — main view, Call & Answer only (mockups 01, 03).
          The one Workie input that changes what Workie KNOWS; under Advanced
          it would never be found. BriefingField owns every state.
        */}
        {isCallAndAnswer && (
          <SessionBriefing value={briefing} onChange={setBriefing} onWorkingChange={setBriefingWorking} />
        )}

        {/*
          ── ADVANCED ─────────────────────────────────────────────────────────
          components/SessionOptions.jsx, shared with the event item dialog
          (events M1b). Always rendered, so a value set and folded away is
          still in the form.
        */}
        {!isOther && (
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
        )}
      </div>

      {/*
        THE GOAL'S PROBLEM, REPEATED OUTSIDE THE FOLD (final review Minor 1a).
        The Advanced fold is closed on open, so its own red help text — this
        same sentence, from session-goal.js — is not what a host sees when
        Create or Save just greyed out; a `title` tooltip is hover-only and
        never reaches touch. This line is the visible, announced reason, and
        the disabled button's `aria-describedby` points straight at it.
      */}
      {goalProblem && (
        <p className="gsd-blocked-reason" role="alert" id="gsd-blocked-reason">
          {goalProblem}
        </p>
      )}

      {/* A PLAN LIMIT is the shared notice (22-plan-limit-notice.html): what
          ran out, and what THIS person can do about it — the owner gets the
          request, anyone else is told whom to ask. Anything else is a fault,
          said plainly. */}
      {refusal && refusal.blocked ? (
        <PlanLimitNotice refusal={refusal} outcome="Nothing was created." surface="dusk" billingHref={billingHref} />
      ) : refusal ? (
        <div className="gsd-refusal" role="alert" data-testid="gsd-refusal">
          Could not create the session: {refusal.message || 'unknown error'}.
        </div>
      ) : null}

      {/*
        THE FOOT STICKS, like the head. With work in hand, the X, Cancel and
        Escape turn it into the question — inline, never a second modal.
      */}
      {confirmingClose ? (
        <div className="dialog-actions is-confirm" role="alertdialog" aria-labelledby="gsd-confirm-t">
          <p className="gsd-confirm-t" id="gsd-confirm-t">
            {isEdit
              ? <><b>Discard your changes?</b> The session stays as it was.</>
              : <><b>Discard this engagement?</b> Nothing has been created yet, and what you filled in is lost.</>}
          </p>
          <button
            type="button"
            className="btn-secondary"
            ref={keepEditingRef}
            onClick={() => setConfirmingClose(false)}
          >
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
              <Icon name="Lock" weight="bold" size={14} color="currentColor" />
              <span>{footNote}</span>
            </p>
          )}
          <button type="button" className="btn-secondary" ref={cancelRef} onClick={requestClose}>
            Cancel
          </button>
          {/* The guard the mockup drops. Without a set the game has no
              questions; without a title the live screen has nothing to name. */}
          {/* A survey is created AND opened by this press (the page posts
              /start straight after the create), so the button says what it
              does: phones can answer the moment it lands. */}
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!canCreate || busy}
            aria-describedby={goalProblem ? 'gsd-blocked-reason' : undefined}
            title={isCallAndAnswer && briefingWorking ? 'Waiting for Workie to finish the briefing' : (goalProblem || undefined)}
          >
            {busy
              ? (isEdit ? 'Saving…' : (isSurvey ? 'Opening…' : 'Creating…'))
              : (isEdit ? 'Save changes' : (OTHER_LABELS[engagementType]
                || (isSurvey ? 'Open the survey' : 'Create engagement')))}
          </button>
        </div>
      )}
    </Modal>
  );
}
