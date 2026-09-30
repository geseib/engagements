/**
 * WORKIE'S HOST OPTIONS — which of them apply right now.
 *
 * The voice and approach pickers change Workie from the NEXT round on. They
 * used to be drawn on the stage's What We Heard beat whatever came next, so a
 * CLOSED SURVEY — which has no next anything — offered "VOICE (NEXT QUESTION)"
 * and "APPROACH (NEXT QUESTION)" (QA drive 2026-09-29, finding #5b). A picker
 * for a round that cannot happen is a control that does nothing.
 *
 * `remaining` is the Session panel's own `questionsRemaining(catRows)`, or null
 * when there are no category rows to count from: "cannot tell" keeps the
 * pickers, because hiding them on a count that was never loaded would take a
 * working control away from every session whose categories are still loading.
 */
export function nextRoundPickersApply({ gameType = '', gameState = '', remaining = null } = {}) {
  if (gameType === 'survey') return false;
  const state = String(gameState || '');
  if (state.startsWith('SURVEY#') || state.startsWith('ENDED')) return false;
  if (typeof remaining === 'number' && remaining <= 0) return false;
  return true;
}

/**
 * The stage's words for a template read, by the reason get-ai-summary.js
 * stored (FALLBACK_REASONS there). Room-safe: this is drawn on the projector,
 * so it says what happened, never an error string.
 */
export function fallbackDetail(reason) {
  if (reason === 'model-error') {
    return 'Workie could not be reached, so this is only the count. Redo tries again.';
  }
  if (reason === 'no-prompt') {
    return 'No summary approach is set up for this kind of session, so this is only the count.';
  }
  return 'This is only the count, not Workie\'s read. Redo tries again.';
}
