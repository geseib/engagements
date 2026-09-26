/**
 * A LAMBDA NEVER WRITES ITS WHOLE EVENT TO CLOUDWATCH.
 *
 * ── THE LEAK ───────────────────────────────────────────────────────────────
 *
 * Four handlers opened with `console.log('…', JSON.stringify(event, null, 2))`:
 *
 *   - admin/ai-generate-prompt.js, admin/delete-game.js and
 *     admin/populate-defaults.js — an API Gateway event, so every header went
 *     out, `Authorization` included: a live Cognito JWT, in the clear, readable
 *     by anyone with log access for as long as the log group keeps it. The body
 *     went with it, and a body here can be an organisation's prompt text, the
 *     thing tenant-crypto.js encrypts at rest. populate-defaults.js also printed
 *     the raw body a second time, and then the parsed one.
 *   - auth/post-confirmation.js — a Cognito trigger, whose userAttributes carry
 *     the new account's email and name. A later line printed the email again.
 *
 * admin/get-ai-prompts.js fixed this for itself first. Its approach is the rule:
 * trace the request, do not quote it. Method, path and ids; never headers, never
 * body. For the Cognito trigger, the trigger source and the account's sub.
 *
 * rejects: the JWT, a body sentinel, or the new account's email or name in any
 *          console output printed at unlimited depth, on each handler's working
 *          path; the trace line silenced rather than reduced (it must still
 *          say which request, and which game or account); and, statically, a
 *          `JSON.stringify(event…)`, or a whole event, body or header set
 *          handed to console, anywhere under lambda-functions/ outside the
 *          allowlist below.
 *
 * Drives the REAL handlers against stubbed AWS clients. No handler here reads a
 * sealed row, so no KMS is needed.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const util = require('util');
const assert = require('assert');
const nodeCrypto = require('crypto');

const REPO = path.join(__dirname, '..');

// ---- stubbed AWS SDK --------------------------------------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

/** Every command the handlers send, by name, so a check can see a path ran. */
let sent = [];

// What a command answers, when an empty object will not do.
const BEDROCK_REPLY = {
  content: [{ text: JSON.stringify({
    instructions: 'Read what the room said and name the pattern in it.',
    outputFormat: '## Summary\nWhat the room said:\n{responsesText}',
  }) }],
};
const ANSWERS = {
  QueryCommand: () => ({ Items: [], Count: 0 }),
  AdminListGroupsForUserCommand: () => ({ Groups: [] }),
  InvokeModelCommand: () => ({ body: new TextEncoder().encode(JSON.stringify(BEDROCK_REPLY)) }),
};

const client = {
  async send(cmd) {
    sent.push(cmd.commandName);
    const answer = ANSWERS[cmd.commandName];
    return answer ? answer(cmd) : {};
  },
};
class Client { send(cmd) { return client.send(cmd); } }

/** A module exporting one command class per name, plus `extra`. */
function sdk(names, extra) {
  const mod = { ...extra };
  for (const commandName of names) {
    mod[commandName] = class { constructor(input) { this.input = input; this.commandName = commandName; } };
  }
  return mod;
}

stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: Client });
stubs.set('@aws-sdk/lib-dynamodb', sdk(
  ['GetCommand', 'PutCommand', 'QueryCommand', 'DeleteCommand', 'UpdateCommand', 'ScanCommand', 'BatchWriteCommand'],
  { DynamoDBDocumentClient: { from: () => client } }));
stubs.set('@aws-sdk/client-s3', sdk(
  ['GetObjectCommand', 'PutObjectCommand', 'ListObjectsV2Command'], { S3Client: Client }));
stubs.set('@aws-sdk/client-bedrock-runtime', sdk(['InvokeModelCommand'], { BedrockRuntimeClient: Client }));
stubs.set('@aws-sdk/client-cognito-identity-provider', sdk(
  ['AdminGetUserCommand', 'AdminListGroupsForUserCommand', 'AdminAddUserToGroupCommand', 'AdminUpdateUserAttributesCommand'],
  { CognitoIdentityProviderClient: Client }));

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-prompts-bucket';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

const load = (rel) => require(path.join(REPO, 'lambda-functions', rel)).handler;

// ---- harness ---------------------------------------------------------------
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/**
 * Everything the console prints while `fn` runs, formatted as the Lambda
 * runtime formats it for CloudWatch but with no depth, array or string limit.
 * Also silences the handler's chatter. A throw is returned, not rethrown, so
 * one broken handler reports instead of ending the file.
 */
const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const level of LEVELS) {
    orig[level] = console[level];
    console[level] = (...args) => lines.push(util.formatWithOptions(FORMAT, ...args));
  }
  let out;
  try { out = await fn(); } catch (e) { out = { threw: e.stack || String(e) }; }
  finally { Object.assign(console, orig); }
  return { out, logs: lines.join('\n') };
}

/** A string no fixture, id or log template could contain by accident. */
const marker = (tag) => `zq${tag}${nodeCrypto.randomBytes(4).toString('hex')}`;

