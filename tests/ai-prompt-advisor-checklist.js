/**
 * TICK THE ADVICE, APPLY THE TICKED — lambda-functions/admin/ai-prompt-advisor.js.
 *
 * The owner, 2026-09-24: "It gave good advice on validate quality, but you cant
 * action that advice… when using the improve prompt button, also did what
 * appear to be nice work, but it failed when i attempted to save it."
 *
 * What was wrong, in the advisor (docs/superpowers/specs/
 * 2026-09-24-prompt-admin-engage-mode-design.md, "The advisor"):
 *
 *   - It reviewed a Workie's two halves JOINED into one string, so its advice
 *     could not say which half a problem was in, and "improve" returned ONE
 *     rewritten string that the screen pasted whole into Output Format.
 *   - Validate's `issues[]` were never shown; Optimize rendered nothing.
 *   - None of its prompts carried the save rules (`describeAuthoringRules()`),
 *     so a rewrite could be — and was — refused at Save.
 *
 * Now: two lenses, Review and Improve, each returning ONE checklist shape
 *
 *   issues: [{ id, severity: high|medium|low, half: instructions|outputFormat|both, issue, fix }]
 *
 * and a third job, `apply`, that is sent the two halves separately and ONLY the
 * fixes the admin ticked, and returns `{ instructions, outputFormat, applied }`.
 * Every advisor prompt carries the authoring rules.
 *
 * rejects: the halves joined before they reach the model; a checklist without
 *          ids, severities or halves the screen can group by; a rewrite that
 *          is one string; an apply job told about fixes nobody ticked; a half
 *          no ticked fix names coming back changed; a malformed reply stored
 *          as a result; any advisor prompt without the save rules; an org's
 *          rewrite stored readable; the ticked fixes reaching the logs.
 */
const suiteFinished = require('./helpers/finish-guard');
// TEAM AUTHORING ON for this file, as in tests/ai-prompt-advisor-job.js: the
// org cases below pin how an org's advice and rewrite are sealed, which the
// owner may turn back on later. Prompts are Engage-mode only by default
// (prompt-access.js TEAM_WORKIE_AUTHORING); tests/prompt-writes-engage-only.js
// pins that default.
process.env.TEAM_WORKIE_AUTHORING = 'on';
const path = require('path');
const util = require('util');
const assert = require('assert');
const nodeCrypto = require('crypto');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const kmsStub = require('./helpers/tenant-crypto-stub');

// ---- stubs, registered before anything under test is required --------------
// The same fakes as tests/ai-prompt-advisor-job.js: an in-memory table that
// honours the worker's one condition, S3 bodies, a recorded self-invoke, a
// scripted Bedrock and the policy-enforcing KMS stub.
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

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

