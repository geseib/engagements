/**
 * The three gates that keep a nonexistent `{variable}` out of a prompt.
 *
 * The owner's complaint: "the AI generator that assists with creation will put
 * in all kinds of nonexistent variables, so the Prompt doesn't work."
 *
 * The cause was never the chip palette. It was that `ai-generate-prompt.js`
 * looked its variable list up in a table keyed by the LEGACY spellings while
 * the editor sends the dashed ones, so for call-and-answer, poll and survey the
 * lookup missed, the list came back `[]`, and the model was handed
 *
 *     AVAILABLE TEMPLATE VARIABLES:
 *     <nothing>
 *     ...
 *     6. Include appropriate template variables from the available list
 *
 * With no list and an instruction to use one, a model invents. Meanwhile the
 * advisor was asked to "validate variable usage" having been told nothing, and
 * the one game type whose row DID match named five variables that do not exist.
 *
 * So: the wand and the advisor are given the real catalogue (gate 0, the fix),
 * the save handlers reject an uncatalogued token by name (gate 1, the one that
 * matters — both AI helpers pass through it), and the runtime reports whatever
 * still slips past instead of quietly printing `{braces}` on a projector
 * (gate 2).
 *
 * Everything below drives the REAL handlers with the AWS SDK stubbed. Bedrock
 * records the prompt it is handed, because the prompt is the artefact.
 */
const path = require('path');
const assert = require('assert');

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

const ddb = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => ddb.set(key(item.PK, item.SK), item);
const written = [];

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'get': return { Item: ddb.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'put': written.push(inp.Item); put(inp.Item); return {};
      case 'delete': ddb.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...ddb.values()].filter(
          (i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      case 'scan': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...ddb.values()].filter((i) =>
          (v[':pk'] === undefined || i.PK === v[':pk']) &&
          (v[':isDefault'] === undefined || i.isDefault === v[':isDefault']));
        return { Items: items, Count: items.length };
      }
      default: return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

const s3Store = new Map();
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.type === 'put') { s3Store.set(cmd.input.Key, cmd.input.Body); return {}; }
      if (cmd.type === 'get') {
        const body = s3Store.get(cmd.input.Key);
        if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: { transformToString: async () => body } };
      }
      return {};
    }
  },
  PutObjectCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; this.type = 'list'; } },
});

// Bedrock never runs a model here. It records the prompt and replies with
// whatever the current case needs.
let bedrockCalls = [];
let bedrockReply = '{"instructions":"i","outputFormat":"o"}';
/* A scripted sequence of replies, for the cases where a handler is expected to
   call the model MORE THAN ONCE and the second answer has to differ from the
   first. Empty means "answer every call with bedrockReply", which is what every
   case above this one wants. */
let bedrockQueue = [];
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      const body = JSON.parse(cmd.input.body);
      const content = body.messages[0].content;
      bedrockCalls.push(typeof content === 'string' ? content : content[0].text);
      const text = bedrockQueue.length ? bedrockQueue.shift() : bedrockReply;
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text }] })) };
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-fn';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const generatePrompt = admin('ai-generate-prompt.js');
const advisor = admin('ai-prompt-advisor.js');
const createPrompt = admin('create-ai-prompt.js');
const updatePrompt = admin('update-ai-prompt.js');
const summary = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try {
    const r = fn();
    assert(!(r && typeof r.then === 'function'), 'check() takes a synchronous assertion — use acheck()');
    console.log(`  PASS  ${label}`); pass++;
  } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
