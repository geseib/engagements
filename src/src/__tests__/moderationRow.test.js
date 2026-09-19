import { whyLabel, waitedLabel, queueHeadline } from '../utils/moderationRow';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');

describe('whyLabel — band words, never scores', () => {
  test('an escalation names how many questions the check could not decide', () => {
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['c001#014', 'c002#022'], bands: { MEDIUM: 2 } })).toBe('2 uncertain questions');
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['c001#014'] })).toBe('1 uncertain question');
    expect(whyLabel({ reasons: ['escalated'], bands: { MEDIUM: 3 } })).toBe('Uncertain (medium ×3)');
  });
  test('an appeal quotes the author, shortened', () => {
    expect(whyLabel({ reasons: ['appealed'], appealMessage: 'It is a clinical safety set.' })).toBe('Appealed: “It is a clinical safety set.”');
    expect(whyLabel({ reasons: ['appealed'], appealMessage: 'x'.repeat(120) })).toBe(`Appealed: “${'x'.repeat(79)}…”`);
    expect(whyLabel({ reasons: ['appealed'] })).toBe('Appealed');
  });
  test('reports, a declared notice and images each say so; several reasons join', () => {
    expect(whyLabel({ reasons: ['reported'], reports: { count: 3, byType: { graphic: 2, inaccurate: 1 } } })).toBe('Reported ×3 · graphic (2), inaccurate (1)');
    expect(whyLabel({ reasons: ['declared'], declaredNotice: 'graphic-medical' })).toBe('Declared: graphic medical');
    expect(whyLabel({ reasons: ['images'] })).toBe('Images');
    expect(whyLabel({ reasons: ['escalated', 'appealed'], uncertainQuestionIds: ['a'], appealMessage: 'Please.' })).toBe('1 uncertain question · Appealed: “Please.”');
    expect(whyLabel({})).toBe('Waiting');
  });
  /*
    The score card reads a REVIEW row through the same function. Its reasons
    are the check's own (set-check-worker.js): 'images' and 'declared' the
    queue already words; the guardrail unsure, a budget that ran out, a
    snapshot that would not save and a check that threw it had no words for,
    and would have answered "Waiting" under an approved set. No queue row
    carries any of them, so the queue's line is unchanged.
  */
  test('a check\'s own reasons each say so, in the same words', () => {
    expect(whyLabel({ reasons: ['guardrail'] })).toBe('Uncertain');
    expect(whyLabel({ reasons: ['timeout'] })).toBe('Out of time');
    expect(whyLabel({ reasons: ['snapshot'] })).toBe('Snapshot not saved');
    expect(whyLabel({ reasons: ['error'] })).toBe('Error');
    expect(whyLabel({ reasons: ['snapshot', 'images', 'guardrail'] })).toBe('Uncertain · Images · Snapshot not saved');
  });
});

describe('waitedLabel and the headline', () => {
  test('rounds to the unit a person would say', () => {
    expect(waitedLabel('2026-09-17T11:59:30.000Z', NOW)).toBe('just now');
    expect(waitedLabel('2026-09-17T11:15:00.000Z', NOW)).toBe('45 minutes');
    expect(waitedLabel('2026-09-17T07:00:00.000Z', NOW)).toBe('5 hours');
    expect(waitedLabel('2026-09-15T10:00:00.000Z', NOW)).toBe('2 days');
    expect(waitedLabel(null, NOW)).toBe('');
  });
  test('the headline is the mockup sentence', () => {
    expect(queueHeadline(5, '2026-09-15T10:00:00.000Z', NOW)).toBe('5 sets the check would not decide on its own. Oldest has waited 2 days.');
    expect(queueHeadline(1, '2026-09-17T11:59:30.000Z', NOW)).toBe('1 set the check would not decide on its own. Oldest has waited just now.');
    expect(queueHeadline(0, null, NOW)).toBe('');
  });
});
