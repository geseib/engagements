// tests/check-tally.js
/**
 * WHAT A CHECK RECORDS — shared/set-check-worker.js, shared/set-review.js,
 * shared/finding-explanations.js
 *
 * The owner, 2026-09-19: the public-library score card "doesn't reveal much".
 * The guardrail now reports every band it sees (guardrail-observations.js);
 * this file is about keeping it. The owner's decisions, as tests:
 *
 *   A  the card must MEASURE — a tally per category, and the questions it saw
 *   B  the verdict is decided exactly as before — a near-miss is never a
 *      finding, so the moderation queue, the author's banner and the review
 *      dialog (all readers of `findings`) behave as they did
 *
 * and the brief's limits: at most twelve Haiku calls per check IN TOTAL,
 * worst first, none once the budget is spent; the log row carries the small
 * tally and never the observations.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const db = DynamoDBDocumentClient.from({});
const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const J = require(path.join(H.REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const W = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-check-worker.js'));
const E = require(path.join(H.REPO, 'lambda-functions/admin/shared/finding-explanations.js'));

const ORG = 'org_acme'; const SET = 'crime';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const deps = { db, tableName: T, s3, bucket: 'prompts-test', bedrock };
const NONE_SEEN = { worst: null, low: 0, medium: 0, high: 0 };
const qid = (i) => `q${String(i).padStart(3, '0')}`;

/** An org set at v2 with `n` questions, encrypted the way upload writes them. */
async function seed(n = 3) {
  H.reset();
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  H.seedRow(await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'True crime', description: 'Infamous cases.',
    engagementType: 'trivia', scope: 'org', orgId: ORG, activeVersion: 2,
    versions: [{ version: 1 }, { version: 2 }], questionCount: n, createdBy: 'sub-amara',
  }));
  H.seedRow({ PK: `ORG#${ORG}#SET#${SET}#v2`, SK: 'CATEGORY#c001', Name: 'Cases', QuestionCount: n });
  for (let i = 1; i <= n; i += 1) {
    H.seedRow(await C.encryptItem(ORG, 'question', { // eslint-disable-line no-await-in-loop
      PK: `ORG#${ORG}#SET#${SET}#v2`, SK: `QUESTION#${qid(i)}`, Title: `Question ${i} title`, Detail: `Detail ${i}`,
      AnswerDetails: `Reveal ${i}`, optionA: 'A', optionB: 'B', correctAnswer: 'A', Category: 'c001',
      Image: '', Active: true, points: 10,
    }));
  }
}
async function job() {
  const jobId = J.newJobId();
  await J.createJob(db, T, {
    jobId, kind: 'set-check', requested: 3,
    request: { setId: SET, version: 2, publish: true, declaredNotice: [] },
    caller: { userId: 'sub-amara', username: 'amara', orgId: ORG, orgRole: 'owner' },
  });
  return jobId;
}
const review = () => R.readReview(db, T, SRC, 2);
const checkedEvents = async () => (await L.readReviewLog(db, T, SRC)).filter((e) => e.event === 'checked');
const stamp = () => H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share;
const queue = () => H.rowsWhere((r) => r.PK === 'MODERATION');
const promptOf = (i) => H.state.sentHaiku[i].messages[0].content;
const byQuestion = (rows, id, category) => rows.find((o) => o.questionId === id && o.category === category);

/** Three questions, the second clean; the set prose seen at LOW. Nothing intervenes. */
const NEAR_MISSES = () => [
  H.guardrailFull({ VIOLENCE: 'MEDIUM', MISCONDUCT: 'LOW' }),
  H.guardrailFull(),
  H.guardrailFull({ VIOLENCE: 'LOW' }),
  H.guardrailFull({ VIOLENCE: 'LOW' }),
];
const NEAR_MISS_TALLY = {
  scope: 'full',
  questions: 3,
  setTextChecked: true,
  spotless: 1,
  unread: 0,
  categories: {
    VIOLENCE: { worst: 'MEDIUM', low: 1, medium: 1, high: 0 },
    SEXUAL: NONE_SEEN,
    HATE: NONE_SEEN,
    INSULTS: NONE_SEEN,
    MISCONDUCT: { worst: 'LOW', low: 1, medium: 0, high: 0 },
  },
};

