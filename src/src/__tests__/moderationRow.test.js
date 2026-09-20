import { whyLabel, waitedLabel, queueHeadline } from '../utils/moderationRow';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');

describe('whyLabel — band words, never scores', () => {
  test('an escalation names how many questions the check could not decide', () => {
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['c001#014', 'c002#022'] })).toBe('2 uncertain questions');
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['c001#014'] })).toBe('1 uncertain question');
  });
  /*
    A queue row's `bands` is ONE BAND PER CATEGORY — { HATE: 'MEDIUM' } — the
    shape spec §3.2 defines, set-check-worker.js and appeal-question-set.js
    write, and tests/set-check-job.js pins; the worker's error path writes {}.
    These fixtures are those rows. The reader once took `bands` for counts per
    band ({ MEDIUM: 3 }, a shape nothing has ever written), so every escalation
    without question ids read just "Uncertain" and the bands never showed.
  */
  test('an escalation names what the check was unsure of, one band per category, worst first', () => {
    // The set's own text alone: it has no question id, so only the bands say what.
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: [], bands: { HATE: 'MEDIUM' } })).toBe('Uncertain (medium: hate)');
    expect(whyLabel({ reasons: ['escalated'], bands: { VIOLENCE: 'MEDIUM', HATE: 'MEDIUM' } })).toBe('Uncertain (medium: hate, violence)');
    // Beside the count of questions, not instead of it.
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['q001', 'q003'], bands: { HATE: 'MEDIUM' } })).toBe('2 uncertain questions (medium: hate)');
    // The order alone, worst band first: an escalation holds MEDIUM only (a
    // HIGH flags the set instead), so no row the check writes mixes bands.
    expect(whyLabel({ reasons: ['escalated'], bands: { HATE: 'MEDIUM', VIOLENCE: 'HIGH' } })).toBe('Uncertain (high: violence; medium: hate)');
    // The error path's empty map, and a band that is no band at all.
    expect(whyLabel({ reasons: ['escalated'], bands: {} })).toBe('Uncertain');
    expect(whyLabel({ reasons: ['escalated'], bands: { HATE: 'NONE' } })).toBe('Uncertain');
  });
  /*
    One question held in two categories is two findings, and the check writes
    an id per finding: this is the row set-check-worker.js wrote for q001 seen
    at MEDIUM for hate and for insults (its note: 3/4 clean). The review
    dialog counts questions, and so does this line — rows already written too.
  */
  test('a question held in two categories is one uncertain question', () => {
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['guardrail'], uncertainQuestionIds: ['q001', 'q001'], bands: { HATE: 'MEDIUM', INSULTS: 'MEDIUM' } })).toBe('1 uncertain question (medium: hate, insults)');
  });
  test('a number where a band belongs is never printed', () => {
    expect(whyLabel({ reasons: ['escalated'], bands: { MEDIUM: 3 } })).toBe('Uncertain');
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['a', 'b'], bands: { HIGH: 0, MEDIUM: 2 } })).toBe('2 uncertain questions');
  });
  test('an appeal quotes the author, shortened', () => {
    expect(whyLabel({ reasons: ['appealed'], appealMessage: 'It is a clinical safety set.' })).toBe('Appealed: “It is a clinical safety set.”');
    expect(whyLabel({ reasons: ['appealed'], appealMessage: 'x'.repeat(120) })).toBe(`Appealed: “${'x'.repeat(79)}…”`);
    expect(whyLabel({ reasons: ['appealed'] })).toBe('Appealed');
  });
  test('reports, a declared notice and images each say so; several reasons join', () => {
    expect(whyLabel({ reasons: ['reported'], reports: { count: 3, byType: { graphic: 2, inaccurate: 1 } } })).toBe('Reported ×3 · graphic (2), inaccurate (1)');
    expect(whyLabel({ reasons: ['declared'], declaredNotice: 'graphic-medical' })).toBe('Declared: graphic medical');
    // A review row keeps what the author declared as a list, up to eight (check-question-set.js).
    expect(whyLabel({ reasons: ['declared'], declaredNotice: ['graphic-violence', 'strong-language'] })).toBe('Declared: graphic violence, strong language');
    expect(whyLabel({ reasons: ['images'] })).toBe('Images');
    expect(whyLabel({ reasons: ['escalated', 'appealed'], uncertainQuestionIds: ['a'], appealMessage: 'Please.' })).toBe('1 uncertain question · Appealed: “Please.”');
    expect(whyLabel({})).toBe('Waiting');
  });
  /*
    A row staff's re-check raised is about a listing the library is ALREADY
    serving, which changes what the reader should do with it: it is not decided
    in the review dialog (moderation-decide.js refuses it), it is opened on the
    score card. So the line leads with that — the Why cell truncates, and the
    fact that changes the reader's next move must not be the half that is cut.
  */
  test('a row a re-check raised leads with the library already serving it', () => {
    expect(whyLabel({ recheck: true, reasons: ['escalated'], uncertainQuestionIds: ['c001#014'] }))
      .toBe('Already in the library · 1 uncertain question');
    expect(whyLabel({ recheck: true, reasons: ['escalated'], bands: { VIOLENCE: 'HIGH' } }))
      .toBe('Already in the library · Uncertain (high: violence)');
    // A REVIEW row carries no `recheck`, so the score card's line is unchanged.
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['c001#014'] })).toBe('1 uncertain question');
  });
  /*
    The score card reads a REVIEW row through the same function. Its reasons
    are the check's own (set-check-worker.js): 'images' and 'declared' the
    queue already words; the guardrail unsure, a budget that ran out, a
    snapshot that would not save and a check that threw it had no words for,
    and would have answered "Waiting" under an approved set. A queue row the
    check escalated carries the same reasons as `checkReasons` (below).
  */
  test('a check\'s own reasons each say so, in the same words', () => {
    expect(whyLabel({ reasons: ['guardrail'] })).toBe('Uncertain');
    expect(whyLabel({ reasons: ['timeout'] })).toBe('Out of time');
    expect(whyLabel({ reasons: ['snapshot'] })).toBe('Snapshot not saved');
    expect(whyLabel({ reasons: ['error'] })).toBe('Error');
    expect(whyLabel({ reasons: ['snapshot', 'images', 'guardrail'] })).toBe('Uncertain · Images · Snapshot not saved');
  });
  /*
    WHAT AN ESCALATION WAS FOR. A queue row the check escalated says only
    'escalated'; it also carries the check's own reasons (`checkReasons`) and
    the notices the author declared, as set-check-worker.js writes them and
    tests/set-check-job.js pins. So a set held for its images, a declared
    notice or an error says so (spec §10.5's "Declared: …" and "Images")
    instead of "Uncertain", which is what the queue said of every one of them.
  */
  test('a queue row the check escalated says what for, in the check\'s own words', () => {
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['images'], bands: {} })).toBe('Images');
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['declared'], declaredNotice: ['graphic-medical'], bands: {} })).toBe('Declared: graphic medical');
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['error'], bands: {} })).toBe('Error');
    // The line's order, not the list's.
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['images', 'declared'], declaredNotice: ['graphic-medical'], bands: {} })).toBe('Declared: graphic medical · Images');
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['guardrail', 'images'], uncertainQuestionIds: ['q002'], bands: { HATE: 'MEDIUM' } })).toBe('1 uncertain question (medium: hate) · Images');
    // A question the guardrail could not read is undecided with no reason of
    // its own (content-guardrail.js files it as an ERROR finding), so it keeps its words.
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['images'], uncertainQuestionIds: ['q002'], bands: {} })).toBe('1 uncertain question · Images');
  });
  test('a queue row with none of the check\'s reasons on it reads as it always did', () => {
    // Written before the check named them, or escalated for nothing but undecided questions.
    expect(whyLabel({ reasons: ['escalated'], bands: {} })).toBe('Uncertain');
    expect(whyLabel({ reasons: ['escalated'], checkReasons: [], declaredNotice: [], uncertainQuestionIds: ['q001'], bands: {} })).toBe('1 uncertain question');
    // A reason this line has no words for yet says what the queue always said, never "Waiting".
    expect(whyLabel({ reasons: ['escalated'], checkReasons: ['a-reason-with-no-words'], bands: {} })).toBe('Uncertain');
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
