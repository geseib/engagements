/**
 * THE PROMPT WORKBENCH, SERVER SIDE — lambda-functions/admin/ai-prompt-advisor.js
 * and lambda-functions/admin/shared/workie-reference.js.
 *
 * Spec: docs/superpowers/specs/2026-09-25-prompt-workbench-design.md.
 *
 * The owner ran Improve, applied its fixes, opened the editor, and met a
 * finding Improve had never mentioned — "discussionQuestions and nextSteps
 * will come back empty on every round". Improve had never been told the
 * prompt's declared Output sections, reviewed the SAVED copy instead of the
 * draft, and was never shown what the editor's own checks had found. So:
 *
 *   1. `analysisType: 'reference'` — the system facts an outside agent needs
 *      (the save rules, the variables for the game type, the section limits,
 *      the layers the system wraps a prompt in), synchronous, no model call,
 *      and gated exactly as prompt authoring is: Engage admins in Engage mode.
 *   2. A draft is reviewed as sent, WITH its declared sections and the code's
 *      findings, and the model is told not to repeat or contradict them.
 *      Advice about a heading comes back as `half: "sections"` and can never
 *      be sent to a rewrite — a heading is the admin's to change.
 *   3. `analysisType: 'simplify'` rewrites the halves shorter, and the server
 *      refuses a result that dropped a {variable} or a heading line, or that
 *      breaks a save rule.
 *
 * rejects: the reference served to a team owner or an admin acting for a team;
 *          a reference that paraphrases the rules or the catalogue; an advisor
 *          prompt with no sections and no findings in it; a sections item
 *          collapsed to "both" and then rewritten into a half; a simplified
 *          prompt that lost the responses, a heading or a save rule reaching
 *          the screen as a result; the prompt text reaching the logs.
 *
 * TEAM AUTHORING IS LEFT OFF in this file on purpose — the default every
 * deployed stack runs — because the gate is part of what is pinned here.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const util = require('util');
const assert = require('assert');
const nodeCrypto = require('crypto');
const Module = require('module');

delete process.env.TEAM_WORKIE_AUTHORING;
const REPO = path.join(__dirname, '..');
const kmsStub = require('./helpers/tenant-crypto-stub');

// ---- stubs, as tests/ai-prompt-advisor-checklist.js ------------------------
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
      const found = s3Bodies.get(cmd.input.Key);
      if (found === undefined) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      return { Body: { transformToString: async () => found } };
    }
  },
  GetObjectCommand,
});

let dispatched = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class {
    async send(cmd) {
      dispatched.push({ payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')) });
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
      const parsed = JSON.parse(cmd.input.body);
      bedrockCalls.push({ body: parsed, prompt: parsed.messages[0].content[0].text });
      return bedrockHandler(bedrockCalls.length, cmd.input.modelId, parsed);
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

const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-prompt-advisor.js'));
const usage = require(path.join(REPO, 'lambda-functions/admin/shared/template-variable-usage.js'));
const shape = require(path.join(REPO, 'lambda-functions/admin/shared/prompt-shape.js'));
const reference = require(path.join(REPO, 'lambda-functions/admin/shared/workie-reference.js'));

// ---- harness ---------------------------------------------------------------
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
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
const quietly = async (fn) => (await captureLogs(fn)).out;
const marker = (tag) => `zq${tag}${nodeCrypto.randomBytes(4).toString('hex')}`;

const who = ({ userId = 'sub-admin', groups = 'admins', orgId = '', orgRole = '' } = {}) => ({
  authorizer: { lambda: {
    userId, username: `${userId}-name`, groups, status: 'enabled', ...(orgId ? { orgId, orgRole } : {}),
  } },
});
const ENGAGE_ADMIN = who();
const TEAM_OWNER = who({ userId: 'sub-owner', groups: 'hosts', orgId: 'org_team1', orgRole: 'owner' });
const ADMIN_AS_TEAM = who({ orgId: 'org_team1', orgRole: 'owner' });

const postEvent = (payload, caller = ENGAGE_ADMIN) => ({
  requestContext: { http: { method: 'POST' }, ...caller },
  body: JSON.stringify(payload),
});
const pollEvent = (jobId, caller = ENGAGE_ADMIN) => ({
  requestContext: { http: { method: 'GET' }, ...caller },
  pathParameters: { jobId },
});
const ctx = () => ({ functionName: 'engagedev-admin-ai-prompt-advisor' });
const body = (res) => JSON.parse(res.body);
const reply = (text, stopReason = 'end_turn') => ({
  body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: stopReason })),
});
const jsonReply = (obj) => reply(`\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``);
const taggedReply = ({ instructions, outputFormat }) => reply(
  `<instructions>\n${instructions}\n</instructions>\n<outputFormat>\n${outputFormat}\n</outputFormat>\n<applied></applied>`,
);

function reset() {
  store.clear();
  s3Bodies.clear();
  dispatched = [];
  bedrockCalls = [];
  bedrockHandler = () => jsonReply({ overallScore: 7, summary: 'Fine.', issues: [] });
}

async function runJob(request, caller = ENGAGE_ADMIN) {
  const started = await quietly(() => handler(postEvent(request, caller), ctx()));
  if (started.statusCode !== 202) return { started, job: null };
  const { jobId } = body(started);
  const payload = dispatched[dispatched.length - 1].payload;
  const worker = await captureLogs(() => handler(payload, ctx()));
  const polled = await handler(pollEvent(jobId, caller), ctx());
  return { started, jobId, payload, workerLogs: worker.logs, job: body(polled) };
}

/** The shape the owner met: an art round's own headings, none of them a synonym. */
const ART_SECTIONS = [
  { heading: 'The Winning Title', guidance: 'Name the title the room voted for.' },
  { heading: 'The Reveal', guidance: 'The real title of the work, and one fact about it.' },
  { heading: 'Keep Playing', guidance: 'One line to send the room into the next round.' },
];
const INSTRUCTIONS = 'You are Workie, a warm host.\n\n**The titles the room wrote:**\n{responsesText}\n\n**Votes:**\n{voteTally}';
const OUTPUT_FORMAT = '## The Winning Title\nSay which title won.\n\n## The Reveal\nThe real title.\n\n## Keep Playing\nOne line.';
const CHECKS = [
  {
    code: 'structured-fields-empty',
    tier: 'silent',
    title: 'discussionQuestions and nextSteps will come back empty on every round.',
    fix: 'If those surfaces matter, name a section so it matches.',
  },
];

