/**
 * AN ORGANISATION'S WORKIE IS NEVER NAMED IN THE LOGS — get-ai-summary.js on a
 * session whose set carries the org's own AI prompt.
 *
 * ── THE LEAK ───────────────────────────────────────────────────────────────
 *
 * An org's Workie is sealed twice: create-ai-prompt.js writes the row through
 * `encryptItem(orgId, 'prompt', …)` — ENCRYPTED_FIELDS.prompt carries `name`
 * and `description` — and wraps the S3 body with `encryptValue`.
 * fetchPromptFromS3 opens both, because the summary needs the template. Three
 * log lines then printed the opened name to CloudWatch in the clear:
 *
 *   - `✅ Successfully fetched prompt: <name>`, in fetchPromptFromS3;
 *   - `📝 Using prompt template: <name>`, in generateAISummary;
 *   - `❌ Prompt <id> ("<name>") EXISTS but cannot drive a summary`, in
 *     resolvePromptTemplate, when the org's Workie is generation-shaped.
 *
 * Encrypting a field and then logging it is not encrypting it. A log line says
 * which prompt — its id, a pointer and plaintext by design — and what its name
 * is (lambda-functions/game/log-shape.js), never what it says.
 *
 * `✅ Found default prompt: <id> (<name>)` in findDefaultPromptId is NOT on
 * the boundary: its Scan reads the bare `AIPROMPTS` partition only, and
 * create-ai-prompt.js refuses `isDefault` on any non-platform row, so a default
 * is always a platform prompt, which is plaintext by decision
 * (tenant-crypto.js, ENCRYPTED_FIELDS.prompt).
 *
 * rejects: an org Workie's name or description, or its template, in any
 *          console output printed at unlimited depth — on the path where its
 *          S3 body opens and it drives the summary, and on the path where it
 *          is generation-shaped and the round falls back to the default; the
 *          lines silenced rather than described, or no longer saying which
 *          prompt; a fix that stops the org's own Workie driving the summary.
 *
 * Drives the REAL worker path against a stubbed DynamoDB, a stubbed S3 holding
 * the body create-ai-prompt.js would write, and a KMS that enforces the key
 * policy — the harness of tests/ai-summary-set-metadata-sealed.js.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
const assert = require('assert');
const nodeCrypto = require('crypto');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

/** A GetCommand with a ProjectionExpression returns only those attributes. */
function project(item, input) {
  if (!item || !input.ProjectionExpression) return item;
  const names = input.ExpressionAttributeNames || {};
  const out = {};
  for (const raw of input.ProjectionExpression.split(',')) {
    const attr = names[raw.trim()] || raw.trim();
    if (attr in item) out[attr] = item[attr];
  }
  return out;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: project(store.get(key(inp.Key.PK, inp.Key.SK)), inp) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        // `:isDefault` is findDefaultPromptId's filter on the AIPROMPTS partition.
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? ''))
          && (v[':isDefault'] === undefined || i.isDefault === v[':isDefault']));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- S3: the bodies create-ai-prompt.js would have written ------------------
// A key with no body answers bodyless, which makes fetchPromptFromS3 fall back
// to the DynamoDB record's own `template` — how the platform default is served.
const s3Bodies = new Map();
class GetObjectCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      const body = cmd instanceof GetObjectCommand ? s3Bodies.get(cmd.input.Key) : undefined;
      return body === undefined ? {} : { Body: { transformToString: async () => body } };
    }
  },
  GetObjectCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});

// ---- Bedrock: record what Workie was told, then fail ------------------------
let bedrockBodies = [];
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      throw new Error('stub: no Bedrock in tests');
    }
  },
  InvokeModelCommand,
});

// ---- a KMS that behaves the way the key policy will ------------------------
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrap(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId !== ctx) throw new Error('InvalidCiphertextException: encryption context mismatch');
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.AI_PROMPTS_BUCKET = 'test-prompts-bucket';