function leakAt(logs, needle) {
  const at = logs.toLowerCase().indexOf(String(needle).toLowerCase());
  if (at < 0) return null;
  const lineStart = logs.lastIndexOf('\n', at) + 1;
  const lineEnd = logs.indexOf('\n', at);
  return logs.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).slice(0, 300);
}

function assertNothingLogged(logs, secrets) {
  const leaks = [];
  for (const [what, needle] of Object.entries(secrets)) {
    const line = leakAt(logs, needle);
    if (line !== null) leaks.push(`${what}:\n           ${line}`);
  }
  assert.ok(leaks.length === 0, `${leaks.length} secret(s) reached the logs:\n         ${leaks.join('\n         ')}`);
}

/** The first log line containing every one of `needles`, or null. */
const lineWithAll = (logs, needles) =>
  logs.split('\n').find((l) => needles.every((n) => l.includes(n))) || null;

// ---- fixtures ---------------------------------------------------------------
const SUB = '9f1c2b7e-0000-4000-8000-00000000a11c';

/** Fresh secrets per handler, so one handler's leak cannot pass as another's. */
const freshSecrets = () => ({
  jwt: `Bearer SECRET-JWT-${marker('jwt')}`,
  body: marker('body'),
});

/**
 * An HTTP API (payload v2) event as API Gateway hands it over, with the bearer
 * token on both spellings of the header and `body` carrying the sentinel. The
 * authorizer context names the caller but no group or org, which is the
 * internal-call shape prompt-access.js lets through.
 */
