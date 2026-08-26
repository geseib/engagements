/**
 * PER-VERSION REVIEW STATE — admin/shared/set-review.js
 *
 * The owner: *"i think the tagging should be per version, and the
 * checks/moderations have to be per version as well."*
 *
 * The property this exists to guarantee, in one sentence: **an approval of v2
 * can never be read as an approval of v3.** Everything below is that sentence
 * tested from a different angle.
 *
 * ── WHY THIS IS A ROW AND NOT A FIELD ON `versions[]` ─────────────────────
 *
 * The first design put `review` inside the `versions[]` array on the set's
 * metadata row. Agent review found that unsafe, and it is worth keeping the
 * reason here because the array is the obvious place and somebody will propose
 * it again:
 *
 *   `admin/delete-set-version.js:159` rewrites the WHOLE array
 *   (`SET #versions = :versions`) from a copy read earlier, guarded only on
 *   `activeVersion`. Removing an element SHIFTS every later index. So a worker
 *   that resolved "v3 is versions[2]" before a concurrent delete would stamp
 *   `versions[2].review = passed` onto a DIFFERENT VERSION afterwards.
 *
 * That is an approval laundering a later edit — the exact defect per-version
 * state exists to prevent, reintroduced by the storage shape chosen to prevent
 * it. A row keyed by the version NUMBER cannot shift and has one writer.
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');

// ---- stub the SDK before the module loads ---------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let failNextPut = false;

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }

function conditionFailed() {
  const e = new Error('ConditionalCheckFailedException');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'put') {
      if (failNextPut) { failNextPut = false; throw conditionFailed(); }
      store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
      return {};
    }
    if (cmd.type === 'get') {
      const item = store.get(key(inp.Key.PK, inp.Key.SK));
      return { Item: item ? { ...item } : undefined };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const items = [...store.values()].filter((i) => i.PK === v[':pk']);
      return { Items: items, Count: items.length };
    }
    return {};
  },
};

const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', {
    DynamoDBDocumentClient: { from: () => fakeDoc },
    PutCommand, GetCommand, QueryCommand,
  }],
]);
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

process.env.TABLE_NAME = 'engage-test';

const R = require(path.join(REPO, 'lambda-functions/admin/shared/set-review.js'));

let pass = 0; let fail = 0;
const say = console.log;
function check(name, fn) {
  try { fn(); say(`  PASS  ${name}`); pass += 1; } catch (e) {
    say(`  FAIL  ${name}\n        ${e.message}`); fail += 1;
  }
}
async function checkAsync(name, fn) {
  try { await fn(); say(`  PASS  ${name}`); pass += 1; } catch (e) {
    say(`  FAIL  ${name}\n        ${e.message}`); fail += 1;
  }
}

const ORG_REF = { scope: 'org', orgId: 'org_acme', setId: 'teamretro' };
const PLAT_REF = { scope: 'platform', setId: '80strivia' };

(async () => {
  say('\nper-version review state\n');

  // ---------------------------------------------------------------- keys --
  say('1. the key is the version, so it cannot shift');
  check('the review row lives in the VERSION\'s own content partition', () => {
    const k = R.reviewKey(ORG_REF, 2);
    assert.strictEqual(k.PK, 'ORG#org_acme#SET#teamretro#v2');
    assert.strictEqual(k.SK, 'REVIEW');
  });
  // rejects: one scope's review state being read for another's set of the same
  // name — `teamretro` names a different set in every library.
  check('two scopes with one slug get different rows', () => {
    assert.notStrictEqual(
      R.reviewKey(ORG_REF, 2).PK,
      R.reviewKey({ ...ORG_REF, scope: 'platform', orgId: '' }, 2).PK,
    );
  });
  // rejects: collapsing versions onto one row, which is the whole defect.
  check('two versions of one set get different rows', () => {
    assert.notStrictEqual(R.reviewKey(ORG_REF, 2).PK, R.reviewKey(ORG_REF, 3).PK);
  });
  check('published state is a sibling row, not a second field', () => {
    assert.strictEqual(R.publishedKey(ORG_REF, 2).SK, 'PUBLISHED');
    assert.strictEqual(R.publishedKey(ORG_REF, 2).PK, R.reviewKey(ORG_REF, 2).PK);
  });

  // ------------------------------------------------------------ defaults --
  say('\n2. a version nobody has checked');
  await checkAsync('reads as unreviewed rather than as absent', async () => {
    store.clear();
    const r = await R.readReview(fakeDoc, 'engage-test', ORG_REF, 7);
    assert.strictEqual(r.status, R.STATUS.UNREVIEWED);
    assert.strictEqual(r.version, 7);
  });
  /*
    THE PROPERTY THIS FILE EXISTS FOR. A brand-new version has no row, and the
    absence must read as "not checked" rather than as anything else — least of
    all as the previous version's answer.
  */
  // rejects: an approval of v2 being visible from v3.
  await checkAsync('a passed v2 does not make v3 look passed', async () => {
    store.clear();
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 2, { status: R.STATUS.PASSED });
    const three = await R.readReview(fakeDoc, 'engage-test', ORG_REF, 3);
    assert.strictEqual(three.status, R.STATUS.UNREVIEWED,
      'v3 inherited v2\'s approval');
  });

  // -------------------------------------------------------------- writes --
  say('\n3. writing an outcome');
  await checkAsync('a status round-trips with its findings', async () => {
    store.clear();
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 2, {
      status: R.STATUS.FLAGGED,
      jobId: 'job-1',
      findings: [{ questionId: 'c001#014', category: 'violence', band: 'HIGH' }],
    });
    const r = await R.readReview(fakeDoc, 'engage-test', ORG_REF, 2);
    assert.strictEqual(r.status, R.STATUS.FLAGGED);
    assert.strictEqual(r.jobId, 'job-1');
    assert.strictEqual(r.findings.length, 1);
    assert.strictEqual(r.findings[0].questionId, 'c001#014');
    assert.ok(r.checkedAt, 'no checkedAt was stamped');
  });
  // rejects: a status the state machine does not define reaching the store,
  // where every reader would then have to defend against it.
  await checkAsync('an unknown status is refused', async () => {
    store.clear();
    await assert.rejects(
      () => R.writeReview(fakeDoc, 'engage-test', ORG_REF, 2, { status: 'approved' }),
      /status/i,
    );
  });

  // ------------------------------------------------------- the four ends --
  say('\n4. the four outcomes the mockups promise');
  /*
    05-share-review.html states three, and 06-share-rejected.html adds the
    fourth: "Ask for a human review". A two-state enum cannot express either the
    escalation or the appeal, and the first draft of the spec had exactly that.
  */
  // rejects: dropping escalate or appeal, which are the two the automated
  // check cannot resolve on its own.
  check('escalated and appealed both exist', () => {
    for (const s of ['UNREVIEWED', 'CHECKING', 'PASSED', 'FLAGGED', 'ESCALATED', 'APPEALED']) {
      assert.ok(R.STATUS[s], `${s} is missing from the state machine`);
    }
  });
  // rejects: treating escalated as a pass. It blocks — 11-moderation.html:
  // "5 sets the automated check would not decide on its own … Waiting for a person."
  check('only PASSED may publish', () => {
    assert.strictEqual(R.mayPublish({ status: R.STATUS.PASSED }), true);
    for (const s of ['UNREVIEWED', 'CHECKING', 'FLAGGED', 'ESCALATED', 'APPEALED']) {
      assert.strictEqual(R.mayPublish({ status: R.STATUS[s] }), false,
        `${s} was allowed to publish`);
    }
  });
  check('a missing review may not publish', () => {
    assert.strictEqual(R.mayPublish(null), false);
    assert.strictEqual(R.mayPublish(undefined), false);
    assert.strictEqual(R.mayPublish({}), false);
  });

  // ------------------------------------------------------------ the list --
  say('\n5. reading many at once, for the version list');
  await checkAsync('every version answers, including the ones with no row', async () => {
    store.clear();
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 1, { status: R.STATUS.PASSED });
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 3, { status: R.STATUS.FLAGGED });
    const map = await R.readReviews(fakeDoc, 'engage-test', ORG_REF, [1, 2, 3]);
    assert.strictEqual(map.get(1).status, R.STATUS.PASSED);
    assert.strictEqual(map.get(2).status, R.STATUS.UNREVIEWED, 'the gap did not default');
    assert.strictEqual(map.get(3).status, R.STATUS.FLAGGED);
  });
  await checkAsync('an empty version list is not an error', async () => {
    store.clear();
    const map = await R.readReviews(fakeDoc, 'engage-test', ORG_REF, []);
    assert.strictEqual(map.size, 0);
  });

  // -------------------------------------------------------------- legacy --
  say('\n6. sets that predate versioning');
  /*
    A set that has never been versioned resolves to the LEGACY partition, whose
    key carries no `#v` suffix. It still needs a review row, and it must not
    collide with v1's.
  */
  // rejects: a null version silently becoming version 1's row.
  check('an unversioned set gets its own row, distinct from v1', () => {
    const legacy = R.reviewKey(PLAT_REF, null);
    assert.strictEqual(legacy.PK, 'SET#80strivia');
    assert.notStrictEqual(legacy.PK, R.reviewKey(PLAT_REF, 1).PK);
  });

  say(`\n${pass} passed, ${fail} failed`);
  Module._load = realLoad;
  process.exit(fail ? 1 : 0);
})();
