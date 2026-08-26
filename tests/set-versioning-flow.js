/**
 * Question-set VERSIONING regression tests.
 *
 * Runs the REAL handlers against a stubbed DynamoDB document client:
 *   admin/upload-questions.js        (replace -> new version)
 *   admin/get-set-versions.js        (GET  .../versions)
 *   admin/promote-set-version.js     (POST .../versions/{n}/promote)
 *   admin/delete-set-version.js      (DELETE .../versions/{n})
 *   admin/delete-question-set.js     (whole set, every version)
 *   admin/download-question-set.js   (exports the resolved version)
 *   game/get-question.js             (a pinned game keeps reading its version)
 *   game/get-categories.js
 *   websocket/schema-compliant-manager.js  (createGame pins the version)
 *   admin/shared/set-version.js      (the resolver itself)
 *
 * Stubbing follows tests/import-questions-flow.js: hook Module._load BY MODULE
 * NAME, because several @aws-sdk packages only exist in the deployed bundle and
 * cannot be resolved from the repo root at all.
 *
 * What these tests pin down:
 *   - a legacy set with NO version anywhere still resolves (migration safety)
 *   - a game pinned to v1 still reads v1 after the set is replaced — the whole
 *     point of the design
 *   - resolution order is pin > activeVersion > legacy, in that order
 *   - a validation failure writes nothing and leaves activeVersion untouched
 *   - deleting the active version is refused
 *   - deleting a pinned version warns and NAMES the games before doing anything
 *   - replace preserves promptId, personaId, instructions and roundNoun
 *   - CSV image filenames become set-scoped media keys, per-SET not per-version
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before any handler loads -----------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';

const store = new Map();          // "PK|SK" -> Item
const log = [];
let failNextWrite = null;

function resetDb() { store.clear(); log.length = 0; failNextWrite = null; }
const k = (item) => `${item.PK}|${item.SK}`;

// ---- A small, honest UpdateExpression evaluator ----------------------------
// Only the forms these handlers actually use: SET with plain values,
// list_append, if_not_exists; conditions with attribute_not_exists, <>, OR.
function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

function evalOperand(expr, item, vals, names) {
  expr = expr.trim();
  let m = /^list_append\((.*)\)$/s.exec(expr);
  if (m) {
    const [a, b] = splitTopLevel(m[1], ',');
    const left = evalOperand(a, item, vals, names);
    const right = evalOperand(b, item, vals, names);
    return [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
  }
  m = /^if_not_exists\((.*)\)$/s.exec(expr);
  if (m) {
    const [attrRaw, fallback] = splitTopLevel(m[1], ',');
    const attr = names[attrRaw.trim()] || attrRaw.trim();
    return item[attr] !== undefined ? item[attr] : evalOperand(fallback, item, vals, names);
  }
  if (expr.startsWith(':')) return vals[expr];
  if (expr.startsWith('#')) return item[names[expr]];
  return item[expr];
}

function evalCondition(cond, item, vals, names) {
  if (!cond) return true;
  for (const part of cond.split(/\s+OR\s+/i)) {
    if (part.split(/\s+AND\s+/i).every((c) => evalSimpleCondition(c.trim(), item, vals, names))) return true;
  }
  return false;
}

function evalSimpleCondition(c, item, vals, names) {
  let m = /^attribute_not_exists\(\s*([^)]+)\s*\)$/.exec(c);
  if (m) {
    const attr = names[m[1].trim()] || m[1].trim();
    return item[attr] === undefined;
  }
  m = /^(\S+)\s*<>\s*(\S+)$/.exec(c);
  if (m) return evalOperand(m[1], item, vals, names) !== evalOperand(m[2], item, vals, names);
  m = /^(\S+)\s*=\s*(\S+)$/.exec(c);
  if (m) return evalOperand(m[1], item, vals, names) === evalOperand(m[2], item, vals, names);
  throw new Error(`test harness cannot evaluate condition: ${c}`);
}

function applyUpdate(inp) {
  const key = `${inp.Key.PK}|${inp.Key.SK}`;
  const item = { ...(store.get(key) || { ...inp.Key }) };
  const vals = inp.ExpressionAttributeValues || {};
  const names = inp.ExpressionAttributeNames || {};

  if (!evalCondition(inp.ConditionExpression, item, vals, names)) {
    const err = new Error('The conditional request failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }

  const expr = String(inp.UpdateExpression || '');
  const setPart = /(?:^|\s)SET\s+(.*?)(?:\s+REMOVE\s+|$)/is.exec(expr);
  if (setPart) {
    for (const assign of splitTopLevel(setPart[1], ',')) {
      const eq = assign.indexOf('=');
      const lhsRaw = assign.slice(0, eq).trim();
      const lhs = names[lhsRaw] || lhsRaw;
      item[lhs] = evalOperand(assign.slice(eq + 1), item, vals, names);
    }
  }
  const removePart = /(?:^|\s)REMOVE\s+(.*)$/is.exec(expr);
  if (removePart) {
    for (const attrRaw of splitTopLevel(removePart[1], ',')) {
      delete item[names[attrRaw] || attrRaw];
    }
  }
  store.set(key, item);
  return {};
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });

    if (cmd.type === 'get') return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    if (cmd.type === 'put') {
      if (failNextWrite && failNextWrite(inp.Item)) throw new Error('simulated Dynamo failure');
      store.set(k(inp.Item), inp.Item);
      return {};
    }
    if (cmd.type === 'delete') { store.delete(`${inp.Key.PK}|${inp.Key.SK}`); return {}; }
    if (cmd.type === 'update') return applyUpdate(inp);
    if (cmd.type === 'batchWrite') {
      const reqs = inp.RequestItems[TABLE] || [];
      if (reqs.length > 25) throw new Error(`BatchWrite over the 25-item limit: ${reqs.length}`);
      for (const r of reqs) {
        if (r.PutRequest) {
          if (failNextWrite && failNextWrite(r.PutRequest.Item)) throw new Error('simulated Dynamo failure');
          store.set(k(r.PutRequest.Item), r.PutRequest.Item);
        } else if (r.DeleteRequest) {
          store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
        }
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'];
      const prefix = v[':sk'] ?? v[':questionPrefix'];
      let items = [...store.values()].filter((i) => i.PK === pk);
      if (prefix) items = items.filter((i) => String(i.SK).startsWith(prefix));
      items.sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      if (inp.Limit) items = items.slice(0, inp.Limit);
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

// ── TENANT CRYPTO ──────────────────────────────────────────────────────────
// The handlers this suite drives now encrypt org content, and tenant-crypto
// THROWS on an org with no data key rather than quietly writing plaintext. The
// shared stub refuses a Decrypt with a missing or mismatched encryption context,
// exactly as the key policy will, so this does not weaken anything here.
// Org rows are envelopes at rest since tenancy. `plainRow` unwraps them with
// the real cipher so the assertions below stay about CONTENT — and it is
// synchronous, so a suite that is not about encryption needs no new awaits.
const { makeKmsStub, installTestKeyLoader, plainRow } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();
stub('@aws-sdk/client-kms', kmsStub.exports);
// Every org gets a deterministic data key, no ORG#<id>/METADATA row needed —
// otherwise every reset() in this file would have to re-seed one.
installTestKeyLoader();
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = TABLE;

const upload = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')).handler;
const listVersions = require(path.join(REPO, 'lambda-functions', 'admin', 'get-set-versions.js')).handler;
const promoteVersion = require(path.join(REPO, 'lambda-functions', 'admin', 'promote-set-version.js')).handler;
const deleteVersion = require(path.join(REPO, 'lambda-functions', 'admin', 'delete-set-version.js')).handler;
const deleteSet = require(path.join(REPO, 'lambda-functions', 'admin', 'delete-question-set.js')).handler;
const downloadSet = require(path.join(REPO, 'lambda-functions', 'admin', 'download-question-set.js')).handler;
const adminListSets = require(path.join(REPO, 'lambda-functions', 'admin', 'get-question-sets.js')).handler;
const getQuestion = require(path.join(REPO, 'lambda-functions', 'game', 'get-question.js')).handler;
const getCategories = require(path.join(REPO, 'lambda-functions', 'game', 'get-categories.js')).handler;
const { createGame } = require(path.join(REPO, 'lambda-functions', 'websocket', 'schema-compliant-manager.js'));

const ORG = 'org_nw';
const OWNER = 'sub-owner';
/** The caller for every route that is now ownership-guarded. */
const asOwner = (extra = {}) => ({
  ...extra,
  requestContext: { authorizer: { lambda: {
    userId: OWNER, username: 'owner', groups: 'hosts', orgId: ORG, orgRole: 'admin', status: 'enabled',
  } } },
});
const resolver = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'set-version.js'));

