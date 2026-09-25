/**
 * WORKIE READS EACH QUESTION'S BACKGROUND, OBEYS ONE HONESTY RULE, AND RECORDS
 * WHAT CONTEXT IT HAD — get-ai-summary.js and personas.js
 * (docs/superpowers/specs/2026-09-25-question-background-design.md §3 and §4).
 *
 * A question row can carry `Background`: facts and angles its author wrote for
 * Workie, never shown to players, sealed at rest on an org's set
 * (ENCRYPTED_FIELDS.question). This file pins how the summariser uses it:
 *
 *   - the decrypted text reaches the prompt ONCE, under one label that says who
 *     wrote it — in the injected context block, or inside {contextSections}
 *     when the template places that, or wherever the template put {background}
 *     (and then nowhere else);
 *   - either spelling is read (`background` on a hand-built row);
 *   - one honesty rule rides every prompt, after the template and the host's
 *     additions and before the briefing, so withholdBriefing cannot cut it;
 *   - the summary row records ContextUsed — five plaintext booleans, never the
 *     content — and GET /games/{id}/ai-summary returns it (null for a row
 *     written before it existed, and for the data-driven fallback, which never
 *     read the context);
 *   - the Background's text never reaches console output.
 *
 * Drives the REAL worker path against a stubbed DynamoDB, a stubbed S3 and a
 * KMS that enforces the key policy — the harness of
 * tests/ai-summary-session-brief.js, with Bedrock ANSWERING (as in
 * tests/ai-summary-briefing.js) so the summary is written from the model path,
 * and captureLogs() from tests/ai-summary-prompt-name-not-logged.js.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
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
        // findDefaultPromptId's `PK = :pk AND isDefault = :isDefault` shape.
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

// ---- Bedrock: record what Workie was told, and answer -----------------------
// A real reply, so the summary row is written from the model path — the only
// path that read the context. `bedrockFails` sends one section down the
// data-driven fallback instead.
let bedrockBodies = [];
let bedrockFails = false;
const COMPLETION = '\n\nThe room put the easy fixes first.'
  + '\n\n## Discussion Questions\n1. Who guards the hard tickets?\n\n## Next Steps\n- Pull the quick fixes into one sprint.';
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      if (bedrockFails) throw new Error('stub: Bedrock is down for this section');
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text: COMPLETION }], stop_reason: 'end_turn' })) };
    }
  },
  InvokeModelCommand,
});

// ---- a KMS that behaves the way the key policy will ------------------------
const nodeCrypto = require('crypto');
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
const { ORG: ORG_SCOPE, PLATFORM, promptsMetadataPk } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const { setMetadataKey, setPartition } = require(path.join(REPO, 'lambda-functions/game/set-version.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
const personas = require(path.join(REPO, 'lambda-functions/game/personas.js'));
const { HONESTY_RULE, backgroundLine, withholdBriefing } = personas;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
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
 * limit, so a value three objects down still counts.
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

/** How many times `needle` occurs in `hay`. */
const count = (hay, needle) => hay.split(needle).length - 1;

// ---- fixtures ---------------------------------------------------------------
const ORG = 'org_acme';
const BG = 'zqbg Version control records every change.';
const LABEL = 'BACKGROUND ON THIS QUESTION (from the set\'s author, not something the room said): ';
const INJECTED_HEADING = 'SESSION CONTEXT — weave this into your reading of the room';
const BRIEFING_HEADING = 'THE BRIEFING — part of your material';

const BRIEF = {
  Details: 'Offsite for the platform team after the September reorg',
  AIContext: 'Name the two biggest risks the room raised before anything else',
};
const SET_NOTE = 'Topic: delivery, for engineering leads. Draw facts from the Background notes and from what the room says.';
const BRIEFING = 'The platform team cut its release cadence from monthly to weekly in August.';

const RESULT_SECTIONS =
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

// The platform default. No {contextSections} and no {background}, so the
// context layer is injected ahead of the template body.
const TEMPLATE =
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  'TOP: {topVotedAnswers}\n' +
  RESULT_SECTIONS;

