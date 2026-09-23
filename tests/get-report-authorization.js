/**
 * THE STORED REPORT IS THE HOST'S TO READ: GET /games/{gameId}/report.
 *
 * It was public, and `?role=host` — a query parameter anyone can type — made
 * get-report.js return the whole stored REPORT row, decrypted: every
 * participant's name against their answer, the AI summaries, the comments.
 * That is exactly what POST /games/{gameId}/report was closed to protect, and
 * the stored row exists as soon as a host has opened the report once. Nothing
 * in the frontend calls it (every `games/${id}/report` call is an authFetch
 * POST). The owner, asked whether to close it, 2026-09-23: "Yes".
 *
 * Three halves, like every closed route here:
 *   - the template attaches CognitoAuthorizer;
 *   - authorizer.js demands hosts|admins. The generic rule
 *     `GET + path.includes('games') → []` would otherwise answer first and let
 *     any signed-in account through, including one still in `pending`;
 *   - get-report.js refuses no identity outright and asks
 *     callerMayDriveSession, every refusal the same 404 as "no report".
 *
 * rejects: the route public again; a pending account let in by the generic GET
 * rule; the new rule swallowing a participant GET or /report/download; a
 * refusal that differs from "not found"; the host's own read refused.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

process.env.TABLE_NAME = 'engage-test';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

const ddb = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
const doc = {
  send: async (cmd) => {
    const i = cmd.input;
    if (cmd.kind === 'get') return { Item: ddb.get(key(i.Key.PK, i.Key.SK)) };
    return { Items: [] };
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => doc }, GetCommand, PutCommand, QueryCommand });

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

const { encryptItem } = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { handler } = require(path.join(REPO, 'lambda-functions/game/get-report.js'));
const { requiredGroupsForRoute, hasPermission } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${label}`); }
  catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

const host = (orgId, groups = 'hosts') => ({ authorizer: { lambda: { userId: 'u', groups, orgId, orgIds: orgId } } });
const read = (gameId, requestContext) => handler({
  pathParameters: { gameId },
  queryStringParameters: { role: 'host' },
  ...(requestContext ? { requestContext } : {}),
});

const REPORT = {
  gameId: '1111', gameTitle: 'Q3 Offsite', hostName: 'Ada',
  detailedQuestions: [{ questionNumber: '001', answers: [{ playerName: 'Bea', answer: 'Re-price it.' }] }],
  gameStats: { totalPlayers: 1, totalQuestions: 1 },
};

(async () => {
  ddb.set(key('GAME#1111', 'METADATA'), { PK: 'GAME#1111', SK: 'METADATA', orgId: 'org_acme' });
  ddb.set(key('GAME#1111', 'REPORT'), await encryptItem('org_acme', 'report', { PK: 'GAME#1111', SK: 'REPORT', ...REPORT }));
  ddb.set(key('GAME#2222', 'METADATA'), { PK: 'GAME#2222', SK: 'METADATA' });
  ddb.set(key('GAME#2222', 'REPORT'), { PK: 'GAME#2222', SK: 'REPORT', ...REPORT, gameId: '2222' });
  ddb.set(key('GAME#3333', 'METADATA'), { PK: 'GAME#3333', SK: 'METADATA', orgId: 'org_acme' });

  console.log('\n1. the template closes it, and leaves the download link alone');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  await check('GET /games/{gameId}/report carries CognitoAuthorizer', () => {
    assert.strictEqual(findRoute(routes, 'GET', '/games/{gameId}/report').authorizer, 'CognitoAuthorizer');
  });
  await check('GET /games/{gameId}/report/download is still public (link + passkey)', () => {
    assert.strictEqual(findRoute(routes, 'GET', '/games/{gameId}/report/download').authorizer, null);
  });

  console.log('\n2. the authorizer demands a host, not just an account');
  for (const p of ['games/{gameId}/report', 'games/1234/report']) {
    await check(`GET ${p} requires hosts or admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), ['hosts', 'admins']));
    await check(`GET ${p} refuses a pending account`, () =>
      assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('GET', p)), false));
  }
  for (const p of ['games/{gameId}', 'games/{gameId}/state', 'games/1234/question', 'games/{gameId}/ai-summary']) {
    await check(`the participant route GET ${p} is still open to everyone`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), []));
  }

  console.log('\n3. the handler hands the room over to its own team only');
  const notFound = await read('3333', host('org_acme'));
  await check('a session with no stored report: 404', () => assert.strictEqual(notFound.statusCode, 404));
  const anon = await read('1111', null);
  await check('no identity: the same 404, not the report', () => {
    assert.strictEqual(anon.statusCode, 404);
    assert.deepStrictEqual(anon, notFound);
  });
  const anonOrgless = await read('2222', null);
  await check('no identity on an orgless session: still 404 (callerMayDriveSession alone would pass it)', () =>
    assert.deepStrictEqual(anonOrgless, notFound));
  const rival = await read('1111', host('org_globex'));
  await check('a host of another organisation: the same 404', () => assert.deepStrictEqual(rival, notFound));
  const missing = await read('9999', host('org_acme'));
  await check('no such session: the same 404', () => assert.deepStrictEqual(missing, notFound));

  const own = await read('1111', host('org_acme'));
  await check('the owning team\'s host: 200 with the decrypted room', () => {
    assert.strictEqual(own.statusCode, 200, own.body);
    const body = JSON.parse(own.body);
    assert.strictEqual(body.gameTitle, 'Q3 Offsite');
    assert.strictEqual(body.detailedQuestions[0].answers[0].answer, 'Re-price it.');
  });
  const orgless = await read('2222', host('org_acme'));
  await check('a signed-in host on an orgless session: 200', () => assert.strictEqual(orgless.statusCode, 200, orgless.body));

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
