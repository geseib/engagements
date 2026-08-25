/**
 * MULTI-TENANT QUESTION SETS — the test that has to hold.
 *
 * Everything else in the tenancy change is key shapes. THIS is the part where a
 * mistake is somebody else's material: two customers share one DynamoDB table,
 * their set ids are slugs of their titles (`admin/upload-questions.js:298`
 * lower-cases the name and strips everything else), and two teams both calling
 * a set "Team Retro" therefore both produce `teamretro`. Before scoping the
 * second import silently clobbered the first. That is the failure this file
 * exists to keep out, in both its forms:
 *
 *   - LOUD:   org B edits, deletes or plays org A's set.
 *   - SILENT: org B's import lands on top of org A's rows, or org A's session
 *             reads org B's questions, because a bare `teamretro` addressed
 *             whichever partition the caller reached first.
 *
 * The second is the one to fear. Every AI-generated poll set once imported with
 * zero options because an emitter and the importer disagreed about a column
 * name, and nothing failed — the rows were simply not there. A set that reads
 * from the wrong partition fails exactly as quietly.
 *
 * WHAT IS PINNED HERE, in the owner's words:
 *
 *   1. host B cannot list, read, edit, delete or run host A's set
 *   2. Engage staff cannot edit an org's set   <- a DELIBERATE loss of power
 *   3. every org CAN read the platform library <- an explicit requirement
 *   4. a platform set is still at PK='SETS', byte for byte, afterwards
 *
 * REAL HANDLERS, NOT A RE-IMPLEMENTATION. Every assertion below drives an
 * exported `handler` against a stubbed DynamoDB. Fixtures are produced BY THE
 * HANDLERS (host A's set is created by running upload-questions), never hand-
 * written to match what the reader expects — a fixture copied from a client is
 * how a payload-shape defect passes its own test.
 *
 * Stubbing follows tests/import-questions-flow.js: hook Module._load BY NAME.
 * The require.cache-by-path trick misses, because several @aws-sdk packages the
 * admin bundle imports (s3-request-presigner) cannot be resolved from the repo
 * root at all.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const TABLE = 'test-table';

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

const store = new Map();          // "PK|SK" -> Item
const k = (item) => `${item.PK}|${item.SK}`;

/**
 * A stub that HONOURS begins_with, because the scoping bug this file hunts is a
 * partition-key bug: a stub that ignored the key condition and returned
 * everything would pass whatever partition the handler asked for.
 */
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    if (cmd.type === 'put') { store.set(k(inp.Item), inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(`${inp.Key.PK}|${inp.Key.SK}`); return {}; }
    if (cmd.type === 'update') {
      // Enough of an UpdateItem to see whether the right ROW was addressed:
      // SET of scalar attributes, which is all any set-metadata writer does
      // beyond the list_append in upload-questions' version flip.
      const key = `${inp.Key.PK}|${inp.Key.SK}`;
      const item = store.get(key) || { ...inp.Key };
      const names = inp.ExpressionAttributeNames || {};
      const values = inp.ExpressionAttributeValues || {};
      for (const clause of String(inp.UpdateExpression || '').replace(/^SET /, '').split(',')) {
        const m = clause.trim().match(/^(#?[\w.]+)\s*=\s*(.+)$/);
        if (!m) continue;
        const attr = names[m[1]] || m[1];
        const raw = m[2].trim();
        if (raw.startsWith(':')) item[attr] = values[raw];
        else if (/^list_append/.test(raw)) {
          const parts = raw.match(/:(\w+)\)?\s*,\s*:(\w+)\)/);
          if (parts) item[attr] = [...(item[attr] || values[`:${parts[1]}`] || []), ...(values[`:${parts[2]}`] || [])];
        }
      }
      store.set(key, item);
      return { Attributes: item };
    }
    if (cmd.type === 'batchWrite') {
      for (const r of inp.RequestItems[TABLE] || []) {
        if (r.PutRequest) store.set(k(r.PutRequest.Item), r.PutRequest.Item);
        if (r.DeleteRequest) store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'] ?? v[':PK'];
      const prefix = v[':sk'] ?? v[':questionPrefix'] ?? v[':prefix'] ?? '';
      const items = [...store.values()].filter(
        (i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
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
const { makeKmsStub, installTestKeyLoader, plainRowAuto } = require('./helpers/tenant-crypto-stub');
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
stub('@aws-sdk/client-s3', { S3Client: class {}, ListObjectsV2Command: class {}, PutObjectCommand: class {} });
stub('@aws-sdk/s3-request-presigner', { getSignedUrl: async () => 'https://example.invalid/signed' });

process.env.TABLE_NAME = TABLE;
process.env.GAME_TABLE = TABLE;
process.env.MEDIA_BUCKET = 'test-media';

// ---- the real handlers -----------------------------------------------------
const A = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f)).handler;
const G = (f) => require(path.join(REPO, 'lambda-functions', 'game', f)).handler;

const uploadQuestions = A('upload-questions.js');
const adminListSets = A('get-question-sets.js');
const editSet = A('edit-question-set.js');
const deleteSet = A('delete-question-set.js');
const setQuestions = A('get-question-set-questions.js');
const toggleSet = A('toggle-question-set.js');
const toggleQuickstart = A('toggle-quickstart.js');
const promoteVersion = A('promote-set-version.js');
const deleteVersion = A('delete-set-version.js');
const getVersions = A('get-set-versions.js');
const downloadSet = A('download-question-set.js');
const mediaStatus = A('media-status.js');
const mediaUploadUrls = A('media-upload-urls.js');
const gameListSets = G('get-question-sets.js');
const gameCategories = G('get-categories.js');
const gameQuestion = G('get-question.js');

const access = require(path.join(REPO, 'lambda-functions/admin/shared/question-set-access.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- callers, IN THIS API'S REAL SHAPE -------------------------------------
//
// `requestContext.authorizer.lambda`, groups COMMA-JOINED into a string. This
// API's `CognitoAuthorizer` is a CUSTOM Lambda authorizer despite the name
// (payload 2.0, simple responses), so the context arrives there and NOT at
// `.jwt.claims`. Eighteen tests once passed against a shape this API has never
// produced; see require-admin.js's header.
const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });

const HOST_A = caller({
  userId: 'sub-ada', username: 'ada', groups: 'hosts', status: 'enabled',
  orgId: 'org_a', orgRole: 'member', orgIds: 'org_a',
});
const HOST_B = caller({
  userId: 'sub-bo', username: 'bo', groups: 'hosts', status: 'enabled',
  orgId: 'org_b', orgRole: 'member', orgIds: 'org_b',
});
const ADMIN_A = caller({
  userId: 'sub-ann', username: 'ann', groups: 'hosts', status: 'enabled',
  orgId: 'org_a', orgRole: 'admin', orgIds: 'org_a',
});
/** Engage staff: the `admins` group, and NO organisation. */
const STAFF = caller({
  userId: 'sub-eve', username: 'eve', groups: 'admins', status: 'enabled',
});

const withEvent = (base, extra) => ({ ...base, ...extra });
const body = (o) => JSON.stringify(o);
const parse = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };

// ---- fixtures --------------------------------------------------------------
const CAA_HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image';
const csvFor = (label) => [
  CAA_HEADER,
  `"Leadership",1,"${label} ONE","First lesson of ${label}.","School","Apply it?",`,
  `"Leadership",2,"${label} TWO","Second lesson of ${label}.","School","Apply it?",`,
  `"Innovation",1,"${label} THREE","Third lesson of ${label}.","School","Try it?",`,
].join('\n');

const uploadAs = (who, title, label) => uploadQuestions(withEvent(who, {
  body: body({
    fileName: `${label}.csv`, fileContent: csvFor(label),
    customTitle: title, engagementType: 'call-and-answer',
  }),
}));

// DECRYPTED, with the key taken from each row's OWN partition. This suite spans
// two organisations deliberately — the slug collision IS the scenario — so
// naming one org here would decrypt half the rows with the wrong key. A
// platform row has no ORG# prefix and passes through untouched.
const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk).map(plainRowAuto);
const snapshot = (pk) => JSON.stringify(rowsIn(pk).sort((a, b) => a.SK.localeCompare(b.SK)));

// Both organisations name their set the same thing on purpose: the slug
// collision IS the scenario. `teamretro` from both.
const SET_ID = 'teamretro';
const ORG_A_META_PK = 'ORG#org_a#SETS';
const ORG_B_META_PK = 'ORG#org_b#SETS';
const ORG_A_CONTENT_PK = `ORG#org_a#SET#${SET_ID}`;
const ORG_B_CONTENT_PK = `ORG#org_b#SET#${SET_ID}`;

/** A platform set, seeded in the PRE-TENANCY shape: PK 'SETS', no scope
 *  attribute, no orgId, no createdBy — which is what all ~41 live sets are. */
const PLATFORM_SET_ID = 'greatesthits';
function seedPlatformSet() {
  store.set('SETS|SET#greatesthits', {
    PK: 'SETS', SK: `SET#${PLATFORM_SET_ID}`,
    name: 'Greatest Hits', description: 'House content',
    engagementType: 'call-and-answer', questionCount: 2, categoryCount: 1,
    active: true, createdAt: '2025-01-01T00:00:00.000Z',
  });
  store.set(`SET#${PLATFORM_SET_ID}|CATEGORY#c001`, {
    PK: `SET#${PLATFORM_SET_ID}`, SK: 'CATEGORY#c001',
    Name: 'Leadership', Description: 'Leadership questions', QuestionCount: 2,
  });
  for (const n of [1, 2]) {
    store.set(`SET#${PLATFORM_SET_ID}|QUESTION#c001#${String(n).padStart(3, '0')}`, {
      PK: `SET#${PLATFORM_SET_ID}`, SK: `QUESTION#c001#${String(n).padStart(3, '0')}`,
      Title: `HOUSE ${n}`, Detail: 'House detail', Category: 'Leadership',
    });
  }
}

(async () => {
  say('multi-tenant question-set scoping\n');

  store.clear();
  seedPlatformSet();
  const PLATFORM_BEFORE = snapshot('SETS') + snapshot(`SET#${PLATFORM_SET_ID}`);

  // ── 1. Two organisations, one slug ────────────────────────────────────────
  say('\n1. the same title in two organisations is two sets');

  const createdA = await uploadAs(HOST_A, 'Team Retro', 'retro-a');
  const createdB = await uploadAs(HOST_B, 'Team Retro', 'retro-b');

  // rejects: createSetRef defaulting an org host to the platform library, or
  // upload-questions writing `PK: 'SETS'` again. Either makes this a 400
  // ("already exists") on the second import, or worse a silent overwrite.
  await check('both organisations may create their own "Team Retro"', () => {
    assert.strictEqual(createdA.statusCode, 200, createdA.body);
    assert.strictEqual(createdB.statusCode, 200, createdB.body);
    assert.strictEqual(parse(createdA).setId, SET_ID);
    assert.strictEqual(parse(createdB).setId, SET_ID);
  });

  // rejects: a scope prefix that is not applied to the METADATA partition, so
  // both orgs' index rows land on 'SETS' and the second clobbers the first.
  await check('each set indexes in its OWN org partition', () => {
    assert.strictEqual(rowsIn(ORG_A_META_PK).length, 1, 'org A has no index row');
    assert.strictEqual(rowsIn(ORG_B_META_PK).length, 1, 'org B has no index row');
  });

  // rejects: THE SILENT ONE. A scope prefix applied to the metadata key but not
  // to the CONTENT key, so both orgs' questions share `SET#teamretro` and the
  // second import overwrites row for row with no error anywhere.
  await check('each set writes its questions to its OWN content partition', () => {
    const a = rowsIn(ORG_A_CONTENT_PK).filter((r) => r.SK.startsWith('QUESTION#'));
    const b = rowsIn(ORG_B_CONTENT_PK).filter((r) => r.SK.startsWith('QUESTION#'));
    assert.strictEqual(a.length, 3, `org A has ${a.length} questions`);
    assert.strictEqual(b.length, 3, `org B has ${b.length} questions`);
    assert.ok(a.every((r) => /RETRO-A/i.test(r.Title)), 'org A is holding org B\'s rows');
    assert.ok(b.every((r) => /RETRO-B/i.test(r.Title)), 'org B is holding org A\'s rows');
  });

  // rejects: dropping the scope stamp from ownerStamp — canManageSet reads the
  // scope off the ROW, so an unstamped org row would read as platform content.
  await check('the row records which library it is in', () => {
    const a = rowsIn(ORG_A_META_PK)[0];
    assert.strictEqual(a.scope, 'org');
    assert.strictEqual(a.orgId, 'org_a');
    assert.strictEqual(a.createdBy, 'sub-ada');
  });

  // ── 2. Host B cannot LIST host A's set ────────────────────────────────────
  say('\n2. host B cannot list host A\'s set');

  const listB = parse(await adminListSets(HOST_B)).questionSets;
  const listA = parse(await adminListSets(HOST_A)).questionSets;

  // rejects: get-question-sets going back to one unscoped Query of 'SETS' —
  // which would show B nothing of their own; or merging EVERY org, which shows
  // B all of A's.
  await check('host B\'s list has their own set and not host A\'s', () => {
    const mine = listB.filter((s) => s.id === SET_ID);
    assert.strictEqual(mine.length, 1, `expected one teamretro, found ${mine.length}`);
    assert.strictEqual(mine[0].orgId, 'org_b');
    assert.ok(!listB.some((s) => s.orgId === 'org_a'), 'org A content leaked into org B\'s list');
  });

  // rejects: projecting the id without the scope, so a client that round-trips
  // the row addresses whichever library the next handler searches first.
  await check('every listed row carries its scope and org', () => {
    for (const s of listB) {
      assert.ok(['platform', 'org', 'public'].includes(s.scope), `bad scope ${s.scope}`);
      if (s.scope === 'org') assert.strictEqual(s.orgId, 'org_b');
    }
  });

  // rejects: canManageSet still short-circuiting on isAdminCaller, or losing
  // the within-org creator rule.
  await check('canManage is true for your own org set and absent for the other', () => {
    assert.strictEqual(listA.find((s) => s.id === SET_ID && s.scope === 'org').canManage, true);
    assert.strictEqual(listB.find((s) => s.id === SET_ID && s.scope === 'org').canManage, true);
  });

  // rejects: the game-side picker keeping its single 'SETS' Query, which would
  // make every org's own sets unplayable and/or expose every other org's.
  await check('the game-side picker is scoped the same way', async () => {
    const sets = parse(await gameListSets(HOST_B)).sets;
    const mine = sets.filter((s) => s.id === SET_ID);
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0].orgId, 'org_b');
    assert.strictEqual(mine[0].scope, 'org');
    // The categories came from org B's OWN content partition, not org A's.
    assert.deepStrictEqual(
      mine[0].categories.map((c) => c.name).sort(), ['Innovation', 'Leadership']);
  });

  // ── 3. Host B cannot READ host A's set ────────────────────────────────────
  say('\n3. host B cannot read host A\'s set');

  const readAsB = (h, extra) => h(withEvent(HOST_B, { pathParameters: { setId: SET_ID }, ...extra }));

  // rejects: any read handler resolving a bare setId to a rebuilt platform key
  // (or, worse, accepting an `orgId` from the request) instead of searching
  // only the caller's readable scopes.
  await check('host B reading "teamretro" gets THEIR OWN questions, never host A\'s', async () => {
    const res = await readAsB(setQuestions);
    assert.strictEqual(res.statusCode, 200, res.body);
    const q = parse(res);
    assert.strictEqual(q.scope, 'org');
    assert.strictEqual(q.orgId, 'org_b');
    assert.strictEqual(q.questions.length, 3);
    assert.ok(q.questions.every((x) => /RETRO-B/i.test(x.title)),
      'host B was served host A\'s questions');
  });

  // rejects: honouring a caller-supplied scope/org without checking it, which
  // would turn `?scope=org` plus a guessed org id into a cross-tenant read.
  await check('host B cannot reach org A by naming the scope in the query', async () => {
    const res = await readAsB(setQuestions, {
      queryStringParameters: { scope: 'org', orgId: 'org_a' },
    });
    const q = parse(res);
    // Either absent (404) or their own — never org A's.
    if (res.statusCode === 200) {
      assert.strictEqual(q.orgId, 'org_b');
      assert.ok(q.questions.every((x) => /RETRO-B/i.test(x.title)));
    }
  });

  // rejects: download-question-set reading the platform partition for an org
  // set, which exports the wrong content under the right name.
  await check('the export of host B\'s set is host B\'s content', async () => {
    const res = await readAsB(downloadSet, { queryStringParameters: { format: 'csv' } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(/RETRO-B/i.test(res.body), 'export does not contain org B\'s rows');
    assert.ok(!/RETRO-A/i.test(res.body), 'org A\'s rows are in org B\'s export');
  });

  // ── 4. Host B cannot CHANGE host A's set ─────────────────────────────────
  say('\n4. host B cannot change host A\'s set');

  // These all address `teamretro`, which exists in BOTH orgs. The proof is not
  // that B is refused — B has their own teamretro and is allowed — it is that
  // ORG A'S ROWS ARE UNTOUCHED afterwards.
  const ORG_A_BEFORE = snapshot(ORG_A_META_PK) + snapshot(ORG_A_CONTENT_PK);

  const edited = await editSet(withEvent(HOST_B, {
    pathParameters: { setId: SET_ID }, body: body({ name: 'Renamed By Bo' }),
  }));
  const toggled = await toggleSet(withEvent(HOST_B, {
    pathParameters: { setId: SET_ID }, body: body({ active: false }),
  }));
  const quickstarted = await toggleQuickstart(withEvent(HOST_B, {
    pathParameters: { setId: SET_ID }, body: body({ quickstart: true }),
  }));
  const deleted = await deleteSet(withEvent(HOST_B, { pathParameters: { setId: SET_ID } }));

  // rejects: any of those four writing through an unscoped `PK: 'SETS'` key or
  // a rebuilt `SET#<id>` partition — every one of them is an UpdateItem or a
  // Delete, and every one would land on the wrong org.
  await check('host B\'s edit, toggle, quickstart and delete leave org A untouched', () => {
    assert.strictEqual(edited.statusCode, 200, edited.body);
    assert.strictEqual(toggled.statusCode, 200, toggled.body);
    assert.strictEqual(quickstarted.statusCode, 200, quickstarted.body);
    assert.strictEqual(deleted.statusCode, 200, deleted.body);
    assert.strictEqual(snapshot(ORG_A_META_PK) + snapshot(ORG_A_CONTENT_PK), ORG_A_BEFORE,
      'host B\'s writes reached org A');
  });

  // rejects: delete-question-set sweeping `SET#<id>` — the unscoped partition —
  // which would delete the platform set of the same name, or nothing at all
  // while reporting success.
  await check('...and org B\'s own set really is gone', () => {
    assert.strictEqual(rowsIn(ORG_B_META_PK).length, 0);
    assert.strictEqual(rowsIn(ORG_B_CONTENT_PK).length, 0);
  });

  // Rebuild org B so the later sections have something to work with.
  await uploadAs(HOST_B, 'Team Retro', 'retro-b');

  // rejects: dropping the requireSetManager guard that promote-set-version and
  // delete-set-version never had, which let anyone flip any set's live version.
  await check('host B cannot promote or delete a version of a set they cannot manage', async () => {
    const promoted = await promoteVersion(withEvent(HOST_A, {
      pathParameters: { setId: PLATFORM_SET_ID, version: '1' },
    }));
    assert.strictEqual(promoted.statusCode, 403, `expected 403, got ${promoted.statusCode}`);
    const removed = await deleteVersion(withEvent(HOST_A, {
      pathParameters: { setId: PLATFORM_SET_ID, version: '1' },
    }));
    assert.strictEqual(removed.statusCode, 403, `expected 403, got ${removed.statusCode}`);
  });

  // rejects: media-upload-urls or media-status resolving a bare setId to the
  // platform partition, handing out signed upload URLs against it.
  await check('host B cannot get upload URLs for a set they cannot manage', async () => {
    const res = await mediaUploadUrls(withEvent(HOST_B, {
      pathParameters: { setId: PLATFORM_SET_ID },
      body: body({ files: [{ name: 'a.jpg', contentType: 'image/jpeg', size: 100 }] }),
    }));
    assert.ok(res.statusCode === 403 || res.statusCode === 404,
      `expected a refusal, got ${res.statusCode}: ${res.body}`);
  });

  // ── 5. Host B cannot RUN host A's set ────────────────────────────────────
  say('\n5. host B cannot run host A\'s set');

  // A session that pinned org A's set. The REF row is what get-question reads,
  // and it carries the PAIR — a session that recorded only the slug would send
  // every player to whichever `teamretro` the resolver found first.
  store.set('GAME#7777|STATE', { PK: 'GAME#7777', SK: 'STATE', State: 'ASK#1', LessonNumber: 1 });
  const aQuestionSk = rowsIn(ORG_A_CONTENT_PK)
    .filter((r) => r.SK.startsWith('QUESTION#')).sort((x, y) => x.SK.localeCompare(y.SK))[0].SK;
  store.set('GAME#7777|QUESTION#001#REF', {
    PK: 'GAME#7777', SK: 'QUESTION#001#REF',
    SourceQuestionId: aQuestionSk, SetId: SET_ID, SetScope: 'org', SetOrgId: 'org_a',
    StartedAt: '2026-01-01T00:00:00.000Z',
  });

  // rejects: get-question resolving the set from the REQUEST instead of from
  // the REF row. Players are anonymous — they typed a 4-digit code — so a
  // request-derived scope is platform for every one of them, and an org
  // session's players would see nothing, or somebody else's question.
  await check('a session pinned to org A plays ORG A\'s question', async () => {
    const res = await gameQuestion({
      pathParameters: { gameId: '7777' }, queryStringParameters: { role: 'player' },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const q = parse(res);
    assert.strictEqual(q.setScope, 'org');
    assert.strictEqual(q.setOrgId, 'org_a');
    assert.ok(/RETRO-A/i.test(q.title), `served "${q.title}" — not org A's question`);
  });

  // rejects: get-categories keeping a bare `resolveSetPartition(setId)`, which
  // would build a game's category state from another library's set.
  await check('host B previewing "teamretro" sees org B\'s categories', async () => {
    const res = await gameCategories(withEvent(HOST_B, { pathParameters: { setId: SET_ID } }));
    const c = parse(res);
    assert.strictEqual(c.scope, 'org');
    assert.strictEqual(c.orgId, 'org_b');
    assert.strictEqual(c.totalCategories, 2);
  });

  // ── 6. Engage staff cannot edit an org's set ─────────────────────────────
  say('\n6. Engage staff cannot edit an org\'s set');

  const orgARow = rowsIn(ORG_A_META_PK)[0];

  // rejects: THE LINE. Restoring `if (isAdminCaller(event)) return true;` at the
  // top of canManageSet — which is how it shipped, and which hands every
  // customer's private content to anyone in the `admins` group.
  await check('canManageSet says no to Engage staff on an org set', () => {
    assert.strictEqual(access.canManageSet(STAFF, orgARow), false,
      'the admins group is granting access to org content again');
  });

  // rejects: the same restoration, seen through the handler rather than the
  // helper — a guard that is only unit-tested is a guard nobody enforces.
  await check('the edit handler refuses Engage staff on an org set', async () => {
    const before = snapshot(ORG_A_META_PK);
    const res = await editSet(withEvent(STAFF, {
      pathParameters: { setId: SET_ID }, body: body({ name: 'Renamed By Engage' }),
    }));
    assert.ok(res.statusCode === 403 || res.statusCode === 404,
      `expected a refusal, got ${res.statusCode}: ${res.body}`);
    assert.strictEqual(snapshot(ORG_A_META_PK), before, 'Engage staff rewrote an org set');
  });

  // rejects: readableScopes growing a branch that adds every org for staff —
  // there is deliberately no scope value that means "everyone's".
  await check('an org\'s sets do not appear in Engage staff\'s list', async () => {
    const staffList = parse(await adminListSets(STAFF)).questionSets;
    assert.ok(!staffList.some((s) => s.scope === 'org'),
      'org content is in the platform administrator\'s list');
    assert.ok(staffList.some((s) => s.id === PLATFORM_SET_ID));
  });

  // rejects: losing the within-org half of the rule, which would leave an org
  // admin unable to manage anything their members created — the "outage"
  // failure mode question-set-access.js's header rejects for legacy rows.
  await check('an ADMIN OF THAT ORG can edit it, though', async () => {
    const res = await editSet(withEvent(ADMIN_A, {
      pathParameters: { setId: SET_ID }, body: body({ name: 'Renamed By Ann' }),
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(rowsIn(ORG_A_META_PK)[0].name, 'Renamed By Ann');
  });

  // rejects: dropping createdBy from the rule, which would let any member of an
  // org edit any other member's set.
  await check('createdBy still decides between two members of one org', () => {
    const memberTwo = caller({
      userId: 'sub-other', username: 'other', groups: 'hosts',
      orgId: 'org_a', orgRole: 'member', orgIds: 'org_a',
    });
    assert.strictEqual(access.canManageSet(memberTwo, orgARow), false);
    assert.strictEqual(access.canManageSet(HOST_A, orgARow), true);
  });

  // ── 7. Every org can read the platform library ───────────────────────────
  say('\n7. every organisation can read the platform library');

  // rejects: readableScopes dropping PLATFORM for org members — the owner's
  // explicit requirement, and the reason the existing library needed no
  // per-customer copy and no migration.
  await check('the platform set is in BOTH orgs\' admin lists', async () => {
    for (const [who, name] of [[HOST_A, 'A'], [HOST_B, 'B']]) {
      const list = parse(await adminListSets(who)).questionSets;
      const house = list.find((s) => s.id === PLATFORM_SET_ID);
      assert.ok(house, `org ${name} cannot see the platform set`);
      assert.strictEqual(house.scope, 'platform');
      // …and cannot manage it. Readable is not writable.
      assert.strictEqual(house.canManage, false, `org ${name} can manage a platform set`);
    }
  });

  // rejects: the same loss on the game side, which would empty every host's
  // picker of the entire shipped library.
  await check('the platform set is playable from both orgs\' pickers', async () => {
    for (const who of [HOST_A, HOST_B]) {
      const sets = parse(await gameListSets(who)).sets;
      const house = sets.find((s) => s.id === PLATFORM_SET_ID);
      assert.ok(house, 'the platform set is missing from a host\'s picker');
      assert.strictEqual(house.scope, 'platform');
      assert.deepStrictEqual(house.categories.map((c) => c.name), ['Leadership']);
    }
  });

  // rejects: guarding the READ routes with requireSetManager instead of with
  // readability. No org user may MANAGE a platform set, so that guard would
  // refuse exactly the callers these routes exist for.
  await check('an org host can read and export a platform set\'s questions', async () => {
    const q = await setQuestions(withEvent(HOST_B, { pathParameters: { setId: PLATFORM_SET_ID } }));
    assert.strictEqual(q.statusCode, 200, q.body);
    assert.strictEqual(parse(q).questions.length, 2);
    assert.strictEqual(parse(q).scope, 'platform');

    const v = await getVersions(withEvent(HOST_B, { pathParameters: { setId: PLATFORM_SET_ID } }));
    assert.strictEqual(v.statusCode, 200, v.body);

    const d = await downloadSet(withEvent(HOST_B, {
      pathParameters: { setId: PLATFORM_SET_ID }, queryStringParameters: { format: 'csv' },
    }));
    assert.strictEqual(d.statusCode, 200, d.body);
    assert.ok(/HOUSE 1/.test(d.body));
  });

  // rejects: an org's set shadowing rule inverting — if platform were searched
  // first, an org that named a set after a platform one could never reach their
  // own copy again.
  await check('an org\'s own set shadows a platform set of the same slug', async () => {
    store.set('SETS|SET#teamretro', {
      PK: 'SETS', SK: `SET#${SET_ID}`, name: 'House Team Retro',
      engagementType: 'call-and-answer', active: true,
    });
    const res = await setQuestions(withEvent(HOST_B, { pathParameters: { setId: SET_ID } }));
    assert.strictEqual(parse(res).scope, 'org', 'the platform library shadowed the org\'s own set');
    store.delete('SETS|SET#teamretro');
  });

  // ── 8. The platform library is untouched ─────────────────────────────────
  say('\n8. the platform library is exactly where it was');

  // rejects: ANY migration. The owner's decision is that today's rows are
  // platform content and stay put — no move, no copy, no rename, no backfilled
  // `scope` attribute. If this ever goes red, something wrote to the live
  // library while doing tenancy work.
  await check('PK=\'SETS\' and SET#greatesthits are byte-for-byte unchanged', () => {
    assert.strictEqual(
      snapshot('SETS') + snapshot(`SET#${PLATFORM_SET_ID}`), PLATFORM_BEFORE,
      'the platform library was modified by tenant-scoped work');
  });

  // rejects: ownerStamp writing `scope: 'platform'` onto new platform rows,
  // which would make "unstamped" and "platform" different things and force
  // every reader to carry both branches.
  await check('a platform row carries no scope attribute at all', () => {
    const house = store.get(`SETS|SET#${PLATFORM_SET_ID}`);
    assert.strictEqual(house.scope, undefined);
    assert.strictEqual(house.orgId, undefined);
    assert.strictEqual(access.setScopeOf(house), 'platform',
      'an unstamped row must READ as platform');
  });

  // rejects: ownerStamp writing `scope: 'platform'` onto a row it creates in
  // the platform library. Absence IS the stamp there — a new platform row must
  // be indistinguishable in shape from the ~41 that predate tenancy, or
  // "unstamped" and "platform" stop being one thing and every reader needs two
  // branches. Driven through the real importer, because the seeded fixture
  // above never passes through ownerStamp at all.
  await check('a platform set CREATED TODAY is stamped the same way: not at all', async () => {
    const res = await uploadAs(STAFF, 'House Rules', 'house-rules');
    assert.strictEqual(res.statusCode, 200, res.body);
    const row = store.get('SETS|SET#houserules');
    assert.ok(row, 'Engage staff could not create a platform set');
    assert.strictEqual(row.scope, undefined, 'a platform row must carry no scope attribute');
    assert.strictEqual(row.orgId, undefined);
    assert.strictEqual(row.createdBy, 'sub-eve', 'the creator is still recorded');
    assert.strictEqual(rowsIn('SET#houserules').filter((r) => r.SK.startsWith('QUESTION#')).length, 3);
  });

  // rejects: a `ttl` creeping onto set metadata. `ttl` is for SESSION data only
  // (docs/02-data-model.md). AI prompts once carried a 365-day ttl and silently
  // vanished a year later; a question set doing the same would take a
  // customer's whole library with it.
  await check('nothing written here carries a ttl', () => {
    const contentRows = [...store.values()].filter((i) => !String(i.PK).startsWith('GAME#'));
    const ttls = contentRows.filter((i) => i.ttl !== undefined).map(k);
    assert.deepStrictEqual(ttls, [], `set rows must never carry a ttl: ${ttls.join(', ')}`);
  });

  // ── 9. The three bundle copies of the resolver ──────────────────────────
  say('\n9. the three copies of set-version.js have not drifted');

  // CodeUri is per-directory and there are no Lambda layers, so set-version.js
  // is triplicated exactly as tenant.js is (pinned the same way in
  // tests/tenant-keys.js §8). It now builds SCOPED partition keys, so a drift
  // between the copies is one bundle addressing a different library from the
  // others — the game reading org content the admin console wrote to platform,
  // or the reverse. Only the "(this file)" marker in the header may differ.
  //
  // rejects: patching game/set-version.js and forgetting admin/shared, which is
  // the exact shape of the defect this pins and which no other test would see.
  {
    const fs = require('fs');
    const strip = (t) => t.replace(/ *\(this file\)/g, '');
    const copies = [
      'lambda-functions/game/set-version.js',
      'lambda-functions/websocket/set-version.js',
      'lambda-functions/admin/shared/set-version.js',
    ].map((rel) => ({ rel, body: strip(fs.readFileSync(path.join(REPO, rel), 'utf8')) }));
    for (const c of copies.slice(1)) {
      await check(`${c.rel} matches game/set-version.js`, () =>
        assert.strictEqual(c.body, copies[0].body,
          'the copies have drifted — one bundle is resolving a different partition'));
    }
  }

  /* ── WRITING TO ENGAGE'S OWN LIBRARY ────────────────────────────────────
     "they should be able to add questions to their personal space or org or to
      the overall engage space as a engage manager/admin."

     The first two always worked. The third could not happen from the product at
     all, and the reason is the DEFAULT below rather than any refusal: with no
     scope asked for, `createSetRef` tries the caller's organisation first — and
     since every approved account is given a personal one, an Engage admin
     always has an organisation, so a set made anywhere became a personal set.

     So the Shared library screen sends `scope: 'platform'` explicitly. These
     assertions are the contract that screen depends on. */
  say('\n8. an Engage admin can write to the shared library, and only they can');
  {
    const ev = (groups, orgId, role) => ({
      requestContext: { authorizer: { lambda: { userId: 'u1', groups, orgId, orgRole: role } } },
    });
    /* ACTING AS ENGAGE — no active organisation. Writing Engage's library needs
       the staff group AND the mode: an Engage admin standing inside a team
       renamed a platform set on dev, and every org reads that library. */
    const staffAsEngage = ev('admins,hosts', '', '');
    const staffInOrg = ev('admins,hosts', 'org_3JtYs6WgHn5RkMqZaB7uEv', 'owner');
    const host = ev('hosts', 'org_9xK4Fq7Pz2mNbVc8dQwLxR', 'member');

    // rejects: the UI's assumption that asking is enough. It is enough only
    // BECAUSE the caller is in `admins`; canManageScope decides, not the ask.
    await check('staff ACTING AS ENGAGE asking for the platform scope get it', () =>
      assert.deepStrictEqual(
        access.createSetRef(staffAsEngage, 'newset', 'platform'),
        { scope: 'platform', orgId: '', setId: 'newset' }));

    // rejects: the reported bug's create-side twin — staff inside a team
    // writing a new set into the library every organisation reads.
    await check('the same staff INSIDE an organisation are refused it', () =>
      assert.strictEqual(access.createSetRef(staffInOrg, 'newset', 'platform'), null));

    // rejects: A HOST PUBLISHING INTO THE SHARED LIBRARY by passing a scope in
    // the request body. This is the whole reason the scope is a request rather
    // than an instruction — the field is client-supplied.
    await check('a host asking for it is REFUSED, not quietly downgraded', () =>
      assert.strictEqual(access.createSetRef(host, 'newset', 'platform'), null,
        'a host must not be able to write into the library every other customer reads'));

    // rejects: changing the default to platform for staff, which would put an
    // Engage admin's own drafts into every organisation's library.
    await check('with nothing asked for, staff still write to their own org', () =>
      assert.deepStrictEqual(
        access.createSetRef(staffInOrg, 'newset', ''),
        { scope: 'org', orgId: 'org_3JtYs6WgHn5RkMqZaB7uEv', setId: 'newset' }));

    await check('and so does a host', () =>
      assert.deepStrictEqual(
        access.createSetRef(host, 'newset', ''),
        { scope: 'org', orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR', setId: 'newset' }));
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
