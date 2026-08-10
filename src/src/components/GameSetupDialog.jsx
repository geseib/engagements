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
 */
import React, { useState, useEffect } from 'react';
import { PICKER_GAME_TYPES, gameTypeMeta } from '../config/gameTypes';
import { anonymityApplies } from '../config/anonymity';
import { imageMarkerSuffix } from './SetImageBadge';

export default function GameSetupDialog({
  isFirstEngagement = true,
  eventTitle = '',
  onEventTitleChange,
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
  const [engagementType, setEngagementType] = useState('call-and-answer');
  const [newGameSetId, setNewGameSetId] = useState('');
  const [eventDetails, setEventDetails] = useState('');
  const [gameAiContext, setGameAiContext] = useState('');
  const [newGamePersonaId, setNewGamePersonaId] = useState('');
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [anonymousResponses, setAnonymousResponses] = useState(true);

  const canCreate = Boolean(newGameSetId) && eventTitle.trim().length > 0;
  const setsForType = questionSets.filter((set) => set.engagementType === engagementType);

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
    onCreate?.({
      title: eventTitle,
      gameType: engagementType,
      setId: newGameSetId,
      categoryIds: Array.from(activeCategoryIds || []),
      eventDetails,
      aiContext: gameAiContext,
      personaId: newGamePersonaId,
      randomizeQuestions,
      anonymousResponses,
    });
  };

  return (
    <div className="new-game-overlay">
      <div className="new-game-dialog gsd">
        <h2>{isFirstEngagement ? 'New engagement' : 'Start a new engagement'}</h2>

        <div className="dialog-content">
          <div className="form-group">
            <label htmlFor="gsd-title">Event title</label>
            <input
              id="gsd-title"
              type="text"
              value={eventTitle}
              onChange={(e) => onEventTitleChange?.(e.target.value)}
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
          </div>

          <div className="gsd-row">
            <div className="form-group">
              <label htmlFor="gsd-set">Question set</label>
              <select
                id="gsd-set"
                value={newGameSetId}
                onChange={(e) => chooseSet(e.target.value)}
                className="dialog-select"
              >
                <option value="">Select a question set...</option>
                {setsForType.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name} ({set.totalQuestions} questions){imageMarkerSuffix(set.hasImages)}
                  </option>
                ))}
              </select>
              {setsForType.length === 0 && (
                <small className="dialog-help-text">
                  No {gameTypeMeta(engagementType).label} sets yet. Build one in the
                  question set editor, then come back.
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
                        className={`category-button ${activeCategoryIds.has(category.name) ? 'selected' : ''}`}
                        aria-pressed={activeCategoryIds.has(category.name)}
                        onClick={() => onToggleCategory?.(category.name)}
                      >
                        <span className="category-name">{category.name}</span>
                        <span className="category-count">({category.questionCount})</span>
                      </button>
                    ))}
                  </div>
                  <small className="dialog-help-text">
                    {activeCategoryIds.size === 0
                      ? 'No categories selected - all categories will be included'
                      : `${activeCategoryIds.size} category(ies) selected`}
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
              <input
                type="checkbox"
                checked={randomizeQuestions}
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
            Create engagement
          </button>
        </div>
      </div>
    </div>
  );
}
