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
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      const body = JSON.parse(cmd.input.body);
      const content = body.messages[0].content;
      bedrockCalls.push(typeof content === 'string' ? content : content[0].text);
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text: bedrockReply }] })) };
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

const post = async (body) => {
  quiet();
  const r = await createPrompt.handler({ body: JSON.stringify(body) });
  loud();
  return r;
};
const putUpdate = async (promptId, body) => {
  quiet();
  const r = await updatePrompt.handler({
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
      instructions: 'There were {totalPlayers} players in {gameContext}.',
      outputFormat: '## Summary\n{triviaCorrectness}',
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
      instructions: 'Reply as { "verdict": "..." } — no other keys.',
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

  realLog(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { loud(); console.error('harness error:', e); process.exit(1); });
