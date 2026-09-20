// tests/author-measurement.js
/**
 * WHAT THE CHECK MEASURED, READ BY THE ORGANISATION THAT WROTE THE SET —
 * GET /admin/question-sets/{setId}/versions (admin/get-set-versions.js).
 *
 * The owner: an author gets a status and a sentence, and "Violence: LOW on 11
 * of 30 questions" answers "why was mine held?" in a way a sentence cannot. So
 * the version list carries the same MEASUREMENT the staff score card carries —
 * `review.tally` and `review.observed` (admin/shared/review-card.js, one
 * projection, used by both) — and nothing else the card holds.
 *
 * THE BOUNDARY IS THE POINT, and it is a whitelist on both axes:
 *
 *   WHO   the scope the row is really in, asked of tenant.canManageScope. An
 *         organisation's own library, to its own members. Engage's shared
 *         library, to Engage acting as Engage. A public copy, to nobody here.
 *         Another organisation's set is ABSENT rather than forbidden, because
 *         findSetForCaller never probes their partition.
 *   WHAT  the measurement and the decision note the author already receives.
 *         Never the reviewer, when they decided, the notices they attached,
 *         or the snapshot key — every one of those is on the same row, and
 *         every one of them is staff's.
 *
 * NO QUESTION TEXT, deliberately, and this is the one place the author's view
 * is thinner than the card's rather than merely narrower. The card names each
 * observation by its question's text because staff have no other way to see the
 * question: they cannot decrypt an organisation's rows, so the card reads the
 * PUBLIC copy. The author's rows are encrypted too, and this function has no
 * kms:Decrypt (tests/kms-grants-match-code.js would fail the moment it reached
 * tenant-crypto, and granting it is a template change). It does not need one —
 * the surface that renders this IS the set editor, which is already holding the
 * plaintext questions these ids name.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const versions = require(path.join(H.REPO, 'lambda-functions/admin/get-set-versions.js')).handler;

const ORG = 'org_acme';
const RIVAL = 'org_rival';
const SET = 'safety';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const HOUSE = 'icebreakers';
const HOUSEREF = { scope: 'platform', orgId: '', setId: HOUSE };

/** Facts that belong to the reviewer, not to the author. Distinctive on purpose. */
const REVIEWER = 'dai-the-reviewer';
const SNAPSHOT = 'snapshots/org_acme/safety/v3.json';
const NOTICE = 'graphic-violence';

const NONE_SEEN = { worst: null, low: 0, medium: 0, high: 0 };
const TALLY = {
  scope: 'full',
  questions: 30,
  setTextChecked: true,
  setTextUnread: false,
  spotless: 19,
  unread: 0,
  categories: {
    VIOLENCE: { worst: 'LOW', low: 11, medium: 0, high: 0 },
    SEXUAL: NONE_SEEN,
    HATE: NONE_SEEN,
    INSULTS: NONE_SEEN,
    MISCONDUCT: NONE_SEEN,
  },
};
const OBSERVED = [
  { questionId: 'c001#014', category: 'VIOLENCE', band: 'LOW', intervened: true, explanation: 'The injury is described rather than named.' },
  { questionId: '(set)', category: 'VIOLENCE', band: 'LOW', intervened: false },
];
const FINDINGS = [
  { questionId: 'c001#014', category: 'VIOLENCE', band: 'LOW', explanation: 'The injury is described rather than named.' },
];

const parse = (res) => JSON.parse(res.body || '{}');
const ev = (orgId, { role = 'member', groups = 'hosts', scope, ...rest } = {}) => {
  const event = H.orgEvent({ orgId, role, groups, method: 'GET', setId: SET, ...rest });
  if (scope) event.queryStringParameters = { scope };
  return event;
};
const ask = async (event) => versions(event, H.ctx());

/**
 * The organisation's set as the editor leaves it: v2 checked before measuring
 * existed, v3 flagged by a check that measured and then ruled on by a person —
 * so the row carries the reviewer's own facts beside the author's.
 */
