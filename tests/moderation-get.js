// tests/moderation-get.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
process.env.AI_PROMPTS_BUCKET = 'prompts-test';
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-get.js'));
const parse = (res) => JSON.parse(res.body || '{}');
const SRC = { scope: 'org', orgId: 'org_acme', setId: 'safety' };
const KEY = 'moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json';
// `meta` carries all five SET_FIELDS publishable.contentHash judges, not just
// the two the projection used to print: a '(set)' finding can name any of them.
const SNAPSHOT = {
  version: 2, contentHash: 'c'.repeat(64),
  meta: {
    name: 'Safety walkthrough',
    description: 'Site safety',
    engagementType: 'trivia',
    customInstruction: 'Describe the worst injury you have seen on site.',
    aiContextInstruction: 'The room is a night shift at a steel mill.',
    roundKindBrief: 'Incident',
  },
  categories: [{ SK: 'CATEGORY#c001', Name: 'Injuries' }, { SK: 'CATEGORY#c002', Name: 'PPE' }],
  questions: [
    { SK: 'QUESTION#c001#001', Category: 'Injuries', Title: 'A clean one', Detail: 'Which glove?', optionA: 'Nitrile', optionB: 'None' },
    { SK: 'QUESTION#c001#014', Category: 'Injuries', Title: 'Describe the injury', Detail: 'In detail.', optionA: 'A', optionB: 'B' },
    { SK: 'QUESTION#c002#022', Category: 'PPE', Title: 'Who is to blame', Detail: 'A category of people.', optionA: 'A', optionB: 'B' },
  ],
};
async function seed() {
  H.reset();
  H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify(SNAPSHOT));
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.ESCALATED, reasons: ['guardrail'], snapshotKey: KEY, contentHash: 'c'.repeat(64), findings: [
    { questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Asking for injuries in detail is what was flagged, not the safety topic.' },
    { questionId: 'c002#022', category: 'HATE', band: 'MEDIUM', explanation: 'The question invites an answer about a category of people.' },
    { questionId: '(set)', category: 'VIOLENCE', band: 'LOW' },
  ] });
  await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 3, snapshotKey: KEY, contentHash: 'c'.repeat(64), uncertainQuestionIds: ['c001#014', 'c002#022'] });
  await L.appendReviewEvent(db, T, SRC, 'escalated', { version: 2, reasons: ['guardrail'] });
}
const get = (sk) => handler(H.platformEvent({ method: 'GET', path: { sk: encodeURIComponent(sk) } }), H.ctx());
(async () => {
  console.log('\nGET /admin/moderation/{sk}\n');
  await H.test('the pointer, the review facts and the snapshot come back, uncertain questions first', async () => {
    await seed();
    const res = await get('org_acme#safety#v2');
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.pointer.sk, 'org_acme#safety#v2');
    assert.strictEqual(body.review.status, 'escalated');
    assert.strictEqual(body.snapshot.meta.name, 'Safety walkthrough');
    assert.deepStrictEqual(body.snapshot.categories, [{ id: 'c001', name: 'Injuries' }, { id: 'c002', name: 'PPE' }]);
    assert.deepStrictEqual(body.snapshot.questions.map((q) => q.questionId), ['c001#014', 'c002#022', 'c001#001'], 'uncertain first, then the rest in set order');
    assert.strictEqual(body.snapshot.questions[0].findings[0].band, 'MEDIUM');
    assert.match(body.snapshot.questions[0].findings[0].explanation, /injuries in detail/);
    assert.match(body.snapshot.questions[0].text, /Describe the injury/);
    assert.deepStrictEqual(body.snapshot.questions[2].findings, []);
    assert.strictEqual(body.setFindings.length, 1);
    assert.strictEqual(body.log[0].event, 'escalated');
  });
  // rejects: projecting three of the five SET_FIELDS. A '(set)' finding is
  // raised against the same five publishable.contentHash judges, so a finding
  // about customInstruction, aiContextInstruction or roundKindBrief used to
  // arrive with nothing on screen that could have caused it — the reviewer was
  // shown the name and the description and asked to decide about text they
  // could not see.
  await H.test("the set's own text comes back in full — all five judged fields", async () => {
    await seed();
    const body = parse(await get('org_acme#safety#v2'));
    assert.strictEqual(body.snapshot.meta.customInstruction, 'Describe the worst injury you have seen on site.');
    assert.strictEqual(body.snapshot.meta.aiContextInstruction, 'The room is a night shift at a steel mill.');
    assert.strictEqual(body.snapshot.meta.roundKindBrief, 'Incident');
    assert.strictEqual(body.snapshot.meta.name, 'Safety walkthrough');
    assert.strictEqual(body.snapshot.meta.description, 'Site safety');
    assert.strictEqual(body.snapshot.meta.engagementType, 'trivia');
  });
  // rejects: a varying shape. A set with no custom instructions must answer ''
  // for it, not undefined — the dialog renders the field either way and
  // `undefined` would read as the string "undefined" in a template.
  await H.test('a set that carries none of the extra prose answers empty strings, not gaps', async () => {
    await seed();
    H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify({ ...SNAPSHOT, meta: { name: 'Bare', engagementType: 'trivia' } }));
    const body = parse(await get('org_acme#safety#v2'));
    assert.deepStrictEqual(body.snapshot.meta, {
      name: 'Bare', description: '', customInstruction: '', aiContextInstruction: '', roundKindBrief: '', engagementType: 'trivia',
    });
  });
  // rejects: passing the review-log rows through raw. PK/SK are storage, and
  // moderation-list.js already projects its pointer rather than returning one.
  await H.test('the log comes back as events, never as table rows', async () => {
    await seed();
    const body = parse(await get('org_acme#safety#v2'));
    assert.ok(body.log.length > 0, 'the fixture logs an escalation');
    for (const row of body.log) {
      assert.ok(!('PK' in row), `a log row carried PK: ${JSON.stringify(row)}`);
      assert.ok(!('SK' in row), `a log row carried SK: ${JSON.stringify(row)}`);
    }
    assert.strictEqual(body.log[0].event, 'escalated');
    assert.strictEqual(body.log[0].version, 2, 'the event data itself survives');
    assert.ok(body.log[0].at, 'and so does its time');
  });
  // rejects: `#v(\d+)`, which admits v0 — and setPartition(ref, 0) is the
  // LEGACY UNVERSIONED partition, a different set's content under a
  // version-shaped key.
  await H.test('v0 is not a version, and neither is v01', async () => {
    await seed();
    assert.strictEqual((await get('org_acme#safety#v0')).statusCode, 400, 'v0 resolved to the unversioned partition');
    assert.strictEqual((await get('org_acme#safety#v01')).statusCode, 400, 'two spellings of one version');
  });
  await H.test('a snapshot that is gone reads as null and the rest still answers', async () => {
    await seed();
    H.state.s3.clear();
    const res = await get('org_acme#safety#v2');
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).snapshot, null);
    assert.strictEqual(parse(res).review.status, 'escalated');
  });
  await H.test('an sk that is not one of the three shapes is a 400, and an unknown row a 404', async () => {
    await seed();
    assert.strictEqual((await get('not a key')).statusCode, 400);
    assert.strictEqual((await get('org_acme#missing#v9')).statusCode, 404);
    assert.strictEqual((await get('PUBLIC#orgacme-safety')).statusCode, 404, 'a well-formed public sk with no row');
  });
  await H.test('an org admin is refused', async () => {
    await seed();
    const res = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'GET', path: { sk: encodeURIComponent('org_acme#safety#v2') } }), H.ctx());
    assert.strictEqual(res.statusCode, 403);
  });
  H.summary();
})();