/** Mint the org as create-org does: one GenerateDataKey, blob onto ORG#<id>/METADATA. */
async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId); // make the handler walk loader -> KMS Decrypt itself
}

/**
 * An org Workie written the way create-ai-prompt.js writes one (the shape of
 * seedOrgWorkie in tests/ai-summary-prompt-name-not-logged.js): the row under
 * the org's AIPROMPTS partition through `encryptItem(orgId, 'prompt')`, and
 * the whole body — here an `instructions` + `outputFormat` pair — in S3
 * through `encryptValue`.
 */
async function seedOrgWorkie(orgId, promptId, instructions) {
  const s3Key = `prompts/org/${orgId}/call-and-answer/${promptId}/v1.json`;
  const body = {
    promptId, version: 1, name: 'Acme debrief', description: 'Our own reading of a retro',
    gameType: 'call-and-answer', promptType: 'analysis', category: 'callandanswer',
    instructions, outputFormat: RESULT_SECTIONS,
    isDefault: false, status: 'active',
  };
  s3Bodies.set(s3Key, JSON.stringify(await crypto.encryptValue(orgId, body)));
  put(await crypto.encryptItem(orgId, 'prompt', {
    PK: promptsMetadataPk(ORG_SCOPE, orgId), SK: `AIPROMPT#${promptId}`,
    promptId, name: body.name, description: body.description,
    gameType: 'call-and-answer', promptType: 'analysis', category: 'callandanswer',
    isDefault: false, status: 'active', s3Key, version: 1,
    scope: ORG_SCOPE, orgId,
  }));
}

/**
 * One call-and-answer round at RESULTS, played from its own set (one set per
 * game, so one game's Background or Workie never leaks into another's). An
 * org round is sealed the way the writers leave it; a platform round is plain.
 *
 *   background      the question's Background, or undefined for none
 *   backgroundAttr  the attribute it is written under ('Background' by default)
 *   brief           the host filled in Event details and AI instructions
 *   setNote         the set's Workie note (aiContextInstruction)
 *   briefing        a Call & Answer briefing's text
 *   promptId        a Workie attached to the set
 */
async function seedRound(gameId, {
  orgId = '', background, backgroundAttr = 'Background', brief = false, setNote = '', briefing = '', promptId = null,
} = {}) {
  const scope = orgId ? ORG_SCOPE : PLATFORM;
  const setId = `set-${gameId}`;
  const setRef = { scope, orgId, setId };
  const seal = async (entity, item) => (orgId ? crypto.encryptItem(orgId, entity, item) : item);

  put(await seal('session', {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: 'call-and-answer',
    Title: 'Quarterly retro',
    QuestionSetId: setId,
    QuestionSetScope: scope,
    ...(orgId ? { orgId } : {}),
    ...(brief ? { Details: BRIEF.Details, AIContext: BRIEF.AIContext } : {}),
    ...(briefing ? { Briefing: { text: briefing, source: 'typed' } } : {}),
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });

  put(await seal('set', {
    ...setMetadataKey(setRef),
    ...(orgId ? { orgId } : {}),
    activeVersion: 1,
    engagementType: 'call-and-answer',
    name: 'Retro set',
    ...(setNote ? { aiContextInstruction: setNote } : {}),
    ...(promptId ? { promptId } : {}),
  }));
  put(await seal('question', {
    PK: setPartition(setRef, 1), SK: 'QUESTION#c001#001',
    Title: 'Which handoff hurt most this quarter?',
    Detail: 'Think of the one that cost the most days.',
    Category: 'Delivery',
    ...(background !== undefined ? { [backgroundAttr]: background } : {}),
  }));
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
    SetId: setId, SetVersion: 1, SetScope: scope, ...(orgId ? { SetOrgId: orgId } : {}),
  });

  for (const a of [
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'ship smaller' },
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'fewer handoffs' },
  ]) put(await seal('answer', a));

  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned',
        name: 'Lessons Learned', s3Key: 'platform-fake-key', template: TEMPLATE });
  return { questionAtRest: store.get(key(setPartition(setRef, 1), 'QUESTION#c001#001')) };
}