async function seed() {
  H.reset();
  H.seedRow(await C.encryptItem(ORG, 'set', {
    ...V.setMetadataKey(SRC), name: 'Safety', description: 'Near misses.', engagementType: 'trivia', scope: 'org', orgId: ORG,
    activeVersion: 3, questionCount: 30,
    versions: [{ version: 2, questionCount: 28 }, { version: 3, questionCount: 30 }],
  }));
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, findings: [], note: '28/28 clean' });
  await R.writeReview(db, T, SRC, 3, {
    status: R.STATUS.FLAGGED, findings: FINDINGS, note: '19/30 clean', reasons: ['guardrail'],
    tally: TALLY, observed: OBSERVED, snapshotKey: SNAPSHOT, declaredNotice: [NOTICE],
    reviewer: REVIEWER, decidedAt: '2026-09-18T09:55:00.000Z', notice: [NOTICE],
  });
}

/** Engage's own shared set, checked. Nothing checks one yet; the rule is the point. */
async function seedHouse() {
  H.seedRow({
    ...V.setMetadataKey(HOUSEREF), name: 'Icebreakers', engagementType: 'poll',
    activeVersion: 1, questionCount: 12, versions: [{ version: 1, questionCount: 12 }],
  });
  await R.writeReview(db, T, HOUSEREF, 1, { status: R.STATUS.PASSED, findings: [], note: '12/12 clean', tally: TALLY, observed: OBSERVED });
}

