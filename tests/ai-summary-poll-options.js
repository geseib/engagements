/**
 * A POLL'S OPTIONS REACH THE SUMMARY PROMPT — lambda-functions/game/get-ai-summary.js
 *
 * Phase 0 of the survey redesign (docs/design/survey-redesign/PLAN.md). The
 * poll branch of generateAISummary built `{pollOptions}` from optionA..optionE
 * — attributes upload-questions.js writes only for TRIVIA. A poll's answers
 * live in ONE attribute, the lower-case `options` array, so on every poll in
 * the product the model was told the question had no options at all, and
 * summarised a vote without knowing what anybody voted between.
 *
 * And since 2026-09-23 `options` is in ENCRYPTED_FIELDS.question, so on an org
 * set it is an envelope. The question row that reaches generateAISummary is
 * NOT decrypted upstream, so the poll branch has to open `options` itself —
 * passing a legacy plaintext array through untouched.
 *
 * rejects: reading optionA..E for a poll that has `options`; the envelope
 * reaching the prompt as "[object Object]"; a legacy plaintext array failing
 * to read; a failed decrypt taking the whole summary down; losing the old
 * optionA..E rows that have no `options` at all.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs by request string, before the module loads -----------------------
const Module = require('module');
const realLoad = Module._load;

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

const store = new Map();
const put = (item) => store.set(`${item.PK}|${item.SK}`, item);
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: inp.Key ? store.get(`${inp.Key.PK}|${inp.Key.SK}`) : undefined };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'query' || cmd.type === 'scan') {
      const v = inp.ExpressionAttributeValues || {};
      const items = [...store.values()].filter((i) => (v[':pk'] === undefined || i.PK === v[':pk'])
        && String(i.SK).startsWith(String(v[':sk'] ?? '')));
      return { Items: items, Count: items.length };
    }
    return {};
  },
};

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
const noop = class { async send() { return {}; } };
const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', {
    DynamoDBDocumentClient: { from: () => fakeDoc },
    GetCommand, PutCommand, QueryCommand, ScanCommand, DeleteCommand,
  }],
  ['@aws-sdk/client-s3', { S3Client: noop, GetObjectCommand: class {} }],
  ['@aws-sdk/client-lambda', { LambdaClient: noop, InvokeCommand: class {} }],
  // No Bedrock in tests: every call below takes the fallback path, which still
  // carries debugInfo (the assembled prompt and its variables) under debugMode.
  ['@aws-sdk/client-bedrock-runtime', {
    BedrockRuntimeClient: class { async send() { throw new Error('stub: no Bedrock in tests'); } },
    InvokeModelCommand: class {},
  }],
  ['@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: noop, PostToConnectionCommand: class {} }],
  ['@aws-sdk/client-kms', makeKmsStub().exports],
]);
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

const summary = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
installTestKeyLoader();

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ORG = 'org_acme';

(async () => {
  say('\n1. the poll options line, from the `options` array');

  const { pollOptionsLine } = summary;
  await check('the helper is exported', () => assert.strictEqual(typeof pollOptionsLine, 'function'));

  await check("['A thing','B thing'] → Option 1: A thing, Option 2: B thing", async () =>
    assert.strictEqual(await pollOptionsLine({ options: ['A thing', 'B thing'] }, ''),
      'Option 1: A thing, Option 2: B thing'));
  await check('options win over optionA..E when both are present', async () =>
    assert.strictEqual(await pollOptionsLine({ options: ['Weekly', 'Monthly'], optionA: 'stale' }, ''),
      'Option 1: Weekly, Option 2: Monthly'));
  await check('blank entries drop out', async () =>
    assert.strictEqual(await pollOptionsLine({ options: ['Weekly', '  ', '', 'Monthly'] }, ''),
      'Option 1: Weekly, Option 2: Monthly'));
  await check('the capitalised spelling is read too', async () =>
    assert.strictEqual(await pollOptionsLine({ Options: ['Yes', 'No'] }, ''), 'Option 1: Yes, Option 2: No'));
  await check('an ORG set\'s envelope is decrypted, not printed', async () => {
    const env = await C.encryptValue(ORG, ['Weekly', 'Fortnightly', 'Monthly']);
    assert.ok(C.isEnvelope(env), 'fixture is not an envelope');
    assert.strictEqual(await pollOptionsLine({ options: env }, ORG),
      'Option 1: Weekly, Option 2: Fortnightly, Option 3: Monthly');
  });
  await check('a legacy plaintext array needs no key — even with no org at all', async () =>
    assert.strictEqual(await pollOptionsLine({ options: ['Yes', 'No'] }, ''), 'Option 1: Yes, Option 2: No'));
  await check('a decrypt that fails reads as no options, and does not throw', async () => {
    const env = await C.encryptValue('org_other', ['secret']);
    assert.strictEqual(await pollOptionsLine({ options: env }, ORG), '');
  });
  await check('with NO options attribute, optionA..E are still read (a hand-made row)', async () =>
    assert.strictEqual(await pollOptionsLine({ optionA: 'Red', optionC: 'Blue' }, ''),
      'Option 1: Red, Option 3: Blue'));
  await check('an empty options list is no options — not a fall back to optionA..E', async () =>
    assert.strictEqual(await pollOptionsLine({ options: [], optionA: 'stale' }, ''), ''));
  await check('no question at all is no options', async () =>
    assert.strictEqual(await pollOptionsLine(null, ''), ''));

  say('\n2. …and it is what reaches the prompt');

  put({
    PK: 'AIPROMPTS', SK: 'AIPROMPT#poll-test', s3Key: 'fake-key',
    template: 'Q: {questionTitle}\nOPTIONS: {pollOptions}\n'
      + '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x',
  });
  const baseArgs = {
    eventTitle: 'Poll Test', gameType: 'poll', gameAiContext: '', questionSetAiContext: '',
    customInstruction: '', promptId: 'poll-test', promptProvenance: { hierarchy: [] }, debugMode: true,
    questionId: '001', answers: [{ playerName: 'Ada', answer: 'A thing' }],
    results: { voteTallies: {}, winners: [], totalVotes: 0, maxScore: 0 },
    votes: [], gameId: 'poll-1', questionSetId: null, paddedQuestionNumber: '001',
    scoringConfig: { firstPlacePoints: 3, secondPlacePoints: 2, thirdPlacePoints: 1 },
    hostPersonaId: null, setPersonaId: null, hidden: false,
  };

  const plain = await summary.generateAISummary({
    ...baseArgs, question: { title: 'Which is better?', options: ['A thing', 'B thing'] },
  });
  await check('{pollOptions} carries the options array', () =>
    assert.strictEqual(plain.debugInfo.templateVariables.pollOptions, 'Option 1: A thing, Option 2: B thing',
      JSON.stringify(plain.debugInfo.templateVariables.pollOptions)));
  await check('…and the assembled prompt says them', () =>
    assert.ok(plain.debugInfo.fullPrompt.includes('OPTIONS: Option 1: A thing, Option 2: B thing'),
      plain.debugInfo.fullPrompt));

  const encrypted = await summary.generateAISummary({
    ...baseArgs, orgId: ORG,
    question: { title: 'Which cadence?', options: await C.encryptValue(ORG, ['Weekly', 'Monthly']) },
  });
  await check('an ORG poll\'s options reach the prompt as words, not an envelope', () => {
    assert.ok(encrypted.debugInfo.fullPrompt.includes('OPTIONS: Option 1: Weekly, Option 2: Monthly'),
      encrypted.debugInfo.fullPrompt);
    assert.ok(!encrypted.debugInfo.fullPrompt.includes('[object Object]'), 'an envelope was printed');
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('harness error: ' + (e && e.stack || e)); process.exit(2); });
