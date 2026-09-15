/**
 * A SET COPIED OUT OF THE PUBLIC LIBRARY STARTS UNREVIEWED — admin/copy-question-set.js
 *
 * `shared/set-review.js` exists so that "an approval of v2 must never be readable
 * as an approval of v3". Copying broke that from the side, in four steps that are
 * each correct on their own:
 *
 *   1. `share()` copies a version's REVIEW row into the public partition on
 *      purpose. It is that public version's own review record.
 *   2. `copy-question-set.js` copied EVERY row of the public version partition
 *      into the copying team's unversioned partition.
 *   3. There the REVIEW row sits exactly at `reviewKey(copy, null)`, which is the
 *      review key of a set that has no version.
 *   4. A publish with no `version` resolves such a set to that key, reads
 *      `passed`, and publishes. The team's own content check never ran.
 *
 * Public partitions written before 3b5010cd can also hold a PUBLISHED marker. It
 * records where the ORIGINAL team's version was shared, which says nothing true
 * about the copy.
 *
 * `shared/archive-snapshot.js` already leaves both rows out of a backup, for the
 * same reason: a verdict about a version in another library is not content.
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

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
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'];
        const prefix = v[':sk'] || '';
        const items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

const { makeKmsStub, mintOrg, forgetAllOrgs } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();

const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', {
    DynamoDBDocumentClient: { from: () => fakeDoc },
    PutCommand, GetCommand, QueryCommand, DeleteCommand, BatchWriteCommand,
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
const copySet = require(path.join(REPO, 'lambda-functions/admin/copy-question-set.js')).handler;
const R = require(path.join(REPO, 'lambda-functions/admin/shared/set-review.js'));
const { encryptItem } = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));

let pass = 0; let fail = 0;
const say = console.log;
async function check(name, fn) {
  try { await fn(); say(`  PASS  ${name}`); pass += 1; } catch (e) {
    say(`  FAIL  ${name}\n        ${e.message}`); fail += 1;
  }
}

const ACME = 'org_acme';        // publishes its set to the library
const GLOBEX = 'org_globex';    // copies it out again
const SET = 'pricingmechanics';
// publicSetId keeps only the letters and digits of the org id.
const PUBLIC_SET = 'orgacme-pricingmechanics';
const PUBLIC_V1 = `PUBLIC#SET#${PUBLIC_SET}#v1`;

const caller = (orgId, orgRole, setId, body) => ({
  requestContext: {
    http: { method: 'POST' },
    authorizer: {
      lambda: {
        username: `${orgRole}-${orgId}`, userId: `sub-${orgRole}-${orgId}`,
        groups: 'hosts', status: 'enabled', orgId, orgRole, orgIds: orgId,
      },
    },
  },
  pathParameters: { setId },
  body: JSON.stringify(body),
});

const parse = (res) => JSON.parse(res.body || '{}');
const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);
const publicKeys = () => [...store.keys()].filter((k) => k.startsWith('PUBLIC#')).sort();

/**
 * Acme's v2 passes its check and goes to the library as public v1. Globex, a
 * plain member, copies it. Returns the partition the copy landed in.
 */
