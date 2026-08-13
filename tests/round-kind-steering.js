/**
 * ROUND KIND, end to end: the enum, the CSV columns, and the generator steering.
 *
 * THE DEFECT, in the owner's words: *"if someone is creating a call and answer
 * based on a improve idea, but currently the question set generator prompt has
 * direction like improve, you get a confusing question set."*
 *
 * "improve" was baked in at THREE sites and only one of them produces the
 * reported symptom:
 *
 *   1. AIScenarioBuilder.jsx's six hardcoded scenario TYPES, every one of them
 *      reflection-shaped, with no vocabulary anywhere for "here is somebody
 *      else's material". A topic catalogue, not a defect in itself.
 *   2. populate-generation-prompts.js's seeded basePrompt for
 *      gen-call-and-answer-lessons-learned, which becomes the FIRST instruction
 *      the model reads (ai-generate-scenarios.js buildPrompt), with the
 *      operator's own text appended far below as "Additional Requirements".
 *      House instruction leads, operator's follows — which is why typing an
 *      Apply brief into the details box never changed the shape of the output.
 *   3. generateCustomInstructions() in the browser, keyed on scenario TYPE,
 *      falling back to "share your experiences and insights" for every type
 *      outside its map of six. The importer stamps that onto every question and
 *      the room reads it during ASK. THAT is the reported symptom, and it is
 *      covered by __tests__/roundKinds.test.js on the frontend side.
 *
 * This file covers the backend halves: (2), the CSV contract, and the writers.
 *
 * WHAT IS ASSERTED HERE AND NOWHERE ELSE:
 *   - the direction reaches the prompt AHEAD of the topic, because first is
 *     what a model follows;
 *   - `custom` renders the operator's brief VERBATIM and never as a key;
 *   - trivia and wavelength get NO direction block, because a direction written
 *     for discussion rounds is a new way to confuse a generator;
 *   - the `detail` ceiling moves with the kind, in BOTH the prose limits and
 *     the tool schema, because a model reading 350 in one and 900 in the other
 *     obeys whichever it read last;
 *   - an unknown kind is refused with a 400 by both writers;
 *   - the two copies of the vocabulary — lambda and frontend — agree.
 *
 * Drives the REAL handlers with Bedrock and DynamoDB stubbed, following
 * tests/scenario-generation-job.js.
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK by module name before any handler loads --------------
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

const ddb = new Map();
const rowKey = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class DeleteCommand { constructor(input) { this.kind = 'delete'; this.input = input; } }
class ScanCommand { constructor(input) { this.kind = 'scan'; this.input = input; } }
class BatchWriteCommand { constructor(input) { this.kind = 'batchWrite'; this.input = input; } }

/** Minimal `SET a = :x, #n = :y` applier — enough for the rows these handlers write. */
function applyUpdate(item, input) {
  const expr = String(input.UpdateExpression).replace(/^SET\s+/i, '');
  for (const part of expr.split(/,\s*(?![^(]*\))/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    if (!rhs) continue;
    const name = (input.ExpressionAttributeNames || {})[lhs.trim()] || lhs.trim();
    const values = input.ExpressionAttributeValues || {};
    const listAppend = rhs.trim().match(/^list_append\(\s*if_not_exists\(([^,]+),\s*([^)]+)\)\s*,\s*(\S+)\s*\)$/);
    if (listAppend) {
      const existing = item[(input.ExpressionAttributeNames || {})[listAppend[1].trim()] || listAppend[1].trim()];
      item[name] = [...(Array.isArray(existing) ? existing : values[listAppend[2].trim()]), ...values[listAppend[3].trim()]];
      continue;
    }
    item[name] = values[rhs.trim()];
  }
}

