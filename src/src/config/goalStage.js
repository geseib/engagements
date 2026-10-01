/**
 * THE GOAL, ON THE STAGE ITSELF — the rail's "· GOAL 2" and the notice when
 * the goal is met or passed (QA drive 2026-09-29, findings #3 and #22;
 * docs/superpowers/plans/2026-09-30-qa-drive-fixes.md, workstream C).
 *
 * WHAT CHANGED, AND WHY. Events M1b kept the goal off the room's screen — "the
 * room sees the round, not the plan" — and put it in two host-only places: the
 * SESSION panel's "Question 1 of 2" and, on the goal round's results only, the
 * dock's status line. The drive found both too quiet to use. The header read
 * "ROUND 1 OF 5" with the goal nowhere on it; skipping past the goal round
 * said nothing at all, because the notice only fired on that round's RESULTS;
 * and when it did fire it was the dock's small grey status text. So:
 *
 *   rail    "Goal 2" beside "Round 1 of 5" whenever a round is in play; on the
 *           goal round's results it reads "Goal 2 reached", and on any round
 *           past it "Past goal 2" — however the round got there, Next or
 *           Skip, because it is computed from the round number alone. Both of
 *           those carry the amber chip treatment (`.rail-goal.met`).
 *   notice  the sentence for the dock, which the dock draws as a chip rather
 *           than as its grey status (`.dock .status.notice`): the goal round's
 *           results say session-goal.js's goalReachedLine, and the first round
 *           past the goal says so on ITS results — the one a skip would
 *           otherwise have left unannounced.
 *
 * A PLAN, NEVER A STOP, as session-goal.js says. Nothing here disables or
 * changes an action; hostControlsFor hands the notice back as status text only.
 *
 * Built on session-goal.js's goalProgress rather than beside it, so the rail,
 * the dock, the SESSION panel and the phone remote can never disagree about
 * which round is the goal's. It lives here and not in session-goal.js because
 * that file is copied byte for byte into two Lambda bundles and the rail's
 * words are the browser's business.
 */
import goalRules from '../../../lambda-functions/websocket/session-goal';

const NONE = Object.freeze({ rail: null, notice: '' });

/** The dock's sentence for the first round past the goal. */
export function goalPassedLine(target) {
  return `Past your goal of ${target}. Keep going if there’s time, or end the session.`;
}

/**
 * @param {{target: *, round: *, phase: string, gameType: string}} args
 * @returns {{rail: null|{text: string, state: 'ahead'|'reached'|'passed'}, notice: string}}
 *   `rail` is null when there is no goal to show (none set, a survey, or no
 *   round in play); `notice` is '' when there is nothing to announce.
 */
export function goalOnStage({ target, round, phase, gameType } = {}) {
  if (!goalRules.goalApplies(gameType)) return NONE;
  const { progress, reached, line } = goalRules.goalProgress({ target, round, phase });
  if (!progress) return NONE;
  const goal = Number(target);
  const r = Number(round);
  const onResults = goalRules.RESULT_PHASES.includes(String(phase || '').toUpperCase());
  if (r > goal) {
    return {
      rail: { text: `Past goal ${goal}`, state: 'passed' },
      notice: r === goal + 1 && onResults ? goalPassedLine(goal) : '',
    };
  }
  if (reached) return { rail: { text: `Goal ${goal} reached`, state: 'reached' }, notice: line };
  return { rail: { text: `Goal ${goal}`, state: 'ahead' }, notice: '' };
}

export default goalOnStage;