let dispatched = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class {
    async send(cmd) {
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

stub('@aws-sdk/client-kms', kmsStub.makeKmsStub().exports);

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-prompts-bucket';
process.env.ACCOUNT_ID = '123456789012';
process.env.AWS_REGION = 'us-east-1';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

kmsStub.installTestKeyLoader();
const crypto = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-prompt-advisor.js'));
const { describeAuthoringRules } = require(path.join(REPO, 'lambda-functions/admin/shared/template-variable-usage.js'));

// ---- harness ---------------------------------------------------------------
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

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
const quietly = async (fn) => (await captureLogs(fn)).out;

const marker = (tag) => `zq${tag}${nodeCrypto.randomBytes(4).toString('hex')}`;
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

const ORG = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';

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

const reply = (text, stopReason = 'end_turn') => ({
  body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: stopReason })),
});
const jsonReply = (obj, stopReason) => reply(`Here it is.\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``, stopReason);
/** A rewrite the way the apply prompt asks for one: each half verbatim between its tags. */
const taggedReply = ({ instructions, outputFormat, applied }) => reply(
  `<instructions>\n${instructions}\n</instructions>\n<outputFormat>\n${outputFormat}\n</outputFormat>\n`
  + `<applied>${applied.join(', ')}</applied>`,
);

const body = (res) => JSON.parse(res.body);
const jobRow = (jobId) => store.get(rowKey('AIJOBS', `AIJOB#${jobId}`));

/** Two halves that cannot be mistaken for each other, or for the join of them. */
const INSTRUCTIONS = 'You are Workie, a warm facilitator. Read what the room said.\n\n**The Responses:**\n{responsesText}';
const OUTPUT_FORMAT = '## What we heard\nTwo or three sentences on the themes that recur.';

const CHECKLIST = {
  overallScore: 7,
  summary: 'A clear prompt with one gap in how it treats quiet voices.',
  issues: [
    { id: 'r1', severity: 'high', half: 'instructions', issue: 'It never says what to do with a single answer.', fix: 'Add a sentence for the one-answer case.' },
    { id: 'r2', severity: 'medium', half: 'outputFormat', issue: 'The heading promises themes but allows one sentence.', fix: 'Ask for two or three themes, one line each.' },
    { id: 'r3', severity: 'low', half: 'both', issue: 'The tone words differ between the halves.', fix: 'Use "warm" in both.' },
  ],
};

function reset() {
  store.clear();
  s3Bodies.clear();
  dispatched = [];
  bedrockCalls = [];
  bedrockHandler = () => jsonReply(CHECKLIST);
}

async function runJob(request, caller = ADMIN) {
  const started = await quietly(() => handler(postEvent(request, caller), ctx()));
  const { jobId } = body(started);
  const payload = dispatched[dispatched.length - 1]?.payload;
  const worker = await captureLogs(() => handler(payload, ctx()));
  const polled = await handler(pollEvent(jobId, caller), ctx());
  return { started, jobId, payload, workerLogs: worker.logs, polled, job: body(polled) };
}

/** A platform Workie as create-ai-prompt.js writes one: a row and an S3 body. */
function seedPlatformWorkie(promptId, doc) {
  const s3Key = `prompts/call-and-answer/${promptId}/v1.json`;
  store.set(rowKey('AIPROMPTS', `AIPROMPT#${promptId}`), {
    PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}`, promptId, s3Key,
  });
  s3Bodies.set(s3Key, JSON.stringify({ name: 'House', gameType: 'call-and-answer', ...doc }));
}

/** An org's Workie, sealed the way create-ai-prompt.js seals one. */
async function seedOrgWorkie(orgId, promptId, doc) {
  const s3Key = `prompts/org/${orgId}/call-and-answer/${promptId}/v1.json`;
  s3Bodies.set(s3Key, JSON.stringify(await crypto.encryptValue(orgId, {
    promptId, version: 1, name: 'Acme debrief', gameType: 'call-and-answer', promptType: 'analysis', ...doc,
  })));
  const row = await crypto.encryptItem(orgId, 'prompt', {
    PK: `ORG#${orgId}#AIPROMPTS`, SK: `AIPROMPT#${promptId}`,
    promptId, name: 'Acme debrief', gameType: 'call-and-answer', promptType: 'analysis', s3Key, version: 1,
    scope: 'org', orgId,
  });
  store.set(rowKey(row.PK, row.SK), row);
}

const RULES = describeAuthoringRules();
/** Every rule's text is in the prompt, verbatim — not a paraphrase that can drift. */
const carriesTheRules = (prompt) => prompt.includes(RULES);

/** The half's text sits in the prompt on its own, and the two were never glued together. */
function sentSeparately(prompt, instructions = INSTRUCTIONS, outputFormat = OUTPUT_FORMAT) {
  assert.ok(prompt.includes(instructions), 'the instructions half is not in the prompt as written');
  assert.ok(prompt.includes(outputFormat), 'the output-format half is not in the prompt as written');
  assert.ok(!prompt.includes(`${instructions}\n\n${outputFormat}`),
    'the two halves reached the model joined into one string — the advice cannot say which half is which');
  const i = prompt.indexOf(instructions);
  const o = prompt.indexOf(outputFormat);
  const labelBefore = (at) => prompt.slice(Math.max(0, at - 300), at);
  assert.match(labelBefore(i), /instructions/i, 'the instructions half is not labelled');
  assert.match(labelBefore(o), /output ?format/i, 'the output-format half is not labelled');
}

/** The checklist keys the screen reads, asked for by name in the reply format. */
function asksForTheChecklist(prompt) {
  for (const key of ['"issues"', '"id"', '"severity"', '"half"', '"issue"', '"fix"']) {
    assert.ok(prompt.includes(key), `the reply format does not ask for ${key}`);
  }
  assert.match(prompt, /high\|medium\|low/, 'the severities are not named');
  assert.match(prompt, /instructions\|outputFormat\|both/, 'the halves are not named');
}

