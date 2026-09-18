/**
 * SHARING A SET PUBLICLY — admin/publish-question-set.js
 *
 * `docs/design/tenancy-redesign/05-share-review.html`: "Anyone using Engage will
 * be able to find this set, read every question in it, and copy it into their
 * own team."
 *
 * ── IT IS NOT `copy-question-set.js` REVERSED, AND AGENT REVIEW SAID SO ───
 *
 * The design claimed it was. Four differences say otherwise, and each one has a
 * test below because each one is a way to ship something that looks right:
 *
 *   1. The copy DESTROYS version history — `activeVersion: null, versions: []`
 *      — and lands in the unversioned legacy partition. Publish must do the
 *      opposite: a public set has versions, because re-sharing adds one.
 *   2. The copy does not refuse a name clash, it RENAMES (`teamretro` →
 *      `teamretro2`). For publish that is fatal: a re-share must land on the
 *      SAME public set as a new version, or every share spawns an orphan and
 *      "the library keeps serving v2" is unimplementable.
 *   3. The copy explicitly refuses an org source. Publish only takes one.
 *   4. Encryption runs the other way — org content is ciphertext, public
 *      content must be plaintext, or nobody can read it.
 *
 * ── AND THE GATE IS THE POINT ─────────────────────────────────────────────
 *
 * Only a version whose review PASSED may be published. `escalated` blocks;
 * `11-moderation.html` is a queue of sets "waiting for a person", not a
 * notification.
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let batchWrites = 0;

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': {
        const it = store.get(key(inp.Key.PK, inp.Key.SK));
        return { Item: it ? { ...it } : undefined };
      }
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'batchWrite': {
        batchWrites += 1;
        for (const reqs of Object.values(inp.RequestItems || {})) {
          for (const r of reqs) {
            if (r.PutRequest) {
              const it = r.PutRequest.Item;
              store.set(key(it.PK, it.SK), it);
            } else if (r.DeleteRequest) {
              store.delete(key(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
            }
          }
        }
        return { UnprocessedItems: {} };
      }
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const item = store.get(k) || { ...inp.Key };
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        for (const part of String(inp.UpdateExpression).replace(/^SET\s+/i, '').split(/,\s*/)) {
          const [lhs, rhs] = part.split(/\s*=\s*/);
          item[names[lhs] || lhs] = values[rhs];
        }
        store.set(k, item);
        return {};
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        // ddb-delete.js's collectPartitionKeys names its placeholder `:setpk`,
        // not `:pk` — accept either so a helper that queries a whole partition
        // for deletion works against this same fake.
        const pk = v[':setpk'] !== undefined ? v[':setpk'] : v[':pk'];
        const prefix = v[':sk'] || '';
        const items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

const { makeKmsStub, mintOrg, forgetAllOrgs, plainRow } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();

const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', {
    DynamoDBDocumentClient: { from: () => fakeDoc },
    PutCommand, GetCommand, QueryCommand, DeleteCommand, BatchWriteCommand, UpdateCommand,
  }],
  ['@aws-sdk/client-kms', kmsStub.exports],
]);
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

process.env.TABLE_NAME = 'engage-test';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';

const publish = require(path.join(REPO, 'lambda-functions/admin/publish-question-set.js')).handler;
const R = require(path.join(REPO, 'lambda-functions/admin/shared/set-review.js'));
const Pub = require(path.join(REPO, 'lambda-functions/admin/shared/publishable.js'));
const { publishSnapshot } = require(path.join(REPO, 'lambda-functions/admin/shared/publish-set.js'));

let pass = 0; let fail = 0;
const say = console.log;
async function check(name, fn) {
  try { await fn(); say(`  PASS  ${name}`); pass += 1; } catch (e) {
    say(`  FAIL  ${name}\n        ${e.message}`); fail += 1;
  }
}

const ORG = 'org_acme';
const SET = 'pricingmechanics';
const ORG_REF = { scope: 'org', orgId: ORG, setId: SET };
// publicSetId keeps only letters and digits of the org id, so `org_acme` -> `orgacme`.
const PUBLIC_REF = { scope: 'public', orgId: '', setId: 'orgacme-pricingmechanics' };

const owner = (body = {}) => ({
  requestContext: {
    http: { method: 'POST' },
    authorizer: {
      lambda: {
        username: 'amara', userId: 'sub-amara', groups: 'hosts', status: 'enabled',
        orgId: ORG, orgRole: 'owner', orgIds: ORG,
      },
    },
  },
  pathParameters: { setId: SET },
  body: JSON.stringify(body),
});

