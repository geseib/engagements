/**
 * QUESTION SETS: WHO MAY REACH A ROUTE, AND WHO MAY CHANGE A ROW.
 *
 * The owner's rule: a host may create question sets, and may edit or delete only
 * the ones they created; an admin may edit or delete any of them.
 *
 * That is TWO separate decisions and this file proves both, because either one
 * alone is a hole:
 *
 *   1. THE GATE (auth/authorizer.js). Which groups may reach the route at all.
 *      Opened from `admins` to `hosts,admins` for exactly five route pairs.
 *   2. THE ROW (admin/shared/question-set-access.js, enforced in the handlers).
 *      Which SET a caller who got through may actually change.
 *
 * Section 1 without section 3 is a product where any host edits any set. Section
 * 3 without section 1 is a product where no host reaches the route. And section
 * 3 driving the REAL handlers is the part that matters most: a hidden button is
 * not a permission, so every refusal below is asserted against a hand-made
 * request with no UI involved, and asserted to have written NOTHING.
 *
 * ── THE EVENT SHAPE IS THE POINT, AGAIN ────────────────────────────────────
 *
 * `CognitoAuthorizer` is a CUSTOM Lambda authorizer despite the name (payload
 * format 2.0, `EnableSimpleResponses: true`), NOT a Cognito JWT authorizer. Its
 * context reaches a handler at `event.requestContext.authorizer.lambda`, with
 * groups COMMA-JOINED into a string — `auth/authorizer.js:171-182` is the code
 * that emits it and the fixtures below are copied from there. RESUME.md §1
 * records eighteen tests that asserted `.jwt.claims` instead, a shape this API
 * never produces: all eighteen passed against a guard that would have 403'd
 * every real administrator. Section 1 additionally drives the REAL authorizer
 * handler on REAL route keys, so the literals here are checked against the path
 * the authorizer actually derives rather than one this file made up.
 *
 * ── THE LEGACY-SET DECISION, ASSERTED ──────────────────────────────────────
 *
 * No SETS row written before this change carries `createdBy`. Section 2 and
 * section 3 both pin down the answer chosen: an unowned set is ADMIN-ONLY.
 * Admins keep everything they could do yesterday (section 3.4 — the
 * not-locked-out test, without which the sensible reaction to a broken guard is
 * to delete the guard), and no host inherits content they did not create
 * (section 3.3). Change that decision and both go red.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before anything under test loads ---------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

// -- Cognito + JWT, for the authorizer itself --------------------------------
let userGroups = [];
class AdminListGroupsForUserCommand { constructor(i) { this.input = i; } }
stubs.set('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class {
    async send() { return { Groups: userGroups.map((GroupName) => ({ GroupName })) }; }
  },
  AdminListGroupsForUserCommand,
});
// The "token" is a JSON blob of claims and the stub verifies it by parsing.
// Signature verification is not what this file is about.
stubs.set('jsonwebtoken', { decode: () => ({ header: { kid: 'test-kid' } }), verify: (t) => JSON.parse(t) });
stubs.set('jwk-to-pem', () => 'stub-pem');
stubs.set('axios', { get: async () => ({ data: { keys: [{ kid: 'test-kid' }] } }) });

// -- DynamoDB, for the handlers ----------------------------------------------
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';
const store = new Map();
const log = [];
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);

/**
 * Apply a `SET a = :a` UpdateExpression, strictly — an unmapped name or value
 * throws rather than being ignored. Borrowed from edit-question-set-flow.js for
 * the same reason: a stub that accepts anything would pass while the product
 * wrote nothing.
 */
