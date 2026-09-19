// tests/score-card-standing.js
/**
 * THE SCORE CARD'S DATA — GET /admin/public-library/{publicSetId}, standing()
 * in admin/public-library-item.js
 *
 * The owner, 2026-09-19: the card "doesn't reveal much" — raw ids like
 * c001#014 and "The check found nothing to say." Decision A: the card must
 * MEASURE, with a tally per category and the questions named by their TEXT.
 *
 * The text comes from the PUBLISHED PUBLIC COPY's own question rows, matched
 * by id — publish copies the judged snapshot's rows byte-for-byte, keys and
 * all (shared/publish-set.js), so an id in the org's review is the same id in
 * the public partition. Not the S3 snapshot: snapshots expire after 30 days
 * and this function has no S3 grant. Not the org's rows: they are encrypted,
 * and may have been edited since.
 *
 * Decision C: a review checked before measuring existed has no tally, and the
 * card is given nothing to invent one from.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/public-library-item.js'));

const SRC = { scope: 'org', orgId: 'org_acme', setId: 'crime' };
const PUB = publicSetIdFor('org_acme', 'crime');
const PUBREF = { scope: 'public', orgId: '', setId: PUB };
const HASH = 'c'.repeat(64);
const NONE_SEEN = { worst: null, low: 0, medium: 0, high: 0 };
const TALLY = {
  scope: 'full',
  questions: 3,
  setTextChecked: true,
  setTextUnread: false,
  spotless: 1,
  unread: 0,
  categories: {
    VIOLENCE: { worst: 'MEDIUM', low: 0, medium: 1, high: 0 },
    SEXUAL: NONE_SEEN,
    HATE: NONE_SEEN,
    INSULTS: NONE_SEEN,
    MISCONDUCT: { worst: 'LOW', low: 1, medium: 0, high: 0 },
  },
};
const OBSERVED = [
  { questionId: 'c001#001', category: 'MISCONDUCT', band: 'LOW', intervened: false, explanation: 'A cipher is named; nothing is taught.' },
  { questionId: 'c001#002', category: 'VIOLENCE', band: 'MEDIUM', intervened: false, explanation: 'The murders are the setting; the question asks about a place.' },
  { questionId: '(set)', category: 'VIOLENCE', band: 'LOW', intervened: false },
];

/**
 * The public set as a publish leaves it — v1 an older share, v2 the active
 * one — and the org's own version 3 behind it, whose rows have been edited
 * since and must never be what the card shows.
 */
