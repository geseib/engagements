/**
 * THE PROMPT ADVISOR RUNS AS A JOB — lambda-functions/admin/ai-prompt-advisor.js.
 *
 * ── THE 503 ────────────────────────────────────────────────────────────────
 *
 * `POST /admin/ai-prompt-advisor` called Bedrock inside the HTTP request. The
 * API is an HttpApi, whose integration timeout is a hard 30 seconds, and the
 * advisor asks Sonnet 4.6 for a long structured reply: on dev "improve" took
 * 62,252 ms and "validate" 34,963 ms. Both SUCCEEDED in the Lambda, and both
 * reached the admin as a gateway 503, because the gateway had hung up at 30 s.
 * The same wall clock the generation builders hit (shared/generation-jobs.js).
 *
 * So the request stops analysing. POST validates, authorises, records a job,
 * self-invokes a worker with `InvocationType: 'Event'` and answers 202; the
 * worker does today's Bedrock call (Sonnet 4.6, Haiku 4.5 fallback) against
 * the function's own timeout; the client polls `GET .../{jobId}`.
 *
 * ── AND THE CUT-OFF ────────────────────────────────────────────────────────
 *
 * The same "improve" run logged "Could not parse AI response as JSON" on a
 * 16,581-character reply — about 4,000 tokens, which was `max_tokens`. The
 * format asked for every changed passage TWICE (before and after) and then the
 * whole rewritten prompt, and the model ran out of budget mid-object. A
 * truncation was reported as a parse error. Now the format names each change
 * once, the budget fits the largest format, `stop_reason` is logged, and a
 * reply that still ends on `max_tokens` fails the job with a sentence saying so.
 *
 * rejects: Bedrock on the request path; a synchronous (RequestResponse)
 *          dispatch; the prompt text stored on the job row instead of carried
 *          in the invoke payload; a job another caller can read; an org's
 *          analysis stored readable; a truncated reply stored as a result or
 *          reported as a parse error; the stale `claude-3.5-sonnet` label; the
 *          prompt text reaching the logs.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
const assert = require('assert');
const nodeCrypto = require('crypto');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const kmsStub = require('./helpers/tenant-crypto-stub');

// ---- stubs, registered before anything under test is required --------------
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

// DynamoDB: an in-memory table that honours the one condition the worker uses.
const store = new Map();
const rowKey = (pk, sk) => `${pk}|${sk}`;
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }

function conditionHolds(item, input) {
  if (!input.ConditionExpression) return true;
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const m = /^\s*(\S+)\s*=\s*(:\w+)\s*$/.exec(input.ConditionExpression);
  if (!m) throw new Error(`stub cannot evaluate ConditionExpression ${input.ConditionExpression}`);
  const attr = names[m[1]] || m[1];
  return !!item && item[attr] === values[m[2]];
}

function applySet(item, input) {
  const expr = String(input.UpdateExpression).replace(/^SET\s+/i, '');
  const names = input.ExpressionAttributeNames || {};
  for (const part of expr.split(/,\s*/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    item[names[lhs] || lhs] = input.ExpressionAttributeValues[rhs];
  }
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'get': {
        const item = store.get(rowKey(inp.Key.PK, inp.Key.SK));
        return { Item: item ? JSON.parse(JSON.stringify(item)) : undefined };
      }
      case 'put': store.set(rowKey(inp.Item.PK, inp.Item.SK), JSON.parse(JSON.stringify(inp.Item))); return {};
      case 'update': {
        const k = rowKey(inp.Key.PK, inp.Key.SK);
        const existing = store.get(k);
        if (!conditionHolds(existing, inp)) {
          const e = new Error('The conditional request failed');
          e.name = 'ConditionalCheckFailedException';
          throw e;
        }
        const item = existing || { ...inp.Key };
        applySet(item, inp);
        store.set(k, JSON.parse(JSON.stringify(item)));
        return {};
      }
      case 'query': return { Items: [], Count: 0 };
      default: throw new Error(`unexpected DynamoDB command ${cmd.type}`);
    }
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, UpdateCommand, QueryCommand,
});

