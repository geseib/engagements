/**
 * A SESSION'S GOAL — how many questions the host plans to ask (events M1b,
 * docs/superpowers/plans/2026-09-26-events-m1b-richer-agenda.md).
 *
 * The owner, 26 Sep 2026: "there should be a target number of items. even
 * though the set contains 50 question they might have a goal of 5 questions.
 * And we could alert the host/facilitator they have completed, but they could
 * do extra if time permitted".
 *
 * So a goal is a PLAN, never a stop: nothing on the server reads it to refuse
 * a round. It is stored on a session's METADATA as `Target` (create-game.js,
 * update-game.js), read back only on the host's doors (get-game.js
 * host-details, get-game-state.js host-state), and turned into words on the
 * stage and the remote by `goalProgress` below, so both say the same thing.
 *
 * COPIED BYTE FOR BYTE into lambda-functions/game/session-goal.js: create
 * lives in websocket/ and PUT /games/{id} in game/, and a Lambda bundle is its
 * CodeUri. tests/session-goal.js holds the two copies identical. The browser
 * imports the websocket copy, so it stays PURE: no require, no process, no
 * clock.
 */
const TARGET_MAX = 999;
const ROUND_PHASES = Object.freeze(['ASK', 'VOTE', 'RESULTS', 'FIELD_NOTES', 'FEEDBACK']);
const RESULT_PHASES = Object.freeze(['RESULTS', 'FIELD_NOTES', 'FEEDBACK']);

/** A survey is answered at each person's own pace: it has no rounds to count. */
function goalApplies(gameType) {
  return String(gameType || 'call-and-answer').trim().toLowerCase() !== 'survey';
}

/** A positive whole number, or null. */
function toCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A goal as typed or sent, checked. Blank means no goal. `questionCount` is
 * the set's size at the version the session plays; 0 or unknown bounds the
 * goal by TARGET_MAX alone.
 * @returns {{value: number|null}|{error: string}}
 */
function checkTarget(value, questionCount) {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > TARGET_MAX) {
    return { error: 'A goal is a whole number of questions, 1 or more.' };
  }
  const count = toCount(questionCount);
  if (count && n > count) {
    return { error: `This set has ${count} question${count === 1 ? '' : 's'}, so the goal can be ${count} at most.` };
  }
  return { value: n };
}

/**
 * How many questions a set has at `version` — the number the goal is bounded
 * by, which must be what will actually be asked, not what the builder
 * displays about the pin.
 *
 * A `version` NOT FOUND in versions[] plays the ACTIVE version at run time:
 * that is set-version.js `resolvePartitionFromMeta`'s 'pinned-missing' case
 * (lambda-functions/websocket/set-version.js, the `if (active) return
 * at(active, 'pinned-missing');` branch) — the pin was deleted, so the
 * session falls back to whatever is active now. The bound below follows that
 * same fallback, which is why it disagrees with
 * websocket/events/event-store.js `describeSet`: describeSet reports
 * `questionCount: 0, pinnedMissing: true` for this case, but that is a
 * DISPLAY value so the builder can warn the host and offer "Use vN" — a
 * different job from bounding a goal by what will actually play.
 *
 * An entry that IS found in versions[] but records no count of its own is a
 * different case: genuinely unknown, not "the active version's count" (it
 * may be an older, differently-sized version). That returns null, so
 * `checkTarget` bounds the goal by TARGET_MAX alone rather than guess.
 */
function questionCountAt(setMeta, version) {
  if (!setMeta) return 0;
  const wanted = toCount(version);
  if (wanted !== null && Array.isArray(setMeta.versions)) {
    const entry = setMeta.versions.find((v) => toCount(v && v.version) === wanted);
    if (entry) return toCount(entry.questionCount);
  }
  return toCount(setMeta.questionCount) || 0;
}

/** The notice, in the words the stage and the remote both say. */
function goalReachedLine(target) {
  return `That’s your ${target}. Keep going if there’s time, or end the session.`;
}

/**
 * Where a running session stands against its goal. `round` is the round
 * number the stage shows; `phase` is the host's phase (ASK, VOTE, RESULTS,
 * FIELD_NOTES, FEEDBACK — anything else is between rounds or over).
 *   progress  "Question 3 of 5", then "Question 6 · your goal was 5";
 *             '' with no goal, before the first round and after the end
 *   reached   true only while the goal's own round is on its results
 *   line      the notice while `reached`, else ''
 */
function goalProgress({ target, round, phase } = {}) {
  const goal = toCount(target);
  const r = toCount(round);
  const p = String(phase || '').toUpperCase();
  if (!goal || !r || !ROUND_PHASES.includes(p)) return { progress: '', reached: false, line: '' };
  const progress = r <= goal ? `Question ${r} of ${goal}` : `Question ${r} · your goal was ${goal}`;
  const reached = r === goal && RESULT_PHASES.includes(p);
  return { progress, reached, line: reached ? goalReachedLine(goal) : '' };
}

module.exports = {
  TARGET_MAX, ROUND_PHASES, RESULT_PHASES,
  goalApplies, checkTarget, questionCountAt, goalReachedLine, goalProgress,
};
