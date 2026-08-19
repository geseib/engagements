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
 */
import React, { useState, useEffect, useMemo } from 'react';
import { PICKER_GAME_TYPES, gameTypeMeta } from '../config/gameTypes';
import { anonymityApplies } from '../config/anonymity';
import { imageMarkerSuffix } from './SetImageBadge';
import HostQuestionSetsDialog from './HostQuestionSetsDialog';
import Modal from './Modal';

export default function GameSetupDialog({
  /*
    'create' (default) | 'edit'. Edit is the same form pointed at an EXISTING
    unstarted session: the page fetches `GET /games/{id}?role=host`, hands the
    result in as `initialValues`, and this component seeds its state from it.
    Still pure-props — no fetch enters this file — and in edit mode the fields
    the backend's PUT whitelist refuses (format, question set, categories,
    shuffle) are shown disabled with a note, not hidden, so the host can see
    what the session is without being able to break its pinned rows.
  */
  mode = 'create',
  /** What GET /games/{id}?role=host returned — the host branch of get-game.js. */
  initialValues = null,
  isFirstEngagement = true,
  eventTitle = '',
  onEventTitleChange,
  /*
    THE SET THE HOST WAS JUST USING, so Switch game reopens on it.

    Seeded once rather than controlled: after mount the picker below owns this
    value, and a prop that kept re-asserting itself would fight every change the
    host makes. `handleSwitchGame` reads the outgoing game's set before the
    reset clears it, which is the whole reason it is captured there and not
    read from the page here.
  */
  initialSetId = '',
  questionSets = [],
  personas = [],
  categories = [],
  activeCategoryIds = new Set(),
  onToggleCategory,
  onFormatChange,
  onQuestionSetChange,
  onCancel,
  onCreate,
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
  const [newGameSetId, setNewGameSetId] = useState(
    isEdit ? (seed.questionSetId || '') : (initialSetId || '')
  );
  const [eventDetails, setEventDetails] = useState(isEdit ? (seed.details || '') : '');
  const [gameAiContext, setGameAiContext] = useState(isEdit ? (seed.aiContext || '') : '');
  const [newGamePersonaId, setNewGamePersonaId] = useState(isEdit ? (seed.personaId || '') : '');
  const [randomizeQuestions, setRandomizeQuestions] = useState(
    isEdit ? seed.randomizeQuestions !== false : true
  );
  const [anonymousResponses, setAnonymousResponses] = useState(
    isEdit ? seed.anonymousUntilReveal !== false : true
  );
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

  const canCreate = Boolean(newGameSetId) && title.trim().length > 0;

  // Merged by id, page copy first. A set the host just made exists only in
  // `localSets` until the page next re-reads; a set the page already knows about
  // keeps the page's richer record.
  const allSets = useMemo(() => {
    if (!localSets) return questionSets;
    const byId = new Map(localSets.map((set) => [set.id, set]));
    for (const set of questionSets) byId.set(set.id, set);
    return Array.from(byId.values());
  }, [questionSets, localSets]);

  const setsForType = allSets.filter((set) => set.engagementType === engagementType);

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
    setNewGameSetId('');
    onQuestionSetChange?.('');
    // A voice picked for the old format may not exist for the new one.
    setNewGamePersonaId('');
  };

  const chooseSet = (setId) => {
    setNewGameSetId(setId);
    onQuestionSetChange?.(setId);
  };

  const submit = () => {
    if (!canCreate) return;
    // An edit that deselected every category is refused HERE, not sent and
    // bounced: the backend would 400 it, but the host is mid-form and the
    // helper line under the grid already says why.
    if (isEdit && categories.length > 0 && editCategoryNames.size === 0) return;
    onCreate?.({
      title,
      gameType: engagementType,
      setId: newGameSetId,
      categoryIds: Array.from(selectedCats || []),
      eventDetails,
      aiContext: gameAiContext,
      personaId: newGamePersonaId,
      randomizeQuestions,
      anonymousResponses,
    });
  };

  return (
    <Modal
      overlayClassName="new-game-overlay"
      contentClassName="new-game-dialog gsd"
      labelledBy="gsd-heading"
      onClose={() => onCancel?.()}
      /* THE BACKDROP STAYS INERT. This is not a dialog over a screen — the page
         early-returns it, so there is nothing behind the overlay to go back to,
         and a stray click on the margin would throw away a half-filled form
         with no way to recover it. Escape is offered because it is deliberate
         in a way a mis-aimed click is not. */
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
      {/*
        THE X — reported missing: "when editing, there is no 'x' to close the
        box without saving changes." Same exit Escape already offers (the Modal
        wires it), surfaced where people actually look for it. It DISCARDS, and
        that is consistent: this dialog has never confirmed an Escape either,
        and two exits with different rules would make one of them a trap.
        The backdrop stays inert for the reason the Modal props state.
      */}
      <button
        type="button"
        className="gsd-close"
        onClick={() => onCancel?.()}
        aria-label={isEdit ? 'Close without saving changes' : 'Close without creating'}
        title={isEdit ? 'Close without saving changes' : 'Close without creating'}
      >
        ×
      </button>
      <h2 id="gsd-heading">
        {isEdit
          ? 'Edit session'
          : (isFirstEngagement ? 'New engagement' : 'Start a new engagement')}
      </h2>

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
            /* DISABLED, NOT HIDDEN, AND THE NOTE SAYS WHY. The format, set and
               categories pin derived rows at create time (question-set version,
               per-category order shuffles, category state); the PUT whitelist
               refuses them, so offering live controls here would be a form
               that lies about what saving does. Phase 2, if ever, rebuilds
               those rows. */
            <small className="dialog-help-text">
              The format, question set and categories are fixed once a session is
              created. Create a new session to change them.
            </small>
          )}
        </div>

        <div className="gsd-row">
          <div className="form-group">
            <label htmlFor="gsd-set">Question set</label>
            <select
              id="gsd-set"
              value={newGameSetId}
              onChange={(e) => chooseSet(e.target.value)}
              className="dialog-select"
              disabled={isEdit}
            >
              <option value="">Select a question set...</option>
              {setsForType.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name} ({set.totalQuestions} questions){imageMarkerSuffix(set.hasImages)}
                </option>
              ))}
              {/* Editing a session whose set the page's list does not carry —
                  a retired set, or a list fetched for another format — must
                  still DISPLAY the pinned set rather than a blank control. */}
              {isEdit && newGameSetId && !setsForType.some((s) => s.id === newGameSetId) && (
                <option value={newGameSetId}>{newGameSetId}</option>
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
          {newGameSetId && (
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
                      ? 'No categories selected - all categories will be included'
                      : `${activeCategoryIds.size} category(ies) selected`)}
                </small>
              </div>
            </div>
          )}
        </div>

        <h3 className="gsd-section">Responses</h3>

        {/* Checked against this dialog's own type picker, not the live game's
            `currentGameType`, which still names whatever is on screen until
            the new game is created. */}
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

        <h3 className="gsd-section">Context for Workie</h3>

        <div className="form-group">
          <label htmlFor="gsd-details">Event details (optional)</label>
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
            Shown to participants on the screen they land on after joining.
            {' '}{eventDetails.length}/300 characters
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="gsd-ai-context">AI context (optional)</label>
          <textarea
            id="gsd-ai-context"
            value={gameAiContext}
            onChange={(e) => setGameAiContext(e.target.value)}
            placeholder="Your project, team or goals — e.g. 'Team working on improving collaboration'"
            className="dialog-textarea"
            rows="3"
            maxLength="500"
          />
          <small className="dialog-help-text">
            This helps AI provide more contextual analysis during the session.
            {' '}{gameAiContext.length}/500 characters
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="gsd-persona">Workie's voice (optional)</label>
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
              ? 'Workie will keep this voice for the whole session. You can change it mid-game.'
              : 'Workie reads the room and picks its own register — playful for an icebreaker, analytical for a retro.'}
          </small>
        </div>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn-secondary" onClick={() => onCancel?.()}>
          Cancel
        </button>
        {/* The guard the mockup drops. Without a set the game has no
            questions; without a title the live screen has nothing to name. */}
        <button type="button" className="btn-primary" onClick={submit} disabled={!canCreate}>
          {isEdit ? 'Save changes' : 'Create engagement'}
        </button>
      </div>
    </Modal>
  );
}
