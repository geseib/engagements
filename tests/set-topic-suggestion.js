// tests/set-topic-suggestion.js
/**
 * THE SHELF AT THE MOMENT A SET IS SHARED — the gate, and the help.
 *
 * The owner asked for two things in one sentence: *"req at least 1 pretty broad
 * for public ones"*, and *"maybe when saving or making public the tag can get
 * verified, or recommended as well."* They are different in kind and this file
 * holds both, because they meet in one route:
 *
 *   G  THE GATE.  A share of an unfiled set is refused, and refused BEFORE
 *      anything is spent — before the daily cap is reserved, before the lock is
 *      taken, before one guardrail call is made. A refusal that costs an
 *      organisation a check out of its twenty is a bug, and so is one that
 *      leaves a version reading `checking` with nothing running.
 *   S  THE HELP.  A check already reads the whole set. While it has the content
 *      in hand it proposes a shelf and a few words, and where the shelf the
 *      author chose clearly contradicts what it read, it says so — ONCE, on the
 *      review row, changing nothing. A helper, never a second gate.
 *
 * WHAT THE HELP MAY NEVER DO, which is most of what is asserted here:
 *
 *   S1  it never changes anybody's choice. `topic` on the set's own row is
 *       untouched by a check, whatever the model thinks.
 *   S2  it never changes an outcome. The status, the tally, the observations,
 *       the findings, the reasons and the queue are exactly what they were
 *       without it — asserted by running the same check twice and comparing the
 *       rows, not by listing the fields somebody remembered.
 *   S3  it is capped and budget-guarded like every other model call in the
 *       check (shared/finding-explanations.js): one call, a sample of the
 *       questions rather than all of them, and nothing at all when the Lambda
 *       is nearly out of time.
 *   S4  no model, no suggestion, and the check still passes. Bedrock throttling
 *       must never be the reason a set cannot be shared.
 *
 * // rejects: a share of an unfiled set that reaches the guardrail, the quota or
 * //          the lock; a suggestion that files a set on somebody's behalf, that
 * //          moves an outcome, that runs unbudgeted or uncapped, or whose
 * //          absence fails a check.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const db = DynamoDBDocumentClient.from({});
const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const J = require(path.join(H.REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
const W = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-check-worker.js'));
const { SET_TOPIC_IDS } = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-topics.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/check-question-set.js'));

const ORG = 'org_acme';
const SET = 'chemistry';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const deps = {
  db, tableName: T, s3, bucket: 'prompts-test', bedrock,
};

const parse = (res) => JSON.parse(res.body || '{}');
const review = () => R.readReview(db, T, SRC, 2);
const queue = () => H.rowsWhere((r) => r.PK === 'MODERATION');
const quotaRow = () => H.state.ddb.get(`ORG#${ORG}|CHECKS#${new Date().toISOString().slice(0, 10)}`);
const jobRows = () => H.rowsWhere((r) => String(r.PK).startsWith('JOB#'));
const clean = (n) => Array.from({ length: n }, () => H.guardrailFull());
/** The model's calls, in order, as the prompt text it was sent. */
const prompts = () => H.state.sentHaiku.map((c) => c.messages[0].content);
/** Only the calls the SUGGESTION made — the others are finding-explanations'. */
const suggestCalls = () => prompts().filter((p) => p.includes('SHELVES'));

/**
 * An organisation's set of chemistry questions at v2, encrypted the way upload
 * writes it. `topic` is left OFF when none is given: an unfiled set carries no
 * attribute at all, which is what the forty sets that predate the shelf carry.
 */
async function seed({ topic, tags, questions = 3 } = {}) {
  H.reset();
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  H.seedRow(await C.encryptItem(ORG, 'set', {
    ...V.setMetadataKey(SRC),
    name: 'Bench chemistry', description: 'Reagents, glassware and what not to mix.',
    engagementType: 'trivia', scope: 'org', orgId: ORG, activeVersion: 2,
    versions: [{ version: 2, questionCount: questions }], questionCount: questions, createdBy: 'sub-amara',
    ...(topic ? { topic } : {}),
    ...(tags ? { tags } : {}),
  }));
  H.seedRow({ PK: V.setPartition(SRC, 2), SK: 'CATEGORY#c001', Name: 'Reagents', QuestionCount: questions });
  for (let i = 1; i <= questions; i += 1) {
    H.seedRow(await C.encryptItem(ORG, 'question', { // eslint-disable-line no-await-in-loop
      PK: V.setPartition(SRC, 2), SK: `QUESTION#q${String(i).padStart(3, '0')}`,
      Title: `Which reagent is ${i}?`, Detail: 'Name the compound.', AnswerDetails: 'It is an acid.',
      optionA: 'A', optionB: 'B', correctAnswer: 'A', Category: 'c001', Image: '', Active: true,
    }));
  }
}

