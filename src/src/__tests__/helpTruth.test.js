/**
 * HELP TRUTH (docs/design/experience-plan/PLAN.md §5.3).
 *
 * Fails when a help line names a control that does not do what it says: the "SESSION
 * shows a count" case (PLAN §1 #1), which sent the owner looking for a count that
 * Call & Answer never draws. Phase 0 ratchets the known false claims
 * (driftScan.js FALSE_HELP_CLAIMS) per help guide, at today's count, which may only
 * fall; Phase 1a fixes the first. The cross-check against what the frame and the
 * attention list really render lands with 1a/2a, named in the test.todo entries.
 *
 * Fix a failure: rewrite the help sentence to say what the screen does now (Phase 1a:
 * the Needs-you line and the bell), then lower the allowance in driftAllowances.js.
 */
import { ATTENTION_EVENTS } from '../config/attentionEvents';

const D = require('../testing/driftScan');
const A = require('../testing/driftAllowances');

describe('known false help claims only ever fall', () => {
  const found = {};
  for (const r of D.jsFiles().filter((x) => x.startsWith('config/help/'))) {
    const f = D.scanHelpClaims(D.read(r), r);
    if (f.length) found[r] = f;
  }
  const files = [...new Set([...Object.keys(found), ...Object.keys(A.helpFalseClaims)])].sort();
  const FIX = 'rewrite the sentence to say what the screen really does (see each claim\'s reason in src/src/testing/driftScan.js FALSE_HELP_CLAIMS).';
  // Zero known false claims is the goal (Phase 1a fixed the first two): `.each` refuses an
  // empty table, so the clean state is its own test.
  if (!files.length) {
    test('no known false help claims remain, and none are allowed', () => {
      expect(Object.keys(A.helpFalseClaims)).toEqual([]);
    });
  }
  test.each(files.length ? files.map((f) => [f]) : [['(none)']])('%s', (r) => {
    if (r === '(none)') return;
    const problems = D.ratchet({
      file: r,
      found: (found[r] || []).map((f) => ({ ...f, literal: `${f.literal}: ${f.why}` })),
      allowed: A.helpFalseClaims[r],
      what: 'false help claim(s)',
      fix: FIX,
      allowanceKey: 'helpFalseClaims',
    });
    if (problems.length) throw new Error(problems.join('\n\n'));
  });
  test('the guard can fail: the SESSION count claim is found in help text', () => {
    const src = "export const g = { text: 'Their row reads asking, and **SESSION** on the dock shows a count.' };";
    expect(D.scanHelpClaims(src, 'config/help/x.js').map((f) => f.literal)).toEqual(['session-dock-count']);
  });
});

describe('the help lines the attention list will publish are true to it', () => {
  test('a Now or Soon event\'s helpLine names a button the event really has, so help says what to press', () => {
    const problems = ATTENTION_EVENTS
      .filter((e) => e.needsYouLine && e.actions.length)
      .filter((e) => !e.actions.some((a) => e.helpLine.includes(a)))
      .map((e) => `${e.id}: helpLine names none of its buttons (${e.actions.join(', ')}). Fix: say which one to press, in config/attentionEvents.js`);
    expect(problems).toEqual([]);
  });
  test.todo('1a: every Now/Soon event\'s helpLine appears in a help guide (config/help/host-running.js), and the guide says nothing about it that the event does not');
  test.todo('1a: no help guide names a host control the frame or the attention list says does not exist (SESSION count, Players tab as the only place for a name request)');
  test.todo('2a: help names the top bar\'s slots by their words (Main menu, Session menu, ?), and only those');
});