function apiEvent(secrets, { method, routePath, rawPath, pathParameters, body }) {
  return {
    version: '2.0',
    routeKey: `${method} ${routePath}`,
    rawPath,
    headers: {
      Authorization: secrets.jwt,
      authorization: secrets.jwt,
      'content-type': 'application/json',
    },
    requestContext: {
      http: { method, path: rawPath },
      authorizer: { lambda: { userId: SUB } },
    },
    ...(pathParameters && { pathParameters }),
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

// ---- the static guard -------------------------------------------------------
/*
  What may never appear under lambda-functions/: a whole event stringified, a
  whole event handed to console, or its body or header set handed to console.
  `\bevent\b` so `events` and `eventType` are not caught; `event.body` IS, since
  stringifying the body is the same leak.
*/
const FORBIDDEN = [
  { what: 'JSON.stringify of the event', re: /JSON\.stringify\(\s*event\b/ },
  { what: 'the whole event handed to console', re: /console\.\w+\(\s*event\s*[,)]|console\.\w+\(.*,\s*event\s*[,)]/ },
  { what: 'the event body or headers handed to console', re: /console\.\w+\(.*[(,]\s*event\.(body|headers|multiValueHeaders)\s*[,)]/ },
];

/*
  EXACT LINES, not whole files, so a real dump added to one of these files later
  is still caught. An entry that no longer matches anything fails too, so the
  list cannot quietly outlive its reason.
*/
const ALLOWED = [
  {
    file: 'lambda-functions/admin/shared/review-log.js',
    line: 'if (!EVENTS.includes(event)) throw new Error(`review-log: refusing to record event ${JSON.stringify(event)}`);',
    why: '`event` there is a review-event NAME string being validated, not a Lambda event',
  },
  {
    file: 'lambda-functions/admin/get-ai-prompts.js',
    line: 'THIS USED TO BE JSON.stringify(event) — every header, Authorization',
    why: 'a comment recording the fix this test generalises',
  },
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function scanForEventDumps() {
  const hits = [];
  const allowedUsed = new Set();
  for (const full of walk(path.join(REPO, 'lambda-functions'))) {
    const rel = path.relative(REPO, full).split(path.sep).join('/');
    fs.readFileSync(full, 'utf8').split('\n').forEach((text, i) => {
      for (const rule of FORBIDDEN) {
        if (!rule.re.test(text)) continue;
        const allowed = ALLOWED.findIndex((a) => a.file === rel && a.line === text.trim());
        if (allowed >= 0) { allowedUsed.add(allowed); continue; }
        hits.push(`${rel}:${i + 1} — ${rule.what}\n           ${text.trim().slice(0, 160)}`);
      }
    });
  }
  const stale = ALLOWED.filter((_, i) => !allowedUsed.has(i)).map((a) => `${a.file}: ${a.line}`);
  return { hits, stale };
}

(async () => {
  say('\n1. ai-generate-prompt.js — the wand, with an org\'s prompt text in the body');
  {
    const secrets = freshSecrets();
    const handler = load('admin/ai-generate-prompt.js');
    sent = [];
    const { out, logs } = await captureLogs(() => handler(apiEvent(secrets, {
      method: 'POST', routePath: '/admin/ai-prompts/generate', rawPath: '/admin/ai-prompts/generate',
      body: {
        gameType: 'call-and-answer', category: 'lessons-learned',
        promptName: `Acme reorg debrief ${secrets.body}`,
        description: `How we tell staff ${secrets.body}`,
        currentInstructions: `Our own words ${secrets.body}`,
      },
    })));
    await check('the handler ran its whole path and answered 200', () => {
      assert.strictEqual(out && out.statusCode, 200, JSON.stringify(out).slice(0, 400));
      assert.ok(sent.includes('InvokeModelCommand'), `the model was never asked: ${sent.join(', ')}`);
    });
    await check('neither the JWT nor the body reaches the logs', () => assertNothingLogged(logs, secrets));
    await check('a trace line still says which request it was', () =>
      assert.ok(lineWithAll(logs, ['POST', '/admin/ai-prompts/generate']), `no line names the method and path:\n${logs.slice(0, 600)}`));
  }

  say('\n2. delete-game.js');
  {
    const secrets = freshSecrets();
    const handler = load('admin/delete-game.js');
    sent = [];
    const { out, logs } = await captureLogs(() => handler(apiEvent(secrets, {
      method: 'DELETE', routePath: '/admin/games/{gameId}', rawPath: '/admin/games/4821',
      pathParameters: { gameId: '4821' },
      body: { reason: secrets.body },
    })));
    await check('the handler ran its whole path and answered 200', () => {
      assert.strictEqual(out && out.statusCode, 200, JSON.stringify(out).slice(0, 400));
      assert.ok(sent.includes('DeleteCommand'), `nothing was deleted: ${sent.join(', ')}`);
    });
    await check('neither the JWT nor the body reaches the logs', () => assertNothingLogged(logs, secrets));
    await check('a trace line still says which request, and which game', () =>
      assert.ok(lineWithAll(logs, ['DELETE', '4821']), `no line names the method and the gameId:\n${logs.slice(0, 600)}`));
  }

  say('\n3. populate-defaults.js');
  {
    const secrets = freshSecrets();
    const handler = load('admin/populate-defaults.js');
    sent = [];
    const { out, logs } = await captureLogs(() => handler(apiEvent(secrets, {
      method: 'POST', routePath: '/admin/ai-prompts/populate-defaults', rawPath: '/admin/ai-prompts/populate-defaults',
      body: { overwrite: false, note: secrets.body },
    })));
    await check('the handler ran its whole path and answered 200', () => {
      assert.strictEqual(out && out.statusCode, 200, JSON.stringify(out).slice(0, 400));
      assert.ok(sent.includes('PutCommand'), `no default prompt was written: ${sent.join(', ')}`);
    });
    await check('neither the JWT nor the body reaches the logs', () => assertNothingLogged(logs, secrets));
    await check('a trace line still says which request it was', () =>
      assert.ok(lineWithAll(logs, ['POST', '/admin/ai-prompts/populate-defaults']), `no line names the method and path:\n${logs.slice(0, 600)}`));
    await check('the overwrite flag it acted on is still logged', () =>
      assert.ok(lineWithAll(logs, ['Overwrite mode: false']), 'the overwrite line is gone'));
  }

  say('\n4. auth/post-confirmation.js — a Cognito trigger, carrying the new account\'s email and name');
  {
    const secrets = {
      ...freshSecrets(),
      email: `${marker('mail')}@example.com`,
      name: `Ada ${marker('name')}`,
    };
    const handler = load('auth/post-confirmation.js');
    sent = [];
    // With UsernameAttributes: email, a native account's userName IS its sub.
    const event = {
      version: '1', region: 'us-east-1', userPoolId: 'us-east-1_TEST',
      userName: SUB,
      triggerSource: 'PostConfirmation_ConfirmSignUp',
      callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'test-client' },
      request: {
        userAttributes: {
          sub: SUB, email: secrets.email, name: secrets.name,
          email_verified: 'true', 'cognito:user_status': 'CONFIRMED',
        },
      },
      response: {},
      // Not part of a Cognito trigger. Carried so a dump of the whole event,
      // were one ever restored, is caught by the same two sentinels as above.
      headers: { Authorization: secrets.jwt },
      body: JSON.stringify({ note: secrets.body }),
    };
    const { out, logs } = await captureLogs(() => handler(event));
    await check('the trigger ran its whole path and handed the event back', () => {
      assert.strictEqual(out, event, JSON.stringify(out).slice(0, 400));
      assert.ok(sent.includes('PutCommand'), `no profile row was written: ${sent.join(', ')}`);
    });
    await check('the email, the name, the JWT and the body stay out of the logs', () =>
      assertNothingLogged(logs, secrets));
    await check('a trace line still names the trigger source and the account\'s sub', () =>
      assert.ok(lineWithAll(logs, ['PostConfirmation_ConfirmSignUp', SUB]), `no line names both:\n${logs.slice(0, 600)}`));
  }

  say('\n5. static guard: nothing under lambda-functions/ dumps an event');
  const { hits, stale } = scanForEventDumps();
  await check('no whole event, body or header set is stringified or handed to console', () =>
    assert.ok(hits.length === 0, `${hits.length} dump(s):\n         ${hits.join('\n         ')}`));
  await check('every allowlist entry still matches the line it excuses', () =>
    assert.ok(stale.length === 0, `stale allowlist entries:\n         ${stale.join('\n         ')}`));

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