async function runWorker(gameId) {
  bedrockBodies = [];
  // Worker mode RETHROWS (so the Event invoke retries); catch it here so one
  // failing section reports instead of ending the file.
  let res;
  try {
    res = await getAiSummary({ __workerMode: true, gameId, questionId: '001', debug: 'true' });
  } catch (e) {
    res = { error: e.message };
  }
  const prompt = bedrockBodies.length ? bedrockBodies[0].messages[0].content : '';
  return { res, prompt, stored: store.get(key(`GAME#${gameId}`, 'QUESTION#001#AISummary')) };
}

const getSummary = async (gameId, extra = {}) => {
  const res = await getAiSummary({
    pathParameters: { gameId }, queryStringParameters: { questionId: '001', ...extra },
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};

(async () => {
  await mintOrg(ORG);

  say('\n0. personas.js: the label, the rule, the block');
  await check('HONESTY_RULE and backgroundLine are exported', () => {
    assert.strictEqual(typeof HONESTY_RULE, 'string');
    assert.strictEqual(typeof backgroundLine, 'function');
  });
  await check('the honesty rule is the spec\'s text', () => assert.strictEqual(HONESTY_RULE,
    'Facts come from the material above, from what the room said, or from general knowledge you are certain '
    + 'of. Never invent numbers, names, quotations, or anything about this organisation or event. When something '
    + 'you would like is missing, work with what you have and do not mention that it is missing.'));
  await check('backgroundLine labels a Background, and is empty for nothing', () => {
    assert.strictEqual(backgroundLine(`  ${BG}  `), LABEL + BG);
    for (const v of [undefined, null, '', '   ', 42, {}]) assert.strictEqual(backgroundLine(v), '');
  });
  await check('buildContextBlock adds the Background after the set author\'s line', () => {
    const block = personas.buildContextBlock({
      eventDetails: 'the details', hostInstructions: 'the instructions',
      questionSetContext: 'the set note', questionBackground: BG,
    });
    assert.ok(block.includes(LABEL + BG), block);
    assert.ok(block.indexOf(LABEL) > block.indexOf("FROM THE QUESTION SET'S AUTHOR: the set note"), block);
  });
  await check('a Background alone still makes a block; no Background leaves the three-field block unchanged', () => {
    assert.ok(personas.buildContextBlock({ questionBackground: BG }).includes(LABEL + BG));
    const three = { eventDetails: 'a', hostInstructions: 'b', questionSetContext: 'c' };
    assert.strictEqual(personas.buildContextBlock({ ...three, questionBackground: '  ' }),
      personas.buildContextBlock(three));
  });

  say('\n1. an org round whose question has a Background');
  const { questionAtRest } = await seedRound('7101', { orgId: ORG, background: BG, brief: true, setNote: SET_NOTE });
  await check('the seeded Background is an envelope at rest, as the importer leaves it', () =>
    assert.ok(isEnvelope(questionAtRest.Background), JSON.stringify(questionAtRest.Background)));
  const { out: withBg, logs: withBgLogs } = await captureLogs(() => runWorker('7101'));
  await check('the worker completed from the model path', () => {
    assert.strictEqual(withBg.res && withBg.res.ok, true, JSON.stringify(withBg.res));
    assert.ok(withBg.prompt.length > 0, 'Bedrock was never called');
  });
  await check('the decrypted Background reaches the prompt, labelled', () =>
    assert.ok(withBg.prompt.includes(LABEL + BG), withBg.prompt));
  await check('it appears exactly once', () =>
    assert.strictEqual(count(withBg.prompt, 'zqbg Version control'), 1));
  await check('no ciphertext and no "[object Object]" in the prompt', () => {
    assert.ok(!withBg.prompt.includes(questionAtRest.Background.ct), 'Background ciphertext reached the prompt');
    assert.ok(!withBg.prompt.includes('[object Object]'));
  });
  await check('the honesty rule is in the prompt, after the template and the host\'s additions', () => {
    assert.ok(withBg.prompt.includes(HONESTY_RULE));
    assert.ok(withBg.prompt.lastIndexOf(HONESTY_RULE) > withBg.prompt.lastIndexOf(LABEL));
    const additions = withBg.prompt.indexOf("THE HOST'S REQUIRED ADDITIONS");
    assert.ok(additions > -1, 'the host directive is missing — the fixture should carry one');
    assert.ok(withBg.prompt.lastIndexOf(HONESTY_RULE) > additions, 'the rule comes before the host\'s additions');
    assert.ok(withBg.prompt.trimEnd().endsWith(HONESTY_RULE), 'an unbriefed prompt ends with the rule');
  });
  await check('ContextUsed is stored, flags only', () => {
    const cu = withBg.stored.ContextUsed;
    assert.deepStrictEqual(Object.keys(cu).sort(), ['background', 'briefing', 'eventDetails', 'hostInstructions', 'setNote']);
    assert.strictEqual(cu.background, true);
    for (const v of Object.values(cu)) assert.strictEqual(typeof v, 'boolean');
  });
  await check('each flag says what this round had', () =>
    assert.deepStrictEqual(withBg.stored.ContextUsed,
      { background: true, setNote: true, eventDetails: true, hostInstructions: true, briefing: false }));
  await check('ContextUsed is plaintext on an org\'s summary row, while the summary itself is sealed', () => {
    assert.ok(!isEnvelope(withBg.stored.ContextUsed));
    assert.ok(isEnvelope(withBg.stored.SummaryText) || isEnvelope(withBg.stored.MarkdownResponse));
  });

  say('\n2. the same round with no Background (and a briefing, and nothing else)');
  await seedRound('7102', { orgId: ORG, briefing: BRIEFING });
  const noBg = await runWorker('7102');
  await check('the worker completed from the model path', () =>
    assert.strictEqual(noBg.res && noBg.res.ok, true, JSON.stringify(noBg.res)));
  await check('no Background, no label, and the flag says so', () => {
    assert.ok(!noBg.prompt.includes(LABEL));
    assert.strictEqual(noBg.stored.ContextUsed.background, false);
    assert.ok(noBg.prompt.includes(HONESTY_RULE), 'the honesty rule is on every prompt');
  });
  await check('each flag says what this round had', () =>
    assert.deepStrictEqual(noBg.stored.ContextUsed,
      { background: false, setNote: false, eventDetails: false, hostInstructions: false, briefing: true }));
  await check('the honesty rule comes before the briefing, so withholding the briefing keeps it', () => {
    const at = noBg.prompt.indexOf(BRIEFING_HEADING);
    assert.ok(at > -1, 'the briefing layer is missing — the fixture should carry one');
    assert.ok(noBg.prompt.indexOf(HONESTY_RULE) < at);
    assert.ok(withholdBriefing(noBg.prompt).includes(HONESTY_RULE));
  });
  await check('?debug=true on the public GET returns a prompt with the rule and without the briefing', async () => {
    const { body } = await getSummary('7102', { debug: 'true' });
    assert.ok(body.debugPrompt.includes(HONESTY_RULE), body.debugPrompt);
    assert.ok(!body.debugPrompt.includes(BRIEFING), 'the briefing reached a public route');
  });

  say('\n3. a lowercase `background` on a hand-built platform row');
  await seedRound('7103', { background: 'zqbg-lower', backgroundAttr: 'background' });
  const lower = await runWorker('7103');
  await check('the worker completed', () =>
    assert.strictEqual(lower.res && lower.res.ok, true, JSON.stringify(lower.res)));
  await check('a lowercase background attribute is read too', () =>
    assert.ok(lower.prompt.includes(LABEL + 'zqbg-lower'), lower.prompt));
  await check('…and flagged', () => assert.strictEqual(lower.stored.ContextUsed.background, true));

  say('\n4. a Workie that places {background} itself');
  await seedOrgWorkie(ORG, 'acme-bg-workie',
    'OUR OWN WORKIE\nQ: {questionTitle}\nBackground: {background}\nRESPONSES: {responsesText}');
  await seedRound('7104', { orgId: ORG, background: BG, brief: true, promptId: 'acme-bg-workie' });
  const placed = await runWorker('7104');
  await check('the org Workie drove the prompt', () =>
    assert.ok(placed.prompt.includes('OUR OWN WORKIE'), placed.prompt));
  await check('{background} in the template: once, and not repeated in the block', () => {
    assert.strictEqual(count(placed.prompt, 'zqbg Version control'), 1);
    assert.ok(!placed.prompt.includes(LABEL));
  });
  await check('…where the template put it', () =>
    assert.ok(placed.prompt.includes(`Background: ${BG}`), placed.prompt));
  await check('the injected block still carries everything else', () =>
    assert.ok(placed.prompt.includes(INJECTED_HEADING) && placed.prompt.includes(BRIEF.Details)));
  await check('…and it is still flagged as used', () =>
    assert.strictEqual(placed.stored.ContextUsed.background, true));

  say('\n5. a Workie that places {contextSections} and not {background} (Ruling R2)');
  await seedOrgWorkie(ORG, 'acme-ctx-workie',
    'OUR CONTEXT WORKIE\nQ: {questionTitle}\nRESPONSES: {responsesText}\n{contextSections}');
  await seedRound('7105', { orgId: ORG, background: BG, brief: true, setNote: SET_NOTE, promptId: 'acme-ctx-workie' });
  const sections = await runWorker('7105');
  await check('the org Workie drove the prompt', () =>
    assert.ok(sections.prompt.includes('OUR CONTEXT WORKIE'), sections.prompt));
  await check('the Background appears exactly once', () =>
    assert.strictEqual(count(sections.prompt, 'zqbg Version control'), 1));
  await check('…inside its CONTEXT INFORMATION block, labelled, after the other context', () => {
    const at = sections.prompt.indexOf('CONTEXT INFORMATION:');
    assert.ok(at > -1, sections.prompt);
    const block = sections.prompt.slice(at, sections.prompt.indexOf('\n\n', at));
    assert.ok(block.includes(LABEL + BG), `not in the block:\n${block}`);
    assert.ok(block.includes(`ABOUT THIS SESSION: ${BRIEF.Details}`), block);
    assert.ok(block.indexOf(LABEL) > block.indexOf('QUESTION SET CONTEXT:'), block);
  });
  await check('…and not in an injected context layer', () =>
    assert.ok(!sections.prompt.includes(INJECTED_HEADING), sections.prompt));

  say('\n6. the public GET returns the flags');
  await check('GET ai-summary returns contextUsed', async () => {
    const { statusCode, body } = await getSummary('7101');
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(body.fromCache, true);
    assert.strictEqual(body.contextUsed.background, true);
    assert.deepStrictEqual(body.contextUsed, withBg.stored.ContextUsed);
  });
  await check('a summary row written before ContextUsed existed returns contextUsed: null', async () => {
    delete store.get(key('GAME#7101', 'QUESTION#001#AISummary')).ContextUsed;
    const { body } = await getSummary('7101');
    assert.strictEqual(body.contextUsed, null);
  });

  say('\n7. the data-driven fallback read no context, so it records none');
  await seedRound('7106', { orgId: ORG, background: BG, brief: true, setNote: SET_NOTE });
  bedrockFails = true;
  const fellBack = await runWorker('7106');
  bedrockFails = false;
  await check('the worker completed with a fallback summary', () =>
    assert.strictEqual(fellBack.res && fellBack.res.ok, true, JSON.stringify(fellBack.res)));
  await check('the model was still given the Background and the rule', () =>
    assert.ok(fellBack.prompt.includes(LABEL + BG) && fellBack.prompt.includes(HONESTY_RULE)));
  await check('no ContextUsed on the row, and GET says null', async () => {
    assert.ok(!('ContextUsed' in fellBack.stored), JSON.stringify(Object.keys(fellBack.stored)));
    const { body } = await getSummary('7106');
    assert.strictEqual(body.contextUsed, null);
  });

  say('\n8. the text is never logged');
  await check('Background text never reaches console output', () =>
    assert.ok(!withBgLogs.includes('zqbg Version control'), 'the Background was logged'));
  await check('the raw-question line describes the Background by its shape', () => {
    const line = withBgLogs.split('\n').find((l) => l.includes('RAW QUESTION DATA:'));
    assert.ok(line, 'no RAW QUESTION DATA line');
    assert.ok(line.includes(`background ${BG.length} chars`), line);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
