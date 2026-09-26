/**
 * GUIDANCE FOR ONE BATCH OF ADDED QUESTIONS — the generator half.
 *
 * THE ASK, in the owner's words: *"When adding questions to a question set:
 * optional guidance. I can imagine having a question set on historic figures and
 * wanting to add 'be sure to include George Washington in at least 1 question',
 * or 'make these more focused on recent historic figures'."*
 *
 * The builders send it as its own request field, `batchGuidance` — never folded
 * into `customPrompt`, which is the set's standing brief. What this suite holds
 * the two whole-set generators to:
 *
 *   - PLACEMENT. The guidance is read BEFORE the set's topic and brief, because
 *     first is what a model follows (the DIRECTION BEFORE TOPIC note in
 *     ai-generate-scenarios.js buildPrompt). Trivia: straight after the opening
 *     "Create N trivia questions about …" line. Scenarios: after the round
 *     direction, if there is one, and before `TOPIC:`.
 *   - NO GUIDANCE, NO CHANGE. Absent or blank, guidance changes nothing: the
 *     opening is pinned to the exact lines these generators wrote before the
 *     field existed, and cutting the block back out of a prompt that has it
 *     gives the prompt that does not, byte for byte. That comparison is within
 *     one build ON PURPOSE, not against a whole-prompt snapshot: the rest of
 *     the prompt moves for other reasons (the question-background work added a
 *     `background` line to LENGTH LIMITS), and guidance must change nothing
 *     ELSE, whatever the rest currently says.
 *   - THE LIMIT. Trimmed, capped at 500 characters, dropped when empty.
 *   - EVERY CHUNK. Generation runs in passes; a later pass carries the guidance
 *     as well as the ALREADY GENERATED list.
 *   - IT SURVIVES THE DISPATCH. Started over HTTP, run by the worker from the
 *     payload the handler really dispatched, and found in the Bedrock request.
 *   - NEVER LOGGED, NEVER STORED. Not in any console output, not on the job row,
 *     not on a set the worker creates.
 *
 * Harness follows tests/generated-set-creation.js: the REAL handlers, with the
 * AWS SDK stubbed by module name.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const util = require('util');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK by module name before any handler loads -------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

process.env.TABLE_NAME = 'engage-test';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

// ---- DynamoDB -------------------------------------------------------------
const ddb = new Map();
const rowKey = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class BatchWriteCommand { constructor(input) { this.kind = 'batchWrite'; this.input = input; } }
class DeleteCommand { constructor(input) { this.kind = 'delete'; this.input = input; } }

class ConditionalCheckFailedException extends Error {
  constructor() { super('The conditional request failed'); this.name = 'ConditionalCheckFailedException'; }
}

function applyUpdate(item, input) {
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const body = String(input.UpdateExpression).replace(/^\s*SET\s+/i, '');
  for (const clause of body.split(/,(?![^(]*\))/)) {
    const [lhsRaw, rhsRaw] = clause.split('=');
    if (!rhsRaw) continue;
    const attr = names[lhsRaw.trim()] || lhsRaw.trim();
    const rhs = rhsRaw.trim();
    const listAppend = rhs.match(/^list_append\(\s*if_not_exists\(([^,]+),\s*([^)]+)\)\s*,\s*(\S+)\s*\)$/);
    if (listAppend) {
      const existing = item[names[listAppend[1].trim()] || listAppend[1].trim()];
      const seed = values[listAppend[2].trim()];
      const entry = values[listAppend[3].trim()];
      item[attr] = [...(Array.isArray(existing) ? existing : seed), ...entry];
      continue;
    }
    item[attr] = values[rhs];
  }
}

/** The job claim and the set-creation claim, as in generated-set-creation.js. */
function conditionHolds(input, item) {
  const condition = String(input.ConditionExpression);
  const notExists = condition.match(/^attribute_not_exists\((\w+)\)$/);
  if (notExists) return item[notExists[1]] === undefined;
  const equals = condition.match(/^\s*(#?\w+)\s*=\s*(:\w+)\s*$/);
  if (equals) {
    const attr = (input.ExpressionAttributeNames || {})[equals[1]] || equals[1];
    return item[attr] !== undefined && item[attr] === (input.ExpressionAttributeValues || {})[equals[2]];
  }
  throw new Error(`stub cannot evaluate ConditionExpression: ${condition}`);
}

const docClient = {
  send: async (cmd) => {
    const { Key, Item } = cmd.input;
    if (cmd.kind === 'get') return { Item: ddb.get(rowKey(Key.PK, Key.SK)) || undefined };
    if (cmd.kind === 'put') { ddb.set(rowKey(Item.PK, Item.SK), { ...Item }); return {}; }
    if (cmd.kind === 'update') {
      const k = rowKey(Key.PK, Key.SK);
      const existing = ddb.get(k) || { ...Key };
      if (cmd.input.ConditionExpression && !conditionHolds(cmd.input, existing)) {
        throw new ConditionalCheckFailedException();
      }
      applyUpdate(existing, cmd.input);
      ddb.set(k, existing);
      return {};
    }
    if (cmd.kind === 'delete') { ddb.delete(rowKey(Key.PK, Key.SK)); return {}; }
    if (cmd.kind === 'batchWrite') {
      for (const request of cmd.input.RequestItems['engage-test'] || []) {
        if (request.PutRequest) {
          const row = request.PutRequest.Item;
          ddb.set(rowKey(row.PK, row.SK), { ...row });
        } else if (request.DeleteRequest) {
          ddb.delete(rowKey(request.DeleteRequest.Key.PK, request.DeleteRequest.Key.SK));
        }
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.kind === 'query') {
      const values = cmd.input.ExpressionAttributeValues || {};
      const pk = values[':pk'] ?? values[':setpk'];
      const prefix = values[':sk'] ?? values[':questionPrefix'];
      let items = [...ddb.values()].filter((row) => row.PK === pk);
      if (prefix) items = items.filter((row) => String(row.SK).startsWith(prefix));
      items.sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items, Count: items.length };
    }
    throw new Error(`unexpected command ${cmd.kind}`);
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => docClient },
  GetCommand, PutCommand, UpdateCommand, QueryCommand, BatchWriteCommand, DeleteCommand,
});

// ---- Bedrock --------------------------------------------------------------
let bedrockCalls = [];
let bedrockHandler = () => { throw new Error('no bedrock handler installed'); };

class InvokeModelCommand { constructor(input) { this.input = input; } }
class BedrockRuntimeClient {
  async send(cmd) {
    const body = JSON.parse(cmd.input.body);
    bedrockCalls.push({ raw: cmd.input.body, prompt: body.messages[0].content });
    return bedrockHandler(bedrockCalls.length, body);
  }
}
stub('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, InvokeModelCommand });

const toolResponse = (items) => ({
  body: new TextEncoder().encode(JSON.stringify({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'emit_items', input: { items } }],
  })),
});

