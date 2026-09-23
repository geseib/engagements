/**
 * WHOSE RESPONSES ARE ON THE STAGE — and whether to draw them yet.
 *
 * The owner, 2026-09-23: "when retrieving the responses after all have
 * answered. the host screen flashes up a new template for the 1 responder it
 * would be better to leave that space blank until the data has loaded."
 *
 * How that happened. The room moves to VOTE by the `votingStarted` socket
 * frame, which usually lands before start-vote's own response carries the
 * round's responses — so the VOTE stage drew whatever `answers` still held
 * from ASK. During ASK that list is refetched once per arriving answer, and
 * those fetches can finish out of order, so it could hold fewer rows than had
 * come in — one, in the case the owner saw. The stage laid out a single card,
 * then re-laid it out when the real list arrived.
 *
 * So the page records WHICH round-phase its `answers` belong to, and the VOTE
 * and RESULTS stages draw responses only when that is the round-phase on
 * screen. Until then the space is blank. ASK draws what it has — responses
 * arriving one at a time is what ASK is.
 *
 * Kept out of GameHostPage because that file cannot be mounted in jsdom.
 * __tests__/stageAnswers.test.js holds the rules.
 */

/** `VOTE#3`, `VOTE#003` → `VOTE#003`; anything that is not a round-phase → null. */
export function stageAnswersKey(state) {
  const m = /^(ASK|VOTE|RESULTS)#0*(\d+)$/.exec(String(state || ''));
  return m ? `${m[1]}#${m[2].padStart(3, '0')}` : null;
}

/**
 * May the stage draw its responses for `gameState`?
 *
 * @param answersFor the round-phase key the page's `answers` were loaded for
 */
export function stageAnswersReady(gameState, answersFor) {
  const key = stageAnswersKey(gameState);
  if (!key || key.startsWith('ASK#')) return true;
  return answersFor === key;
}

/**
 * May a response list fetched for ASK round `round` be put on the stage now?
 *
 * Only while the stage is still asking that round. A fetch that lands after the
 * room has moved to VOTE or RESULTS — or to the next round — would put the
 * wrong round-phase's rows under a stage that is waiting for its own, which is
 * the flash this module exists to stop.
 */
export function askFetchStillCurrent(gameStateNow, round) {
  const key = stageAnswersKey(`ASK#${round}`);
  return key !== null && stageAnswersKey(gameStateNow) === key;
}