function seedPublic() {
  H.seedRow({
    ...V.setMetadataKey(PUBREF), name: 'True crime', description: 'Infamous cases, solved and not.', engagementType: 'trivia',
    activeVersion: 2, versions: [{ version: 1, createdAt: '2026-09-01T10:00:00.000Z', questionCount: 1 }, { version: 2, createdAt: '2026-09-18T10:00:00.000Z', questionCount: 3 }],
    sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'crime', sourceVersion: 3, contentHash: HASH, questionCount: 3,
  });
  H.seedRow({ PK: V.setPartition(PUBREF, 1), SK: 'QUESTION#c001#001', Title: 'An older wording', Detail: 'From the first share.' });
  const v2 = V.setPartition(PUBREF, 2);
  H.seedRow({ PK: v2, SK: 'CATEGORY#c001', Name: 'Cases' });
  H.seedRow({ PK: v2, SK: 'QUESTION#c001#001', Title: 'The Zodiac', Detail: 'Which newspaper received the first cipher?', AnswerDetails: 'The Chronicle.', optionA: 'The Chronicle', optionB: 'The Examiner' });
  H.seedRow({ PK: v2, SK: 'QUESTION#c001#002', Title: 'The Ripper', Detail: 'In which district were the murders?', AnswerDetails: 'Whitechapel.' });
  H.seedRow({ PK: v2, SK: 'QUESTION#c001#003', Title: 'Bow Street', Detail: 'Who founded the Bow Street Runners?' });
  const org = V.setPartition(SRC, 3);
  H.seedRow({ PK: org, SK: 'QUESTION#c001#001', Title: 'Edited by the organisation since', Detail: '' });
  H.seedRow({ PK: org, SK: 'QUESTION#c001#002', Title: 'Edited by the organisation since', Detail: '' });
}
/** Escalated for a declared notice, seen at MEDIUM and LOW, approved by staff: the shape production writes. */
async function seedApproved({ observed = OBSERVED } = {}) {
  H.reset();
  seedPublic();
  await R.writeReview(db, T, SRC, 3, {
    status: R.STATUS.ESCALATED, findings: [], note: '4/4 clean', reasons: ['declared'], declaredNotice: ['graphic-violence'],
    contentHash: HASH, checkedBy: 'sub-amara', tally: TALLY, observed,
  });
  await R.transitionReview(db, T, SRC, 3, R.STATUS.ESCALATED, {
    status: R.STATUS.PASSED, reviewer: 'dai', decidedAt: '2026-09-18T09:55:00.000Z', note: 'Historical, not gratuitous.', notice: ['graphic-violence'],
  });
}
const get = async () => {
  const res = await handler(H.platformEvent({ method: 'GET', path: { publicSetId: PUB } }), H.ctx());
  assert.strictEqual(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
};
const observedRow = (card, id, category) => card.review.observed.find((o) => o.questionId === id && o.category === category);

(async () => {
  console.log('\nthe score card\'s data\n');

  // rejects: standing() carrying on with its old projection, which dropped
  // everything the card now needs — and with it the reason a set went to a person.
  await H.test('the review projects the tally, the reasons and every observation, and findings as before', async () => {
    await seedApproved();
    const card = await get();
    assert.deepStrictEqual(card.review.tally, TALLY);
    assert.deepStrictEqual(card.review.reasons, ['declared']);
    assert.deepStrictEqual(card.review.findings, []);
    assert.deepStrictEqual(card.review.observed.map(({ text, ...row }) => row), OBSERVED); // eslint-disable-line no-unused-vars
    assert.strictEqual(card.review.status, 'passed');
    assert.strictEqual(card.review.note, 'Historical, not gratuitous.');
  });
  // rejects: naming a question by its id, by the organisation's edited row,
  // or by an older public version's wording.
  await H.test('each observation carries its question\'s text from the active public copy, matched by id', async () => {
    await seedApproved();
    const card = await get();
    assert.strictEqual(observedRow(card, 'c001#001', 'MISCONDUCT').text, 'The Zodiac\nWhich newspaper received the first cipher?');
    assert.strictEqual(observedRow(card, 'c001#002', 'VIOLENCE').text, 'The Ripper\nIn which district were the murders?');
  });
  await H.test('the set\'s own subject is named by the public set\'s title and description', async () => {
    await seedApproved();
    const card = await get();
    assert.strictEqual(observedRow(card, '(set)', 'VIOLENCE').text, 'True crime\nInfamous cases, solved and not.');
  });
  // rejects: a missing row borrowing a neighbour's text, or taking the card down with it.
  await H.test('an id the public copy does not hold is left without text', async () => {
    await seedApproved({ observed: [{ questionId: 'c009#001', category: 'HATE', band: 'LOW', intervened: false }] });
    const card = await get();
    assert.strictEqual(card.review.observed[0].text, '');
  });
  // rejects: a pre-tally review read as "measured, and nothing seen" — the
  // card must be able to tell that it simply was not measured (decision C).
  await H.test('a review checked before the tally existed projects without one', async () => {
    H.reset();
    seedPublic();
    await R.writeReview(db, T, SRC, 3, { status: R.STATUS.PASSED, findings: [], note: '30/30 clean', contentHash: HASH, checkedBy: 'sub-amara' });
    const card = await get();
    assert.strictEqual(card.review.tally, null);
    assert.deepStrictEqual(card.review.observed, []);
    assert.deepStrictEqual(card.review.reasons, []);
    assert.strictEqual(card.review.status, 'passed');
    assert.strictEqual(card.review.note, '30/30 clean');
  });

  H.summary();
})();