const docClient = {
  send: async (cmd) => {
    const { Key, Item } = cmd.input;
    if (cmd.kind === 'get') return { Item: ddb.get(rowKey(Key.PK, Key.SK)) || undefined };
    if (cmd.kind === 'put') { ddb.set(rowKey(Item.PK, Item.SK), { ...Item }); return {}; }
    if (cmd.kind === 'delete') { ddb.delete(rowKey(Key.PK, Key.SK)); return {}; }
    if (cmd.kind === 'update') {
      const k = rowKey(Key.PK, Key.SK);
      const existing = ddb.get(k) || { ...Key };
      applyUpdate(existing, cmd.input);
      ddb.set(k, existing);
      return { Attributes: existing };
    }
    if (cmd.kind === 'batchWrite') {
      const reqs = cmd.input.RequestItems['engage-test'] || [];
      for (const r of reqs) {
        if (r.PutRequest) ddb.set(rowKey(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
        else if (r.DeleteRequest) ddb.delete(rowKey(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.kind === 'query') {
      const v = cmd.input.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'];
      const prefix = v[':sk'] ?? v[':questionPrefix'];
      let items = [...ddb.values()].filter((i) => i.PK === pk);
      if (prefix) items = items.filter((i) => String(i.SK).startsWith(prefix));
      items.sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => docClient },
  GetCommand, PutCommand, UpdateCommand, QueryCommand,
  DeleteCommand, ScanCommand, BatchWriteCommand,
});

// ---- Bedrock --------------------------------------------------------------
const bedrockCalls = [];
let bedrockHandler = null;

const toolResponse = (items) => ({
  body: new TextEncoder().encode(JSON.stringify({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'emit_items', input: { items } }],
  })),
});

const makeItems = (n, seed = 'item') => Array.from({ length: n }, (_, i) => ({
  title: `${seed} title ${i + 1}`,
  category: 'General',
  detail: `${seed} detail ${i + 1}`,
  customInstructions: 'Answer it.',
  tags: ['alpha', 'beta', 'gamma'],
}));

class InvokeModelCommand {
  constructor(input) { this.input = input; }
}
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      const body = JSON.parse(cmd.input.body);
      bedrockCalls.push({ prompt: body.messages[0].content, tools: body.tools });
      return bedrockHandler ? bedrockHandler(cmd) : toolResponse(makeItems(2));
    }
  },
  InvokeModelCommand,
});

stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(input) { this.input = input; } },
});