/** The share, as ShareSetDialog.jsx posts it. */
const share = (body = {}) => handler(
  H.orgEvent({
    orgId: ORG, method: 'POST', setId: SET, body: { version: 2, publish: true, ...body },
  }),
  H.ctx(),
);

/** The worker's own job row, for a check that is already past the gate. */
async function job(extra = {}) {
  const jobId = J.newJobId();
  await J.createJob(db, T, {
    jobId,
    kind: 'set-check',
    requested: 3,
    request: {
      setId: SET, version: 2, publish: true, declaredNotice: [], ...extra,
    },
    caller: {
      userId: 'sub-amara', username: 'amara', orgId: ORG, orgRole: 'owner',
    },
  });
  return jobId;
}

(async () => {
  console.log('\nG. the shelf gate on a share\n');

  // rejects: the gate being moved after `reserveSubmit`, or into the worker.
  // Either would charge an organisation one of its twenty daily checks for a
  // refusal, and the worker's would also have spent every guardrail call first.
  await H.test('a share of an unfiled set is refused before the quota, the lock or one guardrail call', async () => {
    await seed();
    const res = await share();
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.deepStrictEqual(H.state.sentGuardrail, [], 'the content was sent to the guardrail anyway');
    assert.strictEqual(quotaRow(), undefined, 'the refusal cost the organisation a check');
    assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED, 'the lock was taken for a check that never ran');
    assert.deepStrictEqual(jobRows(), [], 'a job row was written for a refusal');
    assert.deepStrictEqual(H.state.dispatched, [], 'the worker was dispatched anyway');
  });

  // rejects: a refusal that says only "no". The shelf IS the answer to "what
  // should I have said", so the message names all fifteen.
  await H.test('the refusal names every shelf the author could choose', async () => {
    await seed();
    const { error } = parse(await share());
    assert.match(error, /Science & Technology/, error);
    assert.match(error, /General Knowledge/, error);
  });

  // rejects: the gate spreading to sets nobody is sharing. A filed set is
  // checked exactly as it was before any of this existed.
  await H.test('a filed set is checked exactly as before', async () => {
    await seed({ topic: 'science-technology' });
    const res = await share();
    assert.strictEqual(res.statusCode, 202, res.body);
    assert.strictEqual(parse(res).status, 'queued');
    assert.strictEqual(H.state.dispatched.length, 1, 'the worker was not dispatched');
    assert.strictEqual((await review()).status, R.STATUS.CHECKING);
  });

  // rejects: the gate reading a label as though it were an id. `topic` is
  // stored as a shelf id, and a reader that only accepts one spelling would
  // refuse a set the writer accepted.
  await H.test('a set filed under any spelling of a shelf is accepted', async () => {
    await seed({ topic: 'Science & Technology' });
    assert.strictEqual((await share()).statusCode, 202);
  });

  // rejects: the gate spreading to a check that publishes nothing. That is the
  // one journey an UNFILED set still has through here, and it is the journey
  // that answers the question the gate asks — it is where the suggestion below
  // comes from.
  await H.test('a check that publishes nothing is not refused for being unfiled', async () => {
    await seed();
    const res = await share({ publish: false });
    assert.strictEqual(res.statusCode, 202, res.body);
  });

  console.log('\nS. the shelf the check proposes\n');

  // rejects: a check that reads the whole set and says nothing about where it
  // belongs. The content is already in hand, and the author is about to be
  // asked for a shelf.
  await H.test('the check proposes a shelf and a few words, beside the review', async () => {
    await seed({ topic: 'science-technology' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: ['Lab Safety', 'reagents'], fits: true })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, r.note);
    assert.deepStrictEqual(r.topicSuggestion, {
      topic: 'science-technology', tags: ['lab-safety', 'reagents'], filedAs: 'science-technology', mismatch: false,
    });
  });

  // rejects: a shelf proposed in a spelling no row uses. The suggestion is
  // offered as a CHOICE a person can accept, so it has to be storable as it
  // stands, and the tags have to be the canonical form every other tag is in.
  await H.test('a label, and tags in any case, come back as ids a row could carry', async () => {
    await seed({ topic: 'science-technology' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'Science & Technology', tags: ['  Bench Work  '], fits: true })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const { topic, tags } = (await review()).topicSuggestion;
    assert.ok(SET_TOPIC_IDS.includes(topic), `${topic} is not one of the fifteen`);
    assert.deepStrictEqual(tags, ['bench-work']);
  });

  // rejects: a proposal that files the set. The owner's word was "recommended",
  // and a check that quietly moved a set to another shelf would be a filter
  // rearranging somebody's library behind them.
  await H.test('the set itself is never re-filed by a suggestion', async () => {
    await seed({ topic: 'music' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: [], fits: false })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const row = await C.decryptItem(ORG, 'set', H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`));
    assert.strictEqual(row.topic, 'music', 'the check re-filed the set');
  });

  // rejects: a mismatch that becomes a second gate. It is said ONCE, in one
  // place, and the set is shared exactly as it would have been.
  await H.test('a shelf that contradicts the content is recorded once and blocks nothing', async () => {
    await seed({ topic: 'music' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: ['chemistry'], fits: false })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const r = await review();
    assert.strictEqual(r.topicSuggestion.mismatch, true, 'the contradiction was not recorded');
    assert.strictEqual(r.topicSuggestion.filedAs, 'music');
    assert.strictEqual(r.status, R.STATUS.PASSED, 'a mismatch changed the outcome');
    assert.deepStrictEqual(r.reasons, [], 'a mismatch became a reason a person is needed');
    assert.deepStrictEqual(queue().length, 0, 'a mismatch raised a row for a person');
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share.status, 'published', 'a mismatch stopped the share');
    // ONCE: the review row and nowhere else — not the log, not the queue, not
    // the job, not the snapshot.
    const carriers = H.rowsWhere((row) => JSON.stringify(row).includes('mismatch'));
    assert.strictEqual(carriers.length, 1, `${carriers.length} rows carry the mismatch`);
    assert.strictEqual(carriers[0].SK, 'REVIEW');
  });

  // rejects: "different" being read as "contradicts". Most sets could sit on
  // two shelves, and a product that argued about every one of them would be
  // turned off within a week.
  await H.test('a shelf the model merely would not have chosen is not a contradiction', async () => {
    await seed({ topic: 'health-medicine' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: [], fits: true })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).topicSuggestion.mismatch, false);
  });

  // rejects: contradicting the catch-all. "A genuine mix that spans the
  // shelves" is a claim no single shelf can disprove, so the one honest place
  // to put a set that really is a mix must not be argued with.
  await H.test('General Knowledge is never contradicted', async () => {
    await seed({ topic: 'general-knowledge' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: [], fits: false })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).topicSuggestion.mismatch, false);
  });

  // rejects: an unfiled set being told it is on the wrong shelf. There is no
  // choice to contradict — there is only a proposal, which is the whole point.
  await H.test('an unfiled set is proposed a shelf and contradicted about nothing', async () => {
    await seed();
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: [], fits: false })];
    await W.runSetCheck(deps, { jobId: await job({ publish: false }) }, H.ctx());
    const s = (await review()).topicSuggestion;
    assert.strictEqual(s.topic, 'science-technology');
    assert.strictEqual(s.filedAs, '');
    assert.strictEqual(s.mismatch, false);
  });

  console.log('\nS3. capped, budget-guarded, and never the reason a check fails\n');

  // rejects: a proposal that grows with the set. A hundred-question set would
  // otherwise send a hundred questions to a model to answer a fifteen-way
  // question, on every check.
  await H.test('one call, and only a sample of the questions in it', async () => {
    await seed({ topic: 'science-technology', questions: 40 });
    H.state.guardrailReplies = clean(41);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: [], fits: true })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.strictEqual(suggestCalls().length, 1, `${suggestCalls().length} calls to propose one shelf`);
    const sampled = (suggestCalls()[0].match(/Which reagent is/g) || []).length;
    assert.ok(sampled > 0 && sampled <= 12, `${sampled} questions were sent`);
  });

  // rejects: a proposal that arrives with more words than any chip list can
  // render. The cap is the set's own (MAX_SET_TAGS), asked for more tightly
  // here because these are a suggestion, not somebody's own words.
  await H.test('however many words come back, a few are kept', async () => {
    await seed({ topic: 'science-technology' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({
      topic: 'science-technology',
      tags: Array.from({ length: 30 }, (_, i) => `word-${i}`),
      fits: true,
    })];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const { tags } = (await review()).topicSuggestion;
    assert.ok(tags.length > 0 && tags.length <= 6, `${tags.length} tags were kept`);
  });

  // rejects: spending the last seconds of the Lambda on a suggestion. The
  // review row has to be written; a nicety must never be what stops it.
  await H.test('nothing is proposed when the budget is nearly gone', async () => {
    await seed({ topic: 'science-technology' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [JSON.stringify({ topic: 'science-technology', tags: [], fits: true })];
    // Plenty of time while the guardrail runs, almost none once it has: the
    // shape check-tally.js uses for the explanations' own budget.
    await W.runSetCheck(deps, { jobId: await job() }, {
      functionName: 'fn',
      getRemainingTimeInMillis: () => (H.state.sentGuardrail.length >= 4 ? 1000 : 800000),
    });
    const r = await review();
    assert.strictEqual(suggestCalls().length, 0, 'the model was asked with no budget left');
    assert.strictEqual(r.topicSuggestion, undefined);
    assert.strictEqual(r.status, R.STATUS.PASSED, 'the check did not finish');
  });

  // rejects: a throttled model failing a share. This is the sentence in the
  // brief — "a check with no model available still passes and simply carries
  // no suggestion".
  await H.test('a model that will not answer costs the check nothing', async () => {
    await seed({ topic: 'science-technology' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [new Error('ThrottlingException')];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, r.note);
    assert.strictEqual(r.topicSuggestion, undefined, 'a failed call left a suggestion behind');
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share.status, 'published');
  });

  // rejects: a reply thrown away for being wrapped. Models fence JSON and
  // apologise around it, and a parser that only accepts a bare object would
  // lose most real answers while every test that hands it one still passed.
  await H.test('a shelf that arrives fenced or apologised around is still read', async () => {
    await seed({ topic: 'science-technology' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = [`Here is my answer:\n\`\`\`json\n${JSON.stringify({ topic: 'science-technology', tags: ['reagents'], fits: true })}\n\`\`\``];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).topicSuggestion.topic, 'science-technology');
  });

  // rejects: trusting whatever comes back. A model that answers in prose, or
  // names a shelf that does not exist, has said nothing this product can store.
  await H.test('an answer that is not a shelf is not stored as one', async () => {
    await seed({ topic: 'science-technology' });
    H.state.guardrailReplies = clean(4);
    H.state.haikuReplies = ['Science and Technology, probably — hard to say.'];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).topicSuggestion, undefined);
  });

  // rejects: the suggestion changing anything it touches. Asserted by running
  // the same check twice — once with a model, once without — and comparing the
  // rows, rather than by listing the fields somebody remembered to check.
  await H.test('the outcome, the tally, the observations and the findings are exactly what they were', async () => {
    // The same flagged question and the same explanation in both runs: the one
    // difference is whether the LAST call came back with a shelf in it.
    const run = async (suggestionReply) => {
      await seed({ topic: 'music' });
      H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'MEDIUM' }, { VIOLENCE: true }), ...clean(3)];
      H.state.haikuReplies = ['A mild edge in the phrasing, not the subject.', suggestionReply];
      await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
      const row = { ...(await review()) };
      // The three that are a timestamp or derived from one, and the suggestion
      // itself — everything else must match to the byte.
      delete row.checkedAt; delete row.jobId; delete row.snapshotKey; delete row.topicSuggestion;
      return row;
    };
    const plain = await run(new Error('ThrottlingException'));
    const suggested = await run(JSON.stringify({ topic: 'science-technology', tags: ['chemistry'], fits: false }));
    assert.deepStrictEqual(suggested, plain);
  });

  H.summary();
})();
