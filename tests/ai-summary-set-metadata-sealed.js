/**
 * THE SET'S OWN INSTRUCTIONS REACH WORKIE IN THE CLEAR, AND NEVER THE LOGS —
 * get-ai-summary.js on a session played from an organisation's set.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * admin/upload-questions.js writes an org set's METADATA row through
 * `encryptItem(cryptoOrgId, 'set', setMetadataItem)`, and ENCRYPTED_FIELDS.set
 * is name, description, customInstruction, aiContextInstruction and
 * roundKindBrief. get-ai-summary.js read that row twice with a plain GetCommand
 * and never opened it:
 *
 *   - in the handler, `sessionSetKey(metadata, questionSetId)`, whose
 *     customInstruction and aiContextInstruction feed the prompt;
 *   - in generateAISummary, the `oldSetMetadata` read via `setKey`.
 *
 * An envelope is a truthy OBJECT, so both fields were picked up, and:
 *
 *   - aiContextInstruction reached personas.js's
 *     `questionSetAiContext.trim()` and THREW — the worker failed and the room
 *     got `aiSummaryError`, unless a host or set persona won the voice first;
 *   - customInstruction became "[object Object]" in {sessionContext} and in the
 *     PARTICIPANT INSTRUCTIONS context line.
 *
 * get-question.js and create-report.js already open this row with the SET's
 * org — the session's pinned scope (`QuestionSetScope === 'org'` ->
 * `metadata.orgId`), never the caller's — and that is the rule held here.
 *
 * ── THE LOGS ───────────────────────────────────────────────────────────────
 *
 * The same read then printed both values: `📋 Found custom instruction for AI
 * prompt:` and `🎯 Found question set AI context:`. Once the row is decrypted
 * those would print an organisation's own prose to CloudWatch in the clear.
 * They must say what happened — present, and how long — and never the text
 * (lambda-functions/game/log-shape.js; tests/ai-summary-content-not-logged.js
 * holds the rest of this file to the same rule).
 *
 * rejects: an org set's customInstruction or aiContextInstruction missing from
 *          the Bedrock prompt, or reaching it as "[object Object]" or an
 *          envelope; a worker that fails on an org set with no persona picked;
 *          either value (or the set's name or description) in any console
 *          output, printed at unlimited depth; the two log lines silenced
 *          rather than described; the set row written back in the clear; a
 *          platform set's plaintext row no longer passing straight through.
 *
 * Drives the REAL worker path against a stubbed DynamoDB and a KMS that
 * enforces the key policy, exactly as tests/ai-summary-session-brief.js does,
 * and captures the body actually sent to Bedrock.
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
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      case 'scan': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          (v[':pk'] === undefined || i.PK === v[':pk'])
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

// A bodyless S3 object makes fetchPromptFromS3 fall back to the DynamoDB
// record's own `template`.
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
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

const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
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

// {sessionContext} is placed explicitly; there is no {contextSections}, so the
// context layer (QUESTION SET CONTEXT / PARTICIPANT INSTRUCTIONS) is injected.
const TEMPLATE =
  'SESSION: {sessionContext}\n' +
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  'TOP: {topVotedAnswers}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

/** Mint the org as create-org does: one GenerateDataKey, blob onto ORG#<id>/METADATA. */
async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId); // make the handler walk loader -> KMS Decrypt itself
}

/**
 * One round at RESULTS, played from SET_ID in `orgId`'s library (or the
 * platform's when orgId is ''), with the set's METADATA row written the way
 * upload-questions.js writes it — sealed under the org for an org set.
 */
async function seedRound(gameId, { orgId, secrets, personaId = null }) {
  const scope = orgId ? 'org' : '';
  const setRef = { scope, orgId, setId: SET_ID };
  const seal = (entity, item) => (orgId ? crypto.encryptItem(orgId, entity, item) : item);

  put(await seal('session', {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: 'call-and-answer',
    Title: 'Quarterly retro',
    QuestionSetId: SET_ID,
    ...(orgId ? { orgId, QuestionSetScope: 'org' } : {}),
    ...(personaId ? { PersonaId: personaId } : {}),
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });

  put(await seal('set', {
    ...setMetadataKey(setRef),
    ...(orgId ? { orgId } : {}),
    activeVersion: 1,
    engagementType: 'call-and-answer',
    name: secrets.name,
    description: secrets.description,
    customInstruction: secrets.customInstruction,
    aiContextInstruction: secrets.aiContextInstruction,
  }));
  const contentPk = orgId ? `ORG#${orgId}#SET#${SET_ID}#v1` : `SET#${SET_ID}#v1`;
  put(await seal('question', {
    PK: contentPk, SK: 'QUESTION#c001#001',
    Title: 'Which handoff hurt most this quarter?',
    Detail: 'Think of the one that cost the most days.',
    Category: 'Delivery',
  }));
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
    SetId: SET_ID, SetVersion: 1,
    ...(orgId ? { SetScope: 'org', SetOrgId: orgId } : {}),
  });

  for (const a of [
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'ship smaller' },
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'fewer handoffs' },
  ]) put(await seal('answer', a));

  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: TEMPLATE });
  return setRef;
}

