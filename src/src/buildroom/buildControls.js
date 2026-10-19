/**
 * THE STAGE'S MOVES, IN THE SHAPE EVERY HOST SURFACE READS (docs/design/
 * parity/PLAN.md §2.6, §2a D1; owner, 17 Oct 2026: "we want these to feel like
 * the same app").
 *
 * Call & Answer decides its main button in one function (config/roundStep.js)
 * and every surface reads the result through HostActionBar. Build Room's one
 * function is stageModel (buildScreens.js); this turns its moves into that
 * same `controls` shape, so the Stage's dock is the shared Dock + HostActionBar
 * and the two-screen console's footer (B8) can read the very same thing:
 *
 *   { status, primary, secondary, tertiary, model }
 *
 * - exactly one primary when there is a move, else null (HostActionBar draws
 *   nothing); at most one secondary;
 * - a third move (the run list's Stop, a points vote's Save the rest) goes in
 *   the bar's third slot, between the secondary and the main button, never
 *   dropped; with no main move of its own, it becomes the main one;
 * - an early or lossy advance arms in place, as roundStep does:
 *   `arm: { text, confirmLabel, inPlace: true }` — Show results while people
 *   are still answering or voting, Next before Claude reports, Stop on the
 *   last item;
 * - every control keeps its stageModel fields (action, askId, point, k …) so
 *   the page presses it unchanged (useStageMoves).
 *
 * Words come from words.js. Pure: no React, no fetch.
 */
import { stageModel } from './buildScreens';
import { W } from './words';

const ICON = Object.freeze({
  open: 'ListChecks',
  vote: 'ListChecks',
  close: 'ChartBar',
  wheel: 'ArrowsClockwise',
  spin: 'ArrowsClockwise',
  noop: 'Timer',
  'to-claude': 'PaperPlaneTilt',
  edit: 'PencilSimple',
  reopen: 'ArrowCounterClockwise',
  'take-down': 'EyeSlash',
  'point-later': 'FloppyDisk',
  'points-send': 'PaperPlaneTilt',
  'points-run': 'ListNumbers',
  'points-later': 'FloppyDisk',
  'points-close': 'Check',
  'run-next': 'ArrowRight',
  'run-skip': 'SkipForward',
  'run-stop': 'Pause',
  'hide-codes': 'X',
});

/** How many of `of` are still to act, or null when nobody is counted. */
function stillToAct(done, of) {
  const total = Number(of);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, total - (Number(done) || 0));
}

/** The arm for a move, or null: the early and lossy advances only. */
function armFor(move, m) {
  if (move.action === 'close' && (m.phase === 'ASK' || m.phase === 'VOTE') && m.meter) {
    const left = stillToAct(m.meter.count, m.meter.of);
    if (left > 0) return { text: W.armStill(left, m.meter.of, m.phase === 'VOTE' ? 'voting' : 'answering'), confirmLabel: W.armedLabel(move.label), inPlace: true };
  }
  if (move.action === 'run-next' && !move.claudeDone && m.run) {
    return { text: W.armRunEarly(m.run.cur, move.k), confirmLabel: W.armedLabel(move.label), inPlace: true };
  }
  return null;
}

function control(move, m, busy, key) {
  if (!move) return null;
  const arm = armFor(move, m);
  return {
    ...move,
    // Unique within a moment, and new when the moment changes, so an armed press never outlives its moment.
    id: `${key}:${move.action}:${m.phase || ''}:${move.askId || ''}`,
    icon: ICON[move.action] || 'ArrowRight',
    disabled: Boolean(busy || move.disabled),
    hint: '',
    ...(arm ? { arm } : {}),
  };
}

/**
 * @param room the host's room (GET build/state)
 * @param current the ask on the Stage, or null
 * @param opts stageModel's options, plus `busy` (a host action is in flight).
 *   The codes no longer change the moves (see below).
 */
export function buildControls(room, current, now = Date.now(), {
  crewOn = false, draft = null, turning = false, highlight = null, busy = false,
} = {}) {
  const m = stageModel(room, current, now, { crewOn, draft, turning, highlight });
  const ended = m.phase === 'ENDED';
  const none = { status: m.status || '', primary: null, secondary: null, tertiary: null, model: m };
  if (ended) return none;
  // THE CODES ARE A SIDE PANEL (owner, 18 Oct 2026, as on Call & Answer): the
  // moment keeps its own moves; Join, J or Escape take the codes down. Until
  // then the codes card replaced the Stage and its one move was "Hide the code".
  const extra = (m.extras || [])[0] || null;
  if (!m.primary && extra) {
    // The last item of a run: Stop is the only move left, so it leads, and asks twice.
    const stop = control(extra, m, busy, 'p');
    return { ...none, primary: { ...stop, arm: { text: W.armStop, confirmLabel: W.armedLabel(stop.label), inPlace: true } } };
  }
  if (!m.primary) return none;
  return {
    ...none,
    primary: control(m.primary, m, busy, 'p'),
    secondary: control(m.secondary || null, m, busy, 's'),
    tertiary: control(extra, m, busy, 't'),
  };
}