// S3: the Workie bodies create-ai-prompt.js would have written.
const s3Bodies = new Map();
class GetObjectCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      const body = s3Bodies.get(cmd.input.Key);
      if (body === undefined) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      return { Body: { transformToString: async () => body } };
    }
  },
  GetObjectCommand,
});

// Lambda: record the self-invoke, or refuse it.
let dispatched = [];
let lambdaShouldFail = false;
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class {
    async send(cmd) {
      if (lambdaShouldFail) throw new Error('AccessDeniedException: not allowed to invoke');
      dispatched.push({
        FunctionName: cmd.input.FunctionName,
        InvocationType: cmd.input.InvocationType,
        payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
      });
      return { StatusCode: 202 };
    }
  },
  InvokeCommand,
});

// Bedrock: each case installs a handler; every call is recorded.
let bedrockCalls = [];
let bedrockHandler = () => { throw new Error('no bedrock handler installed'); };
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      const body = JSON.parse(cmd.input.body);
      bedrockCalls.push({ modelId: cmd.input.modelId, body, prompt: body.messages[0].content[0].text });
      return bedrockHandler(bedrockCalls.length, cmd.input.modelId, body);
    }
  },
  InvokeModelCommand,
});

// KMS: the policy-enforcing stub every sealed-content suite uses.
stub('@aws-sdk/client-kms', kmsStub.makeKmsStub().exports);

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-prompts-bucket';
process.env.ACCOUNT_ID = '123456789012';
process.env.AWS_REGION = 'us-east-1';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

kmsStub.installTestKeyLoader();
const crypto = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-prompt-advisor.js'));
const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));

// ---- harness ---------------------------------------------------------------
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
/** Every console line `fn` prints, formatted as CloudWatch would receive it — and silenced. */
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
const quietly = async (fn) => (await captureLogs(fn)).out;

const marker = (tag) => `zq${tag}${nodeCrypto.randomBytes(4).toString('hex')}`;
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

const ORG = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';
const OTHER_ORG = 'org_2222222222222222222222';

/** This API's real authorizer shape (require-admin.js's header). */
const who = ({ userId = 'sub-admin', groups = 'admins', orgId = '', orgRole = '' } = {}) => ({
  authorizer: { lambda: {
    userId, username: `${userId}-name`, groups, status: 'enabled',
    ...(orgId ? { orgId, orgRole } : {}),
  } },
});
const ADMIN = who();
const ORG_ADMIN = who({ orgId: ORG, orgRole: 'owner' });

const postEvent = (body, caller = ADMIN) => ({
  requestContext: { http: { method: 'POST' }, ...caller },
  body: JSON.stringify(body),
});
const pollEvent = (jobId, caller = ADMIN) => ({
  requestContext: { http: { method: 'GET' }, ...caller },
  pathParameters: { jobId },
});
const ctx = () => ({ functionName: 'engagedev-admin-ai-prompt-advisor', getRemainingTimeInMillis: () => 900000 });

