/**
 * THE PHONE'S PHASE ORDER — what `applyGameState` in PlayerPage.jsx compares.
 *
 * A3, the monotonic phase guard: a slow `GET /state` must never clobber a newer
 * phase a websocket frame already delivered, so every state gets a rank and a
 * lower rank is refused. It accepts both the websocket spellings (`RESULT#`,
 * `END`) and the server's (`RESULTS#`, `ENDED`).
 *
 * WHY IT LIVES HERE AND NOT INSIDE PlayerPage. It was a closure in the page,
 * and it ranked every state it did not recognise -1 — on purpose, so
 * `CREATED`/`STARTED` can never overwrite a live round. A survey's states have
 * no digits after the `#`, so they fell into that -1 as well, and -1 is not
 * below -1: a stale `STARTED` arriving after `SURVEY#OPEN` was accepted and
 * put an answering phone back on the lobby. Moved out so the survey ranks can
 * be tested without mounting a 3,000-line page, and so `SurveyRunner` can
 * order what it hears from `GET /survey` against what the page already holds.
 *
 * The contract (docs/design/survey-redesign/IMPLEMENTATION-phase-2.md §2):
 * OPEN 1, CLOSED 2, ENDED max. A survey never has an `ASK#`, so its ranks and
 * a round's never meet.
 */

export const SURVEY_OPEN = 'SURVEY#OPEN';
export const SURVEY_CLOSED = 'SURVEY#CLOSED';

const SURVEY_RANK = { [SURVEY_OPEN]: 1, [SURVEY_CLOSED]: 2 };
const ROUND_PHASE = { ASK: 0, VOTE: 1, RESULT: 2, RESULTS: 2 };

export function stateRank(s) {
  if (!s) return -1;
  if (s === 'ENDED' || s === 'END') return Number.MAX_SAFE_INTEGER;
  if (Object.prototype.hasOwnProperty.call(SURVEY_RANK, s)) return SURVEY_RANK[s];
  const m = String(s).match(/^(ASK|VOTE|RESULTS?)#(\d+)/);   // accepts RESULT# and RESULTS#
  if (!m) return -1;                                          // CREATED/STARTED never overwrite a live phase
  return parseInt(m[2], 10) * 10 + ROUND_PHASE[m[1]];
}

/** Is this one of a survey's own states (not ENDED, which every session type shares)? */
export function isSurveyState(s) {
  return s === SURVEY_OPEN || s === SURVEY_CLOSED;
}

/**
 * The guard as a setter: `next`, unless it ranks below `current` — then
 * `current`. For `setGameState((prev) => forwardOnly(prev, SURVEY_CLOSED))`,
 * so a `surveyClosed` frame (or the host's own close POST) resolving after
 * the session ENDED cannot put the stage back on "closed".
 */
export function forwardOnly(current, next) {
  return stateRank(next) < stateRank(current) ? current : next;
}