function applyUpdate(item, inp) {
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const m = /^\s*SET\s+([\s\S]*)$/i.exec(inp.UpdateExpression || '');
  if (!m) throw new Error(`unsupported UpdateExpression: ${inp.UpdateExpression}`);
  for (const clause of m[1].split(/,(?![^(]*\))/)) {
    const parts = clause.split('=');
    if (parts.length !== 2) throw new Error(`unsupported clause: ${clause}`);
    const lhs = parts[0].trim();
    const rhs = parts[1].trim();
    const attr = lhs.startsWith('#') ? names[lhs] : lhs;
    if (!attr) throw new Error(`unmapped attribute name ${lhs}`);
    if (rhs.startsWith('list_append')) { item[attr] = item[attr] || []; continue; }
    if (!(rhs in values)) throw new Error(`unmapped attribute value ${rhs}`);
    item[attr] = values[rhs];
  }
  return item;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });
    if (cmd.type === 'get') return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(k(inp.Key.PK, inp.Key.SK)); return {}; }
    if (cmd.type === 'update') {
      const id = k(inp.Key.PK, inp.Key.SK);
      const item = store.get(id) || { ...inp.Key };
      applyUpdate(item, inp);
      store.set(id, item);
      return { Attributes: item };
    }
    if (cmd.type === 'batchWrite') {
      for (const reqs of Object.values(inp.RequestItems || {})) {
        for (const r of reqs) {
          if (r.PutRequest) put(r.PutRequest.Item);
          if (r.DeleteRequest) store.delete(k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
        }
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'];
      const prefix = v[':sk'] ?? '';
      const items = [...store.values()]
        .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
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
stubs.set('@aws-sdk/client-kms', kmsStub.exports);
// Every org gets a deterministic data key, no ORG#<id>/METADATA row needed —
// otherwise every reset() in this file would have to re-seed one.
installTestKeyLoader();
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;
process.env.USER_POOL_ID = 'us-east-1_TEST';
process.env.CLIENT_ID = 'test-client-id';
process.env.REGION = 'us-east-1';

const { requiredGroupsForRoute, handler: authorize } =
  require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const access = require(path.join(REPO, 'lambda-functions/admin/shared/question-set-access.js'));
const editSet = require(path.join(REPO, 'lambda-functions/admin/edit-question-set.js')).handler;
const deleteSet = require(path.join(REPO, 'lambda-functions/admin/delete-question-set.js')).handler;
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;
const adminList = require(path.join(REPO, 'lambda-functions/admin/get-question-sets.js')).handler;
const toggleQuickstart = require(path.join(REPO, 'lambda-functions/admin/toggle-quickstart.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
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

// ---- Fixtures --------------------------------------------------------------

/** A caller in THIS API'S REAL SHAPE (auth/authorizer.js:171-182). */
const callerEvent = ({ groups, userId, username = 'someone', orgId, orgRole } = {}) => ({
  requestContext: {
    authorizer: {
      lambda: {
        username,
        ...(userId === undefined ? {} : { userId }),
        ...(groups === undefined ? {} : { groups }),
        ...(orgId === undefined ? {} : { orgId }),
        ...(orgRole === undefined ? {} : { orgRole }),
        status: 'enabled',
      },
    },
  },
});

// ── TENANCY: content now belongs to an ORGANISATION, and these two hosts are
// in the SAME one.
//
// That is the sharper version of what this file was already testing. Before
// tenancy the question was "did you create it?"; now it is "is it your org's,
// and did you create it?" — so putting Ivy and Raj in different orgs would make
// every refusal below pass for the wrong reason (a scope miss rather than an
// ownership miss). Same org, different creators, keeps the original question.
const ORG = 'org_nw';
const HOST = { groups: 'hosts', userId: 'sub-ivy', username: 'ivy', orgId: ORG, orgRole: 'member' };
const OTHER_HOST = { groups: 'hosts', userId: 'sub-raj', username: 'raj', orgId: ORG, orgRole: 'member' };
// Engage staff. NOTE they carry an org too: after this change being a platform
// admin grants no content access at all, so an admin acting on org content is
// acting as a member of that org, not as staff.
const ADMIN = { groups: 'hosts,admins', userId: 'sub-ada', username: 'ada', orgId: ORG, orgRole: 'admin' };

/*
  THE SAME PERSON, ACTING AS ENGAGE — no active organisation.

  A legacy set carries no `scope`, and absence of scope IS the platform stamp,
  so every assertion below about "an admin and an unowned set" is really about
  ENGAGE'S SHARED LIBRARY. Writing that now needs the staff group AND the
  absence of an active org: an Engage admin standing inside a customer's team
  renamed a platform set on dev, and every organisation reads that library.

  The ownership rule these tests exist for is unchanged — an administrator is
  not second-class on content they did not personally upload. What changed is
  that they have to be wearing the right hat.
*/
const ADMIN_AS_ENGAGE = { groups: 'hosts,admins', userId: 'sub-ada', username: 'ada', orgId: '', orgRole: '' };

/** A payload-2.0 REQUEST authorizer event, as API Gateway builds it. */
const authEvent = (routeKey) => {
  const token = JSON.stringify({ sub: 'user-sub-1', 'cognito:username': 'ivy', email: 'ivy@example.invalid' });
  const rawPath = routeKey.split(' ')[1];
  return {
    version: '2.0',
    type: 'REQUEST',
    routeKey,
    rawPath,
    identitySource: [`Bearer ${token}`],
    headers: { authorization: `Bearer ${token}` },
    requestContext: { routeKey, http: { method: routeKey.split(' ')[0], path: rawPath } },
  };
};
async function authorizeAs(groups, routeKey) {
  userGroups = groups;
  return authorize(authEvent(routeKey));
}

const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image';
const CSV = [
  HEADER,
  '"Renaissance",1,"THE SMILE","A portrait.","Leonardo","Invent a title.",""',
  '"Renaissance",2,"THE NIGHT","A sky.","Van Gogh","Invent a title.",""',
].join('\n');

const parse = (res) => JSON.parse(res.body);
// ── TENANCY: WHICH PARTITION A FIXTURE SET LIVES IN ────────────────────────
//
// A set is now in one of three scopes, and the scope decides who may manage it
// before ownership is even consulted:
//
//   PLATFORM  PK='SETS'              central content. Engage staff only.
//   ORG       PK='ORG#<org>#SETS'    a team's own. Its members, per creator.
//
// Every fixture in this file used to be seeded at `PK='SETS'`, which is now
// PLATFORM — so "a host may manage their own set" correctly became false, and
// fifteen assertions went red for the right reason. The default is now the ORG
// partition, because that is what "a host's own set" means; `scope: 'platform'`
// opts a fixture back into the shared library for the tests that are about it.
const ORG_SETS = `ORG#${ORG}#SETS`;
// Find a fixture's row WHEREVER it was seeded. Org first, then platform — the
// same order `readableSetRefs` uses, and for the same reason: an org's own set
// shadows a platform set of the same slug. Doing the lookup here rather than
// making every assertion name a scope keeps the assertions about ownership,
// which is what this file is for.
// DECRYPTED for the org partition. An org set's `name`/`description` are
// envelopes at rest; a platform row is plaintext and passes straight through
// (plainRow only unwraps what is envelope-shaped).
const metaOf = (setId) => {
  const org = store.get(k(ORG_SETS, `SET#${setId}`));
  if (org) return plainRow(ORG, org);
  return store.get(k('SETS', `SET#${setId}`));
};
const contentRows = (setId) => {
  const org = [...store.values()]
    .filter((i) => String(i.PK).startsWith(`ORG#${ORG}#SET#${setId}`));
  if (org.length) return org;
  // `startsWith` alone would let `SET#eighties` also match `SET#eightiesplus`,
  // so anchor on the version separator or the exact id.
  return [...store.values()].filter((i) => {
    const pk = String(i.PK);
    return pk === `SET#${setId}` || pk.startsWith(`SET#${setId}#v`);
  });
};

function seedSet(setId, {
  owner, name = setId, questions = 2, createdBy, createdByName, scope = 'org',
} = {}) {
  const platform = scope === 'platform';
  const metaPk = platform ? 'SETS' : ORG_SETS;
  const contentPk = platform ? `SET#${setId}` : `ORG#${ORG}#SET#${setId}`;
  put({
    PK: metaPk, SK: `SET#${setId}`, name,
    description: 'seeded', engagementType: 'call-and-answer',
    questionCount: questions, categoryCount: 1, active: true,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    // Platform rows carry NO scope/orgId attributes — that absence IS the
    // platform marker, which is what keeps the ~41 legacy rows shape-identical
    // to a newly created one and the migration at zero.
    // The real shape a writer produces: `scope` and `orgId` TOGETHER.
    // ownerStamp() writes both, and setScopeOf() reads `scope` first.
    ...(platform ? {} : { scope: 'org', orgId: ORG }),
    // `owner` deliberately omitted for the legacy rows: that is the whole point.
    ...(owner ? { createdBy: owner.userId, createdByName: owner.username } : {}),
    // Set the two ownership attributes INDEPENDENTLY, for the rows that exist
    // to prove sub and username are not interchangeable. Seeding both from one
    // `owner` makes every fixture a row where they agree, and a rule that reads
    // the wrong one is then indistinguishable from the right one.
    ...(createdBy === undefined ? {} : { createdBy }),
    ...(createdByName === undefined ? {} : { createdByName }),
  });
  put({ PK: contentPk, SK: 'CATEGORY#c001', Name: 'Renaissance', QuestionCount: questions });
  for (let q = 1; q <= questions; q++) {
    put({ PK: contentPk, SK: `QUESTION#c001#${String(q).padStart(3, '0')}`, Title: `Q${q}` });
  }
}
function reset() { store.clear(); log.length = 0; }

(async () => {
  // =========================================================================
  say('\n1. THE GATE — which groups may reach which route');

  // REJECTS: not adding HOST_ADMIN_ROUTES at all. Without it every one of these
  // falls through to `path.startsWith('admin')` and returns ['admins'], so a
  // host is refused before any handler runs and the whole feature is dead.
  const HOST_REACHABLE = [
    ['GET', 'admin/question-sets'],
    ['POST', 'admin/upload-questions'],
    ['GET', 'admin/download-template'],
    ['PUT', 'admin/edit-question-set/{setId}'],
    ['DELETE', 'admin/question-sets/{setId}'],
    // Opened 2026-08-15 at the owner's request, and only safe because
    // `toggle-quickstart.js` gained a `requireSetManager` guard in the same
    // change. Section 3.6 is the half that makes this line defensible: without
    // the row guard this entry hands every host every set's quickstart flag.
    ['POST', 'admin/toggle-quickstart/{setId}'],
  ];
  for (const [method, p] of HOST_REACHABLE) {
    check(`${method} ${p} admits hosts and admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute(method, p), ['hosts', 'admins']));
  }

  // REJECTS: returning a bare string instead of an array. hasPermission calls
  // .some() on it, which throws, which the handler catches as a blanket denial.
  check('...and returns an array, which is what hasPermission needs', () =>
    assert.ok(Array.isArray(requiredGroupsForRoute('POST', 'admin/upload-questions'))));

  say('\n1b. and NOTHING ELSE under /admin — the narrowness that makes this safe');

  // REJECTS: `path.startsWith('admin/question-sets')` in place of the exact
  // "METHOD path" match. That spelling reads as the same intent and would
  // additionally hand hosts the three VERSION routes — including a DELETE and
  // the promote that decides which content every live game plays.
  const STILL_ADMIN_ONLY = [
    ['GET', 'admin/question-sets/{setId}/versions'],
    ['DELETE', 'admin/question-sets/{setId}/versions/{version}'],
    ['POST', 'admin/question-sets/{setId}/versions/{version}/promote'],
    // REJECTS: widening from quickstart to the whole toggle/curation surface.
    // Quickstart moved to the host list above because it ADDS a set the host
    // owns to one shelf; active/inactive can take any set OUT of every picker,
    // it was not asked for, and its handler has no ownership guard at all.
    ['POST', 'admin/toggle-question-set/{setId}'],
    // REJECTS: adding the download route "while we are here". Not asked for.
    ['GET', 'admin/download-question-set/{setId}'],
    /*
      ── THESE FOUR MOVED, AND THE REASON THEY WERE HERE EXPIRED ────────────

      They were listed as must-stay-admins-only, and the argument was money:
      "reaching one is a Bedrock spend, and a host's question-set permissions
      say nothing about budget." That was exactly right while there was no way
      to say WHOSE budget — every generation was an unattributable charge
      against the platform.

      Tenancy answered it. A generation now happens inside an organisation: the
      caller carries an `orgId`, the org carries a plan, and the metering ledger
      exists to attribute the spend. The owner's call — "now that we have teams
      with purchase and tracking capabilities coming in, it is ok to let it have
      the full AI Builder experience in the host create question set."

      They are covered by tests/host-ai-builder-routes.js now, which asserts
      BOTH halves of every job are open (opening only the POST spends the money
      and then refuses the answer) and that the prompt LIBRARY writes are not —
      those shape what the AI does for every organisation and stay Engage's.
    */
    // REJECTS: any regression in the guard that matters most.
    ['POST', 'admin/users/list'],
    ['PUT', 'admin/users/{username}/state'],
    ['DELETE', 'admin/clear-all-games'],
  ];
  for (const [method, p] of STILL_ADMIN_ONLY) {
    check(`${method} ${p} is still admins-only`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute(method, p), ['admins'],
        'a host can now reach a route nobody asked to share'));
  }

  // REJECTS: keying the table on the path alone and ignoring the method. The
  // route table is METHOD-specific, so a GET-only entry must not open a POST at
  // the same path.
  check('the METHOD is part of the match, not just the path', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/question-sets'), ['admins']));

  // REJECTS: a loose match that catches a longer path with the same prefix.
  check('a longer path that merely starts the same is not the route', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/upload-questions/bulk'), ['admins']));

  say('\n1c. the routes that were already shared, still shared');

  // REJECTS: reordering the branches so the new Set shadows clear-game, or
  // dropping the precedent this change was modelled on.
  check('admin/clear-game is untouched', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('DELETE', 'admin/clear-game/{gameId}'), ['hosts', 'admins']));
  check("GET 'games' (the directory) is untouched", () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games'), ['hosts', 'admins']));
  // REJECTS: any change that 401s the participant journey.
  check("GET 'games/{gameId}' still needs no groups", () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}'), []));

  say('\n1d. the REAL authorizer, on REAL route keys');

  // REJECTS: writing the literals with a leading slash, or otherwise failing to
  // match the path the authorizer actually derives. requiredGroupsForRoute is
  // called with routeKey's path stripped of its leading slash, and section 1
  // alone cannot prove the table agrees with that derivation — it asserts the
  // function against strings this file chose. This drives the handler end to end
  // so API Gateway's routeKey picks the string instead.
  for (const routeKey of [
    'POST /admin/upload-questions',
    'PUT /admin/edit-question-set/{setId}',
    'DELETE /admin/question-sets/{setId}',
    'GET /admin/question-sets',
  ]) {
    await checkAsync(`a host is authorized for ${routeKey}`, async () =>
      assert.strictEqual((await authorizeAs(['hosts'], routeKey)).isAuthorized, true,
        'the gate is closed to hosts — the feature cannot work'));
  }

  // REJECTS: treating "signed in" as "allowed". A pending account has passed
  // authentication and must still be refused.
  await checkAsync('a `pending` account is refused the upload route', async () =>
    assert.strictEqual((await authorizeAs(['pending'], 'POST /admin/upload-questions')).isAuthorized, false));
  await checkAsync('an account in no group at all is refused', async () =>
    assert.strictEqual((await authorizeAs([], 'POST /admin/upload-questions')).isAuthorized, false));

  // REJECTS: the gate leaking sideways. Same caller, a route not on the list.
  await checkAsync('a host is still refused the version DELETE', async () =>
    assert.strictEqual(
      (await authorizeAs(['hosts'], 'DELETE /admin/question-sets/{setId}/versions/{version}')).isAuthorized, false));
  await checkAsync('a host is still refused the user admin route', async () =>
    assert.strictEqual((await authorizeAs(['hosts'], 'POST /admin/users/list')).isAuthorized, false));

  // REJECTS: a change that locks admins out of what they always had.
  await checkAsync('an admin is authorized for the version DELETE', async () =>
    assert.strictEqual(
      (await authorizeAs(['admins'], 'DELETE /admin/question-sets/{setId}/versions/{version}')).isAuthorized, true));

  // =========================================================================
  say('\n2. THE ROW RULE — canManageSet, as a pure function');

  // A set Ivy made. Since tenancy that means an ORG set: `scope` and `orgId`
  // together, which is what ownerStamp writes.
  const owned = {
    SK: 'SET#ivys', scope: 'org', orgId: ORG,
    createdBy: 'sub-ivy', createdByName: 'ivy',
  };
  // No createdBy AND no scope — the shape of every set that exists today. The
  // absence of `scope` is what marks it as central Engage content, which is why
  // there is no migration: these rows are already correct.
  const legacy = { SK: 'SET#eighties', name: '80s Trivia' };

  // REJECTS: dropping the admin short-circuit, which would make admins
  // second-class on content they did not personally upload.
  check('an admin may manage a set they do not own', () =>
    assert.ok(access.canManageSet(callerEvent(ADMIN), owned)));
  check('an admin acting as Engage may manage a set with NO owner recorded', () =>
    assert.ok(access.canManageSet(callerEvent(ADMIN_AS_ENGAGE), legacy)));
  // rejects: the reported bug — an Engage admin inside a team editing the
  // shared library, where the row looks like one of that team's own.
  check('...but not while standing inside an organisation', () =>
    assert.ok(!access.canManageSet(callerEvent(ADMIN), legacy)));

  // REJECTS: the whole feature being ownership-blind.
  check('a host may manage their own set', () =>
    assert.ok(access.canManageSet(callerEvent(HOST), owned)));
  check("a host may NOT manage another host's set", () =>
    assert.ok(!access.canManageSet(callerEvent(OTHER_HOST), owned)));

  // REJECTS: option (b) — reading "no owner" as "everyone's". THE decision.
  check('a host may NOT manage a set with no owner recorded (legacy sets are admin-only)', () =>
    assert.ok(!access.canManageSet(callerEvent(HOST), legacy)));

  // REJECTS: comparing with `==` or without the empty guards, where '' === ''
  // hands every legacy set to every unidentified caller.
  check('an anonymous caller manages nothing', () =>
    assert.ok(!access.canManageSet({}, owned)));
  check('...not even an unowned set', () =>
    assert.ok(!access.canManageSet({}, legacy)));
  check('an empty owner does not match an empty caller id', () =>
    assert.ok(!access.canManageSet(callerEvent({ groups: 'hosts', userId: '' }), { createdBy: '' })));

  // REJECTS: authorising on the display name. createdByName is mutable and is
  // never the identifier.
  check('a matching display name with a different sub does not pass', () =>
    assert.ok(!access.canManageSet(
      callerEvent({ groups: 'hosts', userId: 'sub-impostor', username: 'ivy' }), owned)));

  // REJECTS: a substring or prefix comparison of subs.
  check('a sub that merely starts the same does not pass', () =>
    assert.ok(!access.canManageSet(callerEvent({ groups: 'hosts', userId: 'sub-iv' }), owned)));

  // REJECTS: reading groups from .jwt.claims only — the shape this API never
  // produces. If that regressed, this admin would be read as a plain host and
  // denied the legacy set above.
  check('groups are read from .authorizer.lambda, comma-joined', () =>
    assert.ok(access.canManageSet(callerEvent({ groups: 'hosts,admins', userId: 'sub-x' }), legacy)));

  // REJECTS: dropping the JWT fallbacks, so a route moved onto a native JWT
  // authorizer silently stops recognising its owners.
  // The org half travels in claims too (`custom:orgId` / `custom:orgRole`), or
  // the fallback only half works: the caller would be identified as the owner
  // and then refused for having no organisation.
  check('a native JWT authorizer still identifies the owner', () =>
    assert.ok(access.canManageSet(
      { requestContext: { authorizer: { jwt: { claims: {
        sub: 'sub-ivy', 'custom:orgId': ORG, 'custom:orgRole': 'member',
      } } } } }, owned)));

  say('\n2b. ownerStamp');

  // REJECTS: stamping an owner of '' for an unattributable write, which
  // isSetOwner would then have to special-case at every read.
  check('an unidentifiable caller stamps no owner at all', () =>
    assert.deepStrictEqual(access.ownerStamp({}), {}));
  check('an identified caller stamps sub and name', () =>
    assert.deepStrictEqual(access.ownerStamp(callerEvent(HOST)),
      { createdBy: 'sub-ivy', createdByName: 'ivy' }));

  // =========================================================================
  say('\n3. THE HANDLERS — a hand-made request, no UI involved');
  say('\n3.1 edit');

  reset();
  seedSet('ivys', { owner: HOST, name: 'Ivy original' });

  // REJECTS: enforcing ownership in the console only. This is the request a
  // curl one-liner sends, and it must be refused by the handler itself.
  let res = await editSet({
    ...callerEvent(OTHER_HOST),
    pathParameters: { setId: 'ivys' },
    body: JSON.stringify({ name: 'Raj took this' }),
  });
  check("a host editing another host's set is refused with 403", () =>
    assert.strictEqual(res.statusCode, 403, res.body));
  // REJECTS: checking ownership AFTER the write, which would refuse and mutate.
  check('...and the name on the row is untouched', () =>
    assert.strictEqual(metaOf('ivys').name, 'Ivy original'));
  check('...and no update was issued at all', () =>
    assert.strictEqual(log.filter((c) => c.type === 'update').length, 0));

  // REJECTS: a guard so strict the owner cannot edit their own set — the
  // failure that sends someone back to deleting the guard.
  reset();
  seedSet('ivys', { owner: HOST, name: 'Ivy original' });
  res = await editSet({
    ...callerEvent(HOST),
    pathParameters: { setId: 'ivys' },
    body: JSON.stringify({ name: 'Ivy renamed', description: 'now with a description' }),
  });
  check('a host editing their OWN set succeeds', () =>
    assert.strictEqual(res.statusCode, 200, res.body));
  check('...and the rename really landed', () =>
    assert.strictEqual(metaOf('ivys').name, 'Ivy renamed'));

  say('\n3.2 edit — the legacy sets, which is the decision');

  reset();
  seedSet('eighties', { name: '80s Trivia', scope: 'platform' });   // no owner, like every set today

  // REJECTS: option (b). A host must not inherit the house content.
  res = await editSet({
    ...callerEvent(HOST),
    pathParameters: { setId: 'eighties' },
    body: JSON.stringify({ name: 'mine now' }),
  });
  check('a host may NOT edit an unowned legacy set', () =>
    assert.strictEqual(res.statusCode, 403, res.body));
  check('...and it is unchanged', () =>
    assert.strictEqual(metaOf('eighties').name, '80s Trivia'));

  // REJECTS: option (a) — an unowned set nobody can touch. This is the outage
  // test: every set in every tier is unowned right now.
  res = await editSet({
    ...callerEvent(ADMIN_AS_ENGAGE),
    pathParameters: { setId: 'eighties' },
    body: JSON.stringify({ name: '80s Trivia (curated)' }),
  });
  check('an admin acting as Engage CAN still edit an unowned legacy set', () =>
    assert.strictEqual(res.statusCode, 200, res.body));
  check('...and the rename landed', () =>
    assert.strictEqual(metaOf('eighties').name, '80s Trivia (curated)'));

  say('\n3.3 edit — the upsert that used to manufacture rows');

  reset();
  // REJECTS: removing the existence read and going straight to UpdateCommand.
  // UpdateCommand is an upsert: a PUT to any id used to CREATE a SETS row with
  // nothing but a name — no type, no questions, and no owner. Harmless while
  // only admins could call it; a way around the ownership rule now.
  res = await editSet({
    ...callerEvent(HOST),
    pathParameters: { setId: 'invented-out-of-thin-air' },
    body: JSON.stringify({ name: 'A set that never existed' }),
  });
  check('editing a set that does not exist is a 404', () =>
    assert.strictEqual(res.statusCode, 404, res.body));
  check('...and NO row was conjured into the table', () =>
    assert.strictEqual(metaOf('invented-out-of-thin-air'), undefined,
      'the upsert is back: a PUT just created a set row out of nothing'));

  say('\n3.4 delete');

  reset();
  seedSet('ivys', { owner: HOST, questions: 3 });

  // REJECTS: guarding delete only in the dialog.
  res = await deleteSet({ ...callerEvent(OTHER_HOST), pathParameters: { setId: 'ivys' } });
  check("a host deleting another host's set is refused with 403", () =>
    assert.strictEqual(res.statusCode, 403, res.body));
  // REJECTS: placing the guard after the content sweep, which would refuse the
  // request while having already destroyed the questions.
  check('...and every content row is still there', () =>
    assert.strictEqual(contentRows('ivys').length, 4));
  check('...and the index row is still there', () =>
    assert.ok(metaOf('ivys')));
  check('...and no delete or batchWrite was issued', () =>
    assert.strictEqual(log.filter((c) => c.type === 'delete' || c.type === 'batchWrite').length, 0));

  reset();
  seedSet('ivys', { owner: HOST, questions: 3 });
  res = await deleteSet({ ...callerEvent(HOST), pathParameters: { setId: 'ivys' } });
  check('a host deleting their OWN set succeeds', () =>
    assert.strictEqual(res.statusCode, 200, res.body));
  check('...and the set is gone', () => assert.strictEqual(metaOf('ivys'), undefined));

  reset();
  seedSet('eighties', { scope: 'platform' });
  res = await deleteSet({ ...callerEvent(HOST), pathParameters: { setId: 'eighties' } });
  check('a host may NOT delete an unowned legacy set', () =>
    assert.strictEqual(res.statusCode, 403, res.body));
  check('...and it survives intact', () => assert.ok(metaOf('eighties')));

  reset();
  seedSet('eighties', { scope: 'platform' });
  res = await deleteSet({ ...callerEvent(ADMIN_AS_ENGAGE), pathParameters: { setId: 'eighties' } });
  check('an admin acting as Engage CAN still delete an unowned legacy set', () =>
    assert.strictEqual(res.statusCode, 200, res.body));

  say('\n3.5 create — the set records who made it');

  reset();
  res = await upload({
    ...callerEvent(HOST),
    body: JSON.stringify({
      fileName: 'ivy.csv', fileContent: CSV,
      customTitle: 'Ivy Set', engagementType: 'call-and-answer',
    }),
  });
  check('a host can create a question set', () =>
    assert.strictEqual(res.statusCode, 200, res.body));
  const created = metaOf(parse(res).setId);
  // REJECTS: not stamping the owner. Without it a host creates a set and is
  // then locked out of it, because an unowned set is admin-only.
  check('...and the row records their sub', () =>
    assert.strictEqual(created.createdBy, 'sub-ivy'));
  check('...and their name, for display', () =>
    assert.strictEqual(created.createdByName, 'ivy'));

  // REJECTS: the creator being unable to edit what they just made — the
  // end-to-end version of the stamp above.
  res = await editSet({
    ...callerEvent(HOST),
    pathParameters: { setId: parse(res).setId },
    body: JSON.stringify({ name: 'Ivy Set, renamed' }),
  });
  check('...and they can immediately edit it', () =>
    assert.strictEqual(res.statusCode, 200, res.body));

  say('\n3.6b quickstart — the newest route on the host list');

  /*
    WHY THIS SECTION EXISTS AT ALL.

    `POST admin/toggle-quickstart/{setId}` sat in section 1b's admins-only list
    until 2026-08-15, excluded by name, on the grounds that quickstart is GLOBAL
    curation: `QuickstartMenu.jsx:46` filters on `set.quickstart && set.active`
    with no ownership term, so a flagged set shows on EVERY host's menu.

    The owner asked for it on the host list — "host question set lists, should
    allow quick starts easily marked by clicking a tag on list just like the
    admin" — so section 1 now admits hosts. That is only defensible because the
    handler gained a row guard in the same change. THIS is that half. Delete the
    `requireSetManager` call from toggle-quickstart.js and section 1 alone would
    still be green while any host could flag any set in the library.
  */

  reset();
  seedSet('ivys', { owner: HOST });
  seedSet('eighties', { scope: 'platform' });  // legacy, unowned -> admin-only by rule

  const flip = (caller, setId, quickstart) => toggleQuickstart({
    ...callerEvent(caller),
    pathParameters: { setId },
    body: JSON.stringify({ quickstart }),
  });

  res = await flip(HOST, 'ivys', true);
  check('a host flags their OWN set', () =>
    assert.strictEqual(res.statusCode, 200, res.body));
  check('...and the flag actually landed', () =>
    assert.strictEqual(metaOf('ivys').Quickstart, true));

  // REJECTS: opening the route in authorizer.js without adding the row guard —
  // the exact half-done change this section was written to make impossible.
  res = await flip(OTHER_HOST, 'ivys', true);
  check("a host flagging ANOTHER host's set is refused with 403", () =>
    assert.strictEqual(res.statusCode, 403, res.body));

  // REJECTS: a guard that refuses but writes anyway. `requireSetManager` returns
  // a response the handler must RETURN, not merely evaluate.
  reset();
  seedSet('ivys', { owner: HOST });
  seedSet('eighties', { scope: 'platform' });  // re-seeded: the reset above dropped it
  await flip(OTHER_HOST, 'ivys', true);
  check('...and nothing was written', () =>
    assert.strictEqual(metaOf('ivys').Quickstart, undefined));

  // REJECTS: reading an absent `createdBy` as "anyone may". Same decision as
  // section 3.2: an unowned set is house content.
  res = await flip(HOST, 'eighties', true);
  check('a host flagging a LEGACY unowned set is refused with 403', () =>
    assert.strictEqual(res.statusCode, 403, res.body));

  // REJECTS: a guard so tight it locks admins out — the failure that makes the
  // sensible next move "delete the guard".
  res = await flip(ADMIN_AS_ENGAGE, 'eighties', true);
  check('an admin acting as Engage flags a legacy set', () =>
    assert.strictEqual(res.statusCode, 200, res.body));
  res = await flip(ADMIN, 'ivys', false);
  check("an admin unflags a host's set", () =>
    assert.strictEqual(res.statusCode, 200, res.body));

  // REJECTS: dropping the 404 in favour of a blind UpdateCommand, which would
  // CREATE a SETS row for a set that does not exist — the upsert fault section
  // 3.3 already caught once on edit.
  res = await flip(ADMIN, 'ghost', true);
  check('flagging a set that does not exist is 404, not an upsert', () =>
    assert.strictEqual(res.statusCode, 404, res.body));
  check('...and no row was manufactured', () =>
    assert.strictEqual(metaOf('ghost'), undefined));

  // REJECTS: writing whatever arrives. `{}` writes undefined and the string
  // "false" is truthy, so both read back as flagged.
  for (const bad of [undefined, 'true', 'false', 1, null]) {
    res = await toggleQuickstart({
      ...callerEvent(ADMIN),
      pathParameters: { setId: 'ivys' },
      body: JSON.stringify(bad === undefined ? {} : { quickstart: bad }),
    });
    check(`quickstart=${JSON.stringify(bad)} is refused as not a boolean`, () =>
      assert.strictEqual(res.statusCode, 400, res.body));
  }

  /*
    REJECTS: the `UpdatedAt` spelling this handler shipped with.

    Every other writer uses lower-case `updatedAt`, and get-question-sets.js:60
    reads `item.updatedAt || item.UpdatedAt` — preferring the lower-case one. So
    on any set that had ever been edited, flagging quickstart wrote a SECOND
    attribute the reader then ignored, and the Updated column did not move. The
    seed carries a 2020 `updatedAt`, which is what makes this assertion able to
    fail: a handler writing the capitalised name leaves the 2020 value in place.
  */
  reset();
  seedSet('ivys', { owner: HOST });
  await flip(HOST, 'ivys', true);
  check('the toggle moves the canonical lower-case updatedAt', () =>
    assert.notStrictEqual(metaOf('ivys').updatedAt, '2020-01-01T00:00:00.000Z'));
  check('...and does not leave a capitalised twin behind', () =>
    assert.strictEqual(metaOf('ivys').UpdatedAt, undefined));

  say('\n3.6 replace — an edit by another name');

  reset();
  seedSet('ivys', { owner: HOST });

  // REJECTS: guarding edit and delete but not replace. A replace writes a new
  // version and flips the live pointer, so it changes what every future game
  // plays — the most consequential edit in the product.
  res = await upload({
    ...callerEvent(OTHER_HOST),
    body: JSON.stringify({ fileName: 'raj.csv', fileContent: CSV, replaceSetId: 'ivys' }),
  });
  check("a host replacing another host's set is refused with 403", () =>
    assert.strictEqual(res.statusCode, 403, res.body));
  check('...and no version was written', () =>
    assert.strictEqual(contentRows('ivys').filter((i) => String(i.PK).includes('#v')).length, 0));
  check('...and activeVersion never moved', () =>
    assert.strictEqual(metaOf('ivys').activeVersion, undefined));

  reset();
  seedSet('ivys', { owner: HOST });
  res = await upload({
    ...callerEvent(HOST),
    body: JSON.stringify({ fileName: 'ivy2.csv', fileContent: CSV, replaceSetId: 'ivys' }),
  });
  check('a host replacing their OWN set succeeds', () =>
    assert.strictEqual(res.statusCode, 200, res.body));

  reset();
  seedSet('ivys', { owner: HOST });
  await upload({
    ...callerEvent(ADMIN),
    body: JSON.stringify({ fileName: 'ada.csv', fileContent: CSV, replaceSetId: 'ivys' }),
  });
  // REJECTS: stamping the replacer as the new owner. An admin fixing a typo in
  // a host's CSV must not quietly take the set away from them.
  check("an admin's replace leaves the original owner in place", () =>
    assert.strictEqual(metaOf('ivys').createdBy, 'sub-ivy'));

  reset();
  seedSet('eighties', { scope: 'platform' });
  res = await upload({
    ...callerEvent(HOST),
    body: JSON.stringify({ fileName: 'x.csv', fileContent: CSV, replaceSetId: 'eighties' }),
  });
  check('a host may NOT replace an unowned legacy set', () =>
    assert.strictEqual(res.statusCode, 403, res.body));

  // =========================================================================
  say('\n4. THE LIST — the console renders from the same rule the handler enforces');

  reset();
  seedSet('ivys', { owner: HOST, name: 'Ivy Set' });
  seedSet('rajs', { owner: OTHER_HOST, name: 'Raj Set' });
  seedSet('eighties', { name: '80s Trivia', scope: 'platform' });

  const listWithEvent = async (ev) => {
    const out = parse(await adminList(ev));
    return Object.fromEntries(out.questionSets.map((s) => [s.id, s]));
  };
  const listAs = (who) => listWithEvent(callerEvent(who));

  let seen = await listAs(HOST);
  // REJECTS: not projecting canManage, so the console has to guess — and any
  // guess it makes can disagree with the handler.
  check('a host sees canManage true on their own set', () =>
    assert.strictEqual(seen.ivys.canManage, true));
  check("...false on another host's", () =>
    assert.strictEqual(seen.rajs.canManage, false));
  check('...and false on the unowned legacy set', () =>
    assert.strictEqual(seen.eighties.canManage, false));
  check('`mine` marks only what they created', () =>
    assert.deepStrictEqual(
      [seen.ivys.mine, seen.rajs.mine, seen.eighties.mine], [true, false, false]));

  // REJECTS: projecting the raw Cognito sub to every caller. Who authored what
  // is not a host's business, and a sub is useless to them anyway.
  check('a host is not given anyone\'s createdBy sub', () =>
    assert.ok(!('createdBy' in seen.rajs), 'the list leaks Cognito subs to hosts'));

  seen = await listAs(ADMIN);
  /*
    THE DISTINCTION, ON ONE LIST. `ivys` and `rajs` live in this admin's own
    organisation, so they manage them as an org admin. `eighties` is Engage's —
    and while they are STANDING IN an organisation the row is read-only, which
    is what makes the panel offer "Copy to my organisation" instead of Edit.

    This used to be [true, true, true], which is how an Engage admin acting as a
    host in TeamG came to rename a set every organisation reads.
  */
  // REJECTS: an admin losing the ability to manage anything — the list would
  // render an admin console with every control switched off.
  check('an admin inside an org manages its sets but not Engage\'s', () =>
    assert.deepStrictEqual(
      [seen.ivys.canManage, seen.rajs.canManage, seen.eighties.canManage], [true, true, false]));

  // rejects: locking Engage out of its own library. Acting AS Engage is where
  // that library is editable.
  const asEngage = await listAs(ADMIN_AS_ENGAGE);
  check('...and acting as Engage they manage the platform set', () =>
    assert.strictEqual(asEngage.eighties.canManage, true));
  check('...and `mine` is still only what they authored', () =>
    assert.deepStrictEqual(
      [seen.ivys.mine, seen.rajs.mine, seen.eighties.mine], [false, false, false]));
  check('an admin does get createdBy, for attribution', () =>
    assert.strictEqual(seen.ivys.createdBy, 'sub-ivy'));
  check('...and null on a set that has no owner', () =>
    assert.strictEqual(seen.eighties.createdBy, null));

  // =========================================================================
  say('\n5. THE LIST AND THE HANDLERS, CROSS-CHECKED — one rule, or two?');

  // Sections 3 and 4 each assert against literals THIS FILE chose. They agree
  // with the product only for as long as somebody keeps both columns of
  // expectations in step by hand, and nothing makes them do that. Section 4
  // could be updated to match a wrong `canManage` and go green.
  //
  // That is exactly the drift `canManage` exists to prevent, and it is the
  // invisible kind: a console computing "is this mine" its own way keeps
  // rendering perfectly while it starts offering buttons the handler 403s. So
  // this section states NO expected answer. For the same caller and the same
  // row it asks three things —
  //
  //   the LIST         get-question-sets.js's `canManage`
  //   the GUARD        requireSetManager(), the function the handlers call
  //   the HANDLER      the real edit and delete lambdas, hand-made request
  //
  // — and requires all three to be the same answer. Fixture-free: whatever the
  // rule is, these must not be able to disagree about it.
  const ANON = {};   // no authorizer context at all — must fail closed, in all three

  // THE ROWS AND CALLERS ARE CHOSEN TO SEPARATE `sub` FROM `username`, and that
  // is the difference between this section working and this section being
  // decorative. Every other fixture in this file seeds `createdBy` and
  // `createdByName` from one person, so a rule that authorised on the display
  // name would give the identical answer everywhere and no assertion here would
  // notice — a first draft of this section proved exactly that by failing to
  // kill a mutant that compared usernames. `impostor` and `REBORN_IVY` are the
  // two halves of the trap the module header describes: a recycled username,
  // and a name that belongs to someone other than the owner.
  const REBORN_IVY = { groups: 'hosts', userId: 'sub-ivy-2', username: 'ivy' };
  const seedMatrix = () => {
    reset();
    seedSet('ivys', { owner: HOST });
    seedSet('rajs', { owner: OTHER_HOST });
    seedSet('eighties', { scope: 'platform' });
    // Owned by raj's sub, but carrying ivy's display name.
    seedSet('impostor', { createdBy: 'sub-raj', createdByName: 'ivy' });
  };

  const CROSS = [];
  for (const [whoName, who] of [
    ['the creating host', HOST],
    ['another host', OTHER_HOST],
    ['an admin', ADMIN],
    // Same username as HOST, different sub — the deleted-and-recreated account
    // that `question-set-access.js` picked `sub` in order to keep out.
    ['a host who reused ivy\'s username', REBORN_IVY],
    ['an unauthenticated caller', ANON],
  ]) {
    for (const setId of ['ivys', 'rajs', 'eighties', 'impostor']) CROSS.push([whoName, who, setId]);
  }

  for (const [whoName, who, setId] of CROSS) {
    const eventFor = () => (who === ANON ? {} : callerEvent(who));

    // The LIST's answer.
    //
    // ABSENT counts as false, and that is not a fudge. Since tenancy the list
    // returns only the scopes a caller can READ — platform, public, and their
    // own org — so an anonymous caller, or a member of another organisation,
    // does not receive an org set at all. That is a stronger refusal than
    // `canManage: false`: they cannot see it, so they certainly cannot manage
    // it, and the guard below must agree with that too.
    seedMatrix();
    const listed = (await listWithEvent(eventFor()))[setId];
    const listSaid = listed ? listed.canManage : false;

    // The GUARD's answer, asked directly of the function the handlers enforce
    // with. null means "proceed"; a response object means refused.
    const guardSaid = access.requireSetManager(eventFor(), metaOf(setId), 'edit') === null;

    // The real EDIT handler's answer, from a request with no console involved.
    const editRes = await editSet({
      ...eventFor(),
      pathParameters: { setId },
      body: JSON.stringify({ name: `renamed by ${whoName}` }),
    });
    // A REFUSAL IS ANY NON-SUCCESS, NOT SPECIFICALLY A 403.
    //
    // This used to read `!== 403`, which was right when every caller could see
    // every set and the only question was permission. Since tenancy a caller
    // who is outside the owning organisation does not get a 403 — they get a
    // 404, because the handler will not confirm that a set it will not show
    // them even exists. Answering 403 there would turn "forbidden" into an
    // existence oracle: probe ids, and the ones that come back 403 instead of
    // 404 are the real ones.
    //
    // Treating 404 as "allowed" made this cross-check assert the exact
    // opposite of what it is for.
    const editSaid = editRes.statusCode < 400;

    // The real DELETE handler's answer. Reseeded first: the edit above may have
    // succeeded, and delete destroys rows either way.
    seedMatrix();
    const delRes = await deleteSet({ ...eventFor(), pathParameters: { setId } });
    const delSaid = delRes.statusCode < 400;

    // REJECTS: the whole reason this field exists — a list that decides
    // manageability by any route other than the one the handlers enforce.
    // Re-deriving "is this mine" in get-question-sets.js (comparing usernames
    // instead of subs, defaulting an unowned set to manageable, or hard-coding
    // true) moves `listSaid` and leaves the other three where they were.
    check(`${whoName} on ${setId}: list, guard, edit and delete all say the same`, () =>
      assert.deepStrictEqual(
        { list: listSaid, guard: guardSaid, edit: editSaid, delete: delSaid },
        { list: guardSaid, guard: guardSaid, edit: guardSaid, delete: guardSaid },
        `canManage=${listSaid} but requireSetManager=${guardSaid}, `
        + `edit=${editRes.statusCode}, delete=${delRes.statusCode} — `
        + 'the console would offer a control the handler refuses, or hide one it allows'));
  }

  // REJECTS: a cross-check that is vacuously true because every answer is the
  // same. If `canManage` were hard-coded true the loop above would still pass
  // whenever the guard also said true everywhere, so the matrix must be proven
  // to contain both answers.
  seedMatrix();
  const hostRow = await listAs(HOST);
  const adminRow = await listAs(ADMIN);
  check('the cross-checked matrix contains both a true and a false', () =>
    assert.deepStrictEqual(
      [...new Set([
        hostRow.ivys.canManage, hostRow.rajs.canManage, hostRow.eighties.canManage,
        adminRow.ivys.canManage,
      ])].sort(),
      [false, true],
      'every case agrees because every case is the same answer — section 5 proves nothing'));

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
