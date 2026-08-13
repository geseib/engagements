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
const callerEvent = ({ groups, userId, username = 'someone' } = {}) => ({
  requestContext: {
    authorizer: {
      lambda: {
        username,
        ...(userId === undefined ? {} : { userId }),
        ...(groups === undefined ? {} : { groups }),
        status: 'enabled',
      },
    },
  },
});

const HOST = { groups: 'hosts', userId: 'sub-ivy', username: 'ivy' };
const OTHER_HOST = { groups: 'hosts', userId: 'sub-raj', username: 'raj' };
const ADMIN = { groups: 'hosts,admins', userId: 'sub-ada', username: 'ada' };

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
const metaOf = (setId) => store.get(k('SETS', `SET#${setId}`));
const contentRows = (setId) =>
  [...store.values()].filter((i) => String(i.PK).startsWith(`SET#${setId}`));

function seedSet(setId, {
  owner, name = setId, questions = 2, createdBy, createdByName,
} = {}) {
  put({
    PK: 'SETS', SK: `SET#${setId}`, name,
    description: 'seeded', engagementType: 'call-and-answer',
    questionCount: questions, categoryCount: 1, active: true,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    // `owner` deliberately omitted for the legacy rows: that is the whole point.
    ...(owner ? { createdBy: owner.userId, createdByName: owner.username } : {}),
    // Set the two ownership attributes INDEPENDENTLY, for the rows that exist
    // to prove sub and username are not interchangeable. Seeding both from one
    // `owner` makes every fixture a row where they agree, and a rule that reads
    // the wrong one is then indistinguishable from the right one.
    ...(createdBy === undefined ? {} : { createdBy }),
    ...(createdByName === undefined ? {} : { createdByName }),
  });
  put({ PK: `SET#${setId}`, SK: 'CATEGORY#c001', Name: 'Renaissance', QuestionCount: questions });
  for (let q = 1; q <= questions; q++) {
    put({ PK: `SET#${setId}`, SK: `QUESTION#c001#${String(q).padStart(3, '0')}`, Title: `Q${q}` });
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
    // REJECTS: widening to the whole toggle/curation surface. These decide what
    // the product offers everybody, not what one host owns.
    ['POST', 'admin/toggle-question-set/{setId}'],
    ['POST', 'admin/toggle-quickstart/{setId}'],
    // REJECTS: adding the download route "while we are here". Not asked for.
    ['GET', 'admin/download-question-set/{setId}'],
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

  const owned = { SK: 'SET#ivys', createdBy: 'sub-ivy', createdByName: 'ivy' };
  const legacy = { SK: 'SET#eighties', name: '80s Trivia' };   // no createdBy — every set today

  // REJECTS: dropping the admin short-circuit, which would make admins
  // second-class on content they did not personally upload.
  check('an admin may manage a set they do not own', () =>
    assert.ok(access.canManageSet(callerEvent(ADMIN), owned)));
  check('an admin may manage a set with NO owner recorded', () =>
    assert.ok(access.canManageSet(callerEvent(ADMIN), legacy)));

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
  check('a native JWT authorizer still identifies the owner', () =>
    assert.ok(access.canManageSet(
      { requestContext: { authorizer: { jwt: { claims: { sub: 'sub-ivy' } } } } }, owned)));

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
  seedSet('eighties', { name: '80s Trivia' });   // no owner, like every set today

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
    ...callerEvent(ADMIN),
    pathParameters: { setId: 'eighties' },
    body: JSON.stringify({ name: '80s Trivia (curated)' }),
  });
  check('an admin CAN still edit an unowned legacy set', () =>
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
  seedSet('eighties');
  res = await deleteSet({ ...callerEvent(HOST), pathParameters: { setId: 'eighties' } });
  check('a host may NOT delete an unowned legacy set', () =>
    assert.strictEqual(res.statusCode, 403, res.body));
  check('...and it survives intact', () => assert.ok(metaOf('eighties')));

  reset();
  seedSet('eighties');
  res = await deleteSet({ ...callerEvent(ADMIN), pathParameters: { setId: 'eighties' } });
  check('an admin CAN still delete an unowned legacy set', () =>
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
  seedSet('eighties');
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
  seedSet('eighties', { name: '80s Trivia' });

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
  // REJECTS: an admin losing the ability to manage anything — the list would
  // render an admin console with every control switched off.
  check('an admin sees canManage true on every set', () =>
    assert.deepStrictEqual(
      [seen.ivys.canManage, seen.rajs.canManage, seen.eighties.canManage], [true, true, true]));
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
    seedSet('eighties');
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
    seedMatrix();
    const listSaid = (await listWithEvent(eventFor()))[setId].canManage;

    // The GUARD's answer, asked directly of the function the handlers enforce
    // with. null means "proceed"; a response object means refused.
    const guardSaid = access.requireSetManager(eventFor(), metaOf(setId), 'edit') === null;

    // The real EDIT handler's answer, from a request with no console involved.
    const editRes = await editSet({
      ...eventFor(),
      pathParameters: { setId },
      body: JSON.stringify({ name: `renamed by ${whoName}` }),
    });
    const editSaid = editRes.statusCode !== 403;

    // The real DELETE handler's answer. Reseeded first: the edit above may have
    // succeeded, and delete destroys rows either way.
    seedMatrix();
    const delRes = await deleteSet({ ...eventFor(), pathParameters: { setId } });
    const delSaid = delRes.statusCode !== 403;

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