if (!process.env.DEBUG) console.log = () => {};
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
async function checkAsync(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const parse = (res) => JSON.parse(res.body);
// DECRYPTED for org partitions. `plainRow` only unwraps envelope-shaped values,
// so a platform row (`SET#…`, plaintext by design) passes through untouched.
const rowsIn = (pk, prefix = 'QUESTION#') =>
  [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(prefix))
    .sort((a, b) => String(a.SK).localeCompare(String(b.SK)))
    .map((i) => plainRow(ORG, i));

const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image';
const csvV1 = [
  HEADER,
  '"Renaissance",1,"THE SMILE","A portrait.","Leonardo","Invent a title.","smile.jpg"',
  '"Renaissance",2,"THE NIGHT","A sky.","Van Gogh","Invent a title.","night.jpg"',
].join('\n');
const csvV2 = [
  HEADER,
  '"Renaissance",1,"THE SMILE (FIXED)","A portrait, corrected.","Leonardo","Invent a title.","smile.jpg"',
  '"Renaissance",2,"THE NIGHT (FIXED)","A sky, corrected.","Van Gogh","Invent a title.","night.jpg"',
  '"Renaissance",3,"THE WAVE","A wave.","Hokusai","Invent a title.","wave.jpg"',
].join('\n');

/**
 * An ADMIN caller, in this API's real event shape.
 *
 * A REPLACE and a DELETE now check who is asking, per set
 * (shared/question-set-access.js): a host may only replace or delete a set they
 * created, an admin may do either to any. Everything in this file is about
 * versioning mechanics, so every caller here is an administrator. An event with
 * no authorizer context is anonymous and would be refused — correctly.
 *
 * `.authorizer.lambda` with groups comma-joined is what the custom Lambda
 * authorizer emits (auth/authorizer.js:171-182) — NOT `.jwt.claims`, a shape
 * this API never produces. Ownership itself: tests/question-set-ownership.js.
 */
// TENANCY: the sets in this suite belong to ORG, and the caller who creates
// them is the same person `asOwner` describes — otherwise the set lands in the
// platform library and every org-scoped lookup below finds nothing.
const adminContext = () => ({
  requestContext: {
    authorizer: { lambda: {
      username: 'owner', userId: OWNER, groups: 'hosts', status: 'enabled',
      orgId: ORG, orgRole: 'admin',
    } },
  },
});
const importSet = (title, csv, extra = {}) => upload({
  ...adminContext(),
  body: JSON.stringify({
    fileName: `${title}.csv`, fileContent: csv,
    customTitle: title, engagementType: 'call-and-answer', ...extra,
  }),
});
const replaceSet = (setId, csv, extra = {}) => upload({
  ...adminContext(),
  body: JSON.stringify({
    fileName: 'replacement.csv', fileContent: csv, replaceSetId: setId, ...extra,
  }),
});

/** Give a set the metadata fields a replace must not clobber. */
function decorate(setId, fields) {
  const key = `ORG#${ORG}#SETS|SET#${setId}`;
  store.set(key, { ...store.get(key), ...fields });
}

(async () => {
  say('question-set versioning\n');

  // ==== 1. the resolver itself: pin > activeVersion > legacy ================
  say('  -- resolution order --');
  {
    const legacyMeta = { name: 'x' };
    const versionedMeta = { activeVersion: 3, versions: [{ version: 1 }, { version: 2 }, { version: 3 }] };

    check('no version anywhere resolves to the LEGACY partition', () => {
      const r = resolver.resolvePartitionFromMeta('demo', legacyMeta, undefined);
      assert.strictEqual(r.pk, 'SET#demo');
      assert.strictEqual(r.version, null);
      assert.strictEqual(r.source, 'legacy');
    });
    check('a missing metadata row still resolves to the legacy partition', () => {
      const r = resolver.resolvePartitionFromMeta('demo', undefined, undefined);
      assert.strictEqual(r.pk, 'SET#demo');
      assert.strictEqual(r.source, 'legacy');
    });
    check('activeVersion is used when the game has no pin', () => {
      const r = resolver.resolvePartitionFromMeta('demo', versionedMeta, undefined);
      assert.strictEqual(r.pk, 'SET#demo#v3');
      assert.strictEqual(r.source, 'active');
    });
    check('a PIN beats activeVersion', () => {
      const r = resolver.resolvePartitionFromMeta('demo', versionedMeta, 1);
      assert.strictEqual(r.pk, 'SET#demo#v1');
      assert.strictEqual(r.source, 'pinned');
    });
    check('a pin to a DELETED version falls back to activeVersion, not an empty partition', () => {
      const r = resolver.resolvePartitionFromMeta('demo', { activeVersion: 3, versions: [{ version: 3 }] }, 2);
      assert.strictEqual(r.pk, 'SET#demo#v3');
      assert.strictEqual(r.source, 'pinned-missing');
    });
    check('a pin on an unmigrated set is trusted (nothing tracks versions yet)', () => {
      const r = resolver.resolvePartitionFromMeta('demo', legacyMeta, 2);
      assert.strictEqual(r.pk, 'SET#demo#v2');
    });
    check('junk version values mean "no version", not v0 or NaN', () => {
      for (const bad of ['', null, undefined, 0, -1, 1.5, 'abc', {}]) {
        assert.strictEqual(resolver.toVersion(bad), null, `toVersion(${JSON.stringify(bad)})`);
      }
      assert.strictEqual(resolver.toVersion('2'), 2, 'a numeric string is a valid version');
    });
    check('nextVersion never reuses a number, even after a delete', () => {
      assert.strictEqual(resolver.nextVersion({}), 1);
      assert.strictEqual(resolver.nextVersion({ activeVersion: 1, versions: [{ version: 1 }] }), 2);
      // v2 deleted: [1, 3] -> next is 4, so a game still pinned to 2 can never
      // be silently re-pointed at different content.
      assert.strictEqual(resolver.nextVersion({ activeVersion: 3, versions: [{ version: 1 }, { version: 3 }] }), 4);
    });
  }

  // ==== 2. a plain import stays on the legacy layout ========================
  say('\n  -- import + replace --');
  resetDb();
  {
    const res = await importSet('Demo Set', csvV1);
    check('a plain import succeeds', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('a plain import writes NO version (legacy layout, unchanged behaviour)', () =>
      assert.strictEqual(parse(res).version, null));
    check('its questions land in the legacy partition', () =>
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#demoset`).length, 2));
    check('the metadata row has no activeVersion', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).activeVersion, undefined));
  }

  // ==== 3. replace: snapshot legacy -> v1, write v2, flip ===================
  {
    decorate('demoset', {
      promptId: 'lessons-learned',
      personaId: 'workie-dry',
      customInstruction: 'Answer in one sentence.',
      aiContextInstruction: 'This is a pilot cohort.',
      roundNoun: 'Lesson',
      Quickstart: true,
      active: true,
    });

    const res = await replaceSet('demoset', csvV2);
    const body = parse(res);

    check('replace succeeds', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('replace reports the new version number', () => assert.strictEqual(body.version, 2));
    check('replace keeps the set id', () => assert.strictEqual(body.setId, 'demoset'));
    check('the pre-versioning content is snapshotted to v1', () => {
      const v1 = rowsIn(`ORG#${ORG}#SET#demoset#v1`);
      assert.strictEqual(v1.length, 2, `v1 has ${v1.length} question rows`);
      assert.strictEqual(v1[0].Title, 'THE SMILE');
    });
    check('the new content is written to v2', () => {
      const v2 = rowsIn(`ORG#${ORG}#SET#demoset#v2`);
      assert.strictEqual(v2.length, 3);
      assert.strictEqual(v2[0].Title, 'THE SMILE (FIXED)');
    });
    check('the LEGACY rows are left in place (rollback needs no restore)', () =>
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#demoset`).length, 2));
    check('activeVersion is flipped to 2', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).activeVersion, 2));
    check('versions[] lists both v1 and v2', () => {
      const versions = plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).versions.map((v) => v.version);
      assert.deepStrictEqual(versions, [1, 2]);
    });
    check('counts follow the new version', () => {
      const meta = plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`));
      assert.strictEqual(meta.questionCount, 3);
      assert.strictEqual(meta.categoryCount, 1);
    });

    // The requirement that makes replace worth doing at all.
    check('replace PRESERVES promptId', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).promptId, 'lessons-learned'));
    check('replace PRESERVES personaId', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).personaId, 'workie-dry'));
    check('replace PRESERVES customInstruction', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).customInstruction, 'Answer in one sentence.'));
    check('replace PRESERVES aiContextInstruction', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).aiContextInstruction, 'This is a pilot cohort.'));
    check('replace PRESERVES roundNoun', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).roundNoun, 'Lesson'));
    check('replace PRESERVES the quickstart badge', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).Quickstart, true));
    check('replace keeps the original set name', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).name, 'Demo Set'));
  }

  // ==== 4. a THIRD replace increments, it does not overwrite ================
  {
    const res = await replaceSet('demoset', csvV1);
    check('a second replace writes v3', () => assert.strictEqual(parse(res).version, 3));
    check('v2 still exists after v3 is written', () =>
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#demoset#v2`).length, 3));
    check('activeVersion follows to 3', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).activeVersion, 3));
  }

  // ==== 5. a validation failure must write NOTHING and not move activeVersion
  say('\n  -- failed replace --');
  {
    const before = plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).activeVersion;
    const partitionsBefore = new Set([...store.values()].map((i) => i.PK));

    const res = await replaceSet('demoset', [
      'Question#,Title,Detail_lesson',            // no Category column at all
      '1,"A TITLE","Some detail."',
    ].join('\n'));

    check('a replace with a missing required column is rejected 400', () =>
      assert.strictEqual(res.statusCode, 400, res.body));
    check('the rejection names the missing column', () =>
      assert.match(parse(res).error, /Category/));
    check('a rejected replace leaves activeVersion exactly where it was', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).activeVersion, before));
    check('a rejected replace creates no new version partition', () => {
      const after = new Set([...store.values()].map((i) => i.PK));
      assert.ok(!after.has(`ORG#${ORG}#SET#demoset#v4`), 'v4 was written by a rejected replace');
      assert.strictEqual(after.size, partitionsBefore.size);
    });
    check('a rejected replace does not append to versions[]', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`)).versions.length, 3));

    const missing = await replaceSet('nosuchset', csvV1);
    check('replacing a set that does not exist is a 404', () =>
      assert.strictEqual(missing.statusCode, 404, missing.body));
  }

  // ==== 6. the point of the whole design: a pinned game keeps its version ===
  say('\n  -- a pinned game is not disturbed by a replace --');
  resetDb();
  {
    await importSet('Pin Set', csvV1);
    await replaceSet('pinset', csvV2);       // legacy -> v1, new content -> v2

    // A game that started on v1: METADATA pin plus the per-round REF pin that
    // next-question.js writes.
    store.set('GAME#1111|METADATA', {
      PK: 'GAME#1111', SK: 'METADATA', orgId: ORG, QuestionSetId: 'pinset', SetScope: 'org', SetOrgId: ORG,
      QuestionSetScope: 'org', QuestionSetVersion: 1,
    });
    store.set('GAME#1111|STATE', { PK: 'GAME#1111', SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
    store.set('GAME#1111|QUESTION#001#REF', {
      PK: 'GAME#1111', SK: 'QUESTION#001#REF',
      SourceQuestionId: 'QUESTION#c001#001', SetId: 'pinset', SetScope: 'org', SetOrgId: ORG, SetVersion: 1, StartedAt: 'now',
    });

    // A game with NO pin — every game that existed before this change.
    store.set('GAME#2222|METADATA', { PK: 'GAME#2222', SK: 'METADATA', orgId: ORG, QuestionSetId: 'pinset', SetScope: 'org', SetOrgId: ORG, QuestionSetScope: 'org' });
    store.set('GAME#2222|STATE', { PK: 'GAME#2222', SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
    store.set('GAME#2222|QUESTION#001#REF', {
      PK: 'GAME#2222', SK: 'QUESTION#001#REF',
      SourceQuestionId: 'QUESTION#c001#001', SetId: 'pinset', SetScope: 'org', SetOrgId: ORG, StartedAt: 'now',
    });

    await checkAsync('a game pinned to v1 STILL reads v1 after the set is replaced', async () => {
      const res = await getQuestion({ pathParameters: { gameId: '1111' }, queryStringParameters: { role: 'player' } });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).title, 'THE SMILE',
        'the pinned game was served the replacement text');
    });

    await checkAsync('an UNPINNED game follows activeVersion (documented fallback)', async () => {
      const res = await getQuestion({ pathParameters: { gameId: '2222' }, queryStringParameters: { role: 'player' } });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).title, 'THE SMILE (FIXED)');
    });

    await checkAsync('get-categories serves the active version by default', async () => {
      const res = await getCategories(asOwner({ pathParameters: { setId: 'pinset' }, queryStringParameters: null }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).version, 2);
      assert.strictEqual(parse(res).categories.length, 1);
    });

    await checkAsync('get-categories honours an explicit ?version', async () => {
      const res = await getCategories(asOwner({ pathParameters: { setId: 'pinset' }, queryStringParameters: { version: '1' } }));
      assert.strictEqual(parse(res).version, 1);
      assert.strictEqual(parse(res).versionSource, 'pinned');
    });
  }

  // ==== 7. a LEGACY set with no version anywhere still plays ================
  say('\n  -- migration safety: an unversioned set still works --');
  resetDb();
  {
    await importSet('Legacy Set', csvV1);     // never replaced, never migrated
    store.set('GAME#3333|METADATA', { PK: 'GAME#3333', SK: 'METADATA', orgId: ORG, QuestionSetId: 'legacyset', SetScope: 'org', SetOrgId: ORG, QuestionSetScope: 'org' });
    store.set('GAME#3333|STATE', { PK: 'GAME#3333', SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
    store.set('GAME#3333|QUESTION#001#REF', {
      PK: 'GAME#3333', SK: 'QUESTION#001#REF',
      SourceQuestionId: 'QUESTION#c001#001', SetId: 'legacyset', SetScope: 'org', SetOrgId: ORG, StartedAt: 'now',
    });

    await checkAsync('a legacy set with no version resolves and serves its question', async () => {
      const res = await getQuestion({ pathParameters: { gameId: '3333' }, queryStringParameters: { role: 'player' } });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).title, 'THE SMILE');
    });
    await checkAsync('a legacy set lists its categories with version null', async () => {
      const res = await getCategories(asOwner({ pathParameters: { setId: 'legacyset' }, queryStringParameters: null }));
      assert.strictEqual(parse(res).version, null);
      assert.strictEqual(parse(res).versionSource, 'legacy');
      assert.strictEqual(parse(res).categories.length, 1);
    });
    await checkAsync('listing versions of an unversioned set is [] , not an error', async () => {
      const res = await listVersions(asOwner({ pathParameters: { setId: 'legacyset' } }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.deepStrictEqual(parse(res), []);
    });
  }

  // ==== 8. createGame pins the active version ==============================
  say('\n  -- game creation pins --');
  resetDb();
  {
    await importSet('Pin Me', csvV1);
    await replaceSet('pinme', csvV2);         // activeVersion = 2

    await createGame('4444', { orgId: ORG, questionSetScope: 'org', title: 'T', engagementType: 'call-and-answer', questionSetId: 'pinme' });

    check('createGame writes QuestionSetVersion onto GAME METADATA', () =>
      assert.strictEqual(store.get('GAME#4444|METADATA').QuestionSetVersion, 2));
    check('createGame mirrors the version onto the GAMES index row', () =>
      assert.strictEqual(store.get(`ORG#${ORG}#GAMES|GAME#4444`).QuestionSetVersion, 2));
    check('createGame builds its category state from the pinned version', () => {
      // v2 has 3 questions in one category; v1 and legacy have 2.
      assert.strictEqual(store.get('GAME#4444|CATEGORY#c001#ACTIVE').QuestionCount, 3);
    });

    await createGame('5555', { orgId: ORG, questionSetScope: 'org', title: 'T', engagementType: 'call-and-answer', questionSetId: 'pinme', questionSetVersion: 1 });
    check('an explicit questionSetVersion pins that version instead', () =>
      assert.strictEqual(store.get('GAME#5555|METADATA').QuestionSetVersion, 1));
    check('an explicitly pinned game is built from that version', () =>
      assert.strictEqual(store.get('GAME#5555|CATEGORY#c001#ACTIVE').QuestionCount, 2));

    // A legacy set must not gain a spurious pin.
    await importSet('No Version', csvV1);
    await createGame('6666', { orgId: ORG, questionSetScope: 'org', title: 'T', engagementType: 'call-and-answer', questionSetId: 'noversion' });
    check('a game on an unversioned set gets NO QuestionSetVersion attribute', () =>
      assert.strictEqual(store.get('GAME#6666|METADATA').QuestionSetVersion, undefined));

    /*
      THE SCOPE IS NOT OPTIONAL, AND OMITTING IT FAILS IN SILENCE.

      Everything above passes `questionSetScope: 'org'` because these sets live
      in an ORG partition. The frontend passed nothing at all for months: the
      picker's <option> carried `set.id` alone, so createGameBody had no scope
      to send. create-game.js then applies its documented `platform` default,
      `resolveSetPartition` finds no metadata for that id in Engage's library,
      `resolvePartitionFromMeta` falls through to its legacy branch, and the
      session pins a partition key that holds nothing.

      Nothing threw. The session was created, listed and joinable — with no
      categories and no questions, so it could not be played.

      Both ends are fixed and either one alone is sufficient, which is the point
      of testing them separately: the picker now sends the pair
      (src/src/utils/setRef.js), and create-game.js no longer ASSUMES a library
      when the caller names none — it looks for the set in the caller's readable
      scopes, org first, exactly as GET /question-sets/{id}/categories always
      has. That asymmetry — the setup screen resolving by search while the
      session resolved by assumption — was the whole bug.
    */
    await createGame('7001', { orgId: ORG, questionSetScope: 'org', title: 'T', engagementType: 'call-and-answer', questionSetId: 'pinme' });

    // rejects: nothing on its own — the control that proves the checks below
    // are measuring the scope and not some unrelated difference.
    check('an ORG set named WITH its scope builds category state', () =>
      assert.ok(store.get('GAME#7001|CATEGORY#c001#ACTIVE'),
        'the org-scoped session got no categories — the control is broken'));

    /*
      THIS FILE DRIVES THE MANAGER, WHICH IS STRICT ON PURPOSE. It is handed a
      scope and pins it; it has no `event`, so it has no caller and no readable
      scopes to search. The recovery for an unnamed scope lives one layer up in
      create-game.js, where the caller exists — and is tested there, in
      tests/tenant-session-scoping.js §1, against the real handler.

      What belongs HERE is the consequence, so the shape of the failure stays on
      the record: hand this function a scope the set is not in and it silently
      builds a session with nothing in it.
    */
    // rejects: the manager quietly searching for the set, which would make its
    // pin depend on data rather than on what it was told.
    await createGame('7002', { orgId: ORG, title: 'T', engagementType: 'call-and-answer', questionSetId: 'pinme' });
    check('the manager pins what it was told, and an absent set builds nothing', () => {
      assert.strictEqual(store.get('GAME#7002|METADATA').QuestionSetScope, 'platform');
      assert.strictEqual(store.get('GAME#7002|CATEGORY#c001#ACTIVE'), undefined);
      assert.strictEqual(store.get('GAME#7002|STATE#CATS'), undefined,
        'STATE#CATS is written only when the set resolved to real categories');
    });

    /*
      AND THE SEARCH IS NOT A HOLE. An EXPLICIT scope is honoured verbatim: a
      caller naming `platform` gets platform, and gets nothing when the set is
      not there. Redirecting an explicit scope to wherever the set happens to
      live is how a set from one library ends up played from another.
    */
    // rejects: applying the search to an explicit scope too.
    await createGame('7003', { orgId: ORG, questionSetScope: 'platform', title: 'T', engagementType: 'call-and-answer', questionSetId: 'pinme' });
    check('an EXPLICIT scope is still strict, and still empty when wrong', () => {
      assert.strictEqual(store.get('GAME#7003|METADATA').QuestionSetScope, 'platform');
      assert.strictEqual(store.get('GAME#7003|CATEGORY#c001#ACTIVE'), undefined,
        'an explicit platform scope was quietly redirected to the org library');
    });
  }

  // ==== 9. listing / promoting versions ====================================
  say('\n  -- list + promote --');
  resetDb();
  {
    await importSet('Ops Set', csvV1);
    await replaceSet('opsset', csvV2);        // v1 (snapshot), v2 active
    await createGame('7777', { orgId: ORG, questionSetScope: 'org', title: 'T', engagementType: 'call-and-answer', questionSetId: 'opsset', questionSetVersion: 1 });
    store.set('GAME#7777|STATE', { PK: 'GAME#7777', SK: 'STATE', State: 'ASK#001' });

    await checkAsync('GET .../versions returns a bare ARRAY, per the contract', async () => {
      const res = await listVersions(asOwner({ pathParameters: { setId: 'opsset' } }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.ok(Array.isArray(parse(res)), `body was ${res.body}`);
    });
    await checkAsync('each entry carries the agreed fields', async () => {
      const [v1, v2] = parse(await listVersions(asOwner({ pathParameters: { setId: 'opsset' } })));
      for (const field of ['version', 'createdAt', 'questionCount', 'categoryCount', 'sourceFile', 'isActive', 'pinnedByGames']) {
        assert.ok(field in v1, `missing "${field}"`);
      }
      assert.strictEqual(v1.version, 1);
      assert.strictEqual(v2.version, 2);
      assert.strictEqual(v2.isActive, true);
      assert.strictEqual(v1.isActive, false);
    });
    await checkAsync('pinnedByGames names the live game pinned to v1', async () => {
      const [v1] = parse(await listVersions(asOwner({ pathParameters: { setId: 'opsset' } })));
      assert.deepStrictEqual(v1.pinnedByGames, ['7777']);
    });
    await checkAsync('an ENDED game is not reported as pinning a version', async () => {
      store.set('GAME#7777|STATE', { PK: 'GAME#7777', SK: 'STATE', State: 'ENDED' });
      const [v1] = parse(await listVersions(asOwner({ pathParameters: { setId: 'opsset' } })));
      assert.deepStrictEqual(v1.pinnedByGames, []);
      store.set('GAME#7777|STATE', { PK: 'GAME#7777', SK: 'STATE', State: 'ASK#001' });
    });

    await checkAsync('promote flips activeVersion back to v1 (the rollback)', async () => {
      const res = await promoteVersion(asOwner({ pathParameters: { setId: 'opsset', version: '1' } }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).activeVersion, 1);
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#opsset`)).activeVersion, 1);
    });
    await checkAsync('promoting an unknown version is a 404, not a silent write', async () => {
      const res = await promoteVersion(asOwner({ pathParameters: { setId: 'opsset', version: '9' } }));
      assert.strictEqual(res.statusCode, 404, res.body);
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#opsset`)).activeVersion, 1);
    });
    await checkAsync('promoting a non-numeric version is a 400', async () => {
      const res = await promoteVersion(asOwner({ pathParameters: { setId: 'opsset', version: 'latest' } }));
      assert.strictEqual(res.statusCode, 400, res.body);
    });
    await checkAsync('a replace after a rollback still gets a fresh number', async () => {
      const res = await replaceSet('opsset', csvV1);
      assert.strictEqual(parse(res).version, 3, 'a rollback must not cause v2 to be overwritten');
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#opsset#v2`).length, 3, 'v2 was clobbered');
    });
  }

  // ==== 10. deleting versions ==============================================
  say('\n  -- delete a version --');
  resetDb();
  {
    await importSet('Del Set', csvV1);
    await replaceSet('delset', csvV2);        // v1, v2 (active)

    await checkAsync('deleting the ACTIVE version is refused with 409', async () => {
      const res = await deleteVersion(asOwner({ pathParameters: { setId: 'delset', version: '2' }, queryStringParameters: null }));
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(parse(res).activeVersion, 2);
      assert.match(parse(res).error, /active version/i);
    });
    check('the refused delete removed nothing', () =>
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#delset#v2`).length, 3));

    await checkAsync('deleting an unknown version is a 404', async () => {
      const res = await deleteVersion(asOwner({ pathParameters: { setId: 'delset', version: '9' }, queryStringParameters: null }));
      assert.strictEqual(res.statusCode, 404, res.body);
    });

    // A live game pinned to v1 -> pre-flight warning, nothing deleted.
    await createGame('8888', { orgId: ORG, questionSetScope: 'org', title: 'T', engagementType: 'call-and-answer', questionSetId: 'delset', questionSetVersion: 1 });
    store.set('GAME#8888|METADATA', { PK: 'GAME#8888', SK: 'METADATA', orgId: ORG,
      QuestionSetId: 'delset', QuestionSetScope: 'org' });
    store.set('GAME#8888|STATE', { PK: 'GAME#8888', SK: 'STATE', State: 'ASK#002' });

    await checkAsync('deleting a PINNED version warns and NAMES the games', async () => {
      const res = await deleteVersion(asOwner({ pathParameters: { setId: 'delset', version: '1' }, queryStringParameters: null }));
      assert.strictEqual(res.statusCode, 200, res.body);
      const body = parse(res);
      assert.strictEqual(body.deleted, false, 'the warning path must not delete');
      assert.ok(body.warning, 'no warning text');
      assert.deepStrictEqual(body.pinnedByGames, ['8888']);
      assert.strictEqual(body.requiresConfirmation, true);
    });
    check('the warned-about version is still fully intact', () =>
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#delset#v1`).length, 2));
    check('the warned-about version is still listed in versions[]', () =>
      assert.deepStrictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#delset`)).versions.map((v) => v.version), [1, 2]));

    await checkAsync('?confirm=true goes through and deletes the version', async () => {
      const res = await deleteVersion(asOwner({
        pathParameters: { setId: 'delset', version: '1' },
        queryStringParameters: { confirm: 'true' },
      }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).deleted, true);
      assert.deepStrictEqual(parse(res).pinnedByGames, ['8888']);
    });
    check('the deleted version has no rows left', () =>
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#delset#v1`).length, 0));
    check('the deleted version is gone from versions[]', () =>
      assert.deepStrictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#delset`)).versions.map((v) => v.version), [2]));
    check('the ACTIVE version is untouched by deleting another one', () =>
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#delset#v2`).length, 3));

    await checkAsync('the game stranded by the delete falls back rather than breaking', async () => {
      store.set('GAME#8888|QUESTION#001#REF', {
        PK: 'GAME#8888', SK: 'QUESTION#001#REF',
        SourceQuestionId: 'QUESTION#c001#001', SetId: 'delset', SetScope: 'org', SetOrgId: ORG,
        SetVersion: 1, StartedAt: 'now',
      });
      store.set('GAME#8888|STATE', { PK: 'GAME#8888', SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
      const res = await getQuestion({ pathParameters: { gameId: '8888' }, queryStringParameters: { role: 'player' } });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).title, 'THE SMILE (FIXED)', 'expected the v2 fallback');
    });

    await checkAsync('a version with no live pins deletes without needing confirm', async () => {
      await replaceSet('delset', csvV1);      // v3 becomes active, v2 is now idle
      const res = await deleteVersion(asOwner({ pathParameters: { setId: 'delset', version: '2' }, queryStringParameters: null }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(parse(res).deleted, true);
      assert.strictEqual(rowsIn(`ORG#${ORG}#SET#delset#v2`).length, 0);
    });
  }

  // ==== 11. deleting the whole set removes every version ====================
  say('\n  -- delete the whole set --');
  resetDb();
  {
    await importSet('Wipe Set', csvV1);
    await replaceSet('wipeset', csvV2);
    await replaceSet('wipeset', csvV1);       // legacy + v1 + v2 + v3
    // An orphan from a replace that died before the activeVersion flip.
    store.set(`ORG#${ORG}#SET#wipeset#v4|QUESTION#c001#001`, {
      PK: `ORG#${ORG}#SET#wipeset#v4`, SK: 'QUESTION#c001#001', Title: 'ORPHAN',
    });

    const res = await deleteSet({ ...adminContext(), pathParameters: { setId: 'wipeset' } });
    check('deleting a versioned set succeeds', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('every version partition is emptied', () => {
      const left = [...store.values()].filter((i) => String(i.PK).startsWith(`ORG#${ORG}#SET#wipeset`));
      assert.strictEqual(left.length, 0, `${left.length} rows left: ${left.map((i) => `${i.PK}/${i.SK}`).join(', ')}`);
    });
    check('the orphaned partition from a failed flip is swept too', () =>
      assert.strictEqual(store.get('SET#wipeset#v4|QUESTION#c001#001'), undefined));
    check('the index row is gone last', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#wipeset`)), undefined));
  }

  // ==== 12. image keys: set-scoped, per-SET not per-version =================
  say('\n  -- image media keys --');
  resetDb();
  {
    const csv = [
      HEADER,
      '"Art",1,"BARE FILENAME","d","s","i","the-enigmatic-smile.jpg"',
      '"Art",2,"ABSOLUTE URL","d","s","i","https://upload.wikimedia.org/x/starry.jpg"',
      '"Art",3,"ROOTED ASSET","d","s","i","/assets/art/wave.jpg"',
      '"Art",4,"ALREADY KEYED","d","s","i","sets/mediaset/wave.jpg"',
      '"Art",5,"NO IMAGE","d","s","i",',
      '"Art",6,"HTTP URL","d","s","i","http://example.test/legacy.png"',
    ].join('\n');
    await importSet('Media Set', csv);
    const q = rowsIn(`ORG#${ORG}#SET#mediaset`);

    check('a bare filename becomes sets/<setId>/<filename>', () =>
      assert.strictEqual(q[0].Image, 'sets/mediaset/the-enigmatic-smile.jpg'));
    check('an https:// URL is stored as-is (legacy Wikimedia rows)', () =>
      assert.strictEqual(q[1].Image, 'https://upload.wikimedia.org/x/starry.jpg'));
    check('a /-rooted repo asset is stored as-is', () =>
      assert.strictEqual(q[2].Image, '/assets/art/wave.jpg'));
    check('an already-keyed value is NOT double-prefixed', () =>
      assert.strictEqual(q[3].Image, 'sets/mediaset/wave.jpg'));
    check('an empty Image cell stays empty', () =>
      assert.strictEqual(q[4].Image, ''));
    check('an http:// URL is stored as-is too', () =>
      assert.strictEqual(q[5].Image, 'http://example.test/legacy.png'));
    check('the stored value is a KEY, never a CloudFront URL', () => {
      assert.ok(!q[0].Image.includes('cloudfront'), q[0].Image);
      assert.ok(!/^https?:\/\//.test(q[0].Image), q[0].Image);
    });
    check('hasImages still detects artwork after the transform', () =>
      assert.strictEqual(plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#mediaset`)).hasImages, true));

    // Media is per-SET: a new version must reuse the same prefix, so replacing
    // a CSV never means re-uploading the images.
    await replaceSet('mediaset', [
      HEADER,
      '"Art",1,"BARE FILENAME v2","d","s","i","the-enigmatic-smile.jpg"',
      '"Art",2,"ROUND TRIPPED","d","s","i","sets/mediaset/the-enigmatic-smile.jpg"',
    ].join('\n'));
    const v = rowsIn(`ORG#${ORG}#SET#mediaset#v2`);
    check('a replace keys images to the SET, never to the version', () => {
      assert.strictEqual(v[0].Image, 'sets/mediaset/the-enigmatic-smile.jpg');
      assert.ok(!v[0].Image.includes('#v'), v[0].Image);
      assert.ok(!v[0].Image.includes('/v2/'), v[0].Image);
    });
    check('re-uploading a downloaded CSV does not grow the prefix', () =>
      assert.strictEqual(v[1].Image, 'sets/mediaset/the-enigmatic-smile.jpg'));
  }

  // ==== 13. the admin list and the CSV export follow the version ============
  say('\n  -- admin list + download --');
  resetDb();
  {
    await importSet('Round Trip', csvV1);
    await replaceSet('roundtrip', csvV2);

    await checkAsync('the admin list reports activeVersion and versions[]', async () => {
      const res = await adminListSets(asOwner());
      const set = parse(res).questionSets.find((s) => s.id === 'roundtrip');
      assert.strictEqual(set.activeVersion, 2);
      assert.deepStrictEqual(set.versions.map((v) => v.version), [1, 2]);
    });
    await checkAsync('an unversioned set reports activeVersion null and versions []', async () => {
      await importSet('Plain', csvV1);
      const res = await adminListSets(asOwner());
      const set = parse(res).questionSets.find((s) => s.id === 'plain');
      assert.strictEqual(set.activeVersion, null);
      assert.deepStrictEqual(set.versions, []);
    });
    await checkAsync('download exports the ACTIVE version, not the legacy rows', async () => {
      const res = await downloadSet(asOwner({ pathParameters: { setId: 'roundtrip' }, queryStringParameters: { format: 'csv' } }));
      assert.strictEqual(res.statusCode, 200, res.body);
      const { content, filename, contentType } = parse(res);
      assert.ok(filename && contentType, 'the {filename, content, contentType} shape is what the UI parses');
      assert.match(content, /THE SMILE \(FIXED\)/);
      assert.ok(!/THE SMILE"/.test(content.replace(/THE SMILE \(FIXED\)/g, '')), 'legacy rows leaked into the export');
    });
    await checkAsync('download honours ?version for an older one', async () => {
      const res = await downloadSet(asOwner({ pathParameters: { setId: 'roundtrip' }, queryStringParameters: { format: 'csv', version: '1' } }));
      assert.match(parse(res).content, /THE SMILE/);
      assert.ok(!parse(res).content.includes('(FIXED)'), 'v1 export contained v2 text');
    });
    await checkAsync('the exported CSV keeps the stored image key intact', async () => {
      const res = await downloadSet(asOwner({ pathParameters: { setId: 'roundtrip' }, queryStringParameters: { format: 'csv' } }));
      assert.match(parse(res).content, /sets\/roundtrip\/smile\.jpg/);
    });
  }

  // ==== 14. every OTHER runtime reader resolves the same way ===============
  //
  // ASK is served by get-question.js, VOTE by get-game-state.js, RESULTS by
  // get-results.js and get-ai-summary.js, the final report by create-report.js,
  // and trivia scoring by websocket/message.js. If any ONE of them rebuilt
  // `SET#<id>` by hand it would read a DIFFERENT version from the rest, and a
  // replaced set would show one question during ASK and another at RESULTS.
  say('\n  -- every reader goes through the resolver --');
  resetDb();
  {
    await importSet('Cross Set', csvV1);
    await replaceSet('crossset', csvV2);      // v1 = original, v2 = active

    store.set('GAME#9999|METADATA', {
      PK: 'GAME#9999', SK: 'METADATA', orgId: ORG, QuestionSetId: 'crossset',
      QuestionSetScope: 'org', QuestionSetVersion: 1,
      Title: 'T', GameType: 'call-and-answer',
    });
    store.set('GAME#9999|STATE', { PK: 'GAME#9999', SK: 'STATE', State: 'VOTE#001', LessonNumber: 1 });
    store.set('GAME#9999|QUESTION#001#REF', {
      PK: 'GAME#9999', SK: 'QUESTION#001#REF',
      SourceQuestionId: 'QUESTION#c001#001', SetId: 'crossset', SetScope: 'org', SetOrgId: ORG,
      SetVersion: 1, StartedAt: 'now',
    });

    await checkAsync('get-game-state serves the pinned version during VOTE', async () => {
      const getGameState = require(path.join(REPO, 'lambda-functions', 'game', 'get-game-state.js')).handler;
      const res = await getGameState({ pathParameters: { gameId: '9999' } });
      assert.strictEqual(res.statusCode, 200, res.body);
      // `currentQuestion` is the numeric lesson number; the payload is
      // `currentQuestionData`.
      const q = parse(res).currentQuestionData;
      assert.ok(q, `no question data in ${res.body.slice(0, 300)}`);
      assert.strictEqual(q.title, 'THE SMILE',
        'the VOTE payload was served the replacement text while ASK showed the pinned one');
    });

    const fs = require('fs');
    const readerFiles = [
      'game/next-question.js', 'game/get-question.js', 'game/get-categories.js',
      'game/select-question.js', 'game/get-question-sets.js', 'game/get-game-state.js',
      'game/get-results.js', 'game/get-ai-summary.js', 'game/create-report.js',
      'websocket/schema-compliant-manager.js', 'websocket/message.js',
      'admin/download-question-set.js', 'admin/get-question-set-questions.js',
      'admin/update-game-categories.js', 'admin/export-to-archive.js',
    ];
    check('no runtime reader hand-builds a `SET#<id>` content partition', () => {
      const offenders = [];
      for (const rel of readerFiles) {
        const src = fs.readFileSync(path.join(REPO, 'lambda-functions', rel), 'utf8');
        for (const line of src.split('\n')) {
          // Metadata lives at PK='SETS', SK='SET#<id>' and is NOT versioned, so
          // only PK-side interpolation is an offence.
          if (/(?:PK|':?pk'?|':?setpk'?)\s*:\s*`SET#\$\{/.test(line)
            && !/SK:\s*'METADATA'/.test(line)) {
            offenders.push(`${rel}: ${line.trim()}`);
          }
        }
      }
      assert.deepStrictEqual(offenders, [],
        `these bypass the resolver and will read the wrong version:\n  ${offenders.join('\n  ')}`);
    });
    /*
      AND THE METADATA PARTITION MOVES TOO.

      The check above deliberately exempts `SK: 'METADATA'`, because set METADATA
      is not versioned — and that exemption left a hole, because metadata is
      still SCOPED. It lives at `PK='SETS'` for the platform library and at
      `PK='ORG#<org>#SETS'` for an organisation's own, so a hard-coded `'SETS'`
      is a platform-only read that finds NOTHING for every org session and
      reports no error.

      create-report.js:223 already carries the fix and the post-mortem: "this
      read `PK: 'SETS'` unconditionally, which since tenancy is the PLATFORM
      library and nothing else … so for every org session this simply found
      nothing and the report silently lost its set name, description and
      instructions — no error, just absent fields." Two call sites in
      get-ai-summary.js were missed, which cost every org session its set's
      custom instruction, AI context, persona and prompt.

      `setMetadataKey` from tenant.js is the only correct way to build this key.
    */
    // rejects: a runtime reader reaching for the platform library by name.
    check('no runtime reader hard-codes the `SETS` metadata partition', () => {
      const offenders = [];
      for (const rel of readerFiles) {
        // Comments stripped first: this rule is ABOUT the literal, so the
        // comments explaining it necessarily contain it.
        const src = fs.readFileSync(path.join(REPO, 'lambda-functions', rel), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        src.split('\n').forEach((line, i) => {
          if (/PK\s*:\s*'SETS'/.test(line)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
      }
      assert.deepStrictEqual(offenders, [],
        `these read the platform library for every caller, org or not:\n  ${offenders.join('\n  ')}`);
    });
    check('every reader that touches set content requires set-version', () => {
      const missing = readerFiles.filter((rel) =>
        !fs.readFileSync(path.join(REPO, 'lambda-functions', rel), 'utf8').includes('set-version'));
      assert.deepStrictEqual(missing, []);
    });
    check('the three copies of set-version.js are identical apart from the marker', () => {
      const norm = (p) => fs.readFileSync(path.join(REPO, 'lambda-functions', p), 'utf8')
        .replace(/\s*\(this file\)/g, '');
      const admin = norm('admin/shared/set-version.js');
      assert.strictEqual(norm('game/set-version.js'), admin, 'game/set-version.js has drifted');
      assert.strictEqual(norm('websocket/set-version.js'), admin, 'websocket/set-version.js has drifted');
    });
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