const parse = (res) => JSON.parse(res.body || '{}');

/** An org set at v2, with two questions and a category. */
async function seed({ reviewStatus = R.STATUS.PASSED } = {}) {
  store.clear();
  forgetAllOrgs();
  await mintOrg((item) => store.set(key(item.PK, item.SK), item), ORG);

  store.set(key(`ORG#${ORG}#SETS`, `SET#${SET}`), {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`,
    name: 'Pricing mechanics', description: 'How we price.',
    engagementType: 'call-and-answer', scope: 'org', orgId: ORG,
    promptId: 'p-pricing', personaId: 'coach',
    activeVersion: 2, versions: [{ version: 1 }, { version: 2 }],
    createdBy: 'sub-amara',
  });
  for (const [sk, extra] of [
    ['CATEGORY#c001', { Name: 'Pricing', QuestionCount: 2 }],
    ['QUESTION#q001', { Title: 'WHAT DID WE CHARGE', Detail: 'Say a number.' }],
    ['QUESTION#q002', { Title: 'WOULD WE AGAIN', Detail: 'Say why.' }],
  ]) {
    store.set(key(`ORG#${ORG}#SET#${SET}#v2`, sk), { PK: `ORG#${ORG}#SET#${SET}#v2`, SK: sk, ...extra });
  }
  if (reviewStatus !== R.STATUS.UNREVIEWED) {
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 2, { status: reviewStatus });
  }
}

const publicRows = () => [...store.values()].filter((i) => String(i.PK).startsWith('PUBLIC#'));
const publicMeta = () => publicRows().find((i) => i.PK === 'PUBLIC#SETS');

/** The hash `share()` would compute right now, from the live org-side rows —
 *  the same `buildSnapshot` + `contentHash` the handler itself calls. */
function currentHash() {
  const meta = store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`));
  const rows = [...store.values()].filter((i) => i.PK === `ORG#${ORG}#SET#${SET}#v2`);
  const categories = rows.filter((r) => String(r.SK).startsWith('CATEGORY#'));
  const questions = rows.filter((r) => String(r.SK).startsWith('QUESTION#'));
  return Pub.contentHash(Pub.buildSnapshot({ source: ORG_REF, version: 2, meta, categories, questions }));
}

/** The snapshot the handler would build from the live org rows, with the source
 *  version and the content hash overridable so the resume guard can be probed
 *  one condition at a time. */
function snapshotOf({ version = 2, contentHash } = {}) {
  const meta = store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`));
  const rows = [...store.values()].filter((i) => i.PK === `ORG#${ORG}#SET#${SET}#v2`);
  const snapshot = Pub.buildSnapshot({
    source: ORG_REF,
    version,
    meta,
    categories: rows.filter((r) => String(r.SK).startsWith('CATEGORY#')),
    questions: rows.filter((r) => String(r.SK).startsWith('QUESTION#')),
  });
  return { ...snapshot, contentHash: contentHash || Pub.contentHash(snapshot) };
}

