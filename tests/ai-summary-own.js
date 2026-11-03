/**
 * WORKIE'S READ OF A QUESTION THE HOST WROTE (docs/design/impromptu-ask README
 * D7, §5.8, risk 4).
 *
 * No new prompt and no new template variable. For a round whose REF says
 * `Source: 'host'`:
 *   {questionTitle}   the host's question
 *   {questionDetail}  the line for the room, with the plain fact that there
 *                     is no lesson text behind it — or "None." and that fact
 *   {task}            the fixed "Answer in a sentence or two." the phones
 *                     showed, never the set's lesson task
 *   {background}      the host's private note, the question's Background,
 *                     which the read already withholds from players
 * and nothing of the set's own framing: not its customInstruction, not its AI
 * context, not its description. The session's Workie and voice are unchanged.
 *
 * The OWNQ# row is sealed under the session's org (an org session here), so
 * this also proves the read opens it rather than printing envelopes.
 *
 * rejects: the set's lesson task, AI context or description in the prompt of
 *          a host-written round; a missing "no lesson text" line; the note
 *          missing, or reaching the prompt as an envelope; the note in the
 *          logs.
 *
 * Drives the REAL worker path, as tests/ai-summary-set-metadata-sealed.js does.
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

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

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
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {} });

let bedrockBodies = [];
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      throw new Error('stub: no Bedrock in tests');
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrap(command.input.EncryptionContext.orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext && command.input.EncryptionContext.orgId;
        if (!ctx) throw new Error('AccessDeniedException');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId !== ctx) throw new Error('InvalidCiphertextException');
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
const { OWN_TASK, OWN_NO_LESSON } = require(path.join(REPO, 'lambda-functions/game/round-question.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[level] = console[level];
    console[level] = (...args) => lines.push(util.formatWithOptions(FORMAT, ...args));
  }
  let out;
  try { out = await fn(); } finally { Object.assign(console, orig); }
  return { out, logs: lines.join('\n') };
}

const ORG = 'org_acme';
const SET_ID = 'retro-set';
const marker = (tag) => `zq${tag}${nodeCrypto.randomBytes(4).toString('hex')}`;

const TEMPLATE =
  'ABOUT: {questionSetDescription}\n' +
  'Q: {questionTitle}\n' +
  'DETAIL: {questionDetail}\n' +
  'TASK: {task}\n' +
  'BG: {background}\n' +
  'SESSION: {sessionContext}\n' +
  'RESPONSES: {responsesText}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

const SET_SECRETS = {
  customInstruction: `How could you adapt this lesson to your team ${marker('ci')}`,
  aiContextInstruction: `Speak as the lesson's author ${marker('ctx')}`,
  description: `A set about handoffs ${marker('desc')}`,
};

async function seedOwnRound(gameId, { line, note }) {
  const seal = (entity, item) => crypto.encryptItem(ORG, entity, item);
  put(await seal('session', {
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Q4 planning retro',
    QuestionSetId: SET_ID, orgId: ORG, QuestionSetScope: 'org',
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#004', CurrentQuestionId: '004' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#004', QuestionNumber: '004', AuthorsRevealed: true });
  put(await seal('set', {
    ...setMetadataKey({ scope: 'org', orgId: ORG, setId: SET_ID }), orgId: ORG, activeVersion: 1,
    engagementType: 'call-and-answer', name: 'Retro set', ...SET_SECRETS,
  }));
  put(await seal('question', {
    PK: `ORG#${ORG}#SET#${SET_ID}#v1`, SK: 'QUESTION#c001#001', Title: 'A set question', Detail: 'A lesson', Category: 'Delivery',
  }));
  put(await seal('question', {
    PK: `GAME#${gameId}`, SK: 'OWNQ#own1', OrgId: ORG,
    Title: 'What would have to be true for us to ship the pilot by March?',
    Detail: line, Background: note, CustomInstructions: OWN_TASK, Status: 'asked', AskedRound: 4,
  }));
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#004#REF', SourceQuestionId: 'OWNQ#own1', Source: 'host', QuestionNumber: '004' });
  for (const a of [
    { PK: `GAME#${gameId}`, SK: 'QUESTION#004#ANSWER#Ada', PlayerName: 'Ada', Answer: 'one named owner' },
    { PK: `GAME#${gameId}`, SK: 'QUESTION#004#ANSWER#Grace', PlayerName: 'Grace', Answer: 'legal signs by January' },
  ]) put(await seal('answer', a));
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: TEMPLATE });
}

async function runWorker(gameId) {
  bedrockBodies = [];
  const { out: res, logs } = await captureLogs(async () => {
    try {
      return await getAiSummary({ __workerMode: true, gameId, questionId: '004' });
    } catch (e) {
      return { error: e.message };
    }
  });
  const prompt = bedrockBodies.length ? bedrockBodies[0].messages[0].content : '';
  return { res, logs, prompt };
}

(async () => {
  const blob = await crypto.createOrgDataKey(ORG);
  put({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, dataKeyCiphertext: blob });
  crypto.forgetOrg(ORG);

  say('\n1. a host-written round with no line for the room');
  const note = `Is the blocker budget or sign-off? ${marker('note')}`;
  await seedOwnRound('6401', { line: '', note });
  const r1 = await runWorker('6401');
  await check('a prompt was sent', () => assert.ok(r1.prompt.length > 0, JSON.stringify(r1.res)));
  await check('{questionTitle} is the host\'s question', () =>
    assert.ok(r1.prompt.includes('Q: What would have to be true for us to ship the pilot by March?\n'), r1.prompt));
  await check('{questionDetail} says "None." and that there is no lesson text behind it', () =>
    assert.ok(r1.prompt.includes(`DETAIL: None. ${OWN_NO_LESSON}\n`), r1.prompt));
  await check('{task} is the fixed task, not the set\'s lesson task', () => {
    assert.ok(r1.prompt.includes(`TASK: ${OWN_TASK}\n`), r1.prompt);
    assert.ok(!r1.prompt.includes(SET_SECRETS.customInstruction), 'the set\'s customInstruction reached the prompt');
  });
  await check('{background} is the host\'s private note, in the clear', () =>
    assert.ok(r1.prompt.includes(`BG: ${note}\n`), r1.prompt));
  await check('none of the set\'s framing: no AI context, no description', () => {
    assert.ok(!r1.prompt.includes(SET_SECRETS.aiContextInstruction), 'the set\'s AI context reached the prompt');
    assert.ok(!r1.prompt.includes(SET_SECRETS.description), 'the set\'s description reached the prompt');
  });
  await check('no envelope and no "[object Object]" in the prompt', () =>
    assert.ok(!r1.prompt.includes('[object Object]') && !/"ct"\s*:/.test(r1.prompt)));
  await check('the note never reaches the logs', () =>
    assert.ok(!r1.logs.includes(note), 'the host\'s note was logged'));

  say('\n2. with a line for the room');
  await seedOwnRound('6402', { line: 'Think about people, money and the calendar.', note });
  const r2 = await runWorker('6402');
  await check('{questionDetail} is the line, with the no-lesson fact beside it', () =>
    assert.ok(r2.prompt.includes(`DETAIL: Think about people, money and the calendar. (${OWN_NO_LESSON})\n`), r2.prompt));

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