// ---- Lambda (self-invoke) -------------------------------------------------
let dispatched = [];
class InvokeCommand { constructor(input) { this.input = input; } }
class LambdaClient {
  async send(cmd) {
    dispatched.push(JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')));
    return {};
  }
}
stub('@aws-sdk/client-lambda', { LambdaClient, InvokeCommand });

const { makeKmsStub, forgetAllOrgs } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);

// ---- Every console line, kept rather than printed -------------------------
const logged = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => { logged.push(args.map((a) => util.inspect(a, { depth: null })).join(' ')); };
}
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---- The real modules -----------------------------------------------------
const triviaModule = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'));
const scenariosModule = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js'));
const trivia = triviaModule.handler;
const scenarios = scenariosModule.handler;

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; say(`  PASS  ${name}`); }
  catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

function reset() {
  ddb.clear();
  bedrockCalls = [];
  dispatched = [];
  logged.length = 0;
  bedrockHandler = () => toolResponse([]);
  forgetAllOrgs();
}

const adminEvent = (body) => ({
  requestContext: {
    http: { method: 'POST' },
    authorizer: { lambda: { username: 'ada', userId: 'sub-ada', groups: 'admins', status: 'enabled' } },
  },
  body: JSON.stringify(body),
});
const ctx = () => ({ functionName: 'engagedev-admin-ai-generate', getRemainingTimeInMillis: () => 900000 });

