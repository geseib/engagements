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
