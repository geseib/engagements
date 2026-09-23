/**
 * SAVING A REPORT IS THE HOST'S WRITE, NOT ANYONE'S WHO HOLDS THE CODE.
 *
 * `POST /games/{gameId}/save-report` carried no authorizer, and save-report.js
 * asked nobody who they were. Anyone holding a four-digit code — printed on a
 * projector, typed by the whole room — could put an object into the reports
 * bucket and a `REPORT#<game>#<savedAt>` row into that org's REPORTS partition,
 * which the org's Reports list then shows beside the host's own. The row's
 * Title is whatever the caller sent, encrypted under the VICTIM org's key.
 *
 * The fix is the pair create-report and the comments feature route already
 * pay, and neither half works alone (tests/session-control-routes-authorization.js
 * header says why): the Cognito authorizer on the route, and
 * `callerMayDriveSession` on the session's own row in the handler. The handler
 * also refuses a caller with NO identity outright, like comments.js's feature
 * route — `callerMayDriveSession` waves an anonymous caller through by design,
 * so without that line an orgless session would still be writable by anyone
 * the day the authorizer is removed.
 *
 * rejects: the route open in the template; the authorizer mapping it to a
 * public or pending-reachable rule; a refused caller writing anything to S3 or
 * the table; a refusal distinguishable from "no such game"; the host's own
 * save refused; the report screen posting with a bare `fetch`.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
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
process.env.REPORTS_BUCKET_NAME = 'engage-test-reports';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

const ddb = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const ddbPuts = [];
class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class DeleteCommand { constructor(input) { this.kind = 'delete'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
class BatchGetCommand { constructor(input) { this.kind = 'batchGet'; this.input = input; } }
const doc = {
  send: async (cmd) => {
    const i = cmd.input;
    if (cmd.kind === 'get') return { Item: ddb.get(key(i.Key.PK, i.Key.SK)) };
    if (cmd.kind === 'put') { ddbPuts.push(i.Item); ddb.set(key(i.Item.PK, i.Item.SK), i.Item); return {}; }
    if (cmd.kind === 'query') return { Items: [...ddb.values()].filter((r) => r.PK === i.ExpressionAttributeValues[':pk']) };
    return {};
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => doc }, GetCommand, PutCommand, QueryCommand, UpdateCommand, BatchGetCommand, DeleteCommand,
});
const s3Puts = [];
class PutObjectCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class GetObjectCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class DeleteObjectCommand { constructor(input) { this.kind = 'delete'; this.input = input; } }
stub('@aws-sdk/client-s3', {
  S3Client: class { async send(cmd) { if (cmd.kind === 'put') s3Puts.push(cmd.input); return {}; } },
  PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
});
stub('@aws-sdk/s3-request-presigner', { getSignedUrl: async () => 'https://signed.example/x' });

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

const { handler } = require(path.join(REPO, 'lambda-functions/game/save-report.js'));
const { reportsIndexPk } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');
const { requiredGroupsForRoute, hasPermission } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${label}`); }
  catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

/*
  The Lambda authorizer's context, as the live route delivers it
  (auth/authorizer.js returns `context`, which HTTP API hands the backing
  function as requestContext.authorizer.lambda). `orgIds` is comma-joined, the
  one shape an authorizer context can carry.
*/
const host = ({ orgId = '', orgIds = orgId, groups = 'hosts' } = {}) => ({
  authorizer: { lambda: { userId: 'u-1', groups, orgId, orgRole: orgId ? 'member' : '', orgIds } },
});
const save = (gameId, requestContext) => handler({
  pathParameters: { gameId },
  ...(requestContext ? { requestContext } : {}),
  body: JSON.stringify({ eventTitle: 'Q3 Offsite', pdfBlob: 'JVBERi0=' }),
});
const reportRows = () => [...ddb.values()].filter((r) => String(r.SK).startsWith('REPORT#'));
const reset = () => {
  ddb.clear(); ddbPuts.length = 0; s3Puts.length = 0;
  ddb.set(key('GAME#1111', 'METADATA'), { PK: 'GAME#1111', SK: 'METADATA', orgId: 'org_acme' });
  ddb.set(key('GAME#2222', 'METADATA'), { PK: 'GAME#2222', SK: 'METADATA' });
};
const nothingWritten = () => {
  assert.strictEqual(s3Puts.length, 0, `a refused caller put ${s3Puts.length} object(s) in the reports bucket`);
  assert.strictEqual(ddbPuts.length, 0, `a refused caller wrote ${ddbPuts.length} row(s)`);
};