const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { ORG: ORG_SCOPE, promptsMetadataPk } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const { setMetadataKey } = require(path.join(REPO, 'lambda-functions/game/set-version.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

// ---- harness ---------------------------------------------------------------
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

/**
 * Everything the console prints while `fn` runs, formatted as the Lambda
 * runtime formats it for CloudWatch — but with no depth, array or string
 * limit, so a value three objects down still counts. The console is also
 * silenced by this, so the handler's own chatter never reaches the terminal.
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
  try { out = await fn(); } finally { Object.assign(console, orig); }
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

/** The log line that mentions `phrase`, or null. */
const lineMentioning = (logs, phrase) =>
  logs.split('\n').find((l) => l.toLowerCase().includes(phrase)) || null;

// ---- fixtures ---------------------------------------------------------------
const ORG = 'org_acme';
const SET_ID = 'retro-set';

const RESULT_SECTIONS =
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

// The platform default: served from its DynamoDB record, as in the model test.
const DEFAULT_TEMPLATE = `HOUSE DEFAULT\nQ: {questionTitle}\nRESPONSES: {responsesText}\n${RESULT_SECTIONS}`;

/** Mint the org as create-org does: one GenerateDataKey, blob onto ORG#<id>/METADATA. */
async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId); // make the handler walk loader -> KMS Decrypt itself
}

/**
 * An org Workie written the way create-ai-prompt.js writes one: the row under
 * the org's AIPROMPTS partition through `encryptItem(orgId, 'prompt')`, and the
 * whole body in S3 through `encryptValue`. `shape` is 'analysis' (a template
 * the summary engine can run) or 'generation' (basePrompt only — it cannot).
 */
async function seedOrgWorkie(orgId, promptId, secrets, shape) {
  const s3Key = `prompts/org/${orgId}/call-and-answer/${promptId}/v1.json`;
  const shaped = shape === 'analysis'
    ? { template: secrets.template, category: 'callandanswer' }
    : { basePrompt: secrets.template, outputFormat: 'Three bullets.' };
  const body = {
    promptId, version: 1, name: secrets.name, description: secrets.description,
    gameType: 'call-and-answer', promptType: shape, ...shaped,
    isDefault: false, status: 'active',
  };
  s3Bodies.set(s3Key, JSON.stringify(await crypto.encryptValue(orgId, body)));

  const row = {
    PK: promptsMetadataPk(ORG_SCOPE, orgId), SK: `AIPROMPT#${promptId}`,
    promptId, name: secrets.name, description: secrets.description,
    gameType: 'call-and-answer', promptType: shape,
    ...(shape === 'generation' ? { basePrompt: secrets.template, outputFormat: 'Three bullets.' } : { category: 'callandanswer' }),
    isDefault: false, status: 'active', s3Key, version: 1,
    scope: ORG_SCOPE, orgId,
  };
  const sealed = await crypto.encryptItem(orgId, 'prompt', row);
  put(sealed);
  return sealed;
}

/**
 * One call-and-answer round at RESULTS, played from SET_ID in `orgId`'s
 * library, whose METADATA row attaches `promptId` — sealed under the org, the
 * way upload-questions.js leaves it.
 */
async function seedRound(gameId, { orgId, promptId }) {
  const setRef = { scope: ORG_SCOPE, orgId, setId: SET_ID };
  const seal = (entity, item) => crypto.encryptItem(orgId, entity, item);

  put(await seal('session', {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: 'call-and-answer',
    Title: 'Quarterly retro',
    QuestionSetId: SET_ID,
    orgId, QuestionSetScope: 'org',
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });

  put(await seal('set', {
    ...setMetadataKey(setRef),
    orgId,
    activeVersion: 1,
    engagementType: 'call-and-answer',
    name: 'Retro set',
    description: 'Quarterly retro questions',
    promptId,
  }));
  put(await seal('question', {
    PK: `ORG#${orgId}#SET#${SET_ID}#v1`, SK: 'QUESTION#c001#001',
    Title: 'Which handoff hurt most this quarter?',
    Detail: 'Think of the one that cost the most days.',
    Category: 'Delivery',
  }));
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
    SetId: SET_ID, SetVersion: 1, SetScope: 'org', SetOrgId: orgId,
  });

  for (const a of [
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'ship smaller' },
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'fewer handoffs' },
  ]) put(await seal('answer', a));

  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned',
        name: 'Lessons Learned', s3Key: 'platform-fake-key', template: DEFAULT_TEMPLATE });
}