const scenarios = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js'));
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;
const download = require(path.join(REPO, 'lambda-functions/admin/download-question-set.js')).handler;
const editSet = require(path.join(REPO, 'lambda-functions/admin/edit-question-set.js')).handler;
const kinds = require(path.join(REPO, 'lambda-functions/admin/shared/round-kinds.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); passed++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); failed++; }
}

const parse = (res) => JSON.parse(res.body);
const adminContext = () => ({
  requestContext: {
    authorizer: { lambda: { username: 'ada', userId: 'sub-ada', groups: 'admins', status: 'enabled' } },
  },
});
const ctx = () => ({ functionName: 'gen', getRemainingTimeInMillis: () => 900000 });

function reset() {
  ddb.clear();
  bedrockCalls.length = 0;
  bedrockHandler = null;
}

/** Run the worker directly and return the prompt of its first Bedrock call. */
async function promptFor(payload) {
  reset();
  await scenarios.handler({ __workerMode: true, jobId: 'job-1', payload }, ctx());
  assert.ok(bedrockCalls.length > 0, 'the worker made no Bedrock call');
  return bedrockCalls[0];
}

(async () => {
  say('\nround kind: the vocabulary is one vocabulary');

  await test('the lambda copy and the frontend copy have not drifted', () => {
    // rejects: editing one copy of round-kinds and not the other, which would
    // let the picker promise a direction the generator does not send. The two
    // are duplicated because lambda bundles are per-directory, not because
    // either is authoritative.
    const front = fs.readFileSync(path.join(REPO, 'src/src/config/roundKinds.js'), 'utf8');
    for (const id of kinds.ROUND_KIND_IDS) {
      const k = kinds.ROUND_KINDS[id];
      assert.ok(front.includes(`id: '${id}'`), `frontend copy is missing the ${id} kind`);
      assert.ok(front.includes(k.label), `frontend copy is missing ${id}'s label "${k.label}"`);
      assert.ok(front.includes(k.blurb), `frontend copy is missing ${id}'s picker blurb`);
      assert.ok(front.includes(k.handThem), `frontend copy is missing ${id}'s "you hand them" line`);
      if (k.participantInstruction) {
        assert.ok(front.includes(k.participantInstruction),
          `frontend copy is missing ${id}'s participant instruction — the picker would promise one thing and the set would say another`);
      }
      if (k.direction) {
        // The direction is the generator contract. Compare the whole block.
        assert.ok(front.includes(k.direction.split('\n')[0]),
          `frontend copy is missing ${id}'s generator direction`);
      }
      assert.ok(front.includes(`${id}: ${kinds.DETAIL_CEILINGS[id]}`),
        `frontend copy disagrees about ${id}'s detail ceiling`);
    }
  });

  await test('the enum is closed and unknown values do not become a sixth kind', () => {
    // rejects: turning normalizeRoundKind into a pass-through, which is what
    // makes operator free text a KEY and every exhaustive switch downstream
    // silently wrong.
    assert.strictEqual(kinds.normalizeRoundKind('APPLY'), 'apply');
    assert.strictEqual(kinds.normalizeRoundKind('  judge '), 'judge');
    assert.strictEqual(kinds.normalizeRoundKind('reflect'), null);
    assert.strictEqual(kinds.normalizeRoundKind(''), null);
    assert.deepStrictEqual(kinds.ROUND_KIND_IDS, ['produce', 'apply', 'improve', 'judge', 'custom']);
  });

  await test('absent reads as produce and nothing is backfilled', () => {
    // rejects: defaulting to `improve` because the generator was improve-shaped.
    // Every set in the library hands the room a prompt and the room supplies the
    // material; that is Produce, and it is a fact about them, not a guess.
    assert.strictEqual(kinds.resolveRoundKind(undefined), 'produce');
    assert.strictEqual(kinds.resolveRoundKind(''), 'produce');
    assert.strictEqual(kinds.resolveRoundKind('nonsense'), 'produce');
  });

  say('\nthe generator is steered by direction, not by topic');

  await test('an apply round carries the Apply direction and does not lead with the topic', async () => {
    // rejects: appending the direction after template.basePrompt, or leaving it
    // out entirely. basePrompt is a TOPIC and it used to be the first thing the
    // model read; first is what a model follows, which is the whole reason an
    // Apply request came back Improve-shaped.
    const call = await promptFor({
      scenarioType: 'lessons-learned',
      engagementType: 'call-and-answer',
      prompt: 'Create scenarios based on common workplace challenges and the lessons learned from them',
      count: 2,
      roundKind: 'apply',
    });
    assert.match(call.prompt, /ROUND KIND: APPLY/, 'no Apply direction in the prompt');
    assert.match(call.prompt, /SOMEBODY ELSE'S material/);
    assert.match(call.prompt, /NAME ITS\s+ORIGIN/, 'Apply must require the material to name where it came from');

    const directionAt = call.prompt.indexOf('ROUND KIND: APPLY');
    const topicAt = call.prompt.indexOf('lessons learned');
    assert.ok(topicAt > -1, 'the topic vanished — this test would pass vacuously');
    assert.ok(directionAt < topicAt,
      'the topic still leads the prompt; the direction has to come first or it is ignored');
  });

  await test('an apply round does not tell the model to write from the room\'s own experience', async () => {
    // rejects: leaving the Produce framing in place for every kind. "Answerable
    // from the room's own memory" is precisely wrong for a round that just
    // handed people a passage.
    const call = await promptFor({
      scenarioType: 'custom', engagementType: 'call-and-answer', count: 2, roundKind: 'apply',
    });
    assert.ok(!/PRODUCE/.test(call.prompt), 'the Produce direction leaked into an Apply round');
    assert.ok(!/own experience/i.test(call.prompt.split('TOPIC:')[0]),
      'the Apply direction still asks for the room\'s own experience');
  });

  await test('improve and apply are told apart by OWNERSHIP, not by mechanics', async () => {
    // rejects: collapsing the two into one "work on this material" direction.
    // They are mechanically identical and differ only in who wrote the thing —
    // which is exactly why a generator that cannot tell them apart writes the
    // wrong questions for one of them.
    const apply = await promptFor({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, roundKind: 'apply' });
    const improve = await promptFor({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, roundKind: 'improve' });
    assert.match(apply.prompt, /nobody in this\s+room wrote it/);
    assert.match(improve.prompt, /OUR OWN material/);
    assert.match(improve.prompt, /ACTUAL ARTEFACT/, 'Improve must demand the real wording, not a description');
    assert.ok(!/OUR OWN material/.test(apply.prompt), 'the Apply direction claims the material is ours');
    assert.ok(!/nobody in this/.test(improve.prompt), 'the Improve direction claims the material is foreign');
  });

  await test('a judge round forbids the repair question outright', async () => {
    // rejects: describing Judge as "evaluate it" and stopping there. Without the
    // explicit prohibition a model reliably drifts into "how would you improve
    // this", and the room then never states the verdict the round exists for.
    const call = await promptFor({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, roundKind: 'judge' });
    assert.match(call.prompt, /DO NOT ask "how would you improve this"/);
    assert.match(call.prompt, /CRITERION/);
  });

  await test('custom renders the operator brief VERBATIM and never as a key', async () => {
    // rejects: interpolating operator text into a lookup, a switch or a
    // template id. The enum stays closed precisely so this stays prose.
    const brief = 'Hand them two competing funding proposals and ask which they would back.';
    const call = await promptFor({
      scenarioType: 'custom', engagementType: 'call-and-answer', count: 1,
      roundKind: 'custom', roundKindBrief: brief,
    });
    assert.ok(call.prompt.includes(brief), 'the operator brief did not reach the prompt');
    assert.ok(!/ROUND KIND: CUSTOM\b/.test(call.prompt),
      'custom must not render a house direction of its own — the brief occupies that position');
    for (const other of ['PRODUCE', 'APPLY', 'IMPROVE', 'JUDGE']) {
      assert.ok(!call.prompt.includes(`ROUND KIND: ${other}`), `a ${other} direction leaked into a custom round`);
    }
  });

  await test('custom with an empty brief adds no direction rather than an empty one', async () => {
    // rejects: emitting a "ROUND KIND:" header with nothing under it, which
    // reads to a model as an instruction that was cut off.
    const call = await promptFor({
      scenarioType: 'custom', engagementType: 'call-and-answer', count: 1,
      roundKind: 'custom', roundKindBrief: '   ',
    });
    assert.ok(!/ROUND KIND/.test(call.prompt), 'an empty custom brief still produced a direction header');
  });

  await test('an unknown kind generates as Produce AND says so in the warnings', async () => {
    // rejects: silently resolving an unknown kind, which would let a typo in a
    // stored set produce Produce questions for a year without anyone noticing.
    // The worker cannot 400 — it is already off the request — so it warns.
    reset();
    await scenarios.handler({
      __workerMode: true,
      jobId: 'job-warn',
      payload: { scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, roundKind: 'reflect' },
    }, ctx());
    const job = ddb.get(rowKey('AIJOBS', 'AIJOB#job-warn'));
    assert.ok(job, 'no job row was written');
    assert.ok((job.warnings || []).some((w) => /not a round kind/.test(w)),
      `the unknown kind was swallowed: ${JSON.stringify(job.warnings)}`);
  });

  say('\nthe direction reaches only the engagement types it means anything for');

  await test('trivia and wavelength get no direction block at all', async () => {
    // rejects: applying the round kind to every game type. Trivia has a correct
    // answer, so "invention" and "verdict" are meaningless for it; wavelength
    // hands the room a bare subject and no material whatsoever. Steering those
    // with a direction written for discussion rounds is a NEW way to confuse a
    // generator, which is the defect this slice repairs.
    for (const engagementType of ['trivia', 'wavelength']) {
      const call = await promptFor({
        scenarioType: 'custom', engagementType, count: 2, roundKind: 'apply',
      });
      assert.ok(!/ROUND KIND/.test(call.prompt),
        `a round-kind direction reached a ${engagementType} prompt`);
    }
  });

  await test('a call-and-answer prompt with no kind is byte-identical to what it always was', async () => {
    // rejects: making every existing generation drift as a side effect. A set
    // that never chose a direction is Produce, and Produce's direction is a
    // real instruction — but the OPENING LINE must not gain a "TOPIC:" label
    // for callers that send no kind at all, or every trivia and wavelength
    // prompt in the product changes for no reason.
    const call = await promptFor({
      scenarioType: 'custom', engagementType: 'trivia', count: 3,
      prompt: 'TOPIC-BASE-PROMPT',
    });
    assert.ok(call.prompt.startsWith('Create 3 scenarios. TOPIC-BASE-PROMPT'),
      `the opening line drifted: ${JSON.stringify(call.prompt.slice(0, 80))}`);
  });

  await test('a poll round is steered by the direction too', async () => {
    // rejects: wiring only the scenario generator. A poll set carries a
    // roundKind, the editor's picker offers one for polls, and personas are
    // specified for ['call-and-answer','poll'] — so a poll generator that
    // ignores the direction is a HALF-WIRED enum: the picker promises a
    // direction the questions were never given.
    const polls = require(path.join(REPO, 'lambda-functions/admin/ai-generate-polls.js'));
    reset();
    await polls.handler({
      __workerMode: true,
      jobId: 'job-poll',
      payload: { topic: 'release readiness', count: 2, roundKind: 'judge' },
    }, ctx());
    assert.ok(bedrockCalls.length > 0, 'the poll worker made no Bedrock call');
    const prompt = bedrockCalls[0].prompt;
    assert.match(prompt, /ROUND KIND: JUDGE/, 'no direction reached the poll prompt');
    assert.match(prompt, /DO NOT ask "how would you improve this"/);
    // The poll builder's "topic" is the OPERATOR'S own words, not a house
    // basePrompt, so there is no house instruction to get in front of here.
    // What must hold is that the direction precedes the length limits, which
    // are appended last and are read most heavily.
    assert.ok(prompt.indexOf('ROUND KIND: JUDGE') < prompt.indexOf('LENGTH LIMITS'),
      'the direction landed after the length limits, where it will be overruled');
  });

  await test('a poll Apply round raises its detail ceiling in prompt AND schema', async () => {
    // rejects: raising it for scenarios and leaving polls at 300. A poll whose
    // options are readings of a passage is unanswerable if the passage does not
    // fit in `detail`.
    const polls = require(path.join(REPO, 'lambda-functions/admin/ai-generate-polls.js'));
    reset();
    await polls.handler({
      __workerMode: true,
      jobId: 'job-poll-2',
      payload: { topic: 'a rival post-incident review', count: 1, roundKind: 'apply' },
    }, ctx());
    assert.match(bedrockCalls[0].prompt, /detail: 3-8 sentences, 900 characters maximum/);
    const detail = bedrockCalls[0].tools[0].input_schema.properties.items.items.properties.detail.description;
    assert.match(detail, /900 characters maximum/, `poll schema still says: ${detail}`);
  });

  say('\nthe length ceiling moves with the kind, in BOTH statements of it');

  await test('apply raises the detail ceiling in the prose limits', async () => {
    // rejects: leaving lengthGuidance at a flat 350. It is appended LAST, and a
    // model weights the most recent formatting instruction most heavily, so a
    // flat 350 quietly wins the argument with an Apply direction that needs the
    // material carried — and Apply loses, silently.
    const call = await promptFor({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, roundKind: 'apply' });
    assert.match(call.prompt, /detail: 3-8 sentences, 900 characters maximum/);
    assert.ok(!/350 characters maximum/.test(call.prompt), 'the old 350 ceiling is still in the prompt');
    assert.match(call.prompt, /do not pad to reach a limit/,
      'a raised ceiling without this line is read as a target, which is worse than the old limit');
  });

  await test('the tool schema states the SAME ceiling as the prose', async () => {
    // rejects: raising one and not the other. The schema description and the
    // length block are two statements of one instruction; a model that reads
    // 900 in one and 350 in the other obeys whichever it read last, which makes
    // the behaviour depend on nothing anybody chose.
    const call = await promptFor({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, roundKind: 'improve' });
    const detail = call.tools[0].input_schema.properties.items.items.properties.detail.description;
    assert.match(detail, /900 characters maximum/, `schema still says: ${detail}`);
  });

  await test('produce keeps 350 — the ceiling is what stopped the 8,500-character scenarios', async () => {
    // rejects: raising the ceiling for every kind because it was raised for two.
    // Produce's `detail` is framing, not source material, and the unbounded
    // version of it is the original latency and truncation bug.
    const call = await promptFor({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 1, roundKind: 'produce' });
    assert.match(call.prompt, /detail: 2-4 sentences, 350 characters maximum/);
  });

  say('\nthe writers refuse an unknown kind, which is where a refusal can still help');

  await test('upload-questions 400s an unknown set-level kind', async () => {
    // rejects: accepting free text on the create path. A typo stored on the SETS
    // row is a sixth kind that every exhaustive switch downstream misses.
    reset();
    const res = await upload({
      ...adminContext(),
      body: JSON.stringify({
        fileName: 'x.csv',
        fileContent: 'Category,Title\n"General","A question"',
        customTitle: 'Bad Kind Set',
        engagementType: 'call-and-answer',
        roundKind: 'reflect',
      }),
    });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /Unknown round kind "reflect"/);
    assert.match(parse(res).error, /produce, apply, improve, judge, custom/);
  });

  await test('edit-question-set 400s an unknown kind and accepts a known one', async () => {
    // rejects: dropping roundKind into OPTIONAL_FIELDS beside the free-text
    // ones. It is an ENUM and gets engagementType's validated branch; only the
    // free-text roundKindBrief belongs in OPTIONAL_FIELDS.
    reset();
    ddb.set(rowKey('SETS', 'SET#s1'), {
      PK: 'SETS', SK: 'SET#s1', name: 'A set', createdBy: 'sub-ada',
    });
    const bad = await editSet({
      ...adminContext(), pathParameters: { setId: 's1' },
      body: JSON.stringify({ name: 'A set', roundKind: 'reflect' }),
    });
    assert.strictEqual(bad.statusCode, 400, bad.body);
    assert.match(parse(bad).error, /Unknown round kind/);
    assert.strictEqual(ddb.get(rowKey('SETS', 'SET#s1')).roundKind, undefined,
      'a refused kind was written anyway');

    const good = await editSet({
      ...adminContext(), pathParameters: { setId: 's1' },
      body: JSON.stringify({ name: 'A set', roundKind: 'JUDGE' }),
    });
    assert.strictEqual(good.statusCode, 200, good.body);
    assert.strictEqual(ddb.get(rowKey('SETS', 'SET#s1')).roundKind, 'judge',
      'the kind was not normalised on the way in');
    assert.strictEqual(parse(good).updated.roundKind, 'judge',
      'the save must echo what landed, or a no-op looks identical to a save');
  });

  await test('an over-long custom brief is refused rather than truncated', async () => {
    // rejects: storing 5,000 characters of operator prose that then gets
    // rendered into every generation prompt for that set.
    reset();
    ddb.set(rowKey('SETS', 'SET#s2'), { PK: 'SETS', SK: 'SET#s2', name: 'B', createdBy: 'sub-ada' });
    const res = await editSet({
      ...adminContext(), pathParameters: { setId: 's2' },
      body: JSON.stringify({ name: 'B', roundKindBrief: 'x'.repeat(kinds.MAX_ROUND_KIND_BRIEF + 1) }),
    });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /limit is 500/);
  });

  await test('a set that never chose a kind stores no roundKind attribute', async () => {
    // rejects: backfilling `produce` onto everything, which destroys the only
    // signal separating "the author chose Produce" from "nobody was ever asked"
    // — and makes the no-migration decision a migration.
    reset();
    const res = await upload({
      ...adminContext(),
      body: JSON.stringify({
        fileName: 'plain.csv',
        fileContent: 'Category,Title\n"General","A question"',
        customTitle: 'Plain Set',
        engagementType: 'call-and-answer',
      }),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const row = ddb.get(rowKey('SETS', `SET#${parse(res).setId}`));
    assert.ok(!('roundKind' in row), `roundKind was written unasked: ${row.roundKind}`);
  });

  say('\nthe CSV columns survive, and only appear when the set uses them');

  await test('a per-question RoundKind that is not one of the five fails the whole import', async () => {
    // rejects: skipping the bad row, or dropping the cell and inheriting. Both
    // leave a question quietly carrying a direction its author explicitly tried
    // to change — the exact failure this slice exists to stop. The refusal is
    // whole-file because a half-applied direction is worse than none.
    reset();
    const res = await upload({
      ...adminContext(),
      body: JSON.stringify({
        fileName: 'k.csv',
        fileContent: [
          'Category,Title,RoundKind',
          '"General","Good one","apply"',
          '"General","Bad one","reflect"',
        ].join('\n'),
        customTitle: 'Kinded Set',
        engagementType: 'call-and-answer',
      }),
    });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /row 3 \("reflect"\)/);
    assert.strictEqual([...ddb.values()].filter((i) => String(i.SK).startsWith('QUESTION#')).length, 0,
      'a refused import still wrote question rows');
  });

  await test('an ordinary set\'s CSV grows no new columns', async () => {
    // rejects: emitting RoundKind and SourceAttribution unconditionally. Forty-
    // one sets would gain two empty columns in every download, and the
    // conditional-column pattern exists precisely so they do not.
    reset();
    const created = await upload({
      ...adminContext(),
      body: JSON.stringify({
        fileName: 'plain.csv',
        fileContent: 'Category,Question#,Title,Detail_lesson\n"General",1,"A question","Some framing."',
        customTitle: 'Ordinary Set',
        engagementType: 'call-and-answer',
      }),
    });
    const setId = parse(created).setId;
    const csv = parse(await download({ pathParameters: { setId }, queryStringParameters: {} })).content;
    const header = csv.split('\n')[0];
    assert.ok(!/RoundKind/.test(header), `header gained a RoundKind column: ${header}`);
    assert.ok(!/SourceAttribution/.test(header), `header gained a SourceAttribution column: ${header}`);
  });

  say(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