(async () => {
  console.log('\nwhat a check records\n');

  console.log('1. the review row keeps the tally and the observations');
  const TALLY = { ...NEAR_MISS_TALLY };
  const OBSERVED = [
    { questionId: 'q001', category: 'VIOLENCE', band: 'MEDIUM', intervened: false, explanation: 'The attack is described, not the history.' },
    { questionId: '(set)', category: 'VIOLENCE', band: 'LOW', intervened: false },
  ];
  // rejects: tally/observed missing from REVIEW_FIELDS, where writeReview's
  // whitelist would drop them silently and every card would read "pre-tally".
  await H.test('writeReview stores the tally and the observations, and readReview returns them', async () => {
    H.reset();
    await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, findings: [], note: '4/4 clean', tally: TALLY, observed: OBSERVED });
    const r = await review();
    assert.deepStrictEqual(r.tally, NEAR_MISS_TALLY);
    assert.deepStrictEqual(r.observed, OBSERVED);
  });
  // rejects: a staff decision erasing the measurements — an approved
  // escalation is exactly the set whose card has the most to show.
  await H.test('a staff decision keeps them: the approved card still has its tally', async () => {
    H.reset();
    await R.writeReview(db, T, SRC, 2, { status: R.STATUS.ESCALATED, findings: [], note: '4/4 clean', reasons: ['declared'], tally: TALLY, observed: OBSERVED });
    await R.transitionReview(db, T, SRC, 2, R.STATUS.ESCALATED, { status: R.STATUS.PASSED, reviewer: 'dai', decidedAt: '2026-09-19T10:00:00.000Z', note: 'Clinical, not gratuitous.' });
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED);
    assert.deepStrictEqual(r.tally, NEAR_MISS_TALLY);
    assert.deepStrictEqual(r.observed, OBSERVED);
  });
  // rejects: storing whatever a caller hands over as `observed` — the card
  // iterates it, so it is an array or it is not written (findings' own rule).
  await H.test('observations that are not a list are not written', async () => {
    H.reset();
    await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, note: '1/1 clean', observed: 'q001 was violent' });
    assert.strictEqual((await review()).observed, undefined);
  });

  console.log('\n2. the worker records what it measured, and decides as before');
  // rejects: the worker computing a tally and not persisting it, or persisting
  // observations that drop the set's own subject.
  await H.test('a passed set keeps its verdict and now records the tally and every observation', async () => {
    await seed(3);
    H.state.guardrailReplies = NEAR_MISSES();
    H.state.haikuReplies = ['why-1', 'why-2', 'why-3'];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}: ${r.note}`);
    assert.deepStrictEqual(r.tally, NEAR_MISS_TALLY);
    assert.deepStrictEqual(r.observed, [
      { questionId: 'q001', category: 'VIOLENCE', band: 'MEDIUM', intervened: false, explanation: 'why-1' },
      { questionId: 'q001', category: 'MISCONDUCT', band: 'LOW', intervened: false, explanation: 'why-2' },
      { questionId: 'q003', category: 'VIOLENCE', band: 'LOW', intervened: false, explanation: 'why-3' },
      // The set's own prose is observed too; there is no question to explain.
      { questionId: '(set)', category: 'VIOLENCE', band: 'LOW', intervened: false },
    ]);
  });
  // rejects: near-misses leaking into anything that decides — the verdict,
  // the findings, the "N/N clean" note, the publish.
  await H.test('a set that passes today still passes: same status, findings, note and publish', async () => {
    await seed(3);
    H.state.guardrailReplies = NEAR_MISSES();
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED);
    assert.deepStrictEqual(r.findings, []);
    assert.strictEqual(r.note, '4/4 clean');
    assert.deepStrictEqual(r.reasons, []);
    assert.strictEqual(stamp().status, 'published');
    assert.strictEqual(queue().length, 0);
  });
  // rejects: near-misses in `findings`, which every existing reader counts —
  // the queue's "N uncertain questions", its bands, the author's banner.
  await H.test('an escalation names only what intervened: the queue and the findings ignore near-misses', async () => {
    await seed(3);
    H.state.guardrailReplies = [
      H.guardrailFull({ HATE: 'MEDIUM', VIOLENCE: 'LOW' }, { HATE: true }),
      H.guardrailFull({ INSULTS: 'LOW' }),
      H.guardrailFull(),
      H.guardrailFull(),
    ];
    H.state.haikuReplies = ['why-hate', 'why-violence', 'why-insults'];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.ESCALATED);
    assert.deepStrictEqual(r.reasons, ['guardrail']);
    // The explanation written for the observation is carried onto its finding,
    // so the review dialog, which reads findings, keeps its sentence.
    assert.deepStrictEqual(r.findings, [{ questionId: 'q001', category: 'HATE', band: 'MEDIUM', explanation: 'why-hate' }]);
    const [row] = queue();
    assert.deepStrictEqual(row.bands, { HATE: 'MEDIUM' });
    assert.deepStrictEqual(row.uncertainQuestionIds, ['q001']);
    assert.deepStrictEqual(r.tally.categories.INSULTS, { worst: 'LOW', low: 1, medium: 0, high: 0 });
  });
  // rejects: the log row growing by the observation list on every check, or
  // losing the tally the brief allows it.
  await H.test('the checked log event carries the tally and never the observations', async () => {
    await seed(3);
    H.state.guardrailReplies = NEAR_MISSES();
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const [ev] = await checkedEvents();
    assert.ok(ev, 'no checked event');
    assert.deepStrictEqual(ev.tally, NEAR_MISS_TALLY);
    assert.ok(!('observed' in ev), 'the observations were copied into the log row');
    assert.deepStrictEqual(ev.findings, []);
  });
  // rejects: a check that measured everything and then failed in bookkeeping
  // being shown on the card as one that never measured at all.
  await H.test('a check that fails after measuring still records what it measured', async () => {
    await seed(3);
    H.state.guardrailReplies = NEAR_MISSES();
    const jobId = await job();
    const realSend = db.send.bind(db);
    let tripped = false;
    db.send = async (cmd) => {
      if (!tripped && cmd && cmd.kind === 'update' && String((cmd.input || {}).UpdateExpression || '').startsWith('ADD units')) {
        tripped = true;
        throw new Error('quota store down');
      }
      return realSend(cmd);
    };
    try {
      await W.runSetCheck(deps, { jobId }, H.ctx());
    } finally {
      db.send = realSend;
    }
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.ESCALATED);
    assert.deepStrictEqual(r.reasons, ['error']);
    assert.deepStrictEqual(r.tally, NEAR_MISS_TALLY);
    assert.strictEqual(r.observed.length, 4);
  });

  console.log('\n3. the sentences: twelve calls in all, worst first, never on a spent budget');
  // rejects: a second allowance for observations on top of the findings' one,
  // spending the calls in question order (near-misses before a refusal), or
  // the refusal's sentence not reaching its finding.
  await H.test('at most twelve Haiku calls in a check, spent on the worst bands first', async () => {
    await seed(15);
    const replies = [];
    for (let i = 1; i <= 15; i += 1) {
      if (i === 2) replies.push(H.guardrailFull({ VIOLENCE: 'MEDIUM' }));
      else if (i === 3) replies.push(H.guardrailFull({ VIOLENCE: 'HIGH' }, { VIOLENCE: true }));
      else replies.push(H.guardrailFull({ MISCONDUCT: 'LOW' }));
    }
    replies.push(H.guardrailFull());
    H.state.guardrailReplies = replies;
    H.state.haikuReplies = Array.from({ length: 15 }, (_, i) => `why-${i + 1}`);
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.FLAGGED);
    assert.strictEqual(H.state.sentHaiku.length, 12, `${H.state.sentHaiku.length} Haiku calls`);
    assert.ok(promptOf(0).includes('Question 3 title'), 'the HIGH was not explained first');
    assert.ok(promptOf(1).includes('Question 2 title'), 'the MEDIUM was not explained second');
    assert.ok(promptOf(2).includes('Question 1 title'), 'the LOWs were not taken in question order');
    // Calls 1 and 2 are q003 and q002; the LOWs follow in question order —
    // q001 is call 3, then q004…q012 are calls 4…12 — and q013 on get none.
    assert.strictEqual(byQuestion(r.observed, 'q003', 'VIOLENCE').explanation, 'why-1');
    assert.strictEqual(byQuestion(r.observed, 'q002', 'VIOLENCE').explanation, 'why-2');
    assert.strictEqual(byQuestion(r.observed, 'q001', 'MISCONDUCT').explanation, 'why-3');
    assert.strictEqual(byQuestion(r.observed, 'q012', 'MISCONDUCT').explanation, 'why-12');
    for (const late of ['q013', 'q014', 'q015']) {
      const { explanation } = byQuestion(r.observed, late, 'MISCONDUCT');
      assert.ok(explanation && !/^why-/.test(explanation), `${late} was explained by a thirteenth call: ${explanation}`);
      assert.ok(!/a person will look/i.test(explanation), `${late}'s fallback claims a person will look: ${explanation}`);
    }
    assert.deepStrictEqual(r.findings, [{ questionId: 'q003', category: 'VIOLENCE', band: 'HIGH', explanation: 'why-1' }]);
  });
  // rejects: a budget already declared exhausted being spent on Haiku.
  await H.test('no Haiku at all once the budget has run out, and the partial tally says so', async () => {
    await seed(3);
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'LOW' }), H.guardrailFull(), H.guardrailFull()];
    let remaining = 100000;
    const ctx = { functionName: 'fn', getRemainingTimeInMillis: () => { const r = remaining; remaining = 1000; return r; } };
    await W.runSetCheck(deps, { jobId: await job() }, ctx);
    const r = await review();
    assert.ok(r.reasons.includes('timeout'), `reasons were ${r.reasons}`);
    assert.strictEqual(H.state.sentHaiku.length, 0, 'Haiku ran after the budget was spent');
    assert.deepStrictEqual(r.observed, [{ questionId: 'q001', category: 'VIOLENCE', band: 'LOW', intervened: false }]);
    assert.strictEqual(r.tally.questions, 1);
    assert.strictEqual(r.tally.setTextChecked, false);
  });
  // rejects: twelve calls started on a budget that can only afford one — now
  // that PASSED sets are explained too, a check that finishes late would be
  // killed before its REVIEW row is written and sit in `checking`.
  await H.test('the budget is asked again before every Haiku call, and the row is still written', async () => {
    await seed(3);
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'LOW' }), H.guardrailFull({ VIOLENCE: 'LOW' }), H.guardrailFull({ VIOLENCE: 'LOW' }), H.guardrailFull()];
    H.state.haikuReplies = ['why-1', 'why-2', 'why-3'];
    const ctx = { functionName: 'fn', getRemainingTimeInMillis: () => (H.state.sentHaiku.length >= 1 ? 1000 : 800000) };
    await W.runSetCheck(deps, { jobId: await job() }, ctx);
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}`);
    assert.strictEqual(H.state.sentHaiku.length, 1);
    assert.strictEqual(r.observed[0].explanation, 'why-1');
    assert.ok(r.observed[1].explanation && !/^why-/.test(r.observed[1].explanation), 'the fallback sentence is missing');
  });

  console.log('\n4. what the model and the fallback are told');
  const snapshot = { questions: [{ SK: 'QUESTION#q001', Title: 'Which weapon did the Ripper use?', Detail: '' }] };
  // rejects: telling the model a question was flagged when the guardrail let
  // it through — it then writes "X is what was flagged" onto a passed set.
  await H.test('an observation that did not intervene is never described to the model as flagged', async () => {
    H.reset();
    await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [{ questionId: 'q001', category: 'VIOLENCE', band: 'LOW', intervened: false }]);
    const prompt = promptOf(0);
    assert.ok(!/flag/i.test(prompt), `the prompt says flagged:\n${prompt}`);
    assert.ok(/noted/i.test(prompt) && prompt.includes('VIOLENCE') && prompt.includes('LOW'), `the prompt does not say what was noted:\n${prompt}`);
  });
  await H.test('one that intervened is still described as flagged', async () => {
    H.reset();
    await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [{ questionId: 'q001', category: 'VIOLENCE', band: 'HIGH', intervened: true }]);
    assert.match(promptOf(0), /flagged this question for VIOLENCE at HIGH confidence/);
  });
  // rejects: the fallback sentence promising a person will look at something
  // that passed — it used to say so for every band below HIGH.
  await H.test('the fallback sentence never says a person will look at what was let through', async () => {
    for (const band of ['LOW', 'MEDIUM', 'HIGH']) {
      const s = E.bandSentence({ category: 'VIOLENCE', band, intervened: false });
      assert.ok(!/a person will look/i.test(s), `${band}: ${s}`);
      assert.ok(s.toLowerCase().includes(band.toLowerCase()), `${band}: the sentence does not name the band: ${s}`);
      assert.ok(s.includes('violence or injury'), `${band}: ${s}`);
    }
    // A legacy LOW with no flag never held a set either.
    assert.ok(!/a person will look/i.test(E.bandSentence({ category: 'HATE', band: 'LOW' })));
    assert.match(E.bandSentence({ category: 'HATE', band: 'MEDIUM' }), /a person will look/);
  });

  H.summary();
})();