async function acheck(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const realLog = console.log;
const realWarn = console.warn;
const realErr = console.error;
const quiet = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => { console.log = realLog; console.warn = realWarn; console.error = realErr; };

/** Run the wand and return { res, prompt } — the prompt Bedrock was handed. */
async function wand(body) {
  bedrockCalls = [];
  quiet();
  const res = await generatePrompt.handler({ body: JSON.stringify(body) });
  loud();
  return { res, prompt: bedrockCalls[0], calls: bedrockCalls.length };
}

async function advise(body) {
  bedrockCalls = [];
  bedrockReply = '```json\n{"overallScore":8}\n```';
  quiet();
  const res = await advisor.handler({ body: JSON.stringify(body) });
  loud();
  bedrockReply = '{"instructions":"i","outputFormat":"o"}';
  return { res, prompt: bedrockCalls[0] };
}

/**
 * An ADMIN caller, in this API's real event shape.
 *
 * `PUT /admin/ai-prompts/{promptId}` is admins-only at the authorizer and,
 * since the tenancy fix, ownership-checked again inside the handler
 * (`canManagePrompt`, shared/prompt-access.js) — platform passes on the scope
 * alone, which needs the `admins` group and no active org. `goodId` below is
 * created with no caller at all, which create-ai-prompt.js's internal-
 * invocation seam routes to platform, so this is that administrator.
 */
const ADMIN = {
  requestContext: { authorizer: { lambda: {
    userId: 'sub-admin', username: 'admin', groups: 'admins', status: 'enabled',
  } } },
};
const post = async (body) => {
  quiet();
  const r = await createPrompt.handler({ body: JSON.stringify(body) });
  loud();
  return r;
};
const putUpdate = async (promptId, body) => {
  quiet();
  const r = await updatePrompt.handler({
    ...ADMIN,
    pathParameters: { promptId },
    body: JSON.stringify(body),
  });
  loud();
  return r;
};

(async () => {
  realLog('Prompt variable gates: the wand, the advisor, the save path, the runtime\n');

  // === GATE 0a — the wand is told the truth ================================
  realLog('  -- gate 0a: the AI generator gets a real, game-type-correct list --\n');

  for (const gameType of ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey']) {
    // eslint-disable-next-line no-await-in-loop
    const { res, prompt } = await wand({ gameType, category: 'general' });
    await acheck(`${gameType}: the wand succeeds and names real variables`, async () => {
      assert.strictEqual(res.statusCode, 200, res.body);
      assert(prompt, 'Bedrock was never called');
      const listed = [...prompt.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)].map((m) => m[1]);
      assert(listed.length > 0,
        'the list under "AVAILABLE TEMPLATE VARIABLES:" is empty — this is the exact ' +
        'condition under which the model invents variables');
      assert(listed.includes('questionTitle'), `no questionTitle in: ${listed.join(', ')}`);
    });
  }

  const poll = await wand({ gameType: 'poll', category: 'opinion' });
  await acheck('a poll prompt is told about {pollOptions}', async () =>
    assert(poll.prompt.includes('{pollOptions}'),
      'a poll author could not reference the options at all before this'));

  await acheck('a poll prompt is NOT told about trivia-only variables', async () =>
    assert(!poll.prompt.includes('{correctAnswer}'),
      'offering correctAnswer for a poll invites a variable that resolves to nothing'));

  const wl = await wand({ gameType: 'wavelength', category: 'general' });
  await acheck('the five phantom wavelength variables are never offered', async () => {
    for (const ghost of ['wordFrequency', 'uniqueWords', 'wordStats', 'conceptualThemes', 'customInstructions']) {
      assert(!wl.prompt.includes(`{${ghost}}`),
        `${ghost} was in the old hardcoded wavelength row and has never existed`);
    }
    assert(wl.prompt.includes('{commonWords}'), 'wavelength must still get its real variables');
  });

  await acheck('the legacy spelling still resolves rather than yielding an empty list', async () => {
    const { res, prompt } = await wand({ gameType: 'callandanswer', category: 'lessons-learned' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert(prompt.includes('{responsesText}'),
      'rows authored under the old spelling must normalise, not fall through to []');
  });

  await acheck('an unknown game type fails loudly instead of yielding []', async () => {
    const { res, calls } = await wand({ gameType: 'banana', category: 'general' });
    assert.strictEqual(res.statusCode, 400, `expected a 400, got ${res.statusCode}: ${res.body}`);
    assert(/banana/.test(res.body), `the error must name the type it rejected: ${res.body}`);
    assert.strictEqual(calls, 0,
      'a model must never be asked to write a prompt for a type we have no variables for');
  });

  await acheck('the variable block explains what each variable means', async () => {
    const { prompt } = await wand({ gameType: 'trivia', category: 'general' });
    assert(/\{triviaChoices\}[^\n]*—/.test(prompt) || /\{triviaChoices\}[^\n]*-/.test(prompt),
      'a bare name list is what let the model guess at meanings; each entry needs its description');
  });

  // === GATE 0b — the advisor is told the truth ============================
  realLog('\n  -- gate 0b: the advisor can no longer validate variables blind --\n');

  for (const analysisType of ['improve', 'validate', 'optimize']) {
    // eslint-disable-next-line no-await-in-loop
    const { res, prompt } = await advise({
      promptText: '## Summary\n{responsesText}',
      gameType: 'call-and-answer',
      analysisType,
    });
    await acheck(`${analysisType}: the advisor prompt carries the real variable list`, async () => {
      assert.strictEqual(res.statusCode, 200, res.body);
      assert(prompt.includes('{responsesText}') && prompt.includes('{leaderboard}'),
        `the ${analysisType} variant asks the model about variables without listing any`);
    });
  }

  await acheck('the advisor list follows the game type', async () => {
    const { prompt } = await advise({
      promptText: 'x', gameType: 'wavelength', analysisType: 'validate',
    });
    assert(prompt.includes('{commonWords}'), 'wavelength variables missing');
    assert(!prompt.includes('{voteTally}'), 'wavelength never votes');
  });

  await acheck('an unknown game type still gets the full list, never an empty one', async () => {
    const { res, prompt } = await advise({ promptText: 'x', analysisType: 'improve' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert(prompt.includes('{questionTitle}') && prompt.includes('{commonWords}'),
      'with no game type to filter on, show everything — an advisor with no list is the bug');
  });

  // === GATE 1 — the save path, the gate both AI helpers pass through =======
  realLog('\n  -- gate 1: save time --\n');

  await acheck('create rejects an uncatalogued token and names it', async () => {
    const res = await post({
      name: 'Invented Variables',
      gameType: 'wavelength',
      promptType: 'analysis',
      instructions: 'Analyse the words.',
      outputFormat: '## Summary\n{wordFrequency} and {conceptualThemes}',
    });
    assert.strictEqual(res.statusCode, 500, res.body);
    assert(/wordFrequency/.test(res.body) && /conceptualThemes/.test(res.body),
      `the author has to be told WHICH tokens are wrong: ${res.body}`);
  });

  await acheck('create rejects an invented token in instructions, not just outputFormat', async () => {
    const res = await post({
      name: 'Invented In Instructions',
      gameType: 'trivia',
      promptType: 'analysis',
      instructions: 'You are given {vibeCheck}.',
      outputFormat: '## Summary\n{leaderboard}',
    });
    assert.strictEqual(res.statusCode, 500, res.body);
    assert(/vibeCheck/.test(res.body), res.body);
  });

  await acheck('create rejects an invented token in a legacy single-field template', async () => {
    const res = await post({
      name: 'Legacy Template',
      gameType: 'call-and-answer',
      promptType: 'analysis',
      template: 'Summarise {responsesText} and {teamVibes}.',
    });
    assert.strictEqual(res.statusCode, 500, res.body);
    assert(/teamVibes/.test(res.body), res.body);
  });

  let goodId = null;
  await acheck('create accepts a prompt whose tokens all resolve', async () => {
    const res = await post({
      name: 'Honest Prompt',
      gameType: 'call-and-answer',
      promptType: 'analysis',
      category: 'lessons-learned',
      instructions: 'Summarise {responsesText}.',
      outputFormat: '## Summary\n{winnerInfo}\n{leaderboard}',
    });
    assert.strictEqual(res.statusCode, 201, res.body);
    goodId = JSON.parse(res.body).promptId;
  });

  await acheck('create accepts an INTERNAL variable — live prompts use them', async () => {
    const res = await post({
      name: 'Uses Internal Aliases',
      gameType: 'trivia',
      promptType: 'analysis',
      // {triviaResponses} keeps the fixture clean under the receives-responses
      // guard (tests/prompt-save-guards.js) — the aliases are what is under test.
      instructions: 'There were {totalPlayers} players in {gameContext}.',
      outputFormat: '## Summary\n{triviaResponses}\n{triviaCorrectness}',
    });
    assert.strictEqual(res.statusCode, 201,
      `totalPlayers and gameContext resolve; a gate built off the advertised list alone ` +
      `would reject working prompts: ${res.body}`);
  });

  await acheck('create does NOT apply the analysis vocabulary to a generation prompt', async () => {
    const res = await post({
      name: 'Poll Generator',
      gameType: 'poll',
      promptType: 'generation',
      basePrompt: 'Generate poll questions about {context} for {audience}.',
      outputFormat: 'A JSON array',
    });
    assert.strictEqual(res.statusCode, 201,
      `generation prompts use an entirely different vocabulary; validating them here ` +
      `would break every one of them: ${res.body}`);
  });

  await acheck('create accepts a prompt containing a JSON example', async () => {
    const res = await post({
      name: 'Shows JSON',
      gameType: 'trivia',
      promptType: 'analysis',
      // {triviaResponses}: same reason as the aliases fixture above.
      instructions: 'Reply as { "verdict": "..." } — no other keys. Judge {triviaResponses}.',
      outputFormat: '## Summary\n{triviaCorrectness}',
    });
    assert.strictEqual(res.statusCode, 201,
      `a braced JSON example is not a template variable: ${res.body}`);
  });

  await acheck('THE LIVE PROMPT: sets/prompt-trivia-vj.json is accepted unchanged', async () => {
    const live = JSON.parse(
      require('fs').readFileSync(path.join(REPO, 'sets', 'prompt-trivia-vj.json'), 'utf8'));
    const res = await post(live);
    assert.strictEqual(res.statusCode, 201,
      `this prompt is installed and working in dev. A rejection means the CATALOGUE is ` +
      `wrong, not the prompt: ${res.body}`);
  });

  await acheck('update rejects an uncatalogued token and names it', async () => {
    const res = await putUpdate(goodId, { outputFormat: '## Summary\n{groupMood}' });
    assert.strictEqual(res.statusCode, 500, res.body);
    assert(/groupMood/.test(res.body), res.body);
  });

  await acheck('update still accepts an honest edit', async () => {
    const res = await putUpdate(goodId, { outputFormat: '## Summary\n{topVotedAnswers}' });
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  await acheck('update leaves fields it was not given alone', async () => {
    const res = await putUpdate(goodId, { description: 'just a description edit' });
    assert.strictEqual(res.statusCode, 200,
      `validating fields the caller never sent would make a prompt uneditable: ${res.body}`);
  });

  // === GATE 2 — the runtime says what it could not fill ====================
  realLog('\n  -- gate 2: run time --\n');

  const GAME_ID = '7788';
  const SET_ID = 'gateset';
  const PROMPT_ID = 'gate-prompt';

  ddb.clear();
  written.length = 0;
  put({ PK: `GAME#${GAME_ID}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001', LessonNumber: 1 });
  put({ PK: `GAME#${GAME_ID}`, SK: 'METADATA', GameId: GAME_ID, Title: 'Gate Night',
        GameType: 'call-and-answer', QuestionSetId: SET_ID });
  put({ PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#REF',
        SourceQuestionId: 'QUESTION#c#001', SetId: SET_ID, StartedAt: new Date(0).toISOString() });
  put({ PK: `SET#${SET_ID}`, SK: 'QUESTION#c#001', Title: 'A QUESTION', Detail: '', Category: 'General' });
  put({ PK: 'SETS', SK: `SET#${SET_ID}`, setId: SET_ID, name: 'Gate Set', promptId: PROMPT_ID });
  put({ PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#ANSWER#p1', PlayerName: 'Ada', Answer: 'one' });
  put({ PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#ANSWER#p2', PlayerName: 'Ben', Answer: 'two' });
  put({ PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#VOTE#v1', PlayerId: 'p2', Votes: { 0: 1, 1: 2 } });
  put({ PK: `GAME#${GAME_ID}`, SK: 'PLAYER#p1', PlayerId: 'p1', Name: 'Ada', Score: 3 });
  put({ PK: `GAME#${GAME_ID}`, SK: 'PLAYER#p2', PlayerId: 'p2', Name: 'Ben', Score: 1 });
  put({ PK: 'AIPROMPTS', SK: `AIPROMPT#${PROMPT_ID}`, promptId: PROMPT_ID, name: 'Gate Prompt',
        gameType: 'call-and-answer', category: 'lessons-learned', status: 'active', isDefault: true,
        s3Key: `prompts/call-and-answer/${PROMPT_ID}/v1.json` });
  s3Store.set(`prompts/call-and-answer/${PROMPT_ID}/v1.json`, JSON.stringify({
    name: 'Gate Prompt',
    // A prompt that predates the save gate: one real token, two that nothing
    // will ever fill. This is what an AI-generated prompt looked like.
    template: 'Summarise {responsesText}. Weight it by {wordFrequency} and {vibeIndex}.',
  }));

  bedrockReply = '## Summary\nx\n\n## Discussion Questions\n1. y\n\n## Next Steps\n1. z';
  bedrockCalls = [];
  quiet();
  await summary.handler({ __workerMode: true, gameId: GAME_ID, questionId: '001', debug: 'true' });
  loud();
  const stored = written.find((i) => String(i.SK).endsWith('#AISummary'));
  const runtimePrompt = bedrockCalls[0];

  check('the summary was generated at all', () =>
    assert(stored, 'no AISummary item was written — the rest of this section would be vacuous'));

  check('unresolved variables are surfaced in debugInfo', () => {
    const unresolved = stored.DebugInfo && stored.DebugInfo.unresolvedVariables;
    assert(Array.isArray(unresolved),
      'debugInfo.unresolvedVariables is missing; an operator has no way to see why the ' +
      'projector is showing literal braces');
    assert.deepStrictEqual([...unresolved].sort(), ['vibeIndex', 'wordFrequency']);
  });

  check('a variable that DID resolve is not reported as unresolved', () =>
    assert(!(stored.DebugInfo.unresolvedVariables || []).includes('responsesText'),
      'reporting resolved variables would make the list noise and get ignored'));

  check('the unresolved token is still left literal in the prompt', () => {
    assert(runtimePrompt.includes('{wordFrequency}'),
      'stripping it would be a behaviour change on live prompts — the gate LOGS, it does not rewrite');
    assert(!runtimePrompt.includes('{responsesText}'),
      'a real variable must still be substituted');
  });

  /*
    GATE 3: THE WAND IS TOLD EVERY RULE THE SAVE GATE ENFORCES.

    Reported by the owner after generating a prompt and pressing Save: three
    blocking findings and sixteen warnings, on a prompt the product's own wand
    had just written. The wand encoded exactly ONE of the gates — "never invent
    a variable", the one gate 0 above exists for — and knew nothing about the
    rest, while telling the model to "add relevant template variables" with no
    word on WHERE a variable may stand or how often.

    So it produced, reliably:
      - `outputFormat: [Historical Period/Event]`  — three of these, all BLOCKING
      - `Review {playerResponses} and {uniqueAnswers} to ...` — ten variables
        named inside sentences, each inlining its whole value into the rule
      - {scoreChanges} twice, {totalParticipants} and {votingPattern} — variables
        the catalogue itself warns are not what they sound like

    A wand whose output its own save gate refuses is worse than no wand: the
    admin does the work of reading a generated prompt and is then told it cannot
    be kept.

    // rejects: a gate the save path enforces and the wand has never heard of.
  */
  realLog('\nGATE 3: the wand is told every rule the save gate enforces');
  {
    const usage = require(path.join(REPO, 'lambda-functions/admin/shared/template-variable-usage.js'));

    check('the authoring rules are exported at all (guards every check below)', () => {
      assert(Array.isArray(usage.AUTHORING_RULES), 'AUTHORING_RULES is not exported');
      assert(usage.AUTHORING_RULES.length >= 4,
        `only ${(usage.AUTHORING_RULES || []).length} rules — the save gate enforces more than that`);
      assert(typeof usage.describeAuthoringRules === 'function',
        'describeAuthoringRules() is what the wand interpolates');
    });

    /* THE ANTI-DRIFT CHECK. The wand drifted from the gate once already (gate 0
       above is that incident). Every `assert*` the module exports is a rule the
       save path enforces, so every one of them has to be named by a rule the
       wand is given — adding a sixth gate fails here until the wand learns it. */
    check('every gate the save path enforces is named by an authoring rule', () => {
      const gates = Object.keys(usage).filter((k) => /^assert[A-Z]/.test(k));
      assert(gates.length >= 3, `found only ${gates.length} gates — the scanner has rotted`);
      const covered = new Set((usage.AUTHORING_RULES || []).map((r) => r.gate).filter(Boolean));
      const orphans = gates.filter((g) => !covered.has(g));
      assert.deepStrictEqual(orphans, [],
        `these gates reject a prompt the wand was never told about: ${orphans.join(', ')}`);
    });

    const generated = await wand({
      gameType: 'call-and-answer',
      category: 'lessons-learned',
      promptName: 'Historian',
      description: 'Connect the room to a historical moment',
    });

    check('the wand hands the model the rules, not just the variable list', () => {
      for (const rule of usage.AUTHORING_RULES) {
        assert(generated.prompt.includes(rule.text),
          `the model is never told: ${rule.id}`);
      }
    });

    check('square brackets are forbidden in so many words', () => {
      assert(/square bracket/i.test(generated.prompt),
        'the one BLOCKING gate, and the model is not warned about it');
    });

    check('and it is shown a good outputFormat rather than left to invent one', () => {
      // The model falls back on `**Label:** [Description]` when the only
      // example it has is the JSON envelope — which is the blocking failure.
      assert(/EXAMPLE|example of a good/i.test(generated.prompt),
        'no worked example, so the model invents the fill-in-the-blank form');
    });
  }

  /*
    GATE 4: A BRACKETED REPLY NEVER REACHES THE ADMIN.

    Instructions are probabilistic; the save gate is not. The wand already
    imports assertNoBracketDirections — it is the same module its variable list
    comes from — so the cheapest guarantee is to run the gate on the way OUT and
    not hand back a prompt that cannot be kept.
  */
  realLog('\nGATE 4: a reply full of brackets is caught before the admin sees it');
  {
    const GOOD = JSON.stringify({
      instructions: 'Read the responses and name the two ideas that recur.',
      outputFormat: '**The Responses:**\\n{responsesText}',
    });
    const BRACKETED = JSON.stringify({
      instructions: 'Summarise the room.',
      outputFormat: '**Historical Parallel:** [Brief connection to a historical period]',
    });
    const ask = () => generatePrompt.handler({ body: JSON.stringify({
      gameType: 'call-and-answer', category: 'lessons-learned', promptName: 'Historian',
    }) });

    // Fails once, then complies. The admin gets the good one and never learns
    // there was a retry.
    bedrockCalls = [];
    bedrockQueue = [BRACKETED, GOOD];
    quiet();
    const recovered = await ask();
    loud();
    bedrockQueue = [];

    await acheck('a bracketed reply is retried rather than returned', async () => {
      assert.strictEqual(bedrockCalls.length, 2,
        `the wand called the model ${bedrockCalls.length} time(s) — a bracketed reply was returned as-is`);
      assert(/square bracket/i.test(bedrockCalls[1] || ''),
        'the retry does not tell the model what it got wrong');
    });
    await acheck('the retry quotes the offending span back', async () => {
      assert(/Brief connection to a historical period/i.test(bedrockCalls[1] || ''),
        'the retry is a generic scolding rather than the actual violation');
    });
    await acheck('and the admin receives the clean second answer', async () => {
      assert.strictEqual(recovered.statusCode, 200, `got ${recovered.statusCode}`);
      assert(!/\[/.test(JSON.parse(recovered.body).outputFormat || ''),
        'brackets survived into what the admin was handed');
    });

    // Never complies: the admin is told, rather than handed something the save
    // gate will refuse a moment later.
    bedrockCalls = [];
    bedrockQueue = [BRACKETED, BRACKETED];
    quiet();
    const stubborn = await ask();
    loud();
    bedrockQueue = [];

    check('a model that will not comply produces an error, not an unsaveable prompt', () => {
      assert(stubborn.statusCode >= 400,
        `got ${stubborn.statusCode} — the admin was handed a prompt the save gate will refuse`);
      assert(/bracket/i.test(stubborn.body || ''), 'the error does not say what went wrong');
    });
    check('and it does not keep asking forever', () =>
      assert.strictEqual(bedrockCalls.length, 2,
        `${bedrockCalls.length} model calls — one retry is the budget`));
  }

  realLog(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { loud(); console.error('harness error:', e); process.exit(1); });
