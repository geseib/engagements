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
const COPY = 'org_acme-safety';
const COPYREF = { scope: 'public', orgId: '', setId: COPY };

/** Facts that belong to the reviewer, not to the author. Distinctive on purpose. */
const REVIEWER = 'dai-the-reviewer';
const SNAPSHOT = 'snapshots/org_acme/safety/v3.json';
const NOTICE = 'graphic-violence';

/**
 * The shelf the check would have filed this set on (admin/shared/
 * topic-suggestion.js). Unlike everything above it this is the AUTHOR's — it
 * exists to be offered to the person choosing a topic — so it travels with the
 * measurement rather than with the reviewer's facts.
 */
const SUGGESTION = {
  topic: 'health-medicine', tags: ['near-misses', 'site-safety'], filedAs: 'business-work', mismatch: true,
};

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
    topicSuggestion: SUGGESTION,
  });
}

/**
 * Engage's own shared set, checked — which `checkPlatformSet` now really does
 * (admin/check-question-set.js), so the outcome on this row is Engage's own
 * account of Engage's own library and every organisation can ask for it by id.
 */
async function seedHouse(status = R.STATUS.PASSED) {
  H.seedRow({
    ...V.setMetadataKey(HOUSEREF), name: 'Icebreakers', engagementType: 'poll',
    activeVersion: 1, questionCount: 12, versions: [{ version: 1, questionCount: 12 }],
  });
  await R.writeReview(db, T, HOUSEREF, 1, {
    status, findings: status === R.STATUS.PASSED ? [] : FINDINGS, note: '11/12 clean',
    reasons: ['guardrail'], tally: TALLY, observed: OBSERVED,
  });
}

/**
 * A PUBLIC copy: somebody else's published set, which `publishSnapshot` writes
 * a REVIEW row for carrying THAT organisation's findings and the Engage
 * reviewer's own sentence (admin/shared/publish-set.js). `readableScopes`
 * probes public for every caller, so a rival can ask for it by id.
 */
