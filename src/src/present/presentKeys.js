/**
 * WHAT FORWARD AND BACK MEAN ON THE WALL (owner, 2026-10-13).
 *
 * A key on the Presentation (a clicker, Space, the arrows) walks what is on
 * the wall within the round: the results tally, each response (part by part),
 * Workie's pages, feedback; and during voting, the responses in voting order.
 * It never moves the round itself — no Start voting, Show results or Next
 * round from a stray key; those stay on the host's dock and the Remote.
 *
 * Pure: `presentKeyStep(snapshot, 'forward' | 'back', { total })` returns the
 * writes to make, in order — `[]` for "nothing". `total` is how many
 * responses the round has. presentControls.js performs them.
 *   { kind: 'focus', focus, index?, part?, parts? }  POST /stage-focus
 *   { kind: 'beat', beat }                            POST /stage-beat
 *   { kind: 'page', step: 'next' | 'prev' }          POST /stage-beat (Workie's page)
 */
const ROUND = /^(ASK|VOTE|RESULTS)#\d+$/;

const intOr = (v, d) => (Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : d);

function answerFocus(focus, phase) {
  if (!focus || focus.focus !== 'answer') return null;
  const index = intOr(focus.index, -1);
  if (index < 0) return null;
  // A focus stamped for another phase is not on the wall (the server drops it).
  if (focus.phase && focus.phase !== phase) return null;
  const parts = Math.max(1, intOr(focus.parts, 1));
  return { index, parts, part: Math.min(parts - 1, Math.max(0, intOr(focus.part, 0))) };
}

const show = (index, part = 0, parts = 1) => (parts > 1
  ? { kind: 'focus', focus: 'answer', index, part, parts }
  : { kind: 'focus', focus: 'answer', index, part });
const NONE = { kind: 'focus', focus: 'none' };

/** Step within the responses; `null` past either end. */
function stepResponse(at, dir, total) {
  if (dir === 'forward') {
    if (at.part < at.parts - 1) return show(at.index, at.part + 1, at.parts);
    if (at.index < total - 1) return show(at.index + 1);
    return null;
  }
  if (at.part > 0) return show(at.index, at.part - 1, at.parts);
  if (at.index > 0) return show(at.index - 1);
  return null;
}

export function presentKeyStep(snapshot, dir, { total = 0 } = {}) {
  const s = snapshot || {};
  const state = String(s.state || '');
  const m = ROUND.exec(state);
  if (!m) return [];
  const phase = state.split('#')[0];
  const n = Math.max(0, intOr(total, 0));
  const focus = s.stageFocus || {};

  if (focus.focus === 'question') return [NONE];

  if (phase === 'VOTE') {
    const at = answerFocus(focus, 'VOTE');
    if (!at) return dir === 'forward' && n > 0 ? [show(0)] : [];
    const next = stepResponse(at, dir, n);
    if (next) return [next];
    return dir === 'back' ? [NONE] : [];
  }

  if (phase !== 'RESULTS') return [];
  const beat = s.stageBeat || 'results';

  if (beat === 'feedback') return dir === 'back' ? [{ kind: 'beat', beat: 'field-notes' }] : [];

  if (beat === 'field-notes') {
    const notes = s.stageNotes || {};
    const pages = Math.max(1, intOr(notes.pages, 1));
    const page = Math.min(pages - 1, Math.max(0, intOr(notes.page, 0)));
    if (dir === 'forward') return page < pages - 1 ? [{ kind: 'page', step: 'next' }] : [];
    if (page > 0) return [{ kind: 'page', step: 'prev' }];
    return n > 0 ? [{ kind: 'beat', beat: 'results' }, show(n - 1)] : [{ kind: 'beat', beat: 'results' }];
  }

  // The results beat: the tally, or a response on it.
  const at = answerFocus(focus, 'RESULTS');
  if (!at) {
    if (dir === 'back') return [];
    return n > 0 ? [show(0)] : [{ kind: 'beat', beat: 'field-notes' }];
  }
  const next = stepResponse(at, dir, n);
  if (next) return [next];
  return dir === 'forward' ? [NONE, { kind: 'beat', beat: 'field-notes' }] : [NONE];
}

export default presentKeyStep;
