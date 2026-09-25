/**
 * ONLY THE SESSION'S HOST MAY GENERATE A ROUND'S SUMMARY OR READ ITS PROMPT.
 *
 * `GET /games/{gameId}/ai-summary` is PUBLIC: every phone and the host's
 * remote read the round's summary there, and a participant holds no token. It
 * also took three parameters that were never a participant's business:
 *
 *   generateNew=true   start a generation — Bedrock, and an overwrite of the
 *                      round's stored summary
 *   debug=true         the FULL prompt Workie was given (`debugPrompt`)
 *   promptDebug=true   every template variable (`templateVariables`)
 *
 * The prompt and the variables carry the question's reveal (`answerDetails`),
 * a trivia round's `correctAnswer` and every participant's answer text. The
 * question's REF row exists from ASK and generation has no round-state gate,
 * so anyone with the four-digit code could call
 * `?generateNew=true&debug=true` after the first answer and read the answer
 * mid-round (review, 2026-09-25).
 *
 * The fix: those three are served only on `GET /games/{gameId}/ai-summary/host`,
 * which carries the Cognito authorizer, is named for hosts|admins in
 * authorizer.js, and asks callerMayDriveSession in the handler. The public
 * route refuses them before it reads anything. The plain read is unchanged.
 *
 * rejects: a prompt, the template variables or a generation on the public
 * route, with or without a token in the request; another org's host (or no
 * identity) getting anything but the same "Game not found" as a code that
 * names nothing; the host route left public, or open to `pending`; the plain
 * public read changed; the owning host refused.
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
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'engagedev-get-ai-summary';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

// ---- an in-memory table that honours ProjectionExpression --------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);
const reads = [];

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

function project(item, input) {
  if (!item || !input.ProjectionExpression) return item;
  const out = {};
  for (const raw of input.ProjectionExpression.split(',')) {
    const attr = raw.trim();
    if (attr in item) out[attr] = item[attr];
  }
  return out;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') {
      reads.push(`${inp.Key.PK}|${inp.Key.SK}`);
      return { Item: project(store.get(key(inp.Key.PK, inp.Key.SK)), inp) };
    }
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    return { Items: [], Count: 0 };
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- the self-invoke is what a generation IS on the HTTP path ---------------
const invokes = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send(cmd) { invokes.push(JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8'))); return {}; } },
  InvokeCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});
// Nothing here may reach the model; a call is a failure, not a fixture.
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('Bedrock was invoked on the HTTP path'); } },
  InvokeModelCommand: class {},
});

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

const { encryptItem } = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { handler } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
const { requiredGroupsForRoute, hasPermission } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); }
  catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

// ---- the rooms ---------------------------------------------------------------
const ORG = 'org_acme';
const RIVAL = 'org_globex';
// What must never cross the public route: the reveal, the trivia answer, and a
// participant's own words. Distinctive, so a substring check means something.
const REVEAL = 'Westphalia-1648-was-the-reveal';
const CORRECT = 'OptionC-is-the-correct-answer';
const ANSWER = 'Ada-typed-this-exact-answer';
const SUMMARY = 'The room split on sovereignty, and nobody mentioned trade.';

const DEBUG_INFO = {
  fullPrompt: `Q: Which treaty?\nREVEAL: ${REVEAL}\nCORRECT: ${CORRECT}\nRESPONSES: ${ANSWER}`,
  templateVariables: { reveal: REVEAL, answerDetails: REVEAL, correctAnswer: CORRECT, responsesText: ANSWER },
  promptTemplate: 'Q: {questionTitle}\nREVEAL: {reveal}',
  promptName: 'Trivia VJ',
  promptSource: 'default',
  promptProvenance: { source: 'default' },
};

/** A round at ASK — mid-round, the case the finding is about. */
async function seedSession(gameId, { orgId, cached }) {
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'ASK#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'trivia', ...(orgId ? { orgId } : {}) });
  if (!cached) return;
  const row = {
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#AISummary',
    Summary: SUMMARY, SummaryText: SUMMARY,
    DiscussionQuestions: [], NextSteps: [],
    GeneratedAt: '2026-09-25T10:00:00.000Z',
    DebugInfo: DEBUG_INFO,
  };
  put(orgId ? await encryptItem(orgId, 'aiSummary', row) : row);
}

const PUBLIC_ROUTE = 'GET /games/{gameId}/ai-summary';
const HOST_ROUTE = 'GET /games/{gameId}/ai-summary/host';
const hostOf = (orgId, groups = 'hosts') => ({ lambda: { userId: 'u-1', groups, orgId, orgIds: orgId } });

