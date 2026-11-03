/**
 * NEEDS-YOU WIRING (docs/design/experience-plan/PLAN.md §5.3, principle 1, §4).
 *
 * Fails when an event in the attention list lacks a Needs-you line, a mark or a help
 * line. Phase 0 holds the list itself (config/attentionEvents.js) to that; the checks
 * against the code that renders it land with the Phase 1 steps that build it, named in
 * the test.todo entries below, so the guard is in place before the list has a reader.
 *
 * Fix a failure by filling the missing field in config/attentionEvents.js, in PLAN §3.6's
 * words (the banned-words ratchet reads that file too).
 */
import { ATTENTION_EVENTS, ATTENTION_LEVELS, NEEDS_YOU_EVENTS } from '../config/attentionEvents';

const D = require('../testing/driftScan');

const filled = (s) => typeof s === 'string' && s.trim().length > 0;

describe('every attention event has its id, level, Needs-you line, mark and help line', () => {
  test('ids are unique, kebab-case', () => {
    const ids = ATTENTION_EVENTS.map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  test.each(ATTENTION_EVENTS.map((e) => [e.id, e]))('%s', (id, e) => {
    const problems = [];
    if (!ATTENTION_LEVELS.includes(e.level)) problems.push(`level "${e.level}" is not one of ${ATTENTION_LEVELS.join(', ')} (PLAN §4.1)`);
    const wantsLine = (e.level === 'now' && !e.inline) || e.level === 'soon';
    if (wantsLine && !filled(e.needsYouLine)) problems.push('needsYouLine is empty: a now or soon event must say what it is on the Needs-you line and in the bell (PLAN §4.2 column 3)');
    if (!wantsLine && e.needsYouLine !== null) problems.push(`needsYouLine must be null for a ${e.inline ? 'inline ' : ''}${e.level} event: it never reaches the bell or the Needs-you line (PLAN §4.1)`);
    if (!filled(e.markedOn)) problems.push('markedOn is empty: say which person or thing carries the mark (PLAN §4.2 "Marked on")');
    if (!filled(e.helpLine)) problems.push('helpLine is empty: write the sentence help will say about it');
    else if (!/[.!?]$/.test(e.helpLine.trim())) problems.push('helpLine should be a whole sentence, ending with a full stop');
    if (!Array.isArray(e.actions) || e.actions.some((a) => !filled(a))) problems.push('actions must be a list of button words ([] when there is nothing to press)');
    if (!Array.isArray(e.audit)) problems.push('audit must list audit D\'s event numbers ([] for one the plan added)');
    if (problems.length) throw new Error(`config/attentionEvents.js "${id}":\n  ${problems.join('\n  ')}`);
  });

  test('the name request is a Now item with Let them and Not now (the owner\'s case, PLAN §1 #1)', () => {
    const e = ATTENTION_EVENTS.find((x) => x.id === 'name-request');
    expect(e.level).toBe('now');
    expect(e.actions).toEqual(expect.arrayContaining(['Let them', 'Not now']));
    expect(NEEDS_YOU_EVENTS).toContain(e);
  });

  test('the list speaks PLAN §3.6\'s names: no replaced label anywhere in config/attentionEvents.js', () => {
    const r = 'config/attentionEvents.js';
    const found = D.scanBannedWords(D.read(r), r).map((f) => `line ${f.line}: "${f.literal}", say "${f.say}"`);
    expect(found).toEqual([]);
  });
});

describe('the list is wired to what renders it (Phase 1)', () => {
  test.todo('1a: needsYou(state) returns one item per Now/Soon event in ATTENTION_EVENTS, worked out from session state (player rows, lateCounts, aiSummaryFailure, wsConnected, presentDetail)');
  test.todo('1a: each item renders its needsYouLine and actions on the Needs-you line under Your part now, at the one fixed height, calm or amber');
  test.todo('1a: each event\'s mark renders on markedOn (the People row flag for name-request and name-open; the round dot for late-items; the failure card for read-failed)');
  test.todo('1a: a socket event that changes an item (handoverRequested, playersChanged, late arrivals, read status) updates the list, on every host page that handles it');
  test.todo('1a: every live host page (console, stage, Build Room) mounts the Needs-you line; a host page without it fails');
  test.todo('1b: in a live session the bell counts this session\'s Now items only, Soon adds a dot, and This session lists before Your account');
  test.todo('1b: the phone Remote renders the same list from what it already polls, so laptop and phone agree');
  test.todo('1e: read-failed renders the console read panel\'s failure card with Retry and Redo');
});