(async () => {
  console.log('\n1. the template closes the route');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  await check('POST /games/{gameId}/save-report carries CognitoAuthorizer', () => {
    const hit = findRoute(routes, 'POST', '/games/{gameId}/save-report');
    assert.ok(hit, 'the route is not in the template at all');
    assert.strictEqual(hit.authorizer, 'CognitoAuthorizer',
      `authorizer was ${JSON.stringify(hit.authorizer)} — anyone with the join code can write a report`);
  });

  console.log('\n2. the authorizer demands hosts or admins');
  for (const p of ['games/{gameId}/save-report', 'games/1234/save-report']) {
    await check(`POST ${p} requires hosts or admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('POST', p), ['hosts', 'admins']));
    await check(`POST ${p} refuses a pending account`, () =>
      assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('POST', p)), false));
  }

  console.log('\n3. the handler refuses anyone but the session\'s own team');
  reset();
  const anonOrg = await save('1111', null);
  await check('no identity, org session: 404 Game not found', () => {
    assert.strictEqual(anonOrg.statusCode, 404, anonOrg.body);
    assert.deepStrictEqual(JSON.parse(anonOrg.body), { error: 'Game not found' });
  });
  await check('...and nothing reached the bucket or the table', nothingWritten);

  reset();
  const anonOrgless = await save('2222', null);
  await check('no identity, ORGLESS session: still 404 (callerMayDriveSession alone would pass it)', () =>
    assert.strictEqual(anonOrgless.statusCode, 404, anonOrgless.body));
  await check('...and nothing written', nothingWritten);

  reset();
  const rival = await save('1111', host({ orgId: 'org_globex' }));
  await check('a host of another organisation: 404', () => assert.strictEqual(rival.statusCode, 404, rival.body));
  await check('...and nothing written — no row in the victim org\'s Reports list', () => {
    nothingWritten();
    assert.strictEqual(reportRows().length, 0);
  });

  reset();
  const missing = await save('9999', host({ orgId: 'org_acme' }));
  await check('refusal and "no such game" are the same answer — no existence oracle', () => {
    assert.strictEqual(missing.statusCode, 404);
    assert.deepStrictEqual(JSON.parse(missing.body), JSON.parse(rival.body));
    assert.deepStrictEqual(missing.headers, rival.headers);
  });

  console.log('\n4. the host\'s own save still works');
  reset();
  const own = await save('1111', host({ orgId: 'org_acme' }));
  await check('a host acting for the owning org: 200', () => assert.strictEqual(own.statusCode, 200, own.body));
  await check('...one object in the bucket and one row in the org\'s REPORTS partition', () => {
    assert.strictEqual(s3Puts.length, 1);
    const rows = reportRows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].PK, reportsIndexPk('org_acme'));
  });

  reset();
  const member = await save('1111', host({ orgId: 'org_personal', orgIds: 'org_personal,org_acme' }));
  await check('a member of the owning org standing in another library: 200 (membership, as create-report)', () =>
    assert.strictEqual(member.statusCode, 200, member.body));

  reset();
  const orgless = await save('2222', host({ orgId: 'org_acme' }));
  await check('a signed-in host on an orgless session: 200, filed under the platform partition', () => {
    assert.strictEqual(orgless.statusCode, 200, orgless.body);
    assert.strictEqual(reportRows()[0].PK, reportsIndexPk(''));
  });

  console.log('\n5. the report screen sends the token');
  await check('GameReport.jsx posts save-report through authFetch, never bare fetch', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/src/components/GameReport.jsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const calls = [...src.matchAll(/(\w*[Ff]etch)\s*\(\s*`[^`]*save-report`/g)].map((m) => m[1]);
    assert.deepStrictEqual(calls, ['authFetch'],
      `save-report is called via ${JSON.stringify(calls)} — a bare fetch sends no Authorization header and now 401s`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