async function seedCopy() {
  H.seedRow({
    ...V.setMetadataKey(COPYREF), name: 'Safety', engagementType: 'trivia', scope: 'public', orgId: '',
    sourceOrgId: ORG, sourceSetId: SET, sourceVersion: 3,
    activeVersion: 1, questionCount: 30, versions: [{ version: 1, questionCount: 30 }],
  });
  await R.writeReview(db, T, COPYREF, 1, {
    status: R.STATUS.PASSED, findings: FINDINGS, note: 'Historical, not gratuitous.',
    reasons: ['guardrail'], tally: TALLY, observed: OBSERVED,
  });
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

  // rejects: the shelf the check proposed being written to a row nothing
  // renders. It is recorded for exactly one purpose — to be offered to the
  // person choosing a topic — and the set editor is where that person is.
  await H.test('the shelf the check proposed reaches the author who has to choose one', async () => {
    await seed();
    const [v2, v3] = parse(await ask(ev(ORG)));
    assert.deepStrictEqual(v3.reviewTopicSuggestion, SUGGESTION);
    assert.strictEqual(v2.reviewTopicSuggestion, null, 'a version nobody proposed a shelf for reads as though one had been');
  });

  // rejects: a proposal about somebody else's set reaching a reader. It names
  // the shelf the AUTHOR chose (`filedAs`) and disagrees with it, which is a
  // sentence about their judgement and belongs to the library it is in — the
  // same rule the measurement follows two cases below.
  await H.test('a reader who did not write the set is offered no proposal about it', async () => {
    await seed();
    await seedHouse(R.STATUS.FLAGGED);
    await R.writeReview(db, T, HOUSEREF, 1, {
      status: R.STATUS.FLAGGED, findings: FINDINGS, note: '11/12 clean', tally: TALLY, observed: OBSERVED,
      topicSuggestion: { ...SUGGESTION, topic: 'everyday-life' },
    });
    const res = await ask(H.orgEvent({ orgId: ORG, role: 'member', method: 'GET', setId: HOUSE }));
    const [v1] = parse(res);
    assert.ok(!('reviewTopicSuggestion' in v1), 'a reader who did not write the set is offered a proposal');
    assert.ok(!res.body.includes('everyday-life'), 'the proposal leaked to a reader of somebody else\'s library');
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
      'reviewTally', 'reviewTopicSuggestion', 'sourceFile', 'unfinished', 'version',
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
    ── THE WHOLE REVIEW ROW BELONGS TO THE LIBRARY IT IS IN ─────────────────

    The gate used to cover the measurement ALONE, and the four fields beside it
    — the status, the findings, the reasons and the note — went to every reader
    of the set. That was harmless only while nothing ever wrote a REVIEW row
    outside an organisation's own partition, and two writers now do:

      checkPlatformSet   Engage's internal check of Engage's own SHARED set.
                         Read by every signed-in customer, it disclosed Engage's
                         own finding — and the author banner rendered it to them
                         as a statement about THEIR content, which it is not.
      publishSnapshot    a public copy's row, which carries the SOURCE
                         organisation's per-question findings and the Engage
                         reviewer's own sentence. Read by any rival.

    So the rule is the row, not two fields of it: a reader who may not manage
    the library gets what they were owed BEFORE any of those rows existed.

      platform   nothing. Before `checkPlatformSet` there was no row, so
                 `unreviewed` is not a new silence — it is the unchanged one.
      public     the STATUS and nothing else. A copy is in the public library
                 BECAUSE it passed, so the status is already a public fact;
                 whose questions were seen, at what band, and what the reviewer
                 wrote about them are not.
  */
  await H.test('an organisation reading Engage\'s shared library is told nothing about Engage\'s own check', async () => {
    await seed();
    await seedHouse(R.STATUS.FLAGGED);
    const res = await ask(H.orgEvent({ orgId: ORG, role: 'member', method: 'GET', setId: HOUSE }));
    const [v1] = parse(res);
    assert.strictEqual(v1.review, 'unreviewed', 'Engage\'s own verdict on its own set reached a customer');
    assert.deepStrictEqual(v1.reviewFindings, []);
    assert.deepStrictEqual(v1.reasons, []);
    assert.strictEqual(v1.reviewNote, '');
    assert.strictEqual(v1.checkedAt, null);
    assert.strictEqual(v1.unfinished, false);
    assert.ok(!('reviewTally' in v1), 'a reader who did not write the set is offered a measurement');
    assert.ok(!('reviewObserved' in v1), 'a reader who did not write the set is offered observations');
    for (const leak of ['VIOLENCE', 'guardrail', '11/12 clean', 'The injury']) {
      assert.ok(!res.body.includes(leak), `Engage's own check leaked ${JSON.stringify(leak)} to a customer`);
    }
  });

  // rejects: a check still running on one of Engage's sets reading, to a
  // customer, as a check running on theirs.
  await H.test('a check running on Engage\'s own set is not reported to a customer either', async () => {
    await seed();
    H.seedRow({
      ...V.setMetadataKey(HOUSEREF), name: 'Icebreakers', engagementType: 'poll',
      activeVersion: 1, questionCount: 12, versions: [{ version: 1, questionCount: 12 }],
    });
    await R.writeReview(db, T, HOUSEREF, 1, { status: R.STATUS.CHECKING, checkedAt: '2020-01-01T00:00:00.000Z' });
    const [v1] = parse(await ask(H.orgEvent({ orgId: ORG, role: 'member', method: 'GET', setId: HOUSE })));
    assert.strictEqual(v1.review, 'unreviewed');
    assert.strictEqual(v1.unfinished, false, 'a customer was told Engage\'s check did not finish');
  });

  await H.test('Engage acting as Engage is told what the check measured on Engage\'s own set', async () => {
    await seed();
    await seedHouse(R.STATUS.FLAGGED);
    const [v1] = parse(await ask(H.platformEvent({ method: 'GET', path: { setId: HOUSE } })));
    assert.strictEqual(v1.review, 'flagged');
    assert.deepStrictEqual(v1.reviewFindings, FINDINGS);
    assert.strictEqual(v1.reviewNote, '11/12 clean');
    assert.deepStrictEqual(v1.reviewTally, TALLY);
    assert.deepStrictEqual(v1.reviewObserved, OBSERVED);
  });

  // rejects: one organisation's questions, bands and model-written sentences —
  // and the Engage reviewer's own note about them — reaching a rival through
  // the public copy, which `readableScopes` lets everybody ask for by id.
  await H.test('a public copy tells a reader it passed, and nothing about whose set it was', async () => {
    await seed();
    await seedCopy();
    for (const caller of [H.orgEvent({ orgId: RIVAL, role: 'member', method: 'GET', setId: COPY }),
      H.orgEvent({ orgId: ORG, role: 'owner', method: 'GET', setId: COPY }),
      H.platformEvent({ method: 'GET', path: { setId: COPY } })]) {
      const res = await ask(caller); // eslint-disable-line no-await-in-loop
      const [v1] = parse(res);
      assert.strictEqual(v1.review, 'passed', 'a copy in the public library still reads as checked');
      assert.deepStrictEqual(v1.reviewFindings, [], 'the source organisation\'s findings reached a reader of the copy');
      assert.strictEqual(v1.reviewNote, '', 'the reviewer\'s own sentence reached a reader of the copy');
      assert.deepStrictEqual(v1.reasons, []);
      assert.ok(!('reviewTally' in v1));
      for (const leak of ['Historical', 'VIOLENCE', 'The injury']) {
        assert.ok(!res.body.includes(leak), `the public copy leaked ${JSON.stringify(leak)}`);
      }
    }
  });

  // rejects: the gate growing a hole by a field being ADDED to the projection
  // above it. The shape a non-manager gets is a whitelist too.
  await H.test('the shape a reader outside the library gets is fixed, and holds no review facts', async () => {
    await seed();
    await seedHouse(R.STATUS.FLAGGED);
    const [v1] = parse(await ask(H.orgEvent({ orgId: ORG, role: 'member', method: 'GET', setId: HOUSE })));
    assert.deepStrictEqual(Object.keys(v1).sort(), [
      'categoryCount', 'checkedAt', 'createdAt', 'isActive', 'note', 'pinnedByGames', 'published',
      'questionCount', 'reasons', 'review', 'reviewFindings', 'reviewNote', 'sourceFile',
      'unfinished', 'version',
    ]);
  });

  H.summary();
})();
