/**
 * The body of `POST /games`, built from what the setup dialog collected.
 *
 * Its own module for two reasons.
 *
 * 1. **`create-game.js:9` is a whitelist.** A key the frontend sends and the
 *    backend does not name is dropped silently, and the comment above that
 *    destructure records the last time it happened: `triviaTimer` "was sent by
 *    the frontend for months and silently discarded that way." Building the body
 *    where it can be called and asserted is the cheapest guard against a repeat.
 *
 * 2. **`selectedCategories` used to depend on closure timing.**
 *    `handleStartNewGame` calls `leaveCurrentGame()` — which clears
 *    `activeCategoryIds` — and then read `Array.from(activeCategoryIds)` from
 *    the pre-reset closure. It worked, for a reason invisible at the call site.
 *    The ids now arrive in the form payload and the ordering stops mattering.
 */
import { createPayloadFor } from './anonymity';

/**
 * @param form  what `<GameSetupDialog>` raises through `onCreate`:
 *              { title, gameType, setId, categoryIds, eventDetails, aiContext,
 *                personaId, randomizeQuestions, anonymousResponses }
 */
export function createGameBody(form = {}) {
  const {
    title = '',
    gameType,
    setId = '',
    categoryIds,
    eventDetails = '',
    aiContext = '',
    personaId = '',
    randomizeQuestions = true,
    anonymousResponses = true,
  } = form;

  return {
    eventTitle: title,
    engagementInfo: eventDetails || null,
    aiContext: aiContext || null,
    gameType,
    questionSetId: setId,
    randomizeQuestions,
    // Always an array. `undefined` would be deleted by JSON.stringify, so the
    // backend would read "no categories key" where the host meant "all of them".
    selectedCategories: Array.from(categoryIds || []),
    // '' means "adapt to the session" — create-game.js only stores PersonaId
    // when it is non-empty, so the empty string has to survive as one.
    personaId: personaId || '',
    hostName: 'Host',
    ...createPayloadFor({ gameType, anonymousResponses }),
  };
}

/**
 * The body of `PUT /games/{gameId}`, built from the same dialog payload.
 *
 * Beside `createGameBody` for the same drift-protection reason: the backend's
 * update-game.js is a WHITELIST — a key it does not name is ignored in
 * silence — so the one tested definition of the wire shape lives here, where
 * createGamePayload.test.js can call it.
 *
 * PHASE-1 WHITELIST ONLY: eventTitle, engagementInfo, aiContext, personaId,
 * visibility, anonymousUntilReveal. Deliberately NOT sent — the backend would
 * ignore them anyway, and sending them would make this function lie about
 * what an edit can do:
 *   - gameType / questionSetId / selectedCategories: pinned at create time to
 *     derived rows (QuestionSetVersion, the CATEGORY#*#ORDER shuffles,
 *     STATE#CATS); the edit dialog shows them disabled.
 *   - randomizeQuestions: pinned for the same reason — the per-category order
 *     rows were shuffled (or not) when the session was created.
 *   - accessCode / hostName: not part of the edit surface at all.
 *
 * `visibility` is included only when the form actually carries it — the setup
 * dialog has no visibility control today, and an absent key means "leave it
 * alone" to the backend's `'field' in body` builder.
 */
export function updateGameBody(form = {}) {
  const {
    title = '',
    gameType,
    eventDetails = '',
    aiContext = '',
    personaId = '',
    anonymousResponses = true,
  } = form;

  return {
    eventTitle: title,
    // null is the deliberate CLEAR — the backend coerces it to '' — matching
    // createGameBody's own empty-field convention.
    engagementInfo: eventDetails || null,
    aiContext: aiContext || null,
    // '' means "adapt to the session"; the backend REMOVEs the attribute.
    personaId: personaId || '',
    ...('visibility' in form ? { visibility: form.visibility } : {}),
    ...createPayloadFor({ gameType, anonymousResponses }),
  };
}