async function copyAPassedPublicSet() {
  store.clear();
  forgetAllOrgs();
  await mintOrg((item) => store.set(key(item.PK, item.SK), item), ACME);
  await mintOrg((item) => store.set(key(item.PK, item.SK), item), GLOBEX);

  store.set(key(`ORG#${ACME}#SETS`, `SET#${SET}`), {
    PK: `ORG#${ACME}#SETS`, SK: `SET#${SET}`,
    name: 'Pricing mechanics', engagementType: 'call-and-answer', scope: 'org', orgId: ACME,
    activeVersion: 2, versions: [{ version: 1 }, { version: 2 }],
    createdBy: `sub-owner-${ACME}`,
  });
  const v2 = `ORG#${ACME}#SET#${SET}#v2`;
  store.set(key(v2, 'CATEGORY#c001'), { PK: v2, SK: 'CATEGORY#c001', Name: 'Pricing', QuestionCount: 2 });
  for (const [sk, Title] of [['QUESTION#q001', 'WHAT DID WE CHARGE'], ['QUESTION#q002', 'WOULD WE AGAIN']]) {
    // Stored the way upload-questions.js stores an org's questions: encrypted.
    store.set(key(v2, sk), await encryptItem(ACME, 'question', { PK: v2, SK: sk, Title, Detail: 'Say why.' }));
  }
  await R.writeReview(fakeDoc, 'engage-test', { scope: 'org', orgId: ACME, setId: SET }, 2, { status: R.STATUS.PASSED });

  const shared = await publish(caller(ACME, 'owner', SET, { version: 2 }));
  assert.strictEqual(shared.statusCode, 201, `the fixture could not publish Acme's set: ${shared.body}`);
  assert.ok(store.has(key(PUBLIC_V1, 'REVIEW')), 'the fixture expects public v1 to carry its review record');

  // A PUBLISHED marker, which a public partition written before 3b5010cd can
  // hold. It records where Acme's version was shared, not anything about a copy.
  store.set(key(PUBLIC_V1, 'PUBLISHED'), {
    PK: PUBLIC_V1, SK: 'PUBLISHED', publicSetId: PUBLIC_SET, publicVersion: 1, at: '2026-09-01T00:00:00.000Z',
  });
  // A row type this handler has never heard of. The copy promises to carry it.
  store.set(key(PUBLIC_V1, 'FUTURE#f001'), { PK: PUBLIC_V1, SK: 'FUTURE#f001', note: 'not invented yet' });

  const copied = await copySet(caller(GLOBEX, 'member', PUBLIC_SET, { scope: 'public' }));
  assert.strictEqual(copied.statusCode, 201, `Globex could not copy the public set: ${copied.body}`);
  const { setId } = parse(copied);
  return { setId, pk: `ORG#${GLOBEX}#SET#${setId}` };
}

(async () => {
  say('\na copy of a public set starts unreviewed\n');

  say('1. the verdict stays with the version it was given to');
  // rejects: copying the REVIEW row along with the content. It lands at the
  // copy's unversioned review key, where publish reads it as the copy's own.
  await check('the copy holds no REVIEW row', async () => {
    const { pk } = await copyAPassedPublicSet();
    assert.ok(!store.has(key(pk, 'REVIEW')), `the library's verdict was copied into ${pk}`);
  });
  // rejects: the same row, reached through the publish gate. A team must not be
  // able to share a copy that its own check never saw.
  await check('publishing the copy with no version is refused until it is checked', async () => {
    const { setId, pk } = await copyAPassedPublicSet();
    const before = publicKeys();
    const res = await publish(caller(GLOBEX, 'owner', setId, {}));
    assert.strictEqual(res.statusCode, 409, `the copy was published: ${res.statusCode} ${res.body}`);
    const body = parse(res);
    assert.strictEqual(body.error, 'This version has not passed the content check yet.');
    assert.strictEqual(body.status, 'unreviewed');
    assert.deepStrictEqual(publicKeys(), before, 'the refused publish still wrote to the public library');
    assert.deepStrictEqual(rowsIn(pk).filter((i) => ['REVIEW', 'PUBLISHED'].includes(i.SK)), [],
      'the refused publish left a lifecycle row on the copy');
  });
  // rejects: copying a stale PUBLISHED marker. It says where Acme's version was
  // shared, and would read as though Globex's copy had been.
  await check('the copy holds no PUBLISHED marker', async () => {
    const { pk } = await copyAPassedPublicSet();
    assert.ok(!store.has(key(pk, 'PUBLISHED')), `the library's PUBLISHED marker was copied into ${pk}`);
  });

  say('\n2. everything else still arrives');
  // rejects: fixing the lifecycle rows by narrowing the copy to the row types
  // known today. The handler promises a future row type is carried, not dropped.
  await check('questions, categories and an unknown row type are all copied', async () => {
    const { pk } = await copyAPassedPublicSet();
    const sks = rowsIn(pk).map((i) => i.SK);
    for (const sk of ['CATEGORY#c001', 'QUESTION#q001', 'QUESTION#q002', 'FUTURE#f001']) {
      assert.ok(sks.includes(sk), `${sk} did not reach the copy (it holds ${sks.sort().join(', ')})`);
    }
  });
  // rejects: a copy that is unpublishable for some other reason, which would
  // make the refusal above prove nothing about the review row.
  await check('once the team\'s own check passes, the copy may be published', async () => {
    const { setId } = await copyAPassedPublicSet();
    await R.writeReview(fakeDoc, 'engage-test', { scope: 'org', orgId: GLOBEX, setId }, null, { status: R.STATUS.PASSED });
    const res = await publish(caller(GLOBEX, 'owner', setId, {}));
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  say(`\n${pass} passed, ${fail} failed`);
  Module._load = realLoad;
  process.exit(fail ? 1 : 0);
})();
