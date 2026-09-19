// tests/guardrail-observations.js
/**
 * WHAT THE CHECK SAW, AS WELL AS WHAT IT DECIDED —
 * admin/shared/content-guardrail.js
 *
 * The owner, 2026-09-19, on the public-library score card: it "doesn't reveal
 * much". A trivia set about serial killers showed "Checked — passed" and "The
 * check found nothing to say." The check had measured it; the measurements
 * were thrown away in two places, both in this module:
 *
 *   1. ApplyGuardrail was sent with no outputScope, so Bedrock answered with
 *      only the filters that INTERVENED — and the template's LOW strength
 *      intervenes on HIGH confidence only. LOW and MEDIUM never came back.
 *   2. What did come back was dropped below MEDIUM before anything stored it.
 *
 * The owner's rule for the fix (decision B): MEASURE EVERYTHING, DECIDE
 * EXACTLY AS BEFORE. A filter drives the outcome only if it intervened —
 * `detected: true`, or no `detected` at all, which is the INTERVENTIONS-scope
 * reply every pre-FULL response (and every older test here) carries. Every
 * filter in a judged category seen at LOW, MEDIUM or HIGH is an OBSERVATION,
 * intervened or not. No set that publishes today may be held by this change.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const G = require(path.join(H.REPO, 'lambda-functions/admin/shared/content-guardrail.js'));

const QUESTIONS = [
  { id: 'c001#001', text: 'The Zodiac killer wrote to which newspaper?' },
  { id: 'c001#002', text: 'Which city stands on the Seine?' },
];
const NONE_SEEN = { worst: null, low: 0, medium: 0, high: 0 };

(async () => {
  console.log('\nwhat the guardrail observed\n');

  console.log('1. the request asks for everything');
  // rejects: dropping outputScope — the reason LOW and MEDIUM never came back.
  await H.test('every evaluation asks for the FULL output, questions and set prose alike', async () => {
    H.reset();
    H.state.guardrailReplies = [H.guardrailFull(), H.guardrailFull(), H.guardrailFull()];
    await G.checkQuestions(QUESTIONS);
    await G.checkText('A set about true crime', '(set)');
    assert.deepStrictEqual(H.state.sentGuardrail.map((c) => c.outputScope), ['FULL', 'FULL', 'FULL']);
  });

  console.log('\n2. the outcome is decided exactly as it was');
  // rejects: gating on the band alone now that FULL replies carry filters that
  // did not intervene — a MEDIUM the guardrail let through would escalate a
  // set that publishes today, and a HIGH it let through would refuse one.
  await H.test('a filter that did not intervene decides nothing, at any band', async () => {
    H.reset();
    H.state.guardrailReplies = [
      H.guardrailFull({ VIOLENCE: 'HIGH', MISCONDUCT: 'MEDIUM' }),
      H.guardrailFull({ HATE: 'MEDIUM', INSULTS: 'LOW' }),
    ];
    const r = await G.checkQuestions(QUESTIONS);
    assert.strictEqual(r.outcome, 'passed', `got ${r.outcome}`);
    assert.deepStrictEqual(r.findings, []);
    assert.strictEqual(r.clean, 2, 'a question with only near-misses stopped counting as clean');
  });
  await H.test('a filter that intervened decides through the same bands as before', async () => {
    H.reset();
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'HIGH', MISCONDUCT: 'LOW' }, { VIOLENCE: true }), H.guardrailFull()];
    const r = await G.checkQuestions(QUESTIONS);
    assert.strictEqual(r.outcome, 'flagged');
    assert.deepStrictEqual(r.findings, [{ questionId: 'c001#001', category: 'VIOLENCE', band: 'HIGH' }]);
    assert.strictEqual(r.clean, 1);
  });
  // rejects: reading a missing `detected` as "did not intervene", which would
  // wave through every HIGH an INTERVENTIONS-scope reply ever reported.
  await H.test('a reply with no `detected` at all decides exactly as today', async () => {
    H.reset();
    H.state.guardrailReplies = [H.guardrailHit('VIOLENCE', 'HIGH'), H.guardrailHit('HATE', 'MEDIUM')];
    const flagged = await G.checkQuestions(QUESTIONS);
    assert.strictEqual(flagged.outcome, 'flagged');
    assert.deepStrictEqual(flagged.findings, [
      { questionId: 'c001#001', category: 'VIOLENCE', band: 'HIGH' },
      { questionId: 'c001#002', category: 'HATE', band: 'MEDIUM' },
    ]);
    H.state.guardrailReplies = [H.guardrailHit('HATE', 'MEDIUM'), H.guardrailHit('INSULTS', 'LOW')];
    const escalated = await G.checkQuestions(QUESTIONS);
    assert.strictEqual(escalated.outcome, 'escalated');
    assert.deepStrictEqual(escalated.findings, [{ questionId: 'c001#001', category: 'HATE', band: 'MEDIUM' }]);
    assert.strictEqual(escalated.clean, 1);
  });
  // rejects: the one promise decision B makes being broken — a set that
  // publishes today held by a check that now sees more of it.
  await H.test('a set that passes today still passes, with the same findings and counts', async () => {
    H.reset();
    // The same two questions, answered the way FULL answers them: the
    // near-misses come back, and none of them intervened.
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'MEDIUM', MISCONDUCT: 'LOW' }), H.guardrailFull({ INSULTS: 'LOW' })];
    const r = await G.checkQuestions(QUESTIONS);
    assert.strictEqual(r.outcome, 'passed', `got ${r.outcome}`);
    assert.deepStrictEqual(r.findings, []);
    assert.strictEqual(r.checked, 2);
    assert.strictEqual(r.clean, 2);
    assert.strictEqual(r.stopped, false);
  });

  console.log('\n3. what it saw');
  // rejects: throwing away the non-gating bands before anything stores them —
  // the defect that left the serial-killer set's card empty.
  await H.test('LOW, MEDIUM and HIGH are observations, each saying whether it intervened', async () => {
    H.reset();
    H.state.guardrailReplies = [
      H.guardrailFull({ VIOLENCE: 'HIGH', MISCONDUCT: 'LOW' }, { VIOLENCE: true }),
      H.guardrailFull({ HATE: 'MEDIUM' }),
    ];
    const r = await G.checkQuestions(QUESTIONS);
    assert.deepStrictEqual(r.observed, [
      { questionId: 'c001#001', category: 'VIOLENCE', band: 'HIGH', intervened: true },
      { questionId: 'c001#001', category: 'MISCONDUCT', band: 'LOW', intervened: false },
      { questionId: 'c001#002', category: 'HATE', band: 'MEDIUM', intervened: false },
    ]);
  });
  // rejects: recording NONE, which would read as every question noted in every category.
  await H.test('NONE is not an observation: a clean FULL reply observes nothing', async () => {
    H.reset();
    H.state.guardrailReplies = [H.guardrailFull(), H.guardrailFull()];
    const r = await G.checkQuestions(QUESTIONS);
    assert.deepStrictEqual(r.observed, []);
  });
  // rejects: observing before the category filter — a trivia question ABOUT
  // prompt injection would show on a set's card as a prompt attack.
  await H.test('a category the subject is not judged on is not observed', async () => {
    H.reset();
    H.state.guardrailReplies = [H.guardrailFull({ PROMPT_ATTACK: 'HIGH' }, { PROMPT_ATTACK: true }), H.guardrailFull()];
    const r = await G.checkQuestions(QUESTIONS);
    assert.strictEqual(r.outcome, 'passed');
    assert.deepStrictEqual(r.observed, []);
  });
  // rejects: recording a legacy filter as not having intervened, which would
  // tell the card that a HIGH that refused the set did not hold it.
  await H.test('a filter with no `detected` is recorded as having intervened', async () => {
    H.reset();
    H.state.guardrailReplies = [H.guardrailHit('HATE', 'MEDIUM'), H.guardrailHit('INSULTS', 'LOW')];
    const r = await G.checkQuestions(QUESTIONS);
    assert.deepStrictEqual(r.observed, [
      { questionId: 'c001#001', category: 'HATE', band: 'MEDIUM', intervened: true },
      { questionId: 'c001#002', category: 'INSULTS', band: 'LOW', intervened: true },
    ]);
  });
  await H.test('the set prose is observed under its own subject', async () => {
    H.reset();
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'MEDIUM' })];
    const r = await G.checkText('True crime, from the Ripper to the Zodiac', '(set)');
    assert.strictEqual(r.outcome, 'passed');
    assert.deepStrictEqual(r.observed, [{ questionId: '(set)', category: 'VIOLENCE', band: 'MEDIUM', intervened: false }]);
  });
  // rejects: an unreadable subject turning up as measured-and-clean.
  await H.test('a subject the guardrail could not read observes nothing, and still escalates', async () => {
    H.reset();
    H.state.guardrailReplies = [new Error('ThrottlingException'), H.guardrailFull()];
    const errored = await G.checkQuestions(QUESTIONS);
    assert.strictEqual(errored.outcome, 'escalated');
    assert.deepStrictEqual(errored.observed, []);
    const saved = process.env.CONTENT_GUARDRAIL_ID;
    delete process.env.CONTENT_GUARDRAIL_ID;
    try {
      const unconfigured = await G.checkQuestions(QUESTIONS);
      assert.strictEqual(unconfigured.outcome, 'escalated');
      assert.deepStrictEqual(unconfigured.observed, []);
    } finally { process.env.CONTENT_GUARDRAIL_ID = saved; }
  });

  console.log('\n4. the tally');
  // rejects: a category left out because nothing was seen in it — the card's
  // five rows must each say "none", not vanish.
  await H.test('all five categories are always present, and nothing seen reads as none', async () => {
    assert.deepStrictEqual(G.tallyOf({ observed: [], findings: [], questions: 30, setTextReached: true }), {
      scope: 'full',
      questions: 30,
      setTextChecked: true,
      setTextUnread: false,
      spotless: 30,
      unread: 0,
      categories: { VIOLENCE: NONE_SEEN, SEXUAL: NONE_SEEN, HATE: NONE_SEEN, INSULTS: NONE_SEEN, MISCONDUCT: NONE_SEEN },
    });
  });
  // rejects: counting observations instead of questions, counting the set's
  // own text as a question, and a `worst` that is not the worst counted band.
  await H.test('counts are distinct questions per band, worst is the worst of them, and the set prose is not a question', async () => {
    const observed = [
      { questionId: 'c001#001', category: 'VIOLENCE', band: 'LOW', intervened: false },
      // A second assessment of the same question in the same band: still one question.
      { questionId: 'c001#001', category: 'VIOLENCE', band: 'LOW', intervened: false },
      { questionId: 'c001#001', category: 'MISCONDUCT', band: 'LOW', intervened: false },
      { questionId: 'c001#002', category: 'VIOLENCE', band: 'MEDIUM', intervened: false },
      { questionId: 'c001#003', category: 'VIOLENCE', band: 'LOW', intervened: false },
      { questionId: 'c002#001', category: 'HATE', band: 'HIGH', intervened: true },
      { questionId: '(set)', category: 'SEXUAL', band: 'MEDIUM', intervened: false },
    ];
    const findings = [{ questionId: 'c002#001', category: 'HATE', band: 'HIGH' }];
    const t = G.tallyOf({ observed, findings, questions: 10, setTextReached: true });
    assert.deepStrictEqual(t.categories, {
      VIOLENCE: { worst: 'MEDIUM', low: 2, medium: 1, high: 0 },
      SEXUAL: NONE_SEEN,
      HATE: { worst: 'HIGH', low: 0, medium: 0, high: 1 },
      INSULTS: NONE_SEEN,
      MISCONDUCT: { worst: 'LOW', low: 1, medium: 0, high: 0 },
    });
    // Ten questions; c001#001, c001#002, c001#003 and c002#001 had something seen.
    assert.strictEqual(t.spotless, 6);
    assert.strictEqual(t.unread, 0);
  });
  // rejects: calling a question the guardrail never read "spotless" — nothing
  // was seen in it because nothing looked.
  await H.test('a question the guardrail could not read is unread, not spotless', async () => {
    const findings = [
      { questionId: 'c001#004', category: 'ERROR', band: 'NONE', detail: 'ThrottlingException' },
      { questionId: null, category: 'TIMEOUT', band: 'NONE' },
    ];
    const observed = [{ questionId: 'c001#001', category: 'INSULTS', band: 'LOW', intervened: false }];
    const t = G.tallyOf({ observed, findings, questions: 5, setTextReached: false });
    assert.strictEqual(t.unread, 1);
    assert.strictEqual(t.spotless, 3);
    assert.strictEqual(t.setTextChecked, false);
    // Stopped before it: never tried is not "could not be read".
    assert.strictEqual(t.setTextUnread, false);
  });
  // rejects: the set's own text recorded as checked when the guardrail never
  // read it (a throttle, or no guardrail configured) — the score card then
  // named it checked and called it clean. It is not a question, so it moves
  // neither `unread` nor `spotless`.
  await H.test('the set\'s own text the guardrail could not read is unread, never checked', async () => {
    for (const category of ['ERROR', 'UNCONFIGURED']) {
      const t = G.tallyOf({ observed: [], findings: [{ questionId: '(set)', category, band: 'NONE' }], questions: 3, setTextReached: true });
      assert.strictEqual(t.setTextChecked, false, `${category}: the unread text was recorded as checked`);
      assert.strictEqual(t.setTextUnread, true, `${category}: the unread text was not recorded as unread`);
      assert.strictEqual(t.unread, 0, `${category}: the set's text was counted as a question`);
      assert.strictEqual(t.spotless, 3, `${category}: the set's text was taken from the questions`);
    }
    // A finding in a judged category is the guardrail having READ the text.
    const held = G.tallyOf({
      observed: [{ questionId: '(set)', category: 'HATE', band: 'MEDIUM', intervened: true }],
      findings: [{ questionId: '(set)', category: 'HATE', band: 'MEDIUM' }],
      questions: 3,
      setTextReached: true,
    });
    assert.strictEqual(held.setTextChecked, true);
    assert.strictEqual(held.setTextUnread, false);
  });

  H.summary();
})();
