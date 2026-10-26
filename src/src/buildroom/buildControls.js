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
import { stageModel, decisionChoices, wheelPossible } from './buildScreens';
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

/**
 * Why a move cannot go yet, with what to do instead, or ''. Open voting with
 * no ideas would open an empty ballot and refuse the room's later ideas (QA
 * 2026-10-18 C2), so it waits, as C&A's Start voting does at 0 answers.
 */
function holdFor(move, m) {
  if (move.action === 'vote' && m.phase === 'ASK' && m.meter && !(Number(m.meter.count) > 0)) return W.noIdeasToVote;
  return '';
}

/**
 * AN EARLY SHOW RESULTS ASKS FIRST, wherever it is pressed: the Stage dock, the
 * console and, since the host review (25 Oct 2026), the Host screen's ask path.
 * `phase` ASK or VOTE, `count` of `of` done; null when everyone is in.
 */
export function earlyResultsArm({ phase, count, of }, label) {
  // Nobody in the room at all (0 of 0): still an early advance, so it asks (QA 2026-10-18 C3).
  if (of !== null && of !== undefined && !(Number(of) > 0)) {
    return { text: W.armNobodyHere, confirmLabel: W.armedLabel(label), inPlace: true };
  }
  const left = stillToAct(count, of);
  if (left > 0) return { text: W.armStill(left, of, phase === 'VOTE' ? 'voting' : 'answering'), confirmLabel: W.armedLabel(label), inPlace: true };
  return null;
}

/** The arm for a move, or null: the early and lossy advances only. */
function armFor(move, m) {
  if (move.action === 'close' && (m.phase === 'ASK' || m.phase === 'VOTE') && m.meter) {
    const arm = earlyResultsArm({ phase: m.phase, count: m.meter.count, of: m.meter.of }, move.label);
    if (arm) return arm;
  }
  if (move.action === 'run-next' && !move.claudeDone && m.run) {
    return { text: W.armRunEarly(m.run.cur, move.k), confirmLabel: W.armedLabel(move.label), inPlace: true };
  }
  return null;
}

function control(move, m, busy, key) {
  if (!move) return null;
  const hold = holdFor(move, m);
  const arm = hold ? null : armFor(move, m);
  return {
    ...move,
    // Unique within a moment, and new when the moment changes, so an armed press never outlives its moment.
    id: `${key}:${move.action}:${m.phase || ''}:${move.askId || ''}`,
    icon: ICON[move.action] || 'ArrowRight',
    disabled: Boolean(busy || move.disabled || hold),
    // HostActionBar shows a held main button's hint beside it.
    hint: hold,
    ...(arm ? { arm } : {}),
  };
}

/*
  THE DECIDE PANEL INLINE (owner, 19 Oct 2026, the console mockup's answer
  (a): "use the recommendations"). On one screen the result's second button
  is "Change before sending": it opens the send window. On two screens the
  console draws that panel already open beside the board, so a button that
  opens it would do nothing; the second button there is "Spin the wheel"
  (Spin again once the wheel has landed). The host's pick on the board, made
  in the console's panel, is what the main button sends ("Send C to Claude").
  The words are the dock's own; only which second button applies changes, so
  the dock and the console read the same function (parity).
*/
const sendLabelFor = (current, pickId) => {
  const c = decisionChoices(current).find((x) => x.id === pickId);
  return c && c.label ? W.send(c.label) : W.sendPlain;
};

function inlineDecide(model, current, { pickId = null, answering = false } = {}) {
  const m = model;
  if (!current) return m;
  // Answering for the room (people said it out loud): the panel's words go, in one press.
  if (answering) return { ...m, primary: { action: 'to-claude', label: W.sendPlain, spoken: true }, secondary: null, extras: [] };
  if (m.phase !== 'RESULTS' || m.pointsVote) return m;
  const p = m.primary;
  // The wheel still turning holds both buttons, as on the dock.
  if (p && p.action === 'noop') return m;
  const isEdit = (c) => Boolean(c && c.action === 'edit');
  const wheel = current.wheel && !current.revotedAs ? current.wheel : null;
  // Two options at least, as the server requires: one idea offered a Spin that could only fail.
  const canWheel = wheelPossible(current);
  const spinMove = wheel ? { action: 'spin', label: W.spinAgain } : canWheel ? { action: 'wheel', label: W.spin } : null;
  const picked = pickId && current.kind !== 'rating' ? pickId : null;
  if (p && p.action === 'to-claude') {
    return { ...m, primary: picked ? { ...p, label: sendLabelFor(current, picked) } : p, secondary: spinMove };
  }
  if (picked) return { ...m, primary: { action: 'to-claude', label: sendLabelFor(current, picked) }, secondary: spinMove };
  // Nothing to send yet (a tie, a wheel not spun): the lead stays; the panel is the change.
  return { ...m, secondary: isEdit(m.secondary) ? null : m.secondary };
}

/**
 * @param room the host's room (GET build/state)
 * @param current the ask on the Stage, or null
 * @param opts stageModel's options, plus `busy` (a host action is in flight),
 *   and the console's `decideInline` (the decide panel is drawn open: Spin the
 *   wheel is the second button), with its `pickId` (the host's pick on the
 *   board) and `answering` (the host answers for the room). The codes no
 *   longer change the moves (see below).
 */
export function buildControls(room, current, now = Date.now(), {
  crewOn = false, draft = null, turning = false, highlight = null, busy = false,
  decideInline = false, pickId = null, answering = false,
} = {}) {
  const staged = stageModel(room, current, now, { crewOn, draft, turning, highlight });
  const m = decideInline && staged.phase !== 'ENDED' && !crewOn ? inlineDecide(staged, current, { pickId, answering }) : staged;
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
