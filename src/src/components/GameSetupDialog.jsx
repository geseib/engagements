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
 * PURE-PROPS, WITH ONE NAMED EXCEPTION. Every FORM field arrives as a prop and
 * leaves in one payload, and that stays. The single `authFetch` in this file
 * reads the prompt library so the Advanced line can check a claim instead of
 * asserting one — evidence for a sentence, never a value the form owns. Its reasoning is at the fetch itself.
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
import { anonymityApplies } from '../config/anonymity';
import { NAMES_MODES, NAMES_DEFAULT, namesMode } from '../config/surveyNames';
import { advancedSummary } from '../config/setupDefaults';
import Icon from './Icon';
import { setRefKey, parseSetRefKey, sameSetRef, DEFAULT_SCOPE } from '../utils/setRef';
import {
  isUnreadableSet, unreadableSetName, UNREADABLE_REASON,
} from '../utils/unreadableSet';
import { imageMarkerSuffix } from './SetImageBadge';
import HostQuestionSetsDialog from './HostQuestionSetsDialog';
import BriefingField from './BriefingField';
import Modal from './Modal';
import PlanLimitNotice from './PlanLimitNotice';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import './GameSetupDialog.css';

export default function GameSetupDialog({
  /*
    'create' (default) | 'edit'. Edit is the same form pointed at an EXISTING
    unstarted session: the page fetches `GET /games/{id}?role=host`, hands the
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
  /** What GET /games/{id}?role=host returned — the host branch of get-game.js. */
  initialValues = null,
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

  const isCallAndAnswer = normalizeGameType(engagementType) === 'call-and-answer';
  // A draft still being written would be lost by a Create pressed now.
  const canCreate = Boolean(newGameSetId) && title.trim().length > 0
    && !(isCallAndAnswer && briefingWorking);

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
  const isSurvey = normalizeGameType(engagementType) === 'survey';
  const chosenSet = allSets.find((s) => sameSetRef(s, newGameSetRef)) || null;
  const setNamesDefault = isSurvey && chosenSet && chosenSet.namesDefault
    ? namesMode(chosenSet.namesDefault) : null;
  const names = namesMode(namesChoice);

  /*
    ── THE ONE FETCH IN THIS FILE, AND WHY IT IS ALLOWED TO BE HERE ───────────

    This component's header says it is pure-props, and that is still the rule
    for everything the FORM owns — every field above arrives as a prop and every
    value leaves in one payload. This is not a form field. It is the evidence
    behind a CLAIM the dialog makes on the Advanced line ("follows this set's
    own summary approach"), and that claim was once made from the mere presence
    of a string.

    Handing it down as a prop would mean the page fetching a list purely so this
    sentence could be honest, through a component that does not otherwise care
    about prompts — and `HostQuestionSetsDialog` (hung off this same overlay)
    already reads the same endpoint the same way for the same reason. One
    request, when the dialog opens.

    NULL IS "NOT KNOWN", AND IT IS NOT THE SAME AS EMPTY. A 403, a 500 or a
    request that could not be signed says nothing whatever about the set; a
    fetched list that does not contain the id says the id resolves to nothing.
    Only the second is evidence, so a failure leaves this null and the line
    stays where it was. Answering an unreadable list with "the standard way"
    would be the same over-claim pointed in the other direction.
  */
  const [knownPromptIds, setKnownPromptIds] = useState(null);
  // The same list, kept whole: the approach picker below offers the summary
  // prompts written for the chosen format.
  const [promptList, setPromptList] = useState([]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await authFetch(adminApiUrl('admin/ai-prompts'));
        if (!response || !response.ok) return;
        const data = await response.json().catch(() => ({}));
        const rows = (data.prompts || []).filter((p) => p && p.promptId);
        const ids = rows.map((p) => p.promptId);
        if (live) {
          setKnownPromptIds(new Set(ids));
          setPromptList(rows);
        }
      } catch (e) {
        // Left unknown on purpose — see above. The host is told nothing about
        // this request, because nothing on this screen depends on it.
      }
    })();
    return () => { live = false; };
  }, []);

  /** The chosen set's own summary prompt, and whether it can actually be honoured. */
  const chosenSetPromptId = allSets.find((s) => s.id === newGameSetId)?.promptId || '';
  const setPromptWillBeUsed = Boolean(chosenSetPromptId)
    && (knownPromptIds === null || knownPromptIds.has(chosenSetPromptId));
  /*
    THE APPROACH PICKER'S LIST: summary prompts for THIS format. The same
    filter the set editor applies (QuestionSetEditor.jsx:willRunAsASummary) —
    a generator prompt, or one the list already knows cannot drive a summary,
    is not offered; 'unknown' is the normal verdict and is kept.
  */
  const promptChoices = promptList.filter((p) => normalizeGameType(p.gameType) === normalizeGameType(engagementType)
    && p.summaryPromptStatus !== 'unusable'
    && p.promptType !== 'generation');
  /*
    A pick that no longer suits the format is dropped by chooseFormat, below —
    not by an effect on the format. The effect this replaced also ran on MOUNT,
    before the prompt list had loaded, so it cleared an edit's seeded approach
    on open and Save then sent promptId: '', which REMOVEs it.
  */

  // The page reloads the voices that suit this format. On mount too, so the
  // default format's list is the one the picker below shows.
  useEffect(() => {
    onFormatChange?.(engagementType);
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

  /*
    ONE RADIO GROUP, KEYBOARD INCLUDED. Three buttons with role="radio" are a
    radio group only if they behave as one: a single tab stop (the checked
    option), and the arrow keys move the choice — wrapping at the ends, the
    way a native radio group does.
  */
  const namesRefs = useRef([]);
  const onNamesKey = (event, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + NAMES_MODES.length) % NAMES_MODES.length;
    pickNames(NAMES_MODES[next].id);
    namesRefs.current[next]?.focus?.();
  };

  const submit = () => {
    if (!canCreate || busy) return;
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
      // Only Call & Answer carries a briefing: null when there is none, so an
      // edit clears one the host removed. createGameBody/updateGameBody drop
      // it for any other format.
      ...(isCallAndAnswer
        ? { briefing: briefing && briefing.text && briefing.text.trim() ? briefing : null }
        : {}),
    });
  };

  /*
    ── WHAT THE ADVANCED LINE SAYS ────────────────────────────────────────────
    Every default in force, any change first. config/setupDefaults.js decides
    what "default" means; the names come from the lists this dialog already
    holds (the whole prompt list, so an edit's seeded approach is named even
    when it is not one this format offers).
  */
  const summary = advancedSummary({
    gameType: engagementType,
    anonymousResponses,
    randomizeQuestions,
    names: namesChoice,
    namesDefault: chosenSet && chosenSet.namesDefault,
    personaId: newGamePersonaId,
    promptId: newGamePromptId,
    eventDetails,
    aiContext: gameAiContext,
    personas,
    promptChoices: promptList,
    setPromptWillBeUsed,
  });

  /*
    ── WORK IN HAND ────────────────────────────────────────────────────────────
    The form as a string, compared with the form as it opened. Categories count
    only in edit mode, where this dialog owns them: in create mode the PAGE owns
    the selection and can move it without the host touching anything, and the
    grid only appears once a set is picked — which is already a change.
  */
  const snapshot = JSON.stringify([
    title, engagementType, newGameSetKey, eventDetails, gameAiContext,
    newGamePersonaId, newGamePromptId, randomizeQuestions, anonymousResponses, namesChoice,
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

  // "None picked, so all 4 are in · 12 questions" — the count of what will be
  // asked, not just of the chips.
  const pickedCategories = categories.filter((c) => selectedCats.has(c.name));
  const questionsIn = (list) => {
    const n = list.reduce((sum, c) => sum + (Number(c.questionCount) || 0), 0);
    return `${n} question${n === 1 ? '' : 's'}`;
  };

  /*
    THE FOOT SAYS WHO CAN GET IN, at the moment the host commits. True today:
    a created session waits in history for Start, and every phone is refused
    until it has started (game/session-gate.js). A survey is created AND opened
    by this press, so the sentence would be false there and is not shown.
  */
  const footNote = isEdit
    ? 'This session has not started, so nobody can join it yet.'
    : (isSurvey ? null : 'Nobody can join until you start it.');

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
            {PICKER_GAME_TYPES.map((type) => (
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
          <p className="gsd-blurb">{gameTypeMeta(engagementType).blurb}</p>
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
            <div className="form-group">
              <span className="gsd-label" id="gsd-categories-label">Categories</span>
              <div className="category-selection">
                <div className="category-button-grid" role="group" aria-labelledby="gsd-categories-label">
                  {categories.map((category) => (
                    <button
                      key={category.name}
                      type="button"
                      className={`category-button ${selectedCats.has(category.name) ? 'selected' : ''}`}
                      aria-pressed={selectedCats.has(category.name)}
                      onClick={() => (isEdit ? toggleEditCategory(category.name) : onToggleCategory?.(category.name))}
                    >
                      <span className="category-name">{category.name}</span>
                      <span className="category-count">({category.questionCount})</span>
                    </button>
                  ))}
                </div>
                <small className="dialog-help-text">
                  {/*
                    Edit and create disagree about what an empty selection MEANS,
                    and the copy has to carry the difference. Create's empty set
                    is "the host never opened the picker" and falls back to all;
                    an edit that ends empty is a host who deselected everything,
                    and the save button below refuses it rather than storing a
                    session with no reachable questions.
                  */}
                  {isEdit
                    ? (editCategoryNames.size === 0
                      ? 'Select at least one category — a session with none has no questions to ask.'
                      : `${editCategoryNames.size} of ${categories.length} categories enabled`)
                    : (activeCategoryIds.size === 0
                      ? `None picked, so all ${categories.length} are in · ${questionsIn(categories)}`
                      : `${pickedCategories.length} of ${categories.length} categories · ${questionsIn(pickedCategories)}`)}
                </small>
              </div>
            </div>
          )}
        </div>

        {/*
          WORKIE'S BRIEFING — main view, Call & Answer only (mockups 01, 03).
          The one Workie input that changes what Workie KNOWS; under Advanced
          it would never be found. BriefingField owns every state.
        */}
        {isCallAndAnswer && (
          <>
            <h3 className="gsd-section">
              Workie’s briefing<span className="gsd-tag">Call &amp; Answer only</span>
            </h3>
            <BriefingField
              value={briefing}
              onChange={setBriefing}
              onWorkingChange={setBriefingWorking}
            />
          </>
        )}

        {/*
          ── ADVANCED ─────────────────────────────────────────────────────────
          A native <details>, closed on open. Its summary is the plan in one
          sentence; the controls inside keep their shipped copy, grouped.
          Always rendered, so a value set and folded away is still in the form.
        */}
        <details className="gsd-adv">
          <summary>
            <span className="gsd-adv-k"><i className="gsd-chev" aria-hidden="true" />Advanced</span>
            <span className="gsd-adv-s" data-testid="gsd-adv-summary">
              {summary.lead && <b>{summary.lead}</b>}
              {summary.lead && summary.rest ? ' ' : ''}
              {summary.rest}
              {!summary.lead && <span className="gsd-adv-open-only"> Change any of them here.</span>}
            </span>
          </summary>

          <div className="gsd-adv-body">
            {/* Checked against this dialog's own type picker, not the live
                game's `currentGameType`, which still names whatever is on
                screen until the new game is created. A survey's Names takes
                the anonymity card's place. */}
            {(anonymityApplies(engagementType) || isSurvey) && (
              <h3 className="gsd-section">Responses</h3>
            )}

            {anonymityApplies(engagementType) && (
              <div className={`gsd-opt${anonymousResponses ? ' is-on' : ''}`}>
                <label className="gsd-opt-head">
                  <input
                    type="checkbox"
                    checked={anonymousResponses}
                    onChange={(e) => setAnonymousResponses(e.target.checked)}
                  />
                  <span className="gsd-opt-name">Anonymous responses</span>
                  {/* aria-hidden: the checkbox already announces its own state,
                      and without this the browser folds "On" into the control's
                      accessible name and calls it "on". */}
                  <span className="gsd-opt-state" aria-hidden="true">{anonymousResponses ? 'On' : 'Off'}</span>
                </label>

                {/* KEEP THIS SENTENCE. The mockup says "Until you reveal them",
                    which tells the host they hold a switch they do not hold:
                    get-results.js:207-217 sets AuthorsRevealed UNCONDITIONALLY on
                    entering RESULTS, and /reveal-authors is only an *early*
                    reveal. A host who read the mockup's line and then closed
                    voting to show the tally would have attributed every answer
                    believing they had not. */}
                <p className="gsd-opt-does">
                  Until voting closes, nobody sees who wrote which answer — not the room,
                  not you. The room votes on the answers, not on the people. You can also
                  reveal the names earlier if you want to.
                </p>

                <div className="gsd-preview">
                  <div className="gsd-pv">
                    <h6>While voting</h6>
                    <p className="gsd-pv-ans">&ldquo;Freeze all discretionary discounting for thirty days&hellip;&rdquo;</p>
                    <p className="gsd-pv-who">Response 1</p>
                  </div>
                  <div className="gsd-pv">
                    <h6>After voting closes</h6>
                    <p className="gsd-pv-ans">&ldquo;Freeze all discretionary discounting for thirty days&hellip;&rdquo;</p>
                    <p className="gsd-pv-who named">Priya Raghavan &middot; +180 pts</p>
                  </div>
                </div>

                <p className="gsd-opt-else">
                  {anonymousResponses
                    ? <><b>Turn it off</b> and every answer is labelled with its author from the moment voting opens.</>
                    : <><b>It is off</b> — every answer is labelled with its author from the moment voting opens.</>}
                </p>

                {/* Never overclaim. Shipped verbatim. */}
                <p className="gsd-opt-limit">
                  This hides names, not identities. In a small group, people may still
                  recognise each other’s answers.
                </p>
              </div>
            )}

            {isSurvey && (
              /*
                THE NAMES CARD — 07-start-survey.html, which draws it as "the
                shipped card, one control wider": the option card above, with its
                checkbox become a three-way choice. Every sentence is the value's
                own, from config/surveyNames.js — the chooser line, what it does,
                the phone's promise — so what the host chose and what the room is
                told cannot drift.

                "What you get" is a SAMPLE of the host's view in each mode, drawn
                from 07's own example and 33-people's statuses. It shows the shape
                of what comes back, not this survey's answers.
              */
              <>
                <div className="gsd-names">
                  <div className="gsd-names-hd">
                    <span className="gsd-opt-name">Names</span>
                    <span className="gsd-names-st" aria-hidden="true">{names.label}</span>
                  </div>
                  <div className="gsd-three" role="radiogroup" aria-label="Names">
                    {NAMES_MODES.map((mode, i) => {
                      const on = mode.id === names.id;
                      return (
                        <button
                          key={mode.id}
                          ref={(el) => { namesRefs.current[i] = el; }}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          tabIndex={on ? 0 : -1}
                          className="gsd-three-opt"
                          onClick={() => pickNames(mode.id)}
                          onKeyDown={(event) => onNamesKey(event, i)}
                        >
                          <b><i aria-hidden="true" />{mode.label}</b>
                          <span>{mode.hostLine}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="gsd-opt-does">{names.does}</p>
                  <div className="gsd-preview">
                    <div className="gsd-pv">
                      <h6>What their phone says</h6>
                      <p className="gsd-pv-ans" data-testid="names-phone-preview">
                        {names.phoneLead && <b>{names.phoneLead}</b>}
                        {names.phoneLead ? ' ' : ''}
                        {names.phoneLine}
                      </p>
                    </div>
                    <div className="gsd-pv">
                      <h6>What you get</h6>
                      <p className="gsd-pv-ans">&ldquo;Seeing the console actually run beat every slide about it.&rdquo;</p>
                      {names.id === 'named' ? (
                        <p className="gsd-pv-who named">Priya Raghavan</p>
                      ) : (
                        <p className="gsd-pv-who">Response 12 &middot; no name</p>
                      )}
                      {names.id === 'finished' && (
                        <>
                          <p className="gsd-pv-ans gsd-pv-gap">Priya Raghavan &middot; finished 2:12pm</p>
                          <p className="gsd-pv-who">People list &middot; no answers</p>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Never overclaim. The shipped card's own sentence, verbatim. */}
                  <p className="gsd-opt-limit">
                    This hides names, not identities. In a small group, people may still
                    recognise each other’s answers.
                  </p>
                </div>
                <p className="gsd-names-lock">
                  <Icon name="Lock" weight="bold" size={13} color="currentColor" />
                  {' Fixed once the survey opens — people answer on the promise their phone made them.'}
                  {/* Only when the set really carries one: pointing the host at a
                      set-level default that does not exist would be a lie. */}
                  {setNamesDefault && (
                    <>{' This set’s default is '}<b>{setNamesDefault.label}</b>.</>
                  )}
                </p>
              </>
            )}

            {!isSurvey && (
              <>
                <h3 className="gsd-section">Questions</h3>
                <div className={`gsd-opt${randomizeQuestions ? ' is-on' : ''}`}>
                  <label className="gsd-opt-head">
                    {/* Disabled in edit mode: the per-category order rows were
                        shuffled (or not) when the session was created, so the PUT
                        whitelist refuses this flag — a live checkbox here would
                        toggle something that silently fails to save. */}
                    <input
                      type="checkbox"
                      checked={randomizeQuestions}
                      disabled={isEdit}
                      onChange={(e) => setRandomizeQuestions(e.target.checked)}
                    />
                    <span className="gsd-opt-name">Shuffle the question order</span>
                    <span className="gsd-opt-state" aria-hidden="true">{randomizeQuestions ? 'On' : 'Off'}</span>
                  </label>
                  {/* Both branches, because the off state is the one nobody guesses. */}
                  <p className="gsd-opt-does">
                    {randomizeQuestions
                      ? 'Questions are drawn at random from the categories you picked, rather than in the order they were written.'
                      : 'Questions are asked in order, completing each category before moving to the next.'}
                  </p>
                  {isEdit && (
                    <p className="gsd-opt-limit">
                      Fixed once the session is created — the question order was drawn when
                      this session was set up.
                    </p>
                  )}
                </div>
              </>
            )}

            <h3 className="gsd-section">Workie</h3>

            <div className="form-group">
              <label htmlFor="gsd-persona">Workie's voice</label>
              <select
                id="gsd-persona"
                value={newGamePersonaId}
                onChange={(e) => setNewGamePersonaId(e.target.value)}
                className="dialog-select"
              >
                {/* Adapting to the session is the designed default, not a
                    fallback — a fixed persona is what made Workie refuse a
                    holiday icebreaker as "insufficient for business analysis". */}
                <option value="">Adapt to the session (recommended)</option>
                {personas.map((persona) => (
                  <option key={persona.personaId} value={persona.personaId}>
                    {persona.name}{persona.tagline ? ` — ${persona.tagline}` : ''}
                  </option>
                ))}
              </select>
              <small className="dialog-help-text">
                {newGamePersonaId
                  ? 'Workie keeps this voice for the whole session. You can change it between rounds.'
                  : 'Workie reads the room and picks its own register — playful for an icebreaker, analytical for a retro.'}
              </small>
            </div>

            {/*
              THE SESSION'S SUMMARY APPROACH — the owner (2026-09-22): "how do I
              select the right prompt for the results screen ... and how can we
              change it during the session setup". Beside the voice, filtered to
              the format, and defaulting to what the Advanced line promises: the
              set's own approach if it names one, else the format standard. The
              pick lands on the game record (PromptId) and beats the set's.
            */}
            <div className="form-group">
              <label htmlFor="gsd-prompt">Summary approach</label>
              <select
                id="gsd-prompt"
                value={newGamePromptId}
                onChange={(e) => setNewGamePromptId(e.target.value)}
                className="dialog-select"
              >
                <option value="">
                  {setPromptWillBeUsed
                    ? 'What the set says (recommended)'
                    : `The standard ${gameTypeMeta(engagementType).label} way (recommended)`}
                </option>
                {promptChoices.map((prompt) => (
                  <option key={prompt.promptId} value={prompt.promptId}>
                    {prompt.name}{prompt.category ? ` (${prompt.category})` : ''}
                  </option>
                ))}
              </select>
              <small className="dialog-help-text">
                How Workie sums up each round on the results screen — the shape and content, where the voice is only the register. You can change it mid-session; it applies from the next round.
              </small>
            </div>


            {/*
              "AI CONTEXT", RENAMED FOR WHAT IT DOES. The prompt carries it as
              THE HOST'S INSTRUCTIONS and demands it in every section of the
              summary (personas.js) — rules, not background. Facts about the
              session are Event details' job, and the prompt reads those too.
            */}
            <div className="form-group">
              <label htmlFor="gsd-ai-context">Instructions for Workie</label>
              <textarea
                id="gsd-ai-context"
                value={gameAiContext}
                onChange={(e) => setGameAiContext(e.target.value)}
                placeholder="Anything Workie must always do — e.g. ‘end every round with one question for the ops leads’"
                className="dialog-textarea"
                rows="2"
                maxLength="500"
              />
              <small className="dialog-help-text">
                Workie follows these in every round’s summary. Facts about the session belong in
                Event details, below.
                {' '}{gameAiContext.length}/500 characters
              </small>
            </div>

            <h3 className="gsd-section">What people see when they join</h3>

            <div className="form-group">
              <label htmlFor="gsd-details">Event details</label>
              <textarea
                id="gsd-details"
                value={eventDetails}
                onChange={(e) => setEventDetails(e.target.value)}
                placeholder="What this session is for, in a sentence or two."
                className="dialog-textarea"
                rows="2"
                maxLength="300"
              />
              <small className="dialog-help-text">
                Shown to people on the screen they land on after joining. Workie reads it too.
                {' '}{eventDetails.length}/300 characters
              </small>
            </div>
          </div>
        </details>
      </div>

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
            title={isCallAndAnswer && briefingWorking ? 'Waiting for Workie to finish the briefing' : undefined}
          >
            {busy
              ? (isEdit ? 'Saving…' : (isSurvey ? 'Opening…' : 'Creating…'))
              : (isEdit ? 'Save changes' : (isSurvey ? 'Open the survey' : 'Create engagement'))}
          </button>
        </div>
      )}
    </Modal>
  );
}