const freshSecrets = () => ({
  name: `Finance offsite ${marker('name')}`,
  description: `Cost lessons for the quarter ${marker('desc')}`,
  customInstruction: `Frame every answer for the finance team ${marker('ci')}`,
  aiContextInstruction: `Speak as a blunt CFO who hates jargon ${marker('ctx')}`,
});

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

  say('\n1. an org set: its METADATA row is ciphertext at rest');
  const orgSecrets = freshSecrets();
  const setRef = await seedRound('5101', { orgId: ORG, secrets: orgSecrets });
  const setPk = setMetadataKey(setRef);
  const atRest = store.get(key(setPk.PK, setPk.SK));
  await check('the seeded set row carries envelopes, as upload-questions.js leaves it', () => {
    for (const f of ['name', 'description', 'customInstruction', 'aiContextInstruction']) {
      assert.ok(isEnvelope(atRest[f]), `${f} is not an envelope: ${JSON.stringify(atRest[f])}`);
    }
  });

  say('\n2. no persona picked: the set\'s AI context is the voice, and must not throw');
  const org = await runWorker('5101');
  await check('the worker completed (no aiSummaryError)', () =>
    assert.strictEqual(org.res && org.res.ok, true, JSON.stringify(org.res)));
  await check('a prompt was sent to the model', () =>
    assert.ok(org.prompt.length > 0, 'Bedrock was never called'));
  await check("the set's custom instruction is in the prompt, in the clear", () =>
    assert.ok(org.prompt.includes(orgSecrets.customInstruction), `customInstruction missing from:\n${org.prompt}`));
  await check("the set's AI context is in the prompt, in the clear", () =>
    assert.ok(org.prompt.includes(orgSecrets.aiContextInstruction), `aiContextInstruction missing from:\n${org.prompt}`));
  await check('no "[object Object]" and no envelope fragment in the prompt', () => {
    assert.ok(!org.prompt.includes('[object Object]'), `stringified envelope in:\n${org.prompt}`);
    for (const f of ['customInstruction', 'aiContextInstruction']) {
      assert.ok(!org.prompt.includes(atRest[f].ct), `${f} ciphertext reached the prompt`);
    }
  });

  say('\n3. …and none of the set\'s prose reaches the logs');
  await check('neither instruction, nor the set name or description, is in any console output', () =>
    assertNothingLogged(org.logs, orgSecrets));
  await check('the custom-instruction line still says what happened: present, and how long', () => {
    const line = lineMentioning(org.logs, 'custom instruction');
    assert.ok(line, 'no log line mentions the custom instruction any more');
    assert.ok(line.includes(`${orgSecrets.customInstruction.length} chars`), `no length in: ${line}`);
  });
  await check('the AI-context line still says what happened: present, and how long', () => {
    const line = lineMentioning(org.logs, 'ai context');
    assert.ok(line, 'no log line mentions the set\'s AI context any more');
    assert.ok(line.includes(`${orgSecrets.aiContextInstruction.length} chars`), `no length in: ${line}`);
  });

  say('\n4. a host-picked persona wins the voice: nothing throws, so this is the quiet half');
  put({ PK: 'AIPROMPTS', SK: 'PERSONA#coach', personaId: 'coach', name: 'Coach',
        voice: 'You are a warm, direct facilitator.', status: 'active' });
  const pickedSecrets = freshSecrets();
  await seedRound('5102', { orgId: ORG, secrets: pickedSecrets, personaId: 'coach' });
  const picked = await runWorker('5102');
  await check('the worker completed', () =>
    assert.strictEqual(picked.res && picked.res.ok, true, JSON.stringify(picked.res)));
  await check('the picked persona is the voice', () =>
    assert.ok(picked.prompt.includes('warm, direct facilitator'), 'persona voice missing'));
  await check("the set's custom instruction still reaches the prompt in the clear", () =>
    assert.ok(picked.prompt.includes(pickedSecrets.customInstruction), `customInstruction missing from:\n${picked.prompt}`));
  await check('no "[object Object]" in the prompt', () =>
    assert.ok(!picked.prompt.includes('[object Object]'), `stringified envelope in:\n${picked.prompt}`));
  await check('nothing from the set reaches the logs here either', () =>
    assertNothingLogged(picked.logs, pickedSecrets));

  say('\n5. the set row itself is untouched');
  await check('the set METADATA row is still ciphertext after the runs', () => {
    const after = store.get(key(setPk.PK, setPk.SK));
    for (const f of ['name', 'description', 'customInstruction', 'aiContextInstruction']) {
      assert.ok(isEnvelope(after[f]), `${f} was written back in the clear`);
    }
  });

  say('\n6. a platform set: its plaintext row passes straight through');
  store.clear();
  await mintOrg(ORG);
  const platSecrets = freshSecrets();
  await seedRound('5103', { orgId: '', secrets: platSecrets });
  const plat = await runWorker('5103');
  await check('the worker completed', () =>
    assert.strictEqual(plat.res && plat.res.ok, true, JSON.stringify(plat.res)));
  await check('both instructions reach the prompt unchanged', () => {
    assert.ok(plat.prompt.includes(platSecrets.customInstruction), `customInstruction missing from:\n${plat.prompt}`);
    assert.ok(plat.prompt.includes(platSecrets.aiContextInstruction), `aiContextInstruction missing from:\n${plat.prompt}`);
  });
  await check('and the log lines describe them rather than quote them', () =>
    assertNothingLogged(plat.logs, {
      customInstruction: platSecrets.customInstruction,
      aiContextInstruction: platSecrets.aiContextInstruction,
    }));

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