async function call(routeKey, gameId, query = {}, authorizer = null) {
  invokes.length = 0;
  reads.length = 0;
  const res = await handler({
    routeKey,
    rawPath: routeKey === HOST_ROUTE ? `/games/${gameId}/ai-summary/host` : `/games/${gameId}/ai-summary`,
    pathParameters: { gameId },
    queryStringParameters: Object.keys(query).length ? query : undefined,
    requestContext: { routeKey, ...(authorizer ? { authorizer } : {}) },
  });
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { body = { unparsed: res.body }; }
  return { status: res.statusCode, body, raw: String(res.body || ''), invoked: invokes.slice(), read: reads.slice() };
}

/** Nothing of the round's secrets is anywhere in the reply. */
function assertNoSecrets(r) {
  for (const secret of [REVEAL, CORRECT, ANSWER]) {
    assert.ok(!r.raw.includes(secret), `the reply carries ${secret}: ${r.raw.slice(0, 200)}`);
  }
  for (const field of ['debugPrompt', 'templateVariables', 'promptTemplate', 'debugProvenance']) {
    assert.ok(!(field in r.body), `the reply has ${field}`);
  }
}

(async () => {
  await seedSession('4101', { orgId: ORG, cached: true });   // org session, summary stored with DebugInfo
  await seedSession('4102', { orgId: ORG, cached: false });  // org session, nothing generated yet
  await seedSession('4103', { cached: true });               // orgless session

  say('\n1. the template: the public read stays public, the host door is closed');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  await check('GET /games/{gameId}/ai-summary carries no authorizer (phones hold no token)', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}/ai-summary');
    assert.ok(r, 'the public route is gone');
    assert.strictEqual(r.authorizer, null);
  });
  await check('GET /games/{gameId}/ai-summary/host carries CognitoAuthorizer', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}/ai-summary/host');
    assert.ok(r, 'no host route in the template');
    assert.strictEqual(r.authorizer, 'CognitoAuthorizer');
  });

  say('\n2. the authorizer demands a host on the host door, and nobody on the public read');
  for (const p of ['games/{gameId}/ai-summary/host', 'games/1234/ai-summary/host']) {
    await check(`GET ${p} requires hosts or admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), ['hosts', 'admins']));
    await check(`GET ${p} refuses a pending account`, () =>
      assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('GET', p)), false));
    await check(`GET ${p} refuses an account in no group`, () =>
      assert.strictEqual(hasPermission([], requiredGroupsForRoute('GET', p)), false));
  }
  for (const p of ['games/{gameId}/ai-summary', 'games/1234/ai-summary']) {
    await check(`GET ${p} stays public`, () => assert.deepStrictEqual(requiredGroupsForRoute('GET', p), []));
  }

  say('\n3. the public route, as a phone calls it, mid-round');
  for (const query of [
    { debug: 'true' },
    { promptDebug: 'true' },
    { questionId: '001', debug: 'true', promptDebug: 'true' },
  ]) {
    const r = await call(PUBLIC_ROUTE, '4101', query);
    await check(`?${new URLSearchParams(query)}: refused, with no prompt and no variables`, () => {
      assert.strictEqual(r.status, 403, r.raw);
      assertNoSecrets(r);
    });
    await check(`?${new URLSearchParams(query)}: refused before the summary row is read`, () =>
      assert.ok(!r.read.some((k) => k.endsWith('AISummary')), r.read.join(', ')));
  }
  for (const query of [
    { generateNew: 'true' },
    { questionId: '001', generateNew: 'true', debug: 'true' },
    // The handler reads generateNew for truthiness, so ANY value generated.
    { generateNew: 'false' },
  ]) {
    const r = await call(PUBLIC_ROUTE, '4102', query);
    await check(`?${new URLSearchParams(query)}: refused, and no generation is started`, () => {
      assert.strictEqual(r.status, 403, r.raw);
      assert.deepStrictEqual(r.invoked, []);
      assertNoSecrets(r);
    });
  }
  // The route decides, not a token: the public route has no authorizer, so an
  // identity on it can only be forged in a test — and must change nothing.
  const forged = await call(PUBLIC_ROUTE, '4101', { debug: 'true', generateNew: 'true' }, hostOf(ORG));
  await check('a host identity on the PUBLIC route changes nothing: refused, nothing started', () => {
    assert.strictEqual(forged.status, 403, forged.raw);
    assert.deepStrictEqual(forged.invoked, []);
    assertNoSecrets(forged);
  });

  say('\n4. the plain public read is unchanged');
  const plain = await call(PUBLIC_ROUTE, '4101');
  await check('the stored summary is served to anyone, 200 and fromCache', () => {
    assert.strictEqual(plain.status, 200, plain.raw);
    assert.strictEqual(plain.body.summary, SUMMARY);
    assert.strictEqual(plain.body.fromCache, true);
  });
  await check('and it carries none of the prompt', () => assertNoSecrets(plain));
  const plainQ = await call(PUBLIC_ROUTE, '4101', { questionId: '001' });
  await check('?questionId=001 is a plain read too', () => {
    assert.strictEqual(plainQ.status, 200, plainQ.raw);
    assert.strictEqual(plainQ.body.summary, SUMMARY);
  });
  const notReady = await call(PUBLIC_ROUTE, '4102');
  await check('no summary yet: 404 not_ready, and nothing is started', () => {
    assert.strictEqual(notReady.status, 404, notReady.raw);
    assert.strictEqual(notReady.body.status, 'not_ready');
    assert.deepStrictEqual(notReady.invoked, []);
  });

  say('\n5. the host door, for the owning team');
  const dbg = await call(HOST_ROUTE, '4101', { debug: 'true' }, hostOf(ORG));
  await check('?debug=true: 200 with the prompt Workie was given', () => {
    assert.strictEqual(dbg.status, 200, dbg.raw);
    assert.ok(String(dbg.body.debugPrompt || '').includes(REVEAL), JSON.stringify(dbg.body).slice(0, 200));
  });
  const vars = await call(HOST_ROUTE, '4101', { promptDebug: 'true' }, hostOf(ORG));
  await check('?promptDebug=true: 200 with the template variables', () => {
    assert.strictEqual(vars.status, 200, vars.raw);
    assert.strictEqual(vars.body.templateVariables && vars.body.templateVariables.reveal, REVEAL);
  });
  const gen = await call(HOST_ROUTE, '4102', { questionId: '001', generateNew: 'true', debug: 'true' }, hostOf(ORG));
  await check('?generateNew=true: 202, and ONE worker is started, carrying debug', () => {
    assert.strictEqual(gen.status, 202, gen.raw);
    assert.strictEqual(gen.invoked.length, 1);
    assert.strictEqual(gen.invoked[0].__workerMode, true);
    assert.strictEqual(gen.invoked[0].gameId, '4102');
    assert.strictEqual(gen.invoked[0].debug, 'true');
  });
  const hostPlain = await call(HOST_ROUTE, '4101', {}, hostOf(ORG));
  await check('a plain read on the host door: 200, the summary', () => {
    assert.strictEqual(hostPlain.status, 200, hostPlain.raw);
    assert.strictEqual(hostPlain.body.summary, SUMMARY);
  });
  const admin = await call(HOST_ROUTE, '4101', { debug: 'true' }, hostOf(ORG, 'admins'));
  await check('an admin acting for the owning team: 200 with the prompt', () => {
    assert.strictEqual(admin.status, 200, admin.raw);
    assert.ok(String(admin.body.debugPrompt || '').includes(REVEAL));
  });
  const orgless = await call(HOST_ROUTE, '4103', { debug: 'true' }, hostOf(ORG));
  await check('a signed-in host on an orgless session: 200 (callerMayDriveSession\'s rule)', () =>
    assert.strictEqual(orgless.status, 200, orgless.raw));

  say('\n6. the host door, for everyone else: the same "not found" as a code that names nothing');
  const nothing = await call(HOST_ROUTE, '9999', { debug: 'true' }, hostOf(ORG));
  await check('a code that names no session: 404', () => assert.strictEqual(nothing.status, 404, nothing.raw));
  const cases = [
    ['another team\'s host, ?debug=true', '4101', { debug: 'true' }, hostOf(RIVAL)],
    ['another team\'s host, ?promptDebug=true', '4101', { promptDebug: 'true' }, hostOf(RIVAL)],
    ['another team\'s host, ?generateNew=true', '4102', { generateNew: 'true', debug: 'true' }, hostOf(RIVAL)],
    ['another team\'s host, a plain read', '4101', {}, hostOf(RIVAL)],
    ['no identity at all, ?debug=true', '4101', { debug: 'true' }, null],
    ['no identity at all, ?generateNew=true', '4102', { generateNew: 'true' }, null],
    ['no identity on an orgless session', '4103', { debug: 'true' }, null],
  ];
  for (const [label, gameId, query, who] of cases) {
    const r = await call(HOST_ROUTE, gameId, query, who);
    await check(`${label}: the same 404, nothing started, no prompt`, () => {
      assert.strictEqual(r.status, 404, r.raw);
      assert.deepStrictEqual(r.body, nothing.body);
      assert.deepStrictEqual(r.invoked, []);
      assertNoSecrets(r);
      assert.ok(!r.raw.includes(SUMMARY), 'the summary was served to an outsider');
    });
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