/** Shape a Bedrock InvokeModel reply. */
const reply = (text, stopReason = 'end_turn') => ({
  body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: stopReason })),
});
const jsonReply = (obj, stopReason) => reply(`Here is the analysis.\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``, stopReason);

/**
 * The checklist both lenses return (tests/ai-prompt-advisor-checklist.js owns
 * its shape). `half: 'both'` because every prompt in this suite is one piece of
 * pasted or template text, and a one-piece prompt has no halves to name.
 */
const IMPROVE = {
  overallScore: 7.5,
  summary: 'Summarises a retro clearly; the audience is never named.',
  issues: [{ id: 'i1', severity: 'high', half: 'both', issue: 'Vague ask', fix: 'Name the audience' }],
};

function reset() {
  store.clear();
  s3Bodies.clear();
  dispatched = [];
  lambdaShouldFail = false;
  bedrockCalls = [];
  bedrockHandler = () => jsonReply(IMPROVE);
}

const body = (json) => JSON.parse(json.body);
const jobRow = (jobId) => store.get(rowKey('AIJOBS', `AIJOB#${jobId}`));

/** Start a job over HTTP, run the worker the way Lambda's Event invoke would, then poll. */
async function runJob(request, caller = ADMIN) {
  const started = await handler(postEvent(request, caller), ctx());
  const { jobId } = body(started);
  const payload = dispatched[dispatched.length - 1]?.payload;
  const worker = await captureLogs(() => handler(payload, ctx()));
  const polled = await handler(pollEvent(jobId, caller), ctx());
  return { started, jobId, payload, workerLogs: worker.logs, polled, job: body(polled) };
}

/** A Workie written the way create-ai-prompt.js writes one for an org. */
async function seedOrgWorkie(orgId, promptId, secrets) {
  const s3Key = `prompts/org/${orgId}/call-and-answer/${promptId}/v1.json`;
  const doc = {
    promptId, version: 1, name: secrets.name, description: secrets.description,
    gameType: 'call-and-answer', promptType: 'analysis', template: secrets.template,
  };
  s3Bodies.set(s3Key, JSON.stringify(await crypto.encryptValue(orgId, doc)));
  const row = await crypto.encryptItem(orgId, 'prompt', {
    PK: `ORG#${orgId}#AIPROMPTS`, SK: `AIPROMPT#${promptId}`,
    promptId, name: secrets.name, description: secrets.description,
    gameType: 'call-and-answer', promptType: 'analysis', s3Key, version: 1,
    scope: 'org', orgId,
  });
  store.set(rowKey(row.PK, row.SK), row);
}

(async () => {
  say('\n1. the HTTP request no longer analyses');

  reset();
  const t0 = Date.now();
  const started = await quietly(() => handler(postEvent({
    promptText: 'Summarise {responsesText}.', gameType: 'call-and-answer', analysisType: 'improve',
  }), ctx()));
  const elapsed = Date.now() - t0;
  const startedBody = body(started);

  await check('POST answers 202 with a job id', () => {
    assert.strictEqual(started.statusCode, 202, started.body);
    assert.ok(startedBody.jobId, 'no jobId returned');
    assert.strictEqual(startedBody.status, 'queued');
  });
  await check('…promptly, and without calling Bedrock (this is the 503 fix)', () => {
    assert.strictEqual(bedrockCalls.length, 0,
      `the request path called Bedrock ${bedrockCalls.length} time(s); it must not spend the 30s gateway budget`);
    assert.ok(elapsed < 2000, `POST took ${elapsed}ms`);
  });
  await check('the worker is started with an asynchronous Event invoke of this same function', () => {
    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0].InvocationType, 'Event',
      'RequestResponse would put the Bedrock call back inside the 30s request');
    assert.strictEqual(dispatched[0].FunctionName, 'engagedev-admin-ai-prompt-advisor');
    assert.strictEqual(dispatched[0].payload.__workerMode, true);
    assert.strictEqual(dispatched[0].payload.jobId, startedBody.jobId);
  });
  await check('the prompt rides in the invoke payload, not on the job row', () => {
    assert.match(dispatched[0].payload.input.promptText, /Summarise \{responsesText\}/);
    const row = jobRow(startedBody.jobId);
    assert.ok(row, 'no job row was written before the dispatch');
    assert.ok(!JSON.stringify(row).includes('Summarise'), 'the prompt text was stored on the job row');
  });
  await check('the job row records who asked, a kind, a status and a TTL', () => {
    const row = jobRow(startedBody.jobId);
    assert.strictEqual(row.kind, 'prompt-advice');
    assert.strictEqual(row.status, 'queued');
    assert.strictEqual(row.callerUserId, 'sub-admin');
    const now = Math.floor(Date.now() / 1000);
    assert.ok(row.ttl > now && row.ttl < now + 8 * 24 * 3600, `ttl ${row.ttl} is not a few days out`);
  });

  await check('a failed self-invoke fails the job with a readable error', async () => {
    reset();
    lambdaShouldFail = true;
    const res = await quietly(() => handler(postEvent({ promptText: 'x', analysisType: 'validate' }), ctx()));
    assert.strictEqual(res.statusCode, 500);
    const { jobId, error } = body(res);
    assert.match(error, /Could not start the prompt advisor/);
    const polled = body(await handler(pollEvent(jobId), ctx()));
    assert.strictEqual(polled.status, 'error');
    assert.match(polled.error, /Could not start the prompt advisor/);
  });

  await check('a request with nothing to analyse is refused before any job exists', async () => {
    reset();
    const res = await quietly(() => handler(postEvent({ analysisType: 'improve' }), ctx()));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(store.size, 0);
    assert.strictEqual(dispatched.length, 0);
  });

  await check('a prompt too large for an Event payload is refused before any job exists', async () => {
    reset();
    const res = await quietly(() => handler(postEvent({ promptText: 'x'.repeat(300 * 1024), analysisType: 'improve' }), ctx()));
    assert.strictEqual(res.statusCode, 413);
    assert.match(body(res).error, /too long/);
    assert.strictEqual(store.size, 0);
    assert.strictEqual(dispatched.length, 0);
  });

  await check('an unknown analysis type is refused, not sent to Bedrock as an empty prompt', async () => {
    reset();
    const res = await quietly(() => handler(postEvent({ promptText: 'x', analysisType: 'rewrite-it-all' }), ctx()));
    assert.strictEqual(res.statusCode, 400);
    assert.match(body(res).error, /review, improve or apply/);
    assert.strictEqual(dispatched.length, 0);
  });

  say('\n2. the worker does the analysis and stores the outcome');

  await check('Sonnet 4.6 answers: the job completes and the poll hands over the analysis', async () => {
    reset();
    const { job } = await runJob({ promptText: 'Summarise {responsesText}.', gameType: 'call-and-answer', analysisType: 'improve' });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.deepStrictEqual(job.result.analysis, IMPROVE);
    assert.strictEqual(job.result.analysisType, 'improve');
    assert.strictEqual(job.error, null);
    assert.strictEqual(bedrockCalls.length, 1);
    assert.match(bedrockCalls[0].modelId, /inference-profile\/us\.anthropic\.claude-sonnet-4-6$/);
  });

  await check('modelUsed names the model that actually answered, not claude-3.5-sonnet', async () => {
    reset();
    const { job } = await runJob({ promptText: 'x', analysisType: 'validate' });
    assert.strictEqual(job.result.metadata.modelUsed, 'claude-sonnet-4-6');
  });

  await check('a Sonnet failure falls back to Haiku 4.5, and the label says so', async () => {
    reset();
    bedrockHandler = (n) => {
      if (n === 1) { const e = new Error('ThrottlingException: too many requests'); e.name = 'ThrottlingException'; throw e; }
      return jsonReply({ overallScore: 8, summary: 'Fine', issues: [] });
    };
    const { job } = await runJob({ promptText: 'x', analysisType: 'validate' });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.strictEqual(bedrockCalls.length, 2);
    assert.match(bedrockCalls[0].modelId, /claude-sonnet-4-6/);
    assert.match(bedrockCalls[1].modelId, /claude-haiku-4-5/);
    assert.strictEqual(job.result.metadata.modelUsed, 'claude-haiku-4-5');
    assert.strictEqual(job.result.analysis.summary, 'Fine');
    assert.deepStrictEqual(job.result.analysis.issues, []);
  });

  await check('both models failing fails the job and says why, in words', async () => {
    reset();
    bedrockHandler = (n) => { throw new Error(n === 1 ? 'Sonnet unavailable' : 'Haiku unavailable'); };
    const { job } = await runJob({ promptText: 'x', analysisType: 'optimize' });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.result, null);
    assert.match(job.error, /Sonnet unavailable/);
    assert.match(job.error, /Haiku unavailable/);
  });

  say('\n3. a reply cut off at max_tokens is a failure that says so');

  await check('a max_tokens stop fails the job with a readable message and stores no result', async () => {
    reset();
    bedrockHandler = () => reply('```json\n{"overallScore": 8, "improvedPrompt": "Summarise the', 'max_tokens');
    const { job, jobId, workerLogs } = await runJob({ promptText: 'x', analysisType: 'improve' });
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /cut off/i);
    assert.ok(!/parse/i.test(job.error), 'a truncation must not be reported as a parse error');
    assert.strictEqual(job.result, null);
    assert.ok(!('result' in jobRow(jobId)), 'an unparseable result was stored');
    assert.strictEqual(bedrockCalls.length, 1, 'a truncation is not a model failure; Haiku must not be asked');
    assert.match(workerLogs, /stop_reason[^\n]*max_tokens/, 'the stop_reason is not in the logs');
  });

  await check('an ordinary reply logs its stop_reason too', async () => {
    reset();
    const { workerLogs } = await runJob({ promptText: 'x', analysisType: 'improve' });
    assert.match(workerLogs, /stop_reason[^\n]*end_turn/);
  });

  await check('a reply that is not the JSON asked for fails readably instead of storing raw text', async () => {
    reset();
    bedrockHandler = () => reply('I would be happy to help with that prompt! It looks great.');
    const { job, jobId } = await runJob({ promptText: 'x', analysisType: 'improve' });
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /format/i);
    assert.ok(!('result' in jobRow(jobId)));
  });

  await check('the budget fits the largest format with room to spare', async () => {
    reset();
    await runJob({ promptText: 'x', analysisType: 'optimize' });
    assert.ok(bedrockCalls[0].body.max_tokens >= 16000,
      `max_tokens is ${bedrockCalls[0].body.max_tokens}; the improve reply was cut off at 4000`);
  });

  await check('the improve format names each change once, and writes no rewrite at all', async () => {
    // The rewrite moved to the apply job, which writes only what was ticked —
    // so the reply that was cut off at max_tokens no longer exists.
    reset();
    await runJob({ promptText: 'x', analysisType: 'improve' });
    const prompt = bedrockCalls[0].prompt;
    assert.ok(!/"currentText"/.test(prompt) && !/"enhancedText"/.test(prompt),
      'the before/after passage pair is what ran the reply past max_tokens');
    assert.ok(!/"improvedPrompt"/.test(prompt), 'a lens asked for a whole rewrite again');
    assert.strictEqual((prompt.match(/"issues"/g) || []).length, 1, 'the checklist must be asked for once');
  });

  await check('a second delivery of the same Event does not run Bedrock again', async () => {
    reset();
    const { payload, job } = await runJob({ promptText: 'x', analysisType: 'improve' });
    assert.strictEqual(job.status, 'complete', 'the first delivery must have run for this to mean anything');
    await quietly(() => handler(payload, ctx()));
    assert.strictEqual(bedrockCalls.length, 1, 'Lambda async invokes are at-least-once; the worker must claim the job');
  });

  say('\n4. only the caller who started a job can read it');

  reset();
  const mine = await runJob({ promptText: 'x', analysisType: 'improve' });
  await check('the caller who started it can', () => assert.strictEqual(mine.polled.statusCode, 200));
  await check('another admin cannot — and is told it does not exist, not that it is not theirs', async () => {
    const res = await handler(pollEvent(mine.jobId, who({ userId: 'sub-somebody-else' })), ctx());
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(Object.keys(body(res)), ['error'], 'a refusal must carry nothing of the job');
  });
  await check('the same person acting for another organisation cannot', async () => {
    const res = await handler(pollEvent(mine.jobId, who({ orgId: OTHER_ORG, orgRole: 'owner' })), ctx());
    assert.strictEqual(res.statusCode, 404);
  });
  await check('a caller outside the admins group is refused at the handler too', async () => {
    const res = await quietly(() => handler(pollEvent(mine.jobId, who({ groups: 'hosts' })), ctx()));
    assert.strictEqual(res.statusCode, 403);
    const start = await quietly(() => handler(postEvent({ promptText: 'x' }, who({ groups: 'hosts' })), ctx()));
    assert.strictEqual(start.statusCode, 403);
  });
  await check('a generation job id does not open through this route', async () => {
    store.set(rowKey('AIJOBS', 'AIJOB#gen1'), {
      PK: 'AIJOBS', SK: 'AIJOB#gen1', jobId: 'gen1', kind: 'trivia', status: 'complete', callerUserId: 'sub-admin',
    });
    const res = await handler(pollEvent('gen1'), ctx());
    assert.strictEqual(res.statusCode, 404);
  });
  await check('the poll route stays Engage\'s at the authorizer, like the POST', () => {
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/ai-prompt-advisor/{jobId}'), ['admins']);
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/ai-prompt-advisor/mt5t6yreeiwar2rt'), ['admins']);
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-prompt-advisor'), ['admins']);
  });

  say("\n5. an organisation's Workie and its analysis are sealed at rest");

  reset();
  const secrets = {
    name: `Acme layoffs debrief ${marker('name')}`,
    description: `How we tell staff ${marker('desc')}`,
    template: `WORKIE OWN VOICE ${marker('tpl')}\nSummarise {responsesText}.`,
  };
  const analysisSecret = marker('analysis');
  await seedOrgWorkie(ORG, 'acme-debrief', secrets);
  bedrockHandler = () => jsonReply({
    ...IMPROVE,
    summary: analysisSecret,
    issues: [{ ...IMPROVE.issues[0], fix: `${secrets.template} (tightened)` }],
  });
  const orgRun = await captureLogs(() => runJob({
    promptText: 'undefined\n\nundefined', gameType: 'call-and-answer', analysisType: 'improve', existingPromptId: 'acme-debrief',
  }, ORG_ADMIN));
  const orgJob = orgRun.out;

  await check("the org's own Workie is found in the org's library and opened", () => {
    assert.strictEqual(orgJob.job.status, 'complete', JSON.stringify(orgJob.job));
    assert.ok(bedrockCalls[0].prompt.includes(secrets.template.split('\n')[0]),
      'the Workie text did not reach the model — the advisor looked only in the platform library');
  });
  await check('the stored result is an envelope', () => {
    const row = jobRow(orgJob.jobId);
    assert.ok(isEnvelope(row.result), `result is stored readable: ${JSON.stringify(row.result).slice(0, 120)}`);
    assert.strictEqual(row.callerOrgId, ORG);
  });
  await check('no row in the table carries the Workie or the analysis in the clear', () => {
    assert.ok(jobRow(orgJob.jobId) && 'result' in jobRow(orgJob.jobId), 'no result was stored, so this proves nothing');
    const table = JSON.stringify([...store.values()]);
    for (const [what, needle] of Object.entries({ ...secrets, analysis: analysisSecret })) {
      const probe = what === 'template' ? needle.split('\n')[0] : needle;
      assert.ok(!table.includes(probe), `${what} is readable in the table`);
    }
  });
  await check('…and it opens under that org for the caller who asked', () => {
    const plain = kmsStub.plainRow(ORG, jobRow(orgJob.jobId));
    assert.strictEqual(plain.result.analysis.summary, analysisSecret);
    assert.strictEqual(orgJob.job.result.analysis.summary, analysisSecret);
  });
  await check('neither the Workie nor its analysis reaches the logs', () => {
    assert.strictEqual(orgJob.job.status, 'complete', 'the run did not complete, so this proves nothing');
    const logs = `${orgRun.logs}\n${orgJob.workerLogs}`;
    for (const [what, needle] of Object.entries({ ...secrets, analysis: analysisSecret })) {
      const probe = what === 'template' ? needle.split('\n')[0] : needle;
      assert.ok(!logs.toLowerCase().includes(probe.toLowerCase()), `${what} was logged`);
    }
  });
  await check("another organisation's admin cannot read the job", async () => {
    const res = await handler(pollEvent(orgJob.jobId, who({ orgId: OTHER_ORG, orgRole: 'owner' })), ctx());
    assert.strictEqual(res.statusCode, 404);
  });
  await check("…nor can another org's admin reach the Workie by its id", async () => {
    reset();
    await seedOrgWorkie(ORG, 'acme-debrief', secrets);
    const res = await quietly(() => handler(postEvent({
      analysisType: 'improve', existingPromptId: 'acme-debrief',
    }, who({ orgId: OTHER_ORG, orgRole: 'owner' })), ctx()));
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(dispatched.length, 0);
  });

  await check("Engage's own library stays plaintext, as every platform row does", async () => {
    reset();
    const { jobId } = await runJob({ promptText: 'x', analysisType: 'improve' });
    const row = jobRow(jobId);
    assert.ok(!isEnvelope(row.result), 'a platform caller has no org key to seal under');
    assert.deepStrictEqual(row.result.analysis, IMPROVE);
  });

  await check('a platform Workie is still read from the platform library', async () => {
    reset();
    store.set(rowKey('AIPROMPTS', 'AIPROMPT#house'), {
      PK: 'AIPROMPTS', SK: 'AIPROMPT#house', promptId: 'house', s3Key: 'prompts/call-and-answer/house/v1.json',
    });
    s3Bodies.set('prompts/call-and-answer/house/v1.json', JSON.stringify({
      name: 'House', instructions: 'HOUSE INSTRUCTIONS', outputFormat: '## Summary', gameType: 'call-and-answer',
    }));
    const { job } = await runJob({ analysisType: 'validate', existingPromptId: 'house' });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    // Both halves, each in its own labelled block — never glued into one
    // string, which is what stopped the advice saying which half was which.
    assert.ok(bedrockCalls[0].prompt.includes('HOUSE INSTRUCTIONS'));
    assert.ok(bedrockCalls[0].prompt.includes('## Summary'));
    assert.ok(!bedrockCalls[0].prompt.includes('HOUSE INSTRUCTIONS\n\n## Summary'));
  });

  say('\n6. the prompt text never reaches the logs');

  await check('neither the POST nor the worker prints the prompt', async () => {
    reset();
    const secret = marker('prompt');
    const run = await captureLogs(() => runJob({ promptText: `Private ${secret}`, analysisType: 'validate' }));
    const logs = `${run.logs}\n${run.out.workerLogs}`;
    assert.ok(!logs.includes(secret), 'the prompt text reached the logs');
    assert.match(logs, /prompt-advice|advisor/i, 'the handler stopped saying what it is doing');
  });

  say('\n7. the template wires it the way the generation jobs are wired');

  const fs = require('fs');
  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const start = template.indexOf('\n  AdminAIPromptAdvisorFunction:');
  const next = template.slice(start + 1).search(/\n {2}[A-Za-z][A-Za-z0-9]*:\s*\n/);
  const block = template.slice(start, next < 0 ? undefined : start + 1 + next);

  await check('the function block was found', () => assert.ok(start > 0 && /ai-prompt-advisor\.handler/.test(block)));
  await check('the poll route exists, behind the same authorizer', () => {
    assert.match(block, /Path: \/admin\/ai-prompt-advisor\/\{jobId\}\s*\n\s*Method: GET\s*\n\s*Auth:\s*\n\s*Authorizer: CognitoAuthorizer/);
    assert.match(block, /Path: \/admin\/ai-prompt-advisor\s*\n\s*Method: POST/);
  });
  await check('it may invoke itself, and only itself', () => {
    assert.match(block, /Action: lambda:InvokeFunction\s*\n\s*Resource: !Sub 'arn:aws:lambda:\$\{AWS::Region\}:\$\{AWS::AccountId\}:function:\$\{StackName\}-admin-ai-prompt-advisor'/);
  });
  await check('the worker has the full function timeout, not the old 120s', () => {
    assert.match(block, /Timeout: 900/);
  });
  await check('it may unwrap an org key, and only with the tenant key', () => {
    assert.match(block, /Action: \[ kms:Decrypt \]\s*\n\s*Resource: !GetAtt TenantKey\.Arn/);
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
