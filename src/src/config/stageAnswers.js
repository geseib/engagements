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

/**
 * WHAT THE VOTE AND RESULTS STAGES ARE DOING about their responses:
 * `'ready'` (draw them — or the none line, if there are none), `'gathering'`
 * (this round-phase's rows have not landed yet) or `'failed'` (the load for
 * THIS round-phase was refused or threw, so the stage stops saying it is
 * gathering). The owner, 2026-10-11: the wait should read "Gathering
 * responses…" — work in progress, never an error, never blank.
 *
 * @param failedFor the round-phase key whose load last failed, or null
 */
export function stageAnswersStatus(gameState, answersFor, failedFor) {
  if (stageAnswersReady(gameState, answersFor)) return 'ready';
  const key = stageAnswersKey(gameState);
  return key && failedFor === key ? 'failed' : 'gathering';
}

/** The noun the gathering line uses on each phase: "Gathering responses…". */
export function stageGatheringNoun(gameState) {
  return String(gameState || '').startsWith('RESULTS#') ? 'results' : 'responses';
}

/**
 * THE TEXT OF ONE RESPONSE, AS A CARD MAY PRINT IT. A string is itself, a
 * number (a trivia slot, a rating) is its digits, and ANYTHING ELSE IS EMPTY.
 *
 * Why not just `${answer.answer}`: on an org session the stored `Answer` is an
 * encryption envelope, and start-vote / reveal-authors once handed it to the
 * host unopened — so the VOTE stage printed “[object Object]” beside
 * "Response 1" until a decrypted refetch replaced it (owner, 2026-10-11). The
 * server is fixed; this is the page refusing to print an object as prose again.
 */
export function answerText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}
