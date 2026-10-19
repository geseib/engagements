/**
 * WHAT FORWARD AND BACK MEAN ON THE WALL (owner, 2026-10-13).
 *
 * A key on the Presentation (a clicker, Space, the arrows) walks what is on
 * the wall within the round: the results tally, each response (part by part),
 * Workie's pages, feedback; and during voting, the responses in voting order.
 * It never moves the round itself — no Start voting, Show results or Next
 * round from a stray key; those stay on the host's dock and the Remote.
 *
 * Pure: `presentKeyStep(snapshot, 'forward' | 'back', { total, overview, vertical })`
 * returns the writes to make, in order — `[]` for "nothing". `total` is how
 * many responses the round has; `overview` is whether every answer fits on
 * the voting overview (config/roomContent.js overviewFits, decided where the
 * wall's model is built); `vertical` is an ↑ / ↓ press. presentControls.js
 * performs them.
 *
 * ↑ ↓ PAGE, → ← STEP, DURING VOTING, ON EITHER SCREEN (19 Oct 2026).
 *   - One screen (GameHostPage's stage): ↑ ↓ page the ballot
 *     (components/stage/Pager.jsx, config/stagePaging.js pageIntentFor);
 *     with a response open (AnswerSpotlight) → ← step the answers; Space and
 *     → otherwise press the dock's main button (HostActionBar).
 *   - The room's window (here): ↑ ↓ page what is up — a long answer's parts —
 *     or do nothing; the overview is one page by definition (it is up only
 *     when every answer fits). → ← (and Space, PageDown / PageUp, which a
 *     clicker sends) step the answers. It used to take ↓ as "next answer",
 *     so the one key paged on the laptop and stepped on the window.
 * Outside voting ↑ ↓ keep meaning forward and back here.
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

export function presentKeyStep(snapshot, dir, { total = 0, overview = false, vertical = false } = {}) {
  const s = snapshot || {};
  const state = String(s.state || '');
  const m = ROUND.exec(state);
  if (!m) return [];
  const phase = state.split('#')[0];
  const n = Math.max(0, intOr(total, 0));
  const focus = s.stageFocus || {};

  // The question put up comes down with either key. The QR side panel is its
  // own fact (stageFocus.join) and stays: J takes it down, not a step.
  if (focus.focus === 'question' || focus.focus === 'join') return [NONE];

  if (phase === 'VOTE') {
    if (n === 0) return [];
    const focused = answerFocus(focus, 'VOTE');
    if (vertical) {
      // ↑ ↓ page the answer that is up, by its parts; nothing else to page.
      if (!focused || focused.parts < 2) return [];
      if (dir === 'forward') return focused.part < focused.parts - 1 ? [show(focused.index, focused.part + 1, focused.parts)] : [];
      return focused.part > 0 ? [show(focused.index, focused.part - 1, focused.parts)] : [];
    }
    if (overview) {
      // ALL THE ANSWERS FIT, so voting opens on all of them (owner, 18 Oct
      // 2026; config/roomContent.js overviewFits): forward puts answer 1 up,
      // back from answer 1 returns to all of them; forward past the last asks
      // to Show results.
      if (!focused) return dir === 'forward' ? [show(0)] : [];
      const next = stepResponse(focused, dir, n);
      if (next) return [next];
      return dir === 'back' ? [NONE] : [];
    }
    // They do not fit: response 1 is on the wall from the start of voting
    // (owner, 2026-10-13). Forward past the last asks to Show results; back
    // from the first wraps.
    const at = focused || { index: 0, part: 0, parts: 1 };
    const next = stepResponse(at, dir, n);
    if (next) return [next];
    return dir === 'back' ? [show(n - 1)] : [];
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