/** Start over HTTP, then run the worker from the payload really dispatched. */
async function runJob(handler, body) {
  const started = await handler(adminEvent(body), ctx());
  assert.strictEqual(started.statusCode, 202, `start answered ${started.statusCode}: ${started.body}`);
  const { jobId } = JSON.parse(started.body);
  const dispatch = dispatched[dispatched.length - 1];
  await handler(dispatch, ctx());
  return { jobId, dispatch };
}

const LABEL = "THE AUTHOR'S GUIDANCE FOR THIS BATCH";
const GW = 'Include George Washington in at least one question.';

/** The prompt with the guidance block cut back out: the two newlines before the
 *  label, through the end of the guidance text and the `after` that closes the
 *  paragraph (trivia adds one newline, so the next line is not read as part of
 *  the guidance). */
function cutGuidance(prompt, guidance, after = '') {
  const at = prompt.indexOf(LABEL);
  assert.ok(at >= 2, 'no guidance label in the prompt');
  const end = prompt.indexOf(guidance, at);
  assert.ok(end > at, 'the guidance text does not follow its label');
  assert.strictEqual(prompt.slice(at - 2, at), '\n\n', 'the guidance block is not its own paragraph');
  const close = end + guidance.length;
  assert.strictEqual(prompt.slice(close, close + after.length), after, 'the guidance paragraph is not closed');
  return prompt.slice(0, at - 2) + prompt.slice(close + after.length);
}

const TRIVIA_PAYLOAD = {
  topic: 'Historic figures', audience: 'Adults', difficulty: 'medium', count: 6,
  numberOfCategories: 3, mustHaveCategories: 'Presidents', customPrompt: 'Keep it fun.',
};
const triviaPrompt = (payload, { count = 5, alreadyUsedTitles = [] } = {}) =>
  triviaModule.buildPrompt({ config: triviaModule.parseRequest(payload).config, count, alreadyUsedTitles });

const TEMPLATE = {
  basePrompt: 'TOPIC-BASE-PROMPT',
  contextTemplate: '\n\nContext: {context}',
  audienceTemplate: '\nAudience: {audience}',
  categoryTemplate: '\nOrganize scenarios into EXACTLY {numberOfCategories} categories - no more, no less.\nMust include these categories: {mustHaveCategories}',
};
const scenarioPrompt = (overrides = {}) => scenariosModule.buildPrompt({
  template: TEMPLATE, engagementType: 'call-and-answer', count: 4, difficulty: 'detailed',
  context: 'Historic figures', audience: 'Team leads', customPrompt: 'Keep it fun.',
  categories: 3, mustHaveCategories: 'Presidents', alreadyUsedTitles: [],
  roundKind: null, roundKindBrief: '',
  ...overrides,
});