const freshSecrets = () => ({
  name: `Acme layoffs debrief ${marker('name')}`,
  description: `How we tell staff about the reorg ${marker('desc')}`,
  template: `WORKIE OWN VOICE ${marker('tpl')}\nQ: {questionTitle}\nRESPONSES: {responsesText}\n${RESULT_SECTIONS}`,
});

/** Run the worker, capturing every console line and what Bedrock was sent. */
async function runWorker(gameId) {
  bedrockBodies = [];
  // Worker mode RETHROWS (so the Event invoke retries); catch it here so one
  // failing section reports instead of ending the file.
  const { out: res, logs } = await captureLogs(async () => {
    try {
      return await getAiSummary({ __workerMode: true, gameId, questionId: '001' });
    } catch (e) {
      return { error: e.message };
    }
  });
  const prompt = bedrockBodies.length ? bedrockBodies[0].messages[0].content : '';
  return { res, logs, prompt };
}

(async () => {
  await mintOrg(ORG);

  say("\n1. an org's own Workie drives the summary: its row and body are ciphertext at rest");
  const WORKIE = 'acme-debrief-workie';
  const usable = freshSecrets();
  const sealedRow = await seedOrgWorkie(ORG, WORKIE, usable, 'analysis');
  await seedRound('5201', { orgId: ORG, promptId: WORKIE });
  await check('the seeded Workie row carries envelopes, as create-ai-prompt.js leaves it', () => {
    for (const f of ['name', 'description']) {
      assert.ok(isEnvelope(sealedRow[f]), `${f} is not an envelope: ${JSON.stringify(sealedRow[f])}`);
    }
  });
  await check('…and so does its S3 body', () => {
    const body = JSON.parse(s3Bodies.get(sealedRow.s3Key));
    assert.ok(isEnvelope(body), 'the S3 body is not one envelope');
    assert.ok(!s3Bodies.get(sealedRow.s3Key).includes(usable.name), 'the name is readable in the bucket');
  });

  const run = await runWorker('5201');
  await check('the worker completed', () =>
    assert.strictEqual(run.res && run.res.ok, true, JSON.stringify(run.res)));
  await check("the org's own Workie drove the prompt — its template reached the model", () =>
    assert.ok(run.prompt.includes(usable.template.split('\n')[0]), `the Workie template is not in:\n${run.prompt}`));

  say("\n2. …and neither its name, its description nor its template reaches the logs");
  await check('none of the Workie\'s prose is in any console output', () =>
    assertNothingLogged(run.logs, usable));
  await check('the fetch line still says a prompt was found, and which one', () => {
    const line = lineMentioning(run.logs, 'successfully fetched prompt');
    assert.ok(line, 'no log line says the prompt was fetched any more');
    assert.ok(line.includes(WORKIE), `the fetch line does not name the promptId: ${line}`);
  });
  await check('the template line still says which prompt drives the summary', () => {
    const line = lineMentioning(run.logs, 'using prompt template');
    assert.ok(line, 'no log line says which prompt template is in use any more');
    assert.ok(line.includes(WORKIE), `the template line does not name the promptId: ${line}`);
  });

  say("\n3. a generation-shaped org Workie: the round falls back, and says so without naming it");
  const GEN = 'acme-art-workie';
  const unusable = freshSecrets();
  await seedOrgWorkie(ORG, GEN, unusable, 'generation');
  await seedRound('5202', { orgId: ORG, promptId: GEN });
  const fell = await runWorker('5202');
  await check('the worker completed', () =>
    assert.strictEqual(fell.res && fell.res.ok, true, JSON.stringify(fell.res)));
  await check('the platform default drove the prompt instead', () =>
    assert.ok(fell.prompt.includes('HOUSE DEFAULT'), `the default template is not in:\n${fell.prompt}`));
  await check('none of the Workie\'s prose is in any console output', () =>
    assertNothingLogged(fell.logs, unusable));
  await check('the unusable-prompt line still says which prompt, and why', () => {
    const line = lineMentioning(fell.logs, 'cannot drive a summary');
    assert.ok(line, 'no log line says the attached prompt cannot drive a summary any more');
    assert.ok(line.includes(GEN), `the line does not name the promptId: ${line}`);
    assert.ok(line.includes('generation-format'), `the line no longer says why: ${line}`);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
