/**
 * Integration test: asynchronous, structured scenario generation.
 *
 * The complaint this exists for: "Batch 2 of 20: HTTP 503 - retrying in 3s".
 * Generation ran inside the HTTP request, and `RestApi` is an
 * AWS::Serverless::HttpApi whose 30s integration timeout is a hard ceiling.
 * CloudWatch put this function at 28.4s average / 40.1s maximum, so the gateway
 * hung up on a Lambda that was still working and returned its own non-JSON 503.
 * Shrinking the batch could not help: max_tokens was `1000 + count * 700`, i.e.
 * 1700 even at count=1, and at ~45 output tokens/sec that is ~38s before the
 * response exists. The floor was already above the ceiling.
 *
 * So the regression these tests actually guard is a STRUCTURAL one — the HTTP
 * request no longer performs generation at all — plus the four failures that
 * rode along with it: JSON truncation reported as a parse error, the category
 * clamp collapsing to 1, batches blind to each other's output, and every
 * curated prompt row being unreachable because of a stale key format.
 *
 * Drives the REAL handler with Bedrock, DynamoDB and Lambda stubbed, so it
 * asserts against the prompt that would actually be sent and the job record
 * that would actually be written.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK by module name before the handler loads --------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

process.env.TABLE_NAME = 'engage-test';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

// ---- DynamoDB -------------------------------------------------------------
const ddb = new Map();
const rowKey = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }

/** Minimal `SET a = :x, #n = :y` applier — enough for the job record. */
function applyUpdate(item, input) {
  const expr = String(input.UpdateExpression).replace(/^SET\s+/i, '');
  for (const part of expr.split(/,\s*/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    const name = (input.ExpressionAttributeNames || {})[lhs] || lhs;
    item[name] = input.ExpressionAttributeValues[rhs];
  }
}

const docClient = {
  send: async (cmd) => {
    const { Key, Item, TableName } = cmd.input;
    assert.strictEqual(TableName, 'engage-test', 'handler wrote to the wrong table');
    if (cmd.kind === 'get') return { Item: ddb.get(rowKey(Key.PK, Key.SK)) || undefined };
    if (cmd.kind === 'put') { ddb.set(rowKey(Item.PK, Item.SK), { ...Item }); return {}; }
    if (cmd.kind === 'update') {
      const k = rowKey(Key.PK, Key.SK);
      const existing = ddb.get(k) || { ...Key };
      applyUpdate(existing, cmd.input);
      ddb.set(k, existing);
      return {};
    }
    throw new Error(`unexpected command ${cmd.kind}`);
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => docClient },
  GetCommand, PutCommand, UpdateCommand,
});

// ---- Bedrock --------------------------------------------------------------
let bedrockCalls = [];
let bedrockHandler = () => { throw new Error('no bedrock handler installed'); };