(async () => {
  console.log('\nwhat the check measured, on an organisation\'s own set\n');

  // rejects: the author being left with a status and a sentence — the version
  // list carrying `review` and `reviewFindings` and nothing that says how much
  // of the set was seen, or at what band.
  await H.test('the owning organisation is told what the check measured, version by version', async () => {
    await seed();
    const [v2, v3] = parse(await ask(ev(ORG)));
    assert.deepStrictEqual(v3.reviewTally, TALLY);
    assert.deepStrictEqual(v3.reviewObserved, OBSERVED);
    assert.strictEqual(v2.reviewTally, null, 'a version checked before measuring existed must not read as "measured, nothing seen"');
    assert.deepStrictEqual(v2.reviewObserved, []);
  });

  // rejects: naming another organisation's set, by id or by scope, and being
  // answered with anything at all.
  await H.test('another organisation gets nothing, and cannot name its way in', async () => {
    await seed();
    for (const named of [undefined, 'org', 'platform', 'public']) {
      const res = await ask(ev(RIVAL, { scope: named })); // eslint-disable-line no-await-in-loop
      assert.strictEqual(res.statusCode, 404, `scope=${named} answered ${res.statusCode}: ${res.body}`);
      assert.ok(!res.body.includes('VIOLENCE'), `scope=${named} leaked the measurement`);
    }
  });

  // rejects: staff standing inside a customer's organisation being handed more
  // than the customer, because they also hold the `admins` group.
  await H.test('a platform admin standing inside an organisation gets exactly that organisation\'s view', async () => {
    await seed();
    const asMember = parse(await ask(ev(ORG)));
    const asStaff = parse(await ask(ev(ORG, { groups: 'admins,hosts' })));
    assert.deepStrictEqual(asStaff, asMember, 'the admins group changed what the organisation is shown');
  });

  // rejects: the reviewer, when they ruled, the notices they attached or the
  // snapshot key riding along on a row the author reads. Every one of them is
  // on the REVIEW row this projection is built from.
  await H.test('no reviewer, no staff decision and no snapshot key reaches the author', async () => {
    await seed();
    const body = (await ask(ev(ORG))).body;
    for (const secret of [REVIEWER, SNAPSHOT, NOTICE, 'reviewer', 'decidedAt', 'snapshotKey', 'transitionedAt']) {
      assert.ok(!body.includes(secret), `the author's response carries ${JSON.stringify(secret)}`);
    }
    // The note the author already receives is theirs and stays.
    assert.strictEqual(parse({ body }).find((v) => v.version === 3).reviewNote, '19/30 clean');
  });

  // rejects: a version nobody checked inventing a measurement, or an empty one
  // reading as a clean sweep.
  await H.test('a version nobody has checked says so, and measures nothing', async () => {
    H.reset();
    H.seedRow(await C.encryptItem(ORG, 'set', {
      ...V.setMetadataKey(SRC), name: 'Safety', engagementType: 'trivia', scope: 'org', orgId: ORG,
      activeVersion: 1, questionCount: 4, versions: [{ version: 1, questionCount: 4 }],
    }));
    const [v1] = parse(await ask(ev(ORG)));
    assert.strictEqual(v1.review, 'unreviewed');
    assert.strictEqual(v1.reviewTally, null);
    assert.deepStrictEqual(v1.reviewObserved, []);
  });

  // rejects: a set shared before versioning existed throwing, or its review —
  // which really does sit in the unsuffixed partition — being smuggled onto a
  // version list that has no versions to hang it on.
  await H.test('a set that has never been versioned still answers with an empty list', async () => {
    H.reset();
    H.seedRow(await C.encryptItem(ORG, 'set', {
      ...V.setMetadataKey(SRC), name: 'Safety', engagementType: 'trivia', scope: 'org', orgId: ORG, questionCount: 11,
    }));
    await R.writeReview(db, T, SRC, null, { status: R.STATUS.PASSED, findings: [], note: '11/11 clean', tally: TALLY, observed: OBSERVED });
    const res = await ask(ev(ORG));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), []);
  });

  // rejects: a new field arriving by widening the row — the banner and
  // normalizeVersions read this shape by name, and a renamed or dropped field
  // is a blank banner nobody notices.
  await H.test('every field the author\'s banner already reads is unchanged, and the measurement is beside them', async () => {
    await seed();
    const v3 = parse(await ask(ev(ORG))).find((v) => v.version === 3);
    assert.deepStrictEqual(Object.keys(v3).sort(), [
      'categoryCount', 'checkedAt', 'createdAt', 'isActive', 'note', 'pinnedByGames', 'published',
      'questionCount', 'reasons', 'review', 'reviewFindings', 'reviewNote', 'reviewObserved',
      'reviewTally', 'sourceFile', 'unfinished', 'version',
    ]);
    assert.strictEqual(v3.review, 'flagged', 'review is still the status STRING the banner switches on');
    assert.deepStrictEqual(v3.reviewFindings, FINDINGS, 'findings keep their meaning and their rows');
    assert.strictEqual(v3.reviewNote, '19/30 clean');
    assert.deepStrictEqual(v3.reasons, ['guardrail']);
    assert.strictEqual(v3.unfinished, false);
    assert.strictEqual(v3.published, null);
    assert.strictEqual(v3.isActive, true);
  });

  /*
    ENGAGE'S OWN LIBRARY IS READ BY EVERYBODY AND AUTHORED BY ENGAGE.

    The scope the row is really in decides, so the same rule that hands an
    organisation its own measurement hands Engage its own — and hands an
    organisation reading the shared library nothing, which is what a reader who
    did not write the set is owed. Nothing checks a platform set yet; the rule
    is what this pins.
  */
  await H.test('an organisation reading Engage\'s shared library is not even told the fields exist', async () => {
    await seed();
    await seedHouse();
    const e = H.orgEvent({ orgId: ORG, role: 'member', method: 'GET', setId: HOUSE });
    const [v1] = parse(await ask(e));
    assert.strictEqual(v1.review, 'passed', 'the status is public to every reader, as it was');
    assert.ok(!('reviewTally' in v1), 'a reader who did not write the set is offered a measurement');
    assert.ok(!('reviewObserved' in v1), 'a reader who did not write the set is offered observations');
  });
  await H.test('Engage acting as Engage is told what the check measured on Engage\'s own set', async () => {
    await seed();
    await seedHouse();
    const [v1] = parse(await ask(H.platformEvent({ method: 'GET', path: { setId: HOUSE } })));
    assert.deepStrictEqual(v1.reviewTally, TALLY);
    assert.deepStrictEqual(v1.reviewObserved, OBSERVED);
  });

  H.summary();
})();