(async () => {
  say('\npublishing a set\n');

  say('1. the gate');
  /*
    The whole point of per-version review. Anything other than `passed` keeps
    the set out of the library, and `escalated` in particular BLOCKS — it is not
    a notification that publishing went ahead.
  */
  for (const [status, label] of [
    [R.STATUS.UNREVIEWED, 'never checked'],
    [R.STATUS.CHECKING, 'still checking'],
    [R.STATUS.FLAGGED, 'flagged'],
    [R.STATUS.ESCALATED, 'escalated to a person'],
  ]) {
    // rejects: publishing content the check did not clear.
    await check(`a ${label} version is refused`, async () => {
      await seed({ reviewStatus: status });
      const res = await publish(owner({ version: 2 }));
      assert.notStrictEqual(res.statusCode, 201, `it published a ${label} version`);
      assert.deepStrictEqual(publicRows(), [], 'rows reached the public partition');
    });
  }
  await check('a passed version publishes', async () => {
    await seed();
    const res = await publish(owner({ version: 2 }));
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  say('\n1b. a passed review is checked against the LIVE content, not just its status [R25]');
  /*
    [R2] made the content hash a record on the review row rather than a gate,
    on the premise that publish always runs from the S3 snapshot. It does not
    (that read is Stage 2) — it rebuilds from the live org partition, and the
    set-level prose (name, description, …) is edited in place with no new
    version. So an edit after the passed review used to republish unjudged
    prose on a bare `POST /publish {version}`. Ruling R25: gate on the hash
    when the review row carries one; a passed row with none (the fixture
    above, and every pre-hash row) is unaffected.
  */
  await check('a passed review whose hash matches the live content publishes as today', async () => {
    await seed();
    const hash = currentHash();
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 2, { status: R.STATUS.PASSED, contentHash: hash });
    const res = await publish(owner({ version: 2 }));
    assert.strictEqual(res.statusCode, 201, res.body);
  });
  await check('editing the set after the passed review is refused, not silently republished', async () => {
    await seed();
    const hash = currentHash();
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 2, { status: R.STATUS.PASSED, contentHash: hash });
    // The prose edit `edit-question-set.js` makes in place — no new version,
    // so the gate above (which only reads `activeVersion`/review status) would
    // otherwise wave this straight through.
    const row = store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`));
    store.set(key(`ORG#${ORG}#SETS`, `SET#${SET}`), { ...row, description: 'A totally different pitch, written after the check passed.' });
    const res = await publish(owner({ version: 2 }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(parse(res).error, /changed since it was checked/);
    assert.strictEqual(parse(res).status, R.STATUS.PASSED);
    assert.deepStrictEqual(publicRows(), [], 'the edited, unjudged content reached the public partition');
  });
  await check('an older passed review with no recorded hash is unaffected by the gate', async () => {
    await seed(); // seed()'s writeReview carries no contentHash at all
    const row = store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`));
    store.set(key(`ORG#${ORG}#SETS`, `SET#${SET}`), { ...row, description: 'Edited after a pre-hash review.' });
    const res = await publish(owner({ version: 2 }));
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  say('\n2. what lands, and in what shape');
  // rejects: publishing into the unversioned legacy partition the way
  // copy-question-set.js does. A public set HAS versions — re-sharing adds one.
  await check('the public copy keeps a version history', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const meta = publicMeta();
    assert.ok(meta, 'no public metadata row');
    assert.strictEqual(meta.activeVersion, 1, 'the first public version is 1');
    assert.strictEqual(meta.versions.length, 1);
  });
  // rejects: counting every row copied as a question. The version partition
  // also holds its CATEGORY# rows and its REVIEW row, so this two-question set
  // was listed as four — in the set list (get-question-sets.js) and the version
  // list (get-set-versions.js) alike.
  await check('the version entry counts questions, not rows', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const [entry] = publicMeta().versions;
    assert.strictEqual(entry.questionCount, 2,
      `a two-question set was listed with ${entry.questionCount} questions`);
  });
  // rejects: leaving the REVIEW row behind along with the other rows that are
  // not questions. It is the verdict on exactly the rows copied, and without it
  // every public version reads as `unreviewed` in its own version list.
  await check('each public version carries its own review record', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const review = await R.readReview(fakeDoc, 'engage-test', PUBLIC_REF, 1);
    assert.strictEqual(review.status, R.STATUS.PASSED, `public v1 reads as ${review.status}`);
    assert.match(review.contentHash || '', /^[0-9a-f]{64}$/, 'the public review row carries no hash');
  });
  // rejects: leaving org ciphertext in a partition nobody can decrypt. Public
  // content is plaintext by design — encrypting it would make the shared
  // library unreadable, which is the same argument tenant-crypto.js makes.
  await check('questions arrive readable, not as ciphertext', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const q = publicRows().find((i) => String(i.SK).startsWith('QUESTION#'));
    assert.ok(q, 'no question reached the public partition');
    assert.strictEqual(q.Title, 'WHAT DID WE CHARGE',
      'the public copy is unreadable — it kept the org ciphertext');
  });
  // rejects: losing the Workie on the way out, when it is one every organisation
  // may read. The owner asked for exactly this: "if you copy it to public it
  // knows about the workie".
  await check('a PLATFORM Workie comes with it', async () => {
    await seed();
    store.set(key('AIPROMPTS', 'AIPROMPT#p-pricing'), { PK: 'AIPROMPTS', SK: 'AIPROMPT#p-pricing', name: 'Pricing coach' });
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().promptId, 'p-pricing');
    assert.strictEqual(publicMeta().personaId, 'coach');
    assert.notStrictEqual(publicMeta().promptDropped, true);
  });
  // rejects: shipping a public set that points at a Workie only one
  // organisation can read — every copy would hold a dangling reference (D5).
  await check('an ORG Workie is dropped from the public copy, and the drop is recorded', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().promptId, undefined, 'an org Workie reached the public copy');
    assert.strictEqual(publicMeta().promptDropped, true);
  });
  // rejects: a public row with no way back to who published it.
  await check('provenance records the source org, set and version', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const meta = publicMeta();
    assert.strictEqual(meta.sourceOrgId, ORG);
    assert.strictEqual(meta.sourceSetId, SET);
    assert.strictEqual(meta.sourceVersion, 2);
  });

  say('\n3. re-sharing adds a version, it does not spawn an orphan');
  /*
    copy-question-set.js renames on collision (`teamretro` -> `teamretro2`).
    Doing that here would break D1: "the public library keeps serving v2 until
    somebody deliberately shares again" is meaningless if each share creates a
    different set.
  */
  // rejects: freeSetId-style renaming, which is the copy handler's behaviour
  // and wrong for this one.
  await check('a second share lands on the SAME public set', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const first = publicMeta().SK;
    await R.writeReview(fakeDoc, 'engage-test', ORG_REF, 2, { status: R.STATUS.PASSED });
    const res = await publish(owner({ version: 2 }));
    assert.strictEqual(res.statusCode, 201, res.body);
    const metas = publicRows().filter((i) => i.PK === 'PUBLIC#SETS');
    assert.strictEqual(metas.length, 1, `re-sharing made ${metas.length} public sets`);
    assert.strictEqual(metas[0].SK, first, 'the id moved');
  });
  await check('and it becomes public version 2', async () => {
    assert.strictEqual(publicMeta().activeVersion, 2);
    assert.strictEqual(publicMeta().versions.length, 2);
  });
  // rejects: copying the source's PUBLISHED row. It records where the LAST
  // share went, so public v2 would carry a pointer to public v1.
  await check('a re-share leaves the PUBLISHED marker behind', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const res = await publish(owner({ version: 2 }));
    assert.strictEqual(res.statusCode, 201, res.body);
    const markers = publicRows().filter((i) => i.SK === 'PUBLISHED').map((i) => i.PK);
    assert.deepStrictEqual(markers, [], `a PUBLISHED row reached ${markers.join(', ')}`);
  });

  say('\n3b. `resume` converges on ONE publish, and only on that one');
  /*
    publishSnapshot's `resume` flag (Ruling R9, moderation-decide.js finishing a
    decision that crashed after this already ran) reuses the live public version
    instead of minting a new one — but ONLY when the public row records this
    exact publish: same source version, same content hash, same org and set.
    Those three conditions are the whole guard, and a guard whose negatives are
    untested is a guard that can be widened by accident into "a resume never
    bumps", which would silently merge a genuinely newer share into the version
    already live.

    Stage 1's ordinary re-share (section 3 above) is the other half of the
    contract and stays unaffected: without `resume` a second share of identical
    content is deliberately public v2.
  */
  await check('a resume of the SAME version and hash reuses the live public version', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().activeVersion, 1);
    const again = await publishSnapshot(fakeDoc, 'engage-test', snapshotOf(), { resume: true });
    assert.strictEqual(again.publicVersion, 1, 'a true resume minted a second public version');
    assert.strictEqual(publicMeta().activeVersion, 1);
    assert.strictEqual(publicMeta().versions.length, 1, 'a true resume pushed a duplicate versions[] entry');
  });
  // rejects: widening the guard to "resume means never bump". An older source
  // version arriving late is not the crashed publish of the version that is
  // live — it is a different share, and merging it into the live version would
  // quietly replace newer public content with older content under the same
  // version number.
  await check('but an OLDER source version still bumps, resume or not', async () => {
    await seed();
    await publish(owner({ version: 2 }));   // public v1 records sourceVersion 2
    const older = await publishSnapshot(fakeDoc, 'engage-test', snapshotOf({ version: 1 }), { resume: true });
    assert.strictEqual(older.publicVersion, 2, 'an older source version merged into the live public version');
    assert.strictEqual(publicMeta().activeVersion, 2);
    assert.strictEqual(publicMeta().sourceVersion, 1);
    assert.strictEqual(publicMeta().versions.length, 2);
  });
  // rejects: dropping the hash from the guard. The same version number can be
  // submitted twice with different content (set-level prose is edited in place
  // — see 1b), so version alone cannot identify a publish.
  await check('and the same version with a DIFFERENT hash still bumps', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const edited = await publishSnapshot(fakeDoc, 'engage-test', snapshotOf({ contentHash: 'd'.repeat(64) }), { resume: true });
    assert.strictEqual(edited.publicVersion, 2, 'edited content merged into the live public version');
    assert.strictEqual(publicMeta().activeVersion, 2);
    assert.strictEqual(publicMeta().contentHash, 'd'.repeat(64));
    assert.strictEqual(publicMeta().versions.length, 2);
  });

  say('\n4. who may do it');
  // rejects: any member publishing their org's content to the world. Copying IN
  // is a member's call; publishing OUT is not.
  await check('a plain member is refused', async () => {
    await seed();
    const ev = owner({ version: 2 });
    ev.requestContext.authorizer.lambda.orgRole = 'member';
    const res = await publish(ev);
    assert.strictEqual(res.statusCode, 403, `got ${res.statusCode}: ${res.body}`);
    assert.deepStrictEqual(publicRows(), []);
  });
  // rejects: publishing a set that is not yours by naming its id.
  await check('another org cannot publish this set', async () => {
    await seed();
    const ev = owner({ version: 2 });
    ev.requestContext.authorizer.lambda.orgId = 'org_globex';
    ev.requestContext.authorizer.lambda.orgIds = 'org_globex';
    const res = await publish(ev);
    assert.ok(res.statusCode >= 400, `got ${res.statusCode}`);
    assert.deepStrictEqual(publicRows(), []);
  });

  say('\n4b. what the copy records');
  await check('the public row names the source organisation, so 07 needs no extra read', async () => {
    await seed();
    store.set(key(`ORG#${ORG}`, 'METADATA'), { ...store.get(key(`ORG#${ORG}`, 'METADATA')), name: 'Acme Learning' });
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().sourceOrgName, 'Acme Learning');
    assert.match(publicMeta().contentHash || '', /^[0-9a-f]{64}$/, 'no content hash on the public row');
  });
  await check('the org row gets a share stamp and never leaks it into the public row', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const org = store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`));
    assert.strictEqual(org.share.status, 'published');
    assert.strictEqual(org.share.publicSetId, 'orgacme-pricingmechanics');
    assert.strictEqual(org.share.publicVersion, 1);
    // Re-share: NOW the org row carries a real stamp when share() re-reads it —
    // a freshly-seeded row has nothing to leak, so only this proves the guarantee.
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().share, undefined, 'the org stamp was copied onto the public row');
    assert.strictEqual(publicMeta().activeVersion, 2);
  });
  await check('publishing appends to the review log', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const log = [...store.values()].filter((i) => i.PK === `REVIEWLOG#org#${ORG}#${SET}`);
    assert.ok(log.some((e) => e.event === 'published' && e.publicVersion === 1), 'no published event');
  });

  say('\n5. unpublishing');
  // rejects: an unpublish that leaves the questions behind, readable by
  // everyone, while the library stops listing them.
  await check('DELETE removes the public rows', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    assert.ok(publicRows().length > 0);
    const ev = owner({});
    ev.requestContext.http.method = 'DELETE';
    const res = await publish(ev);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(publicRows(), [], 'public rows survived the unpublish');
  });
  await check('unpublishing deletes in batches, stamps the org row, and removes the PUBLISHED markers', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    await publish(owner({ version: 2 }));   // two public versions
    batchWrites = 0;
    const res = await publish({ ...owner(), requestContext: { ...owner().requestContext, http: { method: 'DELETE' } } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(publicRows(), []);
    assert.ok(batchWrites > 0, 'rows were deleted one DeleteCommand at a time');
    assert.strictEqual(store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`)).share.status, 'unpublished');
    assert.strictEqual(store.has(key(`ORG#${ORG}#SET#${SET}#v2`, 'PUBLISHED')), false, 'the PUBLISHED marker outlived the listing');
  });
  // rejects: an unpublish that reaches into the copies other teams made. The
  // copy handler already promises independence; this must not break it.
  await check('the org keeps its own set', async () => {
    assert.ok(store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`)), 'it deleted the source');
  });

  say(`\n${pass} passed, ${fail} failed`);
  Module._load = realLoad;
  process.exit(fail ? 1 : 0);
})();