// ===========================================================================
(async function run() {
  say('\nthe limit');

  await test('trivia parseRequest trims the guidance and keeps it off customPrompt', () => {
    const { config } = triviaModule.parseRequest({ ...TRIVIA_PAYLOAD, batchGuidance: `   ${GW}\n  ` });
    assert.strictEqual(config.batchGuidance, GW);
    assert.strictEqual(config.customPrompt, 'Keep it fun.', 'the guidance was merged into the standing brief');
  });

  await test('trivia parseRequest caps the guidance at 500 characters', () => {
    const { config } = triviaModule.parseRequest({ ...TRIVIA_PAYLOAD, batchGuidance: 'g'.repeat(900) });
    assert.strictEqual(config.batchGuidance.length, 500);
  });

  await test('blank, missing or non-text guidance parses as none', () => {
    for (const batchGuidance of ['   \n ', undefined, null, 42, { text: GW }, ['a']]) {
      const { config } = triviaModule.parseRequest({ ...TRIVIA_PAYLOAD, batchGuidance });
      assert.strictEqual(config.batchGuidance, '', `${JSON.stringify(batchGuidance)} was read as guidance`);
    }
  });

  say('\ntrivia: placement, and no change without it');

  await test('with no guidance the trivia prompt opens exactly as it always has', () => {
    // Pinned text, not a comparison with this build's own output: this is the
    // opening the generator wrote before `batchGuidance` existed.
    const prompt = triviaPrompt(TRIVIA_PAYLOAD);
    assert.ok(prompt.startsWith(
      'You are an expert trivia question creator. Create 5 trivia questions about Historic figures.\n'
      + 'Target audience: Adults.\nDifficulty level: medium.\nEach question has exactly 4 answer choices.\n\n'
      + 'Additional Requirements: Keep it fun.\n\nOrganize questions into EXACTLY 3 categories - no more, no less.\n'
      + 'Must include these categories: Presidents\n\nLENGTH LIMITS (hard limits, not targets):'),
    `the no-guidance opening moved:\n${prompt.slice(0, 400)}`);
    assert.ok(!prompt.includes(LABEL));
  });

  await test('blank guidance leaves the trivia prompt byte-identical to none', () => {
    assert.strictEqual(triviaPrompt({ ...TRIVIA_PAYLOAD, batchGuidance: '  \n\t ' }), triviaPrompt(TRIVIA_PAYLOAD));
  });

  await test('trivia guidance sits straight after the opening line, before the brief', () => {
    const prompt = triviaPrompt({ ...TRIVIA_PAYLOAD, batchGuidance: GW });
    const opening = 'You are an expert trivia question creator. Create 5 trivia questions about Historic figures.';
    assert.ok(prompt.startsWith(`${opening}\n\n${LABEL}`), `not straight after the opening:\n${prompt.slice(0, 300)}`);
    // Its own paragraph: a blank line before the brief resumes, so "Target
    // audience" is not read as more of the guidance.
    assert.ok(prompt.includes(`${GW}\n\nTarget audience: Adults.`), 'the guidance runs into the brief');
    const guidanceAt = prompt.indexOf(GW);
    for (const later of ['Target audience:', 'Additional Requirements:', 'Organize questions into', 'LENGTH LIMITS']) {
      assert.ok(guidanceAt < prompt.indexOf(later), `the guidance comes after "${later}"`);
    }
  });

  await test('the trivia label says the guidance wins over the topic and the rules still hold', () => {
    const prompt = triviaPrompt({ ...TRIVIA_PAYLOAD, batchGuidance: GW });
    const label = prompt.slice(prompt.indexOf(LABEL), prompt.indexOf(GW));
    assert.match(label, /follow it/);
    assert.match(label, /names something to include, include it/);
    assert.match(label, /the guidance wins/);
    assert.match(label, /category and length rules still hold/);
  });

  await test('cutting the block out of a trivia prompt gives back the no-guidance prompt', () => {
    for (const shape of [{}, { alreadyUsedTitles: ['Washington crosses the Delaware'] }]) {
      const withIt = triviaPrompt({ ...TRIVIA_PAYLOAD, batchGuidance: GW }, shape);
      assert.strictEqual(cutGuidance(withIt, GW, '\n'), triviaPrompt(TRIVIA_PAYLOAD, shape));
    }
  });

  say('\nscenarios: placement, and no change without it');

  // Call-and-answer always has a direction (an unset kind is Produce), so the
  // no-direction shape is wavelength's — the other type this generator serves.
  const WAVELENGTH = { engagementType: 'wavelength' };

  await test('with no guidance and no direction the scenario prompt opens exactly as it always has', () => {
    const prompt = scenarioPrompt(WAVELENGTH);
    assert.ok(prompt.startsWith('Create 4 wavelength subjects. TOPIC-BASE-PROMPT\n\nContext: Historic figures\nAudience: Team leads\n\nAdditional Requirements: Keep it fun.'),
      `the no-guidance opening moved:\n${prompt.slice(0, 300)}`);
    assert.ok(!prompt.includes(LABEL));
  });

  await test('with a direction and no guidance, TOPIC still follows the direction rule directly', () => {
    const prompt = scenarioPrompt({ roundKind: 'apply' });
    assert.ok(prompt.startsWith('Create 4 scenarios.\n\nROUND KIND: APPLY'), prompt.slice(0, 120));
    assert.ok(prompt.includes('Where the direction above and the topic below disagree, follow the direction.\n\nTOPIC: TOPIC-BASE-PROMPT'));
    assert.ok(!prompt.includes(LABEL));
  });

  await test('blank guidance leaves the scenario prompt byte-identical to none', () => {
    for (const shape of [WAVELENGTH, { roundKind: null }, { roundKind: 'apply' }]) {
      assert.strictEqual(scenarioPrompt({ ...shape, batchGuidance: ' \n ' }), scenarioPrompt(shape));
    }
  });

  await test('with a direction, the guidance comes after it and before TOPIC', () => {
    const prompt = scenarioPrompt({ roundKind: 'apply', batchGuidance: GW });
    const directionAt = prompt.indexOf('ROUND KIND: APPLY');
    const guidanceAt = prompt.indexOf(LABEL);
    const topicAt = prompt.indexOf('TOPIC: TOPIC-BASE-PROMPT');
    assert.ok(directionAt >= 0 && directionAt < guidanceAt, 'the guidance is not after the direction');
    assert.ok(guidanceAt < topicAt, 'the guidance is not before TOPIC');
    assert.ok(prompt.includes(`${GW}\n\nTOPIC: TOPIC-BASE-PROMPT`), 'TOPIC does not follow the guidance directly');
    assert.strictEqual(cutGuidance(prompt, GW), scenarioPrompt({ roundKind: 'apply' }));
  });

  await test('with no direction, guidance restructures the opening so TOPIC follows it', () => {
    const prompt = scenarioPrompt({ ...WAVELENGTH, batchGuidance: GW });
    assert.ok(prompt.startsWith(`Create 4 wavelength subjects.\n\n${LABEL}`), prompt.slice(0, 200));
    assert.ok(prompt.includes(`${GW}\n\nTOPIC: TOPIC-BASE-PROMPT\n\nContext: Historic figures`));
    // Everything after the topic sentence is untouched.
    const tail = (p, marker) => p.slice(p.indexOf(marker) + marker.length);
    assert.strictEqual(tail(prompt, 'TOPIC: TOPIC-BASE-PROMPT'),
      tail(scenarioPrompt(WAVELENGTH), 'Create 4 wavelength subjects. TOPIC-BASE-PROMPT'));
  });

  say('\nthrough the job: dispatch, every chunk, never logged, never stored');

  await test('trivia: the guidance survives the dispatch and reaches EVERY pass', async () => {
    reset();
    // 19 trivia questions fit one call, so 25 takes two passes.
    let n = 0;
    bedrockHandler = (call, body) => {
      const count = Number((/Create (\d+) trivia/.exec(body.messages[0].content) || [])[1]) || 1;
      return toolResponse(Array.from({ length: count }, () => {
        n += 1;
        return {
          title: `Question number ${n} about figure ${n}`, questionDetail: `Q${n}?`, category: 'Presidents',
          optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', correctAnswer: 'OptionA',
          answerDetails: 'Because.', difficulty: 'medium', tags: ['history'],
        };
      }));
    };
    const { dispatch } = await runJob(trivia, {
      ...TRIVIA_PAYLOAD, count: 25, appendOnly: true, batchGuidance: `  ${GW}  `,
    });
    assert.strictEqual(dispatch.payload.batchGuidance, `  ${GW}  `, 'the dispatch dropped the field');
    assert.ok(bedrockCalls.length >= 2, `expected two passes, got ${bedrockCalls.length}`);
    bedrockCalls.forEach((call, i) => {
      assert.ok(call.prompt.includes(`${LABEL}`), `pass ${i + 1} has no guidance label`);
      assert.ok(call.prompt.includes(GW), `pass ${i + 1} has no guidance`);
      assert.ok(call.raw.includes(GW), `pass ${i + 1}'s Bedrock body does not carry the guidance`);
    });
    assert.match(bedrockCalls[1].prompt, /ALREADY GENERATED/, 'the second pass was not a later chunk');
  });

  await test('scenarios: the guidance survives the dispatch, trimmed and capped, on every pass', async () => {
    reset();
    let n = 0;
    bedrockHandler = (call, body) => {
      const count = Number((/Create (\d+) scenarios/.exec(body.messages[0].content) || [])[1]) || 1;
      return toolResponse(Array.from({ length: count }, () => {
        n += 1;
        return { title: `Scenario ${n} on leader ${n}`, category: 'Presidents', detail: 'd', customInstructions: '', tags: ['x'] };
      }));
    };
    const long = `${'w'.repeat(600)}`;
    await runJob(scenarios, {
      scenarioType: 'custom', engagementType: 'call-and-answer', count: 20, appendOnly: true,
      batchGuidance: `\n  ${long}`,
    });
    assert.ok(bedrockCalls.length >= 2, `expected two passes, got ${bedrockCalls.length}`);
    bedrockCalls.forEach((call, i) => {
      assert.ok(call.prompt.includes(`\n${'w'.repeat(500)}\n\nTOPIC:`), `pass ${i + 1} lacks the capped guidance before TOPIC`);
      assert.ok(!call.prompt.includes('w'.repeat(501)), `pass ${i + 1} carries more than 500 characters of guidance`);
    });
  });

  await test('scenarios: blank guidance through the job leaves the prompt as it was', async () => {
    reset();
    bedrockHandler = () => toolResponse([{ title: 'One scenario', category: 'A', detail: 'd', customInstructions: '', tags: [] }]);
    await runJob(scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, appendOnly: true, batchGuidance: '   ' });
    const blank = bedrockCalls[0].prompt;
    reset();
    bedrockHandler = () => toolResponse([{ title: 'One scenario', category: 'A', detail: 'd', customInstructions: '', tags: [] }]);
    await runJob(scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, appendOnly: true });
    assert.strictEqual(blank, bedrockCalls[0].prompt);
    assert.ok(!blank.includes(LABEL));
  });

  await test('the guidance text is never logged, and never stored on a row', async () => {
    const SENTINEL = 'Include SENTINEL-GW-7731 in at least one question.';
    const items = (prefix) => (call, body) => toolResponse([{
      title: `${prefix} title ${call}`, questionDetail: 'Q?', category: 'Presidents', detail: 'd', customInstructions: '',
      optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', correctAnswer: 'OptionA',
      answerDetails: 'Because.', difficulty: 'medium', tags: ['x'],
    }]);
    // A run that CREATES a set as well as the append-only kind, so "not on the
    // set" is exercised and not vacuous.
    const runs = [
      [trivia, { ...TRIVIA_PAYLOAD, count: 1, batchGuidance: SENTINEL, appendOnly: true }],
      [trivia, { ...TRIVIA_PAYLOAD, count: 1, batchGuidance: SENTINEL, setMetadata: { title: 'Figures Trivia', description: 'd' } }],
      [scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, batchGuidance: SENTINEL, appendOnly: true }],
      [scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, batchGuidance: SENTINEL, setMetadata: { title: 'Figures', description: 'd' } }],
    ];
    let setsMade = 0;
    for (const [handler, body] of runs) {
      reset();
      bedrockHandler = items('logged');
      await runJob(handler, body);
      assert.ok(bedrockCalls.some((c) => c.prompt.includes(SENTINEL)), 'the run never used the guidance, so this proves nothing');
      const leak = logged.find((line) => line.includes('SENTINEL-GW-7731'));
      assert.ok(!leak, `the guidance was logged: ${leak && leak.slice(0, 200)}`);
      const stored = [...ddb.values()].find((row) => JSON.stringify(row).includes('SENTINEL-GW-7731'));
      assert.ok(!stored, `the guidance was stored on ${stored && `${stored.PK} / ${stored.SK}`}`);
      setsMade += [...ddb.values()].filter((row) => row.PK === 'SETS').length;
    }
    assert.ok(setsMade >= 2, `expected the two non-append runs to create sets, saw ${setsMade}`);
  });

  say(`\n${passed} passed, ${failed} failed\n`);
  suiteFinished();
  process.exit(failed > 0 ? 1 : 0);
})();