class InvokeModelCommand { constructor(input) { this.input = input; } }
class BedrockRuntimeClient {
  async send(cmd) {
    const body = JSON.parse(cmd.input.body);
    bedrockCalls.push({ modelId: cmd.input.modelId, body, prompt: body.messages[0].content });
    return bedrockHandler(bedrockCalls.length, body);
  }
}
stub('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, InvokeModelCommand });

/** Shape a Bedrock tool-use response. */
const toolResponse = (items, stopReason = 'tool_use') => ({
  body: new TextEncoder().encode(JSON.stringify({
    stop_reason: stopReason,
    content: [{ type: 'tool_use', name: 'emit_items', input: { items } }],
  })),
});

/**
 * Distinct-looking titles. Deliberately NOT "prefix scenario number 1/2/3":
 * titles that differ only in a trailing digit share 4 of 5 tokens and get eaten
 * by the near-duplicate net, which would make these fixtures test the net rather
 * than the thing under test.
 */
const SUBJECTS = [
  'onboarding a remote hire', 'escalating a security incident', 'renegotiating a vendor contract',
  'splitting a monolith service', 'running a blameless retrospective', 'handling a customer refund dispute',
  'planning quarterly headcount', 'migrating a legacy database', 'reviewing an underperforming teammate',
  'launching a feature behind a flag', 'triaging a production outage', 'declining an executive request',
  'rewriting an on-call rotation', 'auditing third party dependencies', 'sunsetting an unused product',
  'mediating a design disagreement', 'budgeting for cloud overspend', 'interviewing for staff engineer',
  'documenting an undocumented system', 'recovering a corrupted backup',
];

const makeItems = (n, prefix, tags = ['Leadership', 'remote work']) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix}: ${SUBJECTS[i % SUBJECTS.length]}${i >= SUBJECTS.length ? ` round ${Math.floor(i / SUBJECTS.length)}` : ''}`,
    category: `Category ${(i % 3) + 1}`,
    detail: `Detail for ${prefix} ${i + 1}.`,
    customInstructions: 'Discuss with your team.',
    tags,
  }));

// ---- Lambda (self-invoke) -------------------------------------------------
let dispatched = [];
let lambdaShouldFail = false;
class InvokeCommand { constructor(input) { this.input = input; } }
class LambdaClient {
  async send(cmd) {
    if (lambdaShouldFail) throw new Error('AccessDeniedException');
    dispatched.push({
      FunctionName: cmd.input.FunctionName,
      InvocationType: cmd.input.InvocationType,
      payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
    });
    return {};
  }
}
stub('@aws-sdk/client-lambda', { LambdaClient, InvokeCommand });

// ---- Load the real handler ------------------------------------------------
const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js'));
const { normalizeTags, tagsMatch } = require(path.join(REPO, 'lambda-functions/admin/shared/tags.js'));
const { itemsPerCall, maxTokensFor } = require(path.join(REPO, 'lambda-functions/admin/shared/structured-generation.js'));

// ---- Tiny test runner -----------------------------------------------------
let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { failed += 1; console.log(`  FAIL  ${name}\n        ${error.message}`); }
}

const CURATED = {
  PK: 'AIPROMPTS',
  SK: 'AIPROMPT#gen-call-and-answer-custom',
  promptId: 'gen-call-and-answer-custom',
  basePrompt: 'CURATED-BASE-PROMPT: write leadership scenarios.',
  contextTemplate: '\n\nContext: {context}',
  audienceTemplate: '\nAudience: {audience}',
  categoryTemplate: '\nOrganize scenarios into EXACTLY {numberOfCategories} categories.',
  tags: ['scenarios', 'amazon-principles', 'leadership', 'STAR'],
};

function reset({ seedCurated = true } = {}) {
  ddb.clear();
  bedrockCalls = [];
  dispatched = [];
  lambdaShouldFail = false;
  if (seedCurated) ddb.set(rowKey(CURATED.PK, CURATED.SK), { ...CURATED });
}

const postEvent = (body) => ({
  requestContext: { http: { method: 'POST' } },
  body: JSON.stringify(body),
});
const ctx = (remainingMs = 900000) => ({
  functionName: 'engagedev-admin-ai-generate-scenarios',
  getRemainingTimeInMillis: () => remainingMs,
});

/** Start a job over HTTP, then run the worker the way Lambda's Event invoke would. */
async function runJob(body, workerCtx = ctx()) {
  const started = await handler(postEvent(body), ctx());
  const { jobId } = JSON.parse(started.body);
  await handler({ __workerMode: true, jobId, payload: body }, workerCtx);
  const polled = await handler(
    { requestContext: { http: { method: 'GET' } }, pathParameters: { jobId } },
    ctx(),
  );
  return { started, jobId, job: JSON.parse(polled.body) };
}

// ===========================================================================
(async function run() {
  console.log('\nasync generation: the HTTP request no longer generates');

  await test('POST returns 202 with a jobId instead of scenarios', async () => {
    reset();
    const res = await handler(postEvent({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 5 }), ctx());
    assert.strictEqual(res.statusCode, 202, `expected 202, got ${res.statusCode}`);
    const body = JSON.parse(res.body);
    assert.ok(body.jobId, 'no jobId returned');
    assert.strictEqual(body.status, 'queued');
    assert.strictEqual(body.requested, 5);
  });

  await test('the HTTP request performs ZERO Bedrock calls (this is the 503 fix)', async () => {
    reset();
    await handler(postEvent({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 20 }), ctx());
    assert.strictEqual(bedrockCalls.length, 0,
      `request path called Bedrock ${bedrockCalls.length} times; it must not touch the 30s gateway budget`);
  });

  await test('the worker is dispatched as an async Event invoke, not RequestResponse', async () => {
    reset();
    await handler(postEvent({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 3 }), ctx());
    assert.strictEqual(dispatched.length, 1, 'worker was not dispatched');
    assert.strictEqual(dispatched[0].InvocationType, 'Event',
      'a RequestResponse invoke would put generation back inside the 30s request');
    assert.strictEqual(dispatched[0].FunctionName, 'engagedev-admin-ai-generate-scenarios');
    assert.strictEqual(dispatched[0].payload.__workerMode, true);
  });

  await test('a job record exists to poll before the worker has run', async () => {
    reset();
    const res = await handler(postEvent({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 3 }), ctx());
    const { jobId } = JSON.parse(res.body);
    const polled = await handler({ requestContext: { http: { method: 'GET' } }, pathParameters: { jobId } }, ctx());
    assert.strictEqual(polled.statusCode, 200);
    assert.strictEqual(JSON.parse(polled.body).status, 'queued');
  });

  await test('a failed dispatch is recorded on the job, not just returned', async () => {
    reset();
    lambdaShouldFail = true;
    const res = await handler(postEvent({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 3 }), ctx());
    assert.strictEqual(res.statusCode, 500);
    const { jobId } = JSON.parse(res.body);
    const stored = ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
    assert.strictEqual(stored.status, 'error', 'client would poll a job that never starts');
    assert.match(stored.errorMessage, /worker/i);
  });

  await test('polling an unknown job is a 404, not a hang', async () => {
    reset();
    const res = await handler(
      { requestContext: { http: { method: 'GET' } }, pathParameters: { jobId: 'nope' } }, ctx());
    assert.strictEqual(res.statusCode, 404);
  });

  await test('job records carry a TTL — they are genuinely ephemeral', async () => {
    reset();
    const res = await handler(postEvent({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 }), ctx());
    const { jobId } = JSON.parse(res.body);
    const stored = ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
    assert.ok(typeof stored.ttl === 'number', 'no ttl on the job record');
    const days = (stored.ttl - Math.floor(Date.now() / 1000)) / 86400;
    assert.ok(days > 0.5 && days < 30, `ttl of ${days.toFixed(1)} days is not "a few days"`);
  });

  console.log('\ntimeout budget: a partial result beats a lost one');

  await test('the worker stops before the deadline and keeps what it produced', async () => {
    reset();
    const perCall = itemsPerCall('call-and-answer');
    let remaining = 900000;
    bedrockHandler = () => toolResponse(makeItems(perCall, 'first'));
    const started = await handler(postEvent({ scenarioType: 'custom', engagementType: 'call-and-answer', count: perCall * 3 }), ctx());
    const { jobId } = JSON.parse(started.body);
    await handler({ __workerMode: true, jobId, payload: { scenarioType: 'custom', engagementType: 'call-and-answer', count: perCall * 3 } }, {
      functionName: 'fn',
      // Plenty of time for the first pass, none for a second.
      getRemainingTimeInMillis: () => { const r = remaining; remaining = 5000; return r; },
    });
    const job = ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
    assert.strictEqual(job.status, 'complete', 'running out of time must not fail the job');
    assert.strictEqual(job.items.length, perCall, 'partial results were discarded');
    assert.ok(job.warnings.some((w) => /time limit/i.test(w)), 'no warning explaining the short result');
  });

  await test('a request of N <= items-per-call is ONE Bedrock call, not N', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(10, 'single'));
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 10 });
    assert.strictEqual(bedrockCalls.length, 1,
      `10 scenarios took ${bedrockCalls.length} calls; the old design took 10 plus a planning call`);
    assert.strictEqual(job.items.length, 10);
  });

  await test('max_tokens scales with the batch and stays inside the per-call budget', () => {
    assert.ok(maxTokensFor('call-and-answer', 1) < maxTokensFor('call-and-answer', 10),
      'max_tokens must track the number of items requested');
    assert.ok(maxTokensFor('call-and-answer', 100) <= 8000, 'per-call output budget exceeded');
  });

  console.log('\ntruncation is reported as truncation');

  await test('a max_tokens stop is not reported as a JSON parse error', async () => {
    reset();
    bedrockHandler = () => toolResponse([], 'max_tokens');
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 1 });
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /token|limit/i,
      `truncation surfaced as "${job.error}" — the old parser said "No JSON array found in response"`);
    assert.doesNotMatch(job.error, /JSON/i, 'truncation is still masquerading as a parse failure');
  });

  await test('a truncated large pass retries smaller instead of failing the run', async () => {
    reset();
    bedrockHandler = (n) => (n === 1
      ? toolResponse([], 'max_tokens')
      : toolResponse(makeItems(4, 'recovered')));
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 8 });
    assert.strictEqual(job.status, 'complete', `run died on a recoverable truncation: ${job.error}`);
    assert.ok(job.items.length > 0, 'nothing salvaged from the smaller retry');
    assert.ok(job.warnings.some((w) => /output budget/i.test(w)), 'no warning about the shrink');
  });

  console.log('\nretry and backoff on a transient failure');

  await test('a throttled Bedrock call is retried rather than failing the job', async () => {
    reset();
    let calls = 0;
    bedrockHandler = () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('Too many requests');
        err.name = 'ThrottlingException';
        throw err;
      }
      return toolResponse(makeItems(3, 'after-throttle'));
    };
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 3 });
    assert.ok(calls >= 2, 'the throttled call was never retried');
    assert.strictEqual(job.status, 'complete', `job failed despite a retryable error: ${job.error}`);
    assert.strictEqual(job.items.length, 3);
  });

  await test('a non-retryable failure keeps the items already produced', async () => {
    reset();
    const perCall = itemsPerCall('call-and-answer');
    bedrockHandler = (n) => {
      if (n === 1) return toolResponse(makeItems(perCall, 'good'));
      throw new Error('ValidationException: model unavailable');
    };
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: perCall * 2 });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.items.length, perCall, 'a mid-run failure threw away completed work');
  });

  console.log('\ndeduplication');

  await test('a later pass is told what earlier passes already generated', async () => {
    reset();
    const perCall = itemsPerCall('call-and-answer');
    bedrockHandler = (n) => toolResponse(makeItems(perCall, n === 1 ? 'alpha' : 'beta'));
    await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: perCall + 3 });
    assert.ok(bedrockCalls.length >= 2, 'expected more than one pass');
    const second = bedrockCalls[1].prompt;
    assert.match(second, /ALREADY GENERATED/,
      'the second pass was blind to the first — exactly the bug that produced duplicates');
    assert.match(second, /alpha: onboarding a remote hire/, 'earlier titles were not listed for avoidance');
  });

  await test('titles that merely share wording are NOT dropped', async () => {
    reset();
    // 4 of 5 tokens in common, but different scenarios. The threshold inherited
    // from the client dropped these silently, server-side, where nobody sees it.
    bedrockHandler = () => toolResponse([
      { title: 'Handling a difficult customer escalation', category: 'A', detail: 'd', customInstructions: 'i', tags: ['support'] },
      { title: 'Handling a difficult customer complaint', category: 'A', detail: 'd', customInstructions: 'i', tags: ['support'] },
    ]);
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.strictEqual(job.items.length, 2,
      'a legitimately distinct scenario was eaten by the near-duplicate net');
  });

  await test('near-duplicate titles that slip through are dropped', async () => {
    reset();
    bedrockHandler = () => toolResponse([
      { title: 'Handling a difficult customer escalation', category: 'A', detail: 'd', customInstructions: 'i', tags: ['support'] },
      { title: 'Handling a difficult customer escalation', category: 'A', detail: 'd2', customInstructions: 'i', tags: ['support'] },
      { title: 'Running a blameless post incident review', category: 'B', detail: 'd3', customInstructions: 'i', tags: ['incident'] },
    ]);
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 3 });
    const titles = job.items.map((s) => s.title);
    assert.strictEqual(new Set(titles).size, titles.length, 'a duplicate title survived');
    assert.strictEqual(titles.length, 2);
  });

  console.log('\ncurated prompt templates are actually reachable');

  await test('the curated gen- row is found and used', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(2, 'curated'));
    await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.match(bedrockCalls[0].prompt, /CURATED-BASE-PROMPT/,
      'the curated prompt was not used — this is the stale-key bug that made all 22 rows dead');
  });

  await test('a legacy game-type spelling still resolves the same row', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(2, 'curated'));
    // `callandanswer` is the storage spelling; comparing raw strings is what
    // kept other lookups silently empty.
    await runJob({ scenarioType: 'custom', engagementType: 'callandanswer', count: 2 });
    assert.match(bedrockCalls[0].prompt, /CURATED-BASE-PROMPT/, 'legacy spelling did not normalise');
  });

  await test('a missing curated prompt falls back AND says so', async () => {
    reset({ seedCurated: false });
    bedrockHandler = () => toolResponse(makeItems(2, 'fallback'));
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.ok(job.warnings.some((w) => /fallback/i.test(w)),
      'silently using the generic fallback is how this went unnoticed for so long');
  });

  console.log('\nlength guidance and category count');

  await test('the prompt carries hard length limits', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(2, 'len'));
    await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2, difficulty: 'detailed' });
    const prompt = bedrockCalls[0].prompt;
    assert.match(prompt, /LENGTH LIMITS/, 'no length guidance — unbounded "detailed" produced 8,500-character scenarios');
    assert.match(prompt, /350 characters maximum/);
    assert.match(prompt, /do not pad/i, 'a ceiling without this reads as a target');
  });

  await test('the category count is no longer clamped to 1', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(20, 'cat'));
    await runJob({
      scenarioType: 'custom', engagementType: 'call-and-answer', count: 20, numberOfCategories: 5,
    });
    assert.match(bedrockCalls[0].prompt, /EXACTLY 5 categories/,
      'the old clamp was min(n, 24, chunkCount) and chunkCount was always 1');
  });

  await test('categories are still capped at the 24-category bitmask limit', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(30, 'cat'));
    await runJob({
      scenarioType: 'custom', engagementType: 'call-and-answer', count: 30, numberOfCategories: 40,
    });
    assert.match(bedrockCalls[0].prompt, /EXACTLY 24 categories/);
  });

  console.log('\nstructured output');

  await test('generation asks for a tool call, not prose', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(2, 'tool'));
    await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    const body = bedrockCalls[0].body;
    assert.ok(Array.isArray(body.tools) && body.tools.length === 1, 'no tool definition sent');
    assert.strictEqual(body.tool_choice.type, 'tool', 'the model was not forced to call the tool');
    assert.ok(body.tools[0].input_schema.properties.items.items.properties.tags,
      'the tool schema has no tags field');
  });

  await test('a response with no tool call is a clear error', async () => {
    reset();
    bedrockHandler = () => ({
      body: new TextEncoder().encode(JSON.stringify({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Here are your scenarios: ...' }],
      })),
    });
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /emit_items/, `unhelpful error: ${job.error}`);
  });

  console.log('\nsuggested tags');

  await test('generated items carry normalised tags', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(2, 'tagged', ['Leadership', 'remote work', 'STAR']));
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.deepStrictEqual(job.items[0].tags, ['leadership', 'remote-work', 'star'],
      'tags were not normalised to lowercase kebab-case on write');
  });

  await test('the prompt asks for a useful NUMBER of tags', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(2, 'tagcount'));
    await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    const prompt = bedrockCalls[0].prompt;
    assert.match(prompt, /TAGS:/);
    assert.match(prompt, /3-6 tags/, 'a tag on everything filters nothing');
    assert.match(prompt, /kebab-case/);
  });

  await test('tag normalisation: casing, spacing, punctuation, duplicates, cap', () => {
    assert.deepStrictEqual(normalizeTags(['STAR']), ['star']);
    assert.deepStrictEqual(normalizeTags(['Remote Work']), ['remote-work']);
    assert.deepStrictEqual(normalizeTags(['  Conflict  Resolution  ']), ['conflict-resolution']);
    assert.deepStrictEqual(normalizeTags(['a/b', 'a-b']), ['a-b'], 'duplicates after normalising must collapse');
    assert.deepStrictEqual(normalizeTags('one, two , three'), ['one', 'two', 'three'], 'comma strings accepted');
    assert.strictEqual(normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).length, 6, 'tag cap not applied');
    assert.deepStrictEqual(normalizeTags(null), []);
    assert.deepStrictEqual(normalizeTags(['---', '  ']), [], 'junk should normalise away entirely');
  });

  await test('tags match across the inconsistent casing already in the table', () => {
    // The gen- rows really do contain ["scenarios","amazon-principles","leadership","STAR"].
    assert.ok(tagsMatch(CURATED.tags, ['star']), 'a filter on "star" must match a stored "STAR"');
    assert.ok(tagsMatch(CURATED.tags, ['Leadership']));
    assert.ok(!tagsMatch(CURATED.tags, ['nonexistent']));
    assert.ok(tagsMatch(CURATED.tags, []), 'an empty filter matches everything');
  });

  console.log('\nwavelength keeps its own shape');

  await test('wavelength gets subject-sized limits and a bigger batch', async () => {
    reset({ seedCurated: false });
    bedrockHandler = () => toolResponse(makeItems(6, 'subject'));
    await runJob({ scenarioType: 'custom', engagementType: 'wavelength', count: 6 });
    const prompt = bedrockCalls[0].prompt;
    assert.match(prompt, /1-4 words/, 'wavelength subjects must stay short');
    assert.ok(itemsPerCall('wavelength') > itemsPerCall('call-and-answer'),
      'tiny wavelength items should batch larger than scenarios');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