(async () => {
  say('\n1. Review and Improve send the two halves separately and ask for one checklist');

  for (const lens of ['review', 'improve']) {
    await check(`${lens}: the halves reach the model separately, each labelled`, async () => {
      reset();
      const { job } = await runJob({
        analysisType: lens, instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, gameType: 'call-and-answer',
      });
      assert.strictEqual(job.status, 'complete', JSON.stringify(job));
      sentSeparately(bedrockCalls[0].prompt);
    });
    await check(`${lens}: the reply format is the checklist — id, severity, half, issue, fix`, () => {
      asksForTheChecklist(bedrockCalls[0].prompt);
      assert.ok(!/"improvedPrompt"|"optimizedPrompt"/.test(bedrockCalls[0].prompt),
        'a lens asked for a one-string rewrite; rewriting is the apply job, and it writes two halves');
    });
    await check(`${lens}: the prompt carries the save rules, verbatim`, () => {
      assert.ok(carriesTheRules(bedrockCalls[0].prompt),
        'describeAuthoringRules() is missing — the advisor would propose fixes the save refuses');
    });
    await check(`${lens}: the halves ride in the invoke payload separately, not on the job row`, async () => {
      reset();
      const started = await quietly(() => handler(postEvent({
        analysisType: lens, instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT,
      }), ctx()));
      assert.strictEqual(started.statusCode, 202, started.body);
      const { input } = dispatched[0].payload;
      assert.strictEqual(input.instructions, INSTRUCTIONS);
      assert.strictEqual(input.outputFormat, OUTPUT_FORMAT);
      assert.ok(!JSON.stringify(jobRow(body(started).jobId)).includes('warm facilitator'),
        'the prompt text was stored on the job row');
    });
  }

  await check('the lenses are told how often each variable appears — counted, not left to the model', async () => {
    /*
      rejects: the live false positive. On dev's default Workie, which names
      {responsesText} once, two Review runs of two reported it "named twice"
      as a pre-ticked HIGH item whose fix was to remove it.
    */
    reset();
    await runJob({
      analysisType: 'review',
      instructions: `${INSTRUCTIONS}\nAnswered: {responseCount}. Again: {responseCount}.`,
      outputFormat: `${OUTPUT_FORMAT}\n{responseCount}`,
    });
    const prompt = bedrockCalls[0].prompt;
    assert.match(prompt, /\{responsesText\}: once \(instructions 1\)/);
    assert.match(prompt, /\{responseCount\}: 3 times \(instructions 2, outputFormat 1\)/);
  });

  await check('the two lenses ask different questions', async () => {
    reset();
    await runJob({ analysisType: 'review', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    await runJob({ analysisType: 'improve', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    const [review, improve] = bedrockCalls.map((c) => c.prompt);
    assert.match(review, /safety/i);
    assert.match(review, /bias|fair/i);
    assert.match(improve, /effective/i);
    assert.match(improve, /tighten|shorter|repetit/i);
    assert.notStrictEqual(review, improve);
  });

  await check('a saved Workie is read and its halves are sent separately', async () => {
    reset();
    seedPlatformWorkie('house', { instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    const { job } = await runJob({ analysisType: 'review', existingPromptId: 'house' });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    sentSeparately(bedrockCalls[0].prompt);
  });

  await check('the old names still work: validate is Review, optimize is Improve', async () => {
    reset();
    const v = await runJob({ analysisType: 'validate', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    const o = await runJob({ analysisType: 'optimize', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    assert.strictEqual(v.job.result.analysisType, 'review');
    assert.strictEqual(o.job.result.analysisType, 'improve');
    assert.strictEqual(body(v.started).analysisType, 'review');
    asksForTheChecklist(bedrockCalls[1].prompt);
  });

  say('\n2. the checklist the screen is handed');

  await check('a well-formed checklist comes back as it was sent', async () => {
    reset();
    const { job } = await runJob({ analysisType: 'review', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    assert.deepStrictEqual(job.result.analysis, CHECKLIST);
  });

  await check('every item leaves with a unique id, a known severity and a known half', async () => {
    reset();
    bedrockHandler = () => jsonReply({
      overallScore: '8.5',
      summary: 'Mostly fine.',
      issues: [
        { severity: 'HIGH', half: 'Instructions', issue: 'No id at all.', fix: 'Give it one.' },
        { id: 'x', severity: 'urgent', half: 'output format', issue: 'Unknown severity.', fix: 'Default it.' },
        { id: 'x', severity: 'low', half: 'the whole thing', issue: 'Duplicate id.', fix: 'Renumber it.' },
        { id: 'y', severity: 'low', half: 'both' },
        'not an object',
      ],
    });
    const { job } = await runJob({ analysisType: 'improve', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    const { issues, overallScore } = job.result.analysis;
    assert.strictEqual(overallScore, 8.5);
    assert.strictEqual(issues.length, 3, 'an item with neither an issue nor a fix, and a non-object, are dropped');
    const ids = issues.map((i) => i.id);
    assert.strictEqual(new Set(ids).size, 3, `ids are not unique: ${ids}`);
    assert.ok(ids.every((id) => typeof id === 'string' && id), `an id is missing: ${ids}`);
    assert.deepStrictEqual(issues.map((i) => i.severity), ['high', 'medium', 'low']);
    assert.deepStrictEqual(issues.map((i) => i.half), ['instructions', 'outputFormat', 'both']);
  });

  await check('an empty checklist is an answer ("nothing to change"), not a failure', async () => {
    reset();
    bedrockHandler = () => jsonReply({ overallScore: 9, summary: 'Nothing to change.', issues: [] });
    const { job } = await runJob({ analysisType: 'review', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.deepStrictEqual(job.result.analysis.issues, []);
  });

  await check('a reply with no checklist in it fails readably and stores nothing', async () => {
    reset();
    bedrockHandler = () => jsonReply({ overallScore: 8, improvedPrompt: 'A whole new prompt' });
    const { job, jobId } = await runJob({ analysisType: 'review', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /format/i);
    assert.match(job.error, /Nothing was changed/);
    assert.ok(!('result' in jobRow(jobId)));
  });

  await check('a single-piece (older template) prompt is reviewed whole, every item on "both"', async () => {
    reset();
    seedPlatformWorkie('legacy', { template: 'Summarise {responsesText} for the room.' });
    const { job } = await runJob({ analysisType: 'review', existingPromptId: 'legacy' });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.ok(bedrockCalls[0].prompt.includes('Summarise {responsesText} for the room.'));
    assert.ok(job.result.analysis.issues.every((i) => i.half === 'both'),
      'a prompt with no halves cannot have advice about one of them');
  });

  say('\n3. apply is sent the two halves and only the ticked fixes');

  const TICKED = [CHECKLIST.issues[0], CHECKLIST.issues[2]]; // r1 (instructions) and r3 (both)
  const REWRITE = {
    instructions: `${INSTRUCTIONS}\n\nIf only one person answered, say so warmly and quote them.`,
    outputFormat: '## What we heard\nTwo or three warm sentences on the themes that recur.',
    applied: ['r1', 'r3'],
  };

  await check('the POST is refused when nothing was ticked', async () => {
    reset();
    for (const issues of [undefined, [], 'r1', [{ severity: 'high' }]]) {
      const res = await quietly(() => handler(postEvent({
        analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues,
      }), ctx()));
      assert.strictEqual(res.statusCode, 400, `issues=${JSON.stringify(issues)} → ${res.statusCode}`);
      assert.match(body(res).error, /tick/i);
    }
    assert.strictEqual(dispatched.length, 0);
    assert.strictEqual(store.size, 0);
  });

  reset();
  bedrockHandler = () => taggedReply(REWRITE);
  const applied = await runJob({
    analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT,
    gameType: 'call-and-answer', issues: TICKED,
  });
  const applyPrompt = bedrockCalls[0]?.prompt || '';

  await check('the job completes and hands back both halves and the ids it applied', () => {
    assert.strictEqual(applied.job.status, 'complete', JSON.stringify(applied.job));
    assert.strictEqual(applied.job.result.analysisType, 'apply');
    assert.deepStrictEqual(applied.job.result.analysis, REWRITE);
  });
  await check('the worker is handed exactly the ticked fixes', () => {
    assert.deepStrictEqual(applied.payload.input.issues.map((i) => i.id), ['r1', 'r3']);
    assert.deepStrictEqual(applied.payload.input.issues[0], TICKED[0]);
  });
  await check('the model is sent the two halves separately', () => sentSeparately(applyPrompt));
  await check('…and every ticked fix, and nothing about the one left unticked', () => {
    for (const t of TICKED) {
      assert.ok(applyPrompt.includes(t.id), `ticked ${t.id} is not in the prompt`);
      assert.ok(applyPrompt.includes(t.fix), `ticked ${t.id}'s fix is not in the prompt`);
    }
    assert.ok(!applyPrompt.includes(CHECKLIST.issues[1].fix), 'an unticked fix reached the model');
    assert.ok(!/\br2\b/.test(applyPrompt), 'an unticked id reached the model');
  });
  await check('…under the save rules, verbatim, and told to change nothing else', () => {
    assert.ok(carriesTheRules(applyPrompt), 'describeAuthoringRules() is missing from the apply prompt');
    assert.match(applyPrompt, /nothing else/i);
  });
  await check('…and asked to write each half between tags, not as JSON', () => {
    /*
      rejects: the first cut's `{ "instructions": "…" }`. On dev's default
      Workie Sonnet sent 6,771 characters holding no parseable JSON — two long
      halves full of "quoted labels" is a lot to escape by hand.
    */
    const replyFormat = applyPrompt.slice(applyPrompt.indexOf('How to reply'));
    assert.ok(replyFormat.length < applyPrompt.length, 'the reply format section is missing');
    for (const tag of ['<instructions>', '</instructions>', '<outputFormat>', '</outputFormat>', '<applied>']) {
      assert.ok(replyFormat.includes(tag), `the reply format does not ask for ${tag}`);
    }
    assert.ok(!/```json/.test(replyFormat), 'the rewrite is asked for as JSON again');
  });
  await check('the rewrite is asked for at a low temperature — an edit, not a new draft', () => {
    assert.ok(bedrockCalls[0].body.temperature <= 0.3, `temperature ${bedrockCalls[0].body.temperature}`);
  });

  await check('a half no ticked fix names comes back exactly as it went in', async () => {
    reset();
    bedrockHandler = () => taggedReply({
      instructions: `${INSTRUCTIONS}\n\nIf only one person answered, say so.`,
      outputFormat: 'The model quietly rewrote this half as well.',
      applied: ['r1'],
    });
    const { job } = await runJob({
      analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: [CHECKLIST.issues[0]],
    });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.strictEqual(job.result.analysis.outputFormat, OUTPUT_FORMAT,
      'nobody ticked a fix to the output format, so it must not change');
    assert.match(job.result.analysis.instructions, /only one person answered/);
  });

  await check('a half full of quotes, backslashes, braces and fences comes back byte for byte', async () => {
    reset();
    const awkward = 'Rule 1. Say "exactly" what was written — don’t paraphrase.\n'
      + 'A path like C:\\rooms\\one and a {responsesText} token.\n```\nnot a real fence\n```\n\tTabbed.';
    bedrockHandler = () => taggedReply({ instructions: awkward, outputFormat: OUTPUT_FORMAT, applied: ['r1'] });
    const { job } = await runJob({
      analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: [CHECKLIST.issues[0]],
    });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.strictEqual(job.result.analysis.instructions, awkward);
  });

  await check('curly quotes the model straightened on a line no fix touched are put back', async () => {
    // Seen live, three runs of three: people’s → people's across the half.
    reset();
    const curly = 'Treat them as one person’s views, never as the room’s.\nSay “warm”, not cold.';
    const edited = 'Treat them as one person\'s views, never as the room\'s.\nSay "warm", not "cold".';
    bedrockHandler = () => taggedReply({ instructions: edited, outputFormat: OUTPUT_FORMAT, applied: ['r1'] });
    const { job } = await runJob({
      analysisType: 'apply', instructions: curly, outputFormat: OUTPUT_FORMAT, issues: [CHECKLIST.issues[0]],
    });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    const [first, second] = job.result.analysis.instructions.split('\n');
    assert.strictEqual(first, 'Treat them as one person’s views, never as the room’s.', 'an untouched line was changed');
    assert.strictEqual(second, 'Say "warm", not "cold".', 'a line the fix really changed must keep its change');
  });

  await check('a rewrite sent as JSON anyway is still read', async () => {
    reset();
    bedrockHandler = () => jsonReply(REWRITE);
    const { job } = await runJob({
      analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: TICKED,
    });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.deepStrictEqual(job.result.analysis, REWRITE);
  });

  await check('"applied" names only fixes that were ticked', async () => {
    reset();
    bedrockHandler = () => taggedReply({ ...REWRITE, applied: ['r1', 'r2', 'r3', 'made-up', 'r1'] });
    const { job } = await runJob({
      analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: TICKED,
    });
    assert.deepStrictEqual(job.result.analysis.applied, ['r1', 'r3']);
  });

  await check('a saved Workie is read for the apply too, halves separate', async () => {
    reset();
    seedPlatformWorkie('house', { instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    bedrockHandler = () => taggedReply(REWRITE);
    const { job } = await runJob({ analysisType: 'apply', existingPromptId: 'house', issues: TICKED });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    sentSeparately(bedrockCalls[0].prompt);
  });

  await check('a single-piece prompt has no halves to rewrite into, and the POST says so', async () => {
    reset();
    seedPlatformWorkie('legacy', { template: 'Summarise {responsesText} for the room.' });
    const res = await quietly(() => handler(postEvent({
      analysisType: 'apply', existingPromptId: 'legacy', issues: TICKED,
    }), ctx()));
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(body(res).error, /two halves/i);
    assert.strictEqual(dispatched.length, 0);
  });

  say('\n4. a malformed rewrite fails readably');

  for (const [label, text] of [
    ['a tagged reply missing a half', '<instructions>\nOnly one half\n</instructions>\n<applied>r1</applied>'],
    ['a JSON reply missing a half', '```json\n{"instructions": "Only one half", "applied": ["r1"]}\n```'],
    ['a half that is not text', '```json\n{"instructions": "x", "outputFormat": {"sections": []}, "applied": []}\n```'],
    ['a reply with no JSON at all', 'I have applied the fixes you asked for. The prompt is much better now.'],
  ]) {
    await check(`${label}: the job fails with a sentence and stores no result`, async () => {
      reset();
      bedrockHandler = () => reply(text);
      const { job, jobId } = await runJob({
        analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: TICKED,
      });
      assert.strictEqual(job.status, 'error');
      assert.match(job.error, /format/i);
      assert.match(job.error, /Nothing was changed/);
      assert.ok(!('result' in jobRow(jobId)), 'a malformed rewrite was stored');
    });
  }

  await check('a rewrite cut off at max_tokens is a failure that says so', async () => {
    reset();
    bedrockHandler = () => reply('```json\n{"instructions": "You are Workie', 'max_tokens');
    const { job } = await runJob({
      analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: TICKED,
    });
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /cut off/i);
  });

  say("\n5. an organisation's rewrite is sealed, and nothing ticked reaches the logs");

  reset();
  const secret = marker('fix');
  const rewritten = marker('rewrite');
  await seedOrgWorkie(ORG, 'acme', { instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
  bedrockHandler = () => taggedReply({ ...REWRITE, instructions: `${INSTRUCTIONS} ${rewritten}` });
  const orgRun = await captureLogs(() => runJob({
    analysisType: 'apply', existingPromptId: 'acme',
    issues: [{ ...CHECKLIST.issues[0], fix: `Say ${secret}.` }],
  }, ORG_ADMIN));

  await check("the org's rewrite completes and opens for the caller who asked", () => {
    assert.strictEqual(orgRun.out.job.status, 'complete', JSON.stringify(orgRun.out.job));
    assert.match(orgRun.out.job.result.analysis.instructions, new RegExp(rewritten));
  });
  await check('the stored rewrite is an envelope, and the table carries neither it nor the ticked fix', () => {
    const row = jobRow(orgRun.out.jobId);
    assert.ok(isEnvelope(row.result), `result is stored readable: ${JSON.stringify(row.result).slice(0, 120)}`);
    const table = JSON.stringify([...store.values()]);
    assert.ok(!table.includes(rewritten), 'the rewrite is readable in the table');
    assert.ok(!table.includes(secret), 'the ticked fix is readable in the table');
  });
  await check('neither the ticked fix nor the rewrite is logged', () => {
    assert.strictEqual(orgRun.out.job.status, 'complete', 'the run did not complete, so this proves nothing');
    const logs = `${orgRun.logs}\n${orgRun.out.workerLogs}`;
    assert.ok(!logs.includes(secret), 'the ticked fix reached the logs');
    assert.ok(!logs.includes(rewritten), 'the rewrite reached the logs');
    assert.ok(!logs.includes('warm facilitator'), 'the prompt reached the logs');
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