(async () => {
  say('\n1. the reference: what an outside agent needs, from the sources the app uses');

  reset();
  const ref = await quietly(() => handler(postEvent({ analysisType: 'reference', gameType: 'call-and-answer' }), ctx()));

  await check('an Engage admin in Engage mode gets it at once — 200, no job, no model call', () => {
    assert.strictEqual(ref.statusCode, 200, ref.body);
    assert.strictEqual(dispatched.length, 0, 'a reference started a job');
    assert.strictEqual(bedrockCalls.length, 0, 'a reference called the model');
    assert.strictEqual(store.size, 0, 'a reference wrote a row');
  });

  const r = ref.statusCode === 200 ? body(ref).reference : {};

  await check('the save rules are AUTHORING_RULES itself — every rule, verbatim, with whether Save enforces it', () => {
    assert.deepStrictEqual(r.rules, usage.AUTHORING_RULES.map((rule) => ({
      id: rule.id, text: rule.text, enforcedOnSave: Boolean(rule.gate),
    })));
  });

  await check('the variables are the ones the advisor offers for the type, each with its meaning and example', () => {
    const expected = usage.variablesToOffer('call-and-answer');
    assert.ok(expected.length > 20, 'the premise: call-and-answer offers a real catalogue');
    assert.deepStrictEqual(r.variables, expected.map((v) => ({
      name: v.name, category: v.category, description: v.description, example: v.example,
    })));
    assert.strictEqual(r.gameType, 'call-and-answer');
  });

  await check('the section rules are prompt-shape.js\'s own limits and default', () => {
    assert.deepStrictEqual(r.sections, {
      maxSections: shape.MAX_SECTIONS,
      maxHeadingChars: shape.MAX_HEADING_CHARS,
      maxGuidanceChars: shape.MAX_GUIDANCE_CHARS,
      default: shape.DEFAULT_OUTPUT_SECTIONS,
    });
    assert.strictEqual(shape.MAX_SECTIONS, 8);
    assert.strictEqual(shape.MAX_HEADING_CHARS, 60);
    assert.strictEqual(shape.MAX_GUIDANCE_CHARS, 600);
  });

  await check('the layers are the order get-ai-summary.js actually assembles the prompt in', () => {
    /*
      rejects: a description of the assembly that has drifted from it. Read
      the one line that builds the prompt and compare its interpolations, in
      order, to the layers the reference (and the advisor) describe.
    */
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'), 'utf8');
    const line = /let prompt = `([^`]*)`;/.exec(src);
    assert.ok(line, 'the assembly line in get-ai-summary.js was not found');
    const order = [...line[1].matchAll(/\$\{([^}]*?)(?:\(|\})/g)].map((m) => m[1].trim());
    // …and whatever is appended to it afterwards (the briefing, today), in order.
    for (const m of src.slice(line.index).matchAll(/\bprompt \+= `[^`]*\$\{(\w+)\}`/g)) order.push(m[1]);
    assert.ok(order.length >= 7, `the assembly was not read: ${order}`);
    assert.deepStrictEqual(r.layers.map((l) => l.source), order);
    assert.deepStrictEqual(reference.ASSEMBLY_LAYERS.map((l) => l.source), order);
    for (const layer of r.layers) {
      assert.ok(layer.name && layer.text, `layer ${layer.source} has no words`);
    }
  });

  await check('a game type nobody plays, or none, is refused with a sentence', async () => {
    for (const gameType of ['chess', undefined]) {
      const res = await quietly(() => handler(postEvent({ analysisType: 'reference', gameType }), ctx()));
      assert.strictEqual(res.statusCode, 400, `${gameType} → ${res.statusCode}`);
      assert.match(body(res).error, /game type/i);
    }
  });

  await check('a legacy spelling is read as the canonical type', async () => {
    const res = await quietly(() => handler(postEvent({ analysisType: 'reference', gameType: 'callandanswer' }), ctx()));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body(res).reference.gameType, 'call-and-answer');
  });

  say('\n2. the reference is served to Engage admins in Engage mode, and no one else');

  await check('a team owner (a host with an organisation) is refused', async () => {
    reset();
    const res = await quietly(() => handler(postEvent({ analysisType: 'reference', gameType: 'poll' }, TEAM_OWNER), ctx()));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.ok(!('reference' in body(res)), 'a refusal carried the reference');
  });

  await check('an Engage admin acting for a team is refused, with the sentence that says what to do', async () => {
    reset();
    const res = await quietly(() => handler(postEvent({ analysisType: 'reference', gameType: 'poll' }, ADMIN_AS_TEAM), ctx()));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.match(body(res).error, /Engage mode/);
    assert.ok(!('reference' in body(res)));
  });

  say('\n3. a draft is reviewed as sent, with its sections and the code\'s findings');

  reset();
  const drafted = await runJob({
    analysisType: 'improve',
    instructions: INSTRUCTIONS,
    outputFormat: OUTPUT_FORMAT,
    outputSections: ART_SECTIONS,
    checks: CHECKS,
    gameType: 'call-and-answer',
    context: { name: 'Art titles' },
  });
  const draftPrompt = bedrockCalls[0] ? bedrockCalls[0].prompt : '';

  await check('the draft job completes', () => {
    assert.ok(drafted.job, drafted.started && drafted.started.body);
    assert.strictEqual(drafted.job.status, 'complete', JSON.stringify(drafted.job));
  });

  await check('the model is told the declared headings, in order, and that the admin sets them', () => {
    let at = -1;
    for (const s of ART_SECTIONS) {
      const next = draftPrompt.indexOf(s.heading, at + 1);
      assert.ok(next > at, `"${s.heading}" is missing or out of order`);
      at = next;
    }
    assert.match(draftPrompt, /Output sections/);
    assert.match(draftPrompt, /"half": "sections"|half "sections"|"sections"/);
  });

  await check('the model is told what the code already found, and not to repeat or contradict it', () => {
    assert.ok(draftPrompt.includes(CHECKS[0].title), 'the finding the owner met is not in the prompt');
    assert.ok(draftPrompt.includes('structured-fields-empty'));
    assert.match(draftPrompt, /contradict/i);
  });

  await check('with no findings, the model is told the code found nothing', async () => {
    reset();
    await runJob({ analysisType: 'review', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, checks: [] });
    assert.match(bedrockCalls[0].prompt, /found nothing/i);
  });

  await check('with no sections declared, the model is told the default three', async () => {
    reset();
    await runJob({ analysisType: 'review', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    const p = bedrockCalls[0].prompt;
    for (const s of shape.DEFAULT_OUTPUT_SECTIONS) assert.ok(p.includes(s.heading), `default ${s.heading} missing`);
  });

  await check('Improve asks about variety, a spoken voice, the round and the event, and outside knowledge', () => {
    assert.match(draftPrompt, /variety/i);
    assert.match(draftPrompt, /spoken|out loud|aloud/i);
    assert.match(draftPrompt, /this event|the event/i);
    assert.match(draftPrompt, /outside|general knowledge/i);
  });

  await check('the model is told what the system wraps around the prompt, so it does not advise it twice', () => {
    for (const layer of reference.ASSEMBLY_LAYERS) {
      assert.ok(draftPrompt.includes(layer.text), `the layer "${layer.name}" is not described`);
    }
  });

  await check('a saved Workie is reviewed with ITS declared sections', async () => {
    reset();
    const s3Key = 'prompts/call-and-answer/art/v1.json';
    store.set(rowKey('AIPROMPTS', 'AIPROMPT#art'), { PK: 'AIPROMPTS', SK: 'AIPROMPT#art', promptId: 'art', s3Key });
    s3Bodies.set(s3Key, JSON.stringify({
      name: 'Art', gameType: 'call-and-answer', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, outputSections: ART_SECTIONS,
    }));
    await runJob({ analysisType: 'review', existingPromptId: 'art' });
    assert.ok(bedrockCalls[0].prompt.includes('The Reveal'), 'the saved prompt\'s sections were not read');
  });

  await check('an item about a heading keeps half "sections" — it is not folded into "both"', async () => {
    reset();
    bedrockHandler = () => jsonReply({
      overallScore: 6,
      summary: 'Good.',
      issues: [
        { id: 'i1', severity: 'medium', half: 'sections', issue: 'Keep Playing matches nothing the remote reads.', fix: 'Rename it Next steps.' },
        { id: 'i2', severity: 'low', half: 'Output sections', issue: 'The Reveal has no guidance about length.', fix: 'Say one sentence.' },
        { id: 'i3', severity: 'low', half: 'instructions', issue: 'Flat voice.', fix: 'Warmer.' },
      ],
    });
    const { job } = await runJob({ analysisType: 'improve', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, outputSections: ART_SECTIONS });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.deepStrictEqual(job.result.analysis.issues.map((i) => i.half), ['sections', 'sections', 'instructions']);
  });

  await check('a sections item is never sent to a rewrite; one with nothing else ticked is refused', async () => {
    reset();
    bedrockHandler = () => taggedReply({ instructions: `${INSTRUCTIONS}\nWarmer.`, outputFormat: OUTPUT_FORMAT });
    const heading = { id: 'i1', severity: 'medium', half: 'sections', issue: 'Rename Keep Playing.', fix: 'Call it Next steps, zqheading.' };
    const prose = { id: 'i3', severity: 'low', half: 'instructions', issue: 'Flat voice.', fix: 'Warmer.' };
    const { job } = await runJob({ analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: [heading, prose] });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.ok(!bedrockCalls[0].prompt.includes('zqheading'), 'a heading change reached the rewrite');

    reset();
    const res = await quietly(() => handler(postEvent({
      analysisType: 'apply', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, issues: [heading],
    }), ctx()));
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(body(res).error, /editor/i);
    assert.strictEqual(dispatched.length, 0);
  });

  await check('findings from the screen are bounded — thirty at most, each cut to a sane length', async () => {
    reset();
    const many = Array.from({ length: 50 }, (_, i) => ({
      code: `c${i}`, tier: 'advisory', title: `zqtitle${i} ${'x'.repeat(3000)}`, fix: 'Fix.',
    }));
    await runJob({ analysisType: 'review', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, checks: many });
    const p = bedrockCalls[0].prompt;
    assert.ok(p.includes('zqtitle29'), 'the thirtieth finding is missing');
    assert.ok(!p.includes('zqtitle30'), 'more than thirty findings reached the model');
    assert.ok(!p.includes('x'.repeat(1000)), 'a finding reached the model uncut');
  });

  say('\n4. simplify: shorter and clearer, never at the cost of a variable, a heading or a save rule');

  const SIMPLE_OK = {
    instructions: 'You are Workie, warm.\n\n**Titles:**\n{responsesText}\n\n**Votes:**\n{voteTally}',
    outputFormat: '## The Winning Title\nThe winner.\n\n## The Reveal\nThe real title.\n\n## Keep Playing\nOne line.',
  };

  reset();
  bedrockHandler = () => taggedReply(SIMPLE_OK);
  const simple = await runJob({
    analysisType: 'simplify', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT,
    outputSections: ART_SECTIONS, gameType: 'call-and-answer',
  });
  const simplePrompt = bedrockCalls[0] ? bedrockCalls[0].prompt : '';

  await check('a simplified draft that keeps everything completes, with both halves', () => {
    assert.ok(simple.job, simple.started && simple.started.body);
    assert.strictEqual(simple.job.status, 'complete', JSON.stringify(simple.job));
    assert.strictEqual(simple.job.result.analysisType, 'simplify');
    assert.strictEqual(simple.job.result.analysis.instructions, SIMPLE_OK.instructions);
    assert.strictEqual(simple.job.result.analysis.outputFormat, SIMPLE_OK.outputFormat);
  });

  await check('the model is told every variable and every heading it must keep, and the save rules', () => {
    for (const token of ['{responsesText}', '{voteTally}']) assert.ok(simplePrompt.includes(token), `${token} not listed`);
    for (const h of ['## The Winning Title', '## The Reveal', '## Keep Playing']) assert.ok(simplePrompt.includes(h), `${h} not listed`);
    assert.ok(simplePrompt.includes(usage.describeAuthoringRules()), 'the save rules are missing');
    assert.match(simplePrompt, /shorter/i);
    assert.match(simplePrompt, /<instructions>/);
    assert.ok(simple.payload.input.instructions === INSTRUCTIONS, 'the draft did not ride in the payload');
  });

  for (const [label, rewrite, said] of [
    ['a dropped variable', { ...SIMPLE_OK, instructions: 'You are Workie.\n\n**Votes:**\n{voteTally}' }, /\{responsesText\}/],
    ['a dropped heading', { ...SIMPLE_OK, outputFormat: '## The Winning Title\nThe winner.\n\n## Keep Playing\nOne line.' }, /The Reveal/],
    ['a square bracket', { ...SIMPLE_OK, outputFormat: `${SIMPLE_OK.outputFormat}\n[two sentences]` }, /bracket/i],
    ['an invented variable', { ...SIMPLE_OK, instructions: `${SIMPLE_OK.instructions}\n{roomMood}` }, /\{roomMood\}/],
  ]) {
    await check(`${label}: the job fails with a sentence saying what went, and stores no result`, async () => {
      reset();
      bedrockHandler = () => taggedReply(rewrite);
      const { job, jobId } = await runJob({
        analysisType: 'simplify', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, outputSections: ART_SECTIONS,
      });
      assert.strictEqual(job.status, 'error', JSON.stringify(job));
      assert.match(job.error, said);
      assert.match(job.error, /Nothing was changed/);
      assert.ok(!('result' in store.get(rowKey('AIJOBS', `AIJOB#${jobId}`))), 'a refused simplification was stored');
    });
  }

  await check('a duplicate reduced to one mention is fine — the variable is still there', async () => {
    reset();
    bedrockHandler = () => taggedReply(SIMPLE_OK);
    const { job } = await runJob({
      analysisType: 'simplify',
      instructions: `${INSTRUCTIONS}\n\nAgain, the titles: {responsesText}`,
      outputFormat: OUTPUT_FORMAT,
    });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
  });

  await check('a one-piece (older template) prompt cannot be simplified into halves, and the POST says so', async () => {
    reset();
    const res = await quietly(() => handler(postEvent({ analysisType: 'simplify', promptText: 'Summarise {responsesText}.' }), ctx()));
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(body(res).error, /two halves/i);
  });

  await check('neither the draft nor the simplification reaches the logs', async () => {
    reset();
    const secret = marker('draft');
    const rewritten = marker('simple');
    bedrockHandler = () => taggedReply({ ...SIMPLE_OK, instructions: `${SIMPLE_OK.instructions}\n${rewritten}` });
    const run = await captureLogs(() => runJob({
      analysisType: 'simplify', instructions: `${INSTRUCTIONS}\n${secret}`, outputFormat: OUTPUT_FORMAT,
    }));
    assert.strictEqual(run.out.job.status, 'complete', JSON.stringify(run.out.job));
    const logs = `${run.logs}\n${run.out.workerLogs}`;
    assert.ok(!logs.includes(secret), 'the draft reached the logs');
    assert.ok(!logs.includes(rewritten), 'the simplification reached the logs');
  });

  await check('a refused simplification is not logged — the heading it names never reaches CloudWatch', async () => {
    reset();
    const heading = `## The Reveal ${marker('head')}`;
    const format = `## The Winning Title\nThe winner.\n\n${heading}\nThe real title.`;
    bedrockHandler = () => taggedReply({ ...SIMPLE_OK, outputFormat: '## The Winning Title\nThe winner.' });
    const run = await captureLogs(() => runJob({ analysisType: 'simplify', instructions: INSTRUCTIONS, outputFormat: format }));
    assert.strictEqual(run.out.job.status, 'error', JSON.stringify(run.out.job));
    // The admin is told which one (Engage's own library is plaintext by decision)…
    assert.ok(run.out.job.error.includes(heading.slice(3)), run.out.job.error);
    // …and the logs are not.
    const logs = `${run.logs}\n${run.out.workerLogs}`;
    assert.ok(!logs.includes(heading.slice(3)), 'the dropped heading reached the logs');
  });

  await check("an organisation's refusal names the heading by position, never by its words", async () => {
    /*
      An org's prompt text is sealed at rest (tenant-crypto.js), and a job's
      errorMessage is not: quoting the org's heading there would store it in
      the clear. Team authoring is the owner's "later"; this pins how it
      behaves when it comes back.
    */
    reset();
    process.env.TEAM_WORKIE_AUTHORING = 'on';
    try {
      const orgOwner = who({ userId: 'sub-org', groups: 'admins', orgId: 'org_team1', orgRole: 'owner' });
      const heading = `## The Reveal ${marker('orghead')}`;
      const format = `## The Winning Title\nThe winner.\n\n${heading}\nThe real title.`;
      bedrockHandler = () => taggedReply({ ...SIMPLE_OK, outputFormat: '## The Winning Title\nThe winner.' });
      const run = await captureLogs(() => runJob({
        analysisType: 'simplify', instructions: INSTRUCTIONS, outputFormat: format,
      }, orgOwner));
      assert.strictEqual(run.out.job.status, 'error', JSON.stringify(run.out.job));
      assert.ok(!run.out.job.error.includes(heading.slice(3)), `the org's heading is in the error: ${run.out.job.error}`);
      assert.match(run.out.job.error, /heading 2 of 2/);
      const row = store.get(rowKey('AIJOBS', `AIJOB#${run.out.jobId}`));
      assert.ok(!JSON.stringify(row).includes(heading.slice(3)), "the org's heading is stored in the clear");
      assert.ok(!`${run.logs}\n${run.out.workerLogs}`.includes(heading.slice(3)), "the org's heading reached the logs");
    } finally {
      delete process.env.TEAM_WORKIE_AUTHORING;
    }
  });

  await check('a team owner cannot start a simplify either', async () => {
    reset();
    const res = await quietly(() => handler(postEvent({
      analysisType: 'simplify', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT,
    }, TEAM_OWNER), ctx()));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(dispatched.length, 0);
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
