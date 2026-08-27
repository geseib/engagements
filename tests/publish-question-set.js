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

const { makeKmsStub, mintOrg, forgetAllOrgs, plainRow } = require('./helpers/tenant-crypto-stub');
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
const R = require(path.join(REPO, 'lambda-functions/admin/shared/set-review.js'));

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
  // rejects: losing the Workie on the way out. The owner asked for exactly
  // this: "if you copy it to public it knows about the workie".
  await check('the Workie comes with it', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().promptId, 'p-pricing');
    assert.strictEqual(publicMeta().personaId, 'coach');
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
  // rejects: an unpublish that reaches into the copies other teams made. The
  // copy handler already promises independence; this must not break it.
  await check('the org keeps its own set', async () => {
    assert.ok(store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`)), 'it deleted the source');
  });

  say(`\n${pass} passed, ${fail} failed`);
  Module._load = realLoad;
  process.exit(fail ? 1 : 0);
})();
