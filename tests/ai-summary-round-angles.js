/**
 * THE ROUND'S ANGLE IN THE PROMPT THE WORKER SENDS — get-ai-summary.js with
 * lambda-functions/game/round-angles.js.
 *
 * Spec: docs/superpowers/specs/2026-09-24-workie-round-angles-design.md.
 *
 * rejects: no angle block on a Call & Answer round; a block before the format
 *          contract, or after the voice's or the host's additions; the race on
 *          a hidden round; standings that miss this round's points when the
 *          score row has not counted them yet, or count them twice when it
 *          has; the angle not stored on the summary row, or stored sealed; the
 *          previous round's angle ignored; a Workie's own weights ignored; an
 *          angle drawn for a game type with no house mix; the final round not
 *          recognised; standings, names or points in the angle log line.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const util = require('util');

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

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const prefix = String(v[':sk'] ?? v[':skPrefix'] ?? '');
        const items = [...store.values()].filter((i) => i.PK === v[':pk'] && String(i.SK).startsWith(prefix));
        return { Items: items, Count: items.length };
      }
      case 'scan': return { Items: [], Count: 0 };
      default: return {};
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});
stub('@aws-sdk/client-kms', {
  KMSClient: class { async send() { throw new Error('no KMS: every row here is platform'); } },
  GenerateDataKeyCommand: class {}, DecryptCommand: class {},
});

// ---- Bedrock: records the prompt and answers with a whole reply -------------
let bedrockBodies = [];
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      const text = '\n\n- The room split.\n\n## Discussion topics\n1. Why?\n\n## Next steps\n1. Ada: draft it.';
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' })) };
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { SEED_PERSONAS } = require(path.join(REPO, 'lambda-functions/game/personas.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

// ---- harness ---------------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const WORKIE = {
  PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned', s3Key: 'none',
  instructions: 'Read the round back.\n\n1. Every claim comes from the material listed at the end.\n\nAnswers: {responsesText}',
  outputFormat: 'Keep it short.',
};
const setWeights = (angleWeights) => put({ ...WORKIE, ...(angleWeights ? { angleWeights } : {}) });

/**
 * Round 2 of a Call & Answer session, revealed unless `hidden`. Ada and Grace
 * write; Ada's answer wins the vote. Score rows: Ada's still says round 001
 * (this round not counted yet), Grace's already says 002.
 */
function seedRound(gameId, { gameType = 'call-and-answer', hidden = false, prevAngle, finalRound, eventDetails = 'Quarterly launch retro', aiContext = 'Tie it to the Apollo program', hostPersonaId = 'historian' } = {}) {
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: gameType, Title: 'Launch retro',
    EngagementInfo: eventDetails, AIContext: aiContext,
    ...(hostPersonaId ? { PersonaId: hostPersonaId } : {}),
    HostPreferences: { anonymousUntilReveal: true },
  });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#002', CurrentQuestionId: '002' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#002', QuestionNumber: '002', AuthorsRevealed: !hidden });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#002#ANSWER#Ada', PlayerName: 'Ada', Answer: 'Rehearse the launch' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#002#ANSWER#Grace', PlayerName: 'Grace', Answer: 'Name one owner' });
  // Three voters: Ada's answer (index 0) collects 3+3+2 = 8, Grace's 2+2+3 = 7.
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#002#VOTE#v1', Votes: { 0: 1, 1: 2 } });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#002#VOTE#v2', Votes: { 0: 1, 1: 2 } });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#002#VOTE#v3', Votes: { 1: 1, 0: 2 } });
  for (const n of ['Ada', 'Grace', 'Linus']) put({ PK: `GAME#${gameId}`, SK: `PLAYER#${n}`, PlayerName: n });
  put({ PK: `GAME#${gameId}`, SK: 'PLAYER#Ada#SCORE', PlayerName: 'Ada', score: 5, afterRound: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'PLAYER#Grace#SCORE', PlayerName: 'Grace', score: 16, afterRound: '002' });
  put({ PK: `GAME#${gameId}`, SK: 'PLAYER#Linus#SCORE', PlayerName: 'Linus', score: 4, afterRound: '001' });
  if (prevAngle) put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#AISummary', Angle: prevAngle, Summary: 'x' });
  if (finalRound !== undefined) {
    put({ PK: `GAME#${gameId}`, SK: 'CATEGORY#c1#ACTIVE', ActiveIndex: finalRound ? 2 : 1, QuestionCount: 2 });
    put({ PK: `GAME#${gameId}`, SK: 'CATEGORY#c1#ORDER', QuestionOrder: ['q1', 'q2'] });
  }
}

/** Run the worker (debug on, so DebugInfo is kept); return the prompt, the row and the logs. */
async function run(gameId) {
  bedrockBodies = [];
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(util.format(...a));
  try {
    await getAiSummary({ __workerMode: true, gameId, questionId: '002', debug: 'true' });
  } catch { /* surfaces below as a missing prompt */ } finally {
    Object.assign(console, orig);
  }
  assert.ok(bedrockBodies.length, `the worker never called the model:\n${lines.slice(-8).join('\n')}`);
  return {
    prompt: bedrockBodies[0].messages[0].content,
    row: store.get(key(`GAME#${gameId}`, 'QUESTION#002#AISummary')),
    logs: lines,
  };
}

(async () => {
  put({ PK: 'AIPROMPTS', SK: 'PERSONA#historian', ...SEED_PERSONAS.find((p) => p.personaId === 'historian'), status: 'active' });

  console.log('\n1. a race round: the block, its place, its numbers');
  setWeights({ question: 0, race: 100, event: 0, fact: 0 });
  seedRound('7701');
  const race = await run('7701');
  const at = (s) => race.prompt.indexOf(s);
  await check('the race block is in the prompt', () =>
    assert.ok(at("THIS ROUND'S ANGLE — the race") > -1, 'no race block'));
  await check('…after the format contract', () =>
    assert.ok(at("THIS ROUND'S ANGLE") > at('FORMAT (this part is not negotiable'), 'the block precedes the contract'));
  await check("…before the voice's and the host's additions", () => {
    assert.ok(at("THIS ROUND'S ANGLE") < at("THE VOICE'S REQUIRED ADDITION"), 'after the voice');
    assert.ok(at("THIS ROUND'S ANGLE") < at("THE HOST'S REQUIRED ADDITIONS"), 'after the host');
  });
  await check("Ada's row had not counted this round, so her 8 points are added: 5 + 8 = 13", () =>
    assert.ok(race.prompt.includes('Ada, 13 points'), race.prompt.slice(at("THIS ROUND'S ANGLE"))));
  await check("Grace's row already had, so it is not counted twice: 16", () =>
    assert.ok(race.prompt.includes('1st Grace, 16 points'), race.prompt.slice(at("THIS ROUND'S ANGLE"))));
  await check("this round's top and the gap are stated", () => {
    assert.ok(race.prompt.includes('Ada, +8 points this round'), race.prompt.slice(at("THIS ROUND'S ANGLE")));
    assert.ok(race.prompt.includes('3 points between first and second'), race.prompt.slice(at("THIS ROUND'S ANGLE")));
  });
  await check('the turnout says 2 answered, 3 voted, 3 joined', () =>
    assert.ok(/2 answered, 3 voted, 3 joined the session/.test(race.prompt), race.prompt.slice(at("THIS ROUND'S ANGLE"))));
  await check('the angle is stored on the summary row, in plaintext', () => {
    assert.ok(race.row, 'no summary row');
    assert.strictEqual(race.row.Angle, 'race');
  });
  await check('the debug info names the angle and what was on offer', () => {
    assert.strictEqual(race.row.DebugInfo.angle, 'race');
    assert.ok(race.row.DebugInfo.anglesAvailable.includes('race'), JSON.stringify(race.row.DebugInfo.anglesAvailable));
  });
  await check('the angle log line names the angle and nobody', () => {
    const line = race.logs.find((l) => l.includes('ROUND ANGLE'));
    assert.ok(line, 'no angle log line');
    assert.ok(line.includes('race'), line);
    assert.ok(!/Ada|Grace|Linus|\d+ points/.test(line), line);
  });

  console.log('\n2. a hidden round never races');
  seedRound('7702', { hidden: true });
  const hidden = await run('7702');
  await check('no race block, and the angle falls back to question', () => {
    assert.ok(!hidden.prompt.includes("THIS ROUND'S ANGLE — the race"), 'the race ran on a hidden round');
    assert.strictEqual(hidden.row.Angle, 'question');
  });

  console.log('\n3. the previous round is remembered');
  setWeights({ question: 0, race: 0, event: 50, fact: 50 });
  seedRound('7703', { prevAngle: 'fact' });
  const afterFact = await run('7703');
  await check('fact last round, so this round is the event', () => assert.strictEqual(afterFact.row.Angle, 'event'));
  await check('the event block is in the prompt', () =>
    assert.ok(afterFact.prompt.includes("THIS ROUND'S ANGLE — the event"), 'no event block'));
  await check("…quoting the host's own event words", () => {
    const block = afterFact.prompt.slice(afterFact.prompt.indexOf("THIS ROUND'S ANGLE"));
    assert.ok(block.includes('in the host\'s own words: "Quarterly launch retro"'), block.slice(0, 400));
  });

  console.log('\n4. the Workie\'s own weights, and the house mix without them');
  setWeights({ question: 0, race: 0, event: 0, fact: 100 });
  seedRound('7704');
  await check('a Workie that asks only for facts gets a fact', async () =>
    assert.strictEqual((await run('7704')).row.Angle, 'fact'));
  setWeights(null);
  seedRound('7705');
  const house = await run('7705');
  await check('a Workie with no weights still draws an angle from the house mix', () =>
    assert.ok(['question', 'race', 'event', 'fact'].includes(house.row.Angle), String(house.row.Angle)));

  console.log('\n5. the final round');
  seedRound('7706', { finalRound: true });
  await check('every category exhausted: the debug info says final', async () =>
    assert.strictEqual((await run('7706')).row.DebugInfo.isFinalRound, true));
  seedRound('7707', { finalRound: false });
  await check('a category with questions left: not final', async () =>
    assert.strictEqual((await run('7707')).row.DebugInfo.isFinalRound, false));

  console.log('\n6. other game types are unchanged');
  seedRound('7708', { gameType: 'poll' });
  const poll = await run('7708');
  await check('a poll round carries no angle block and stores no angle', () => {
    assert.ok(!poll.prompt.includes("THIS ROUND'S ANGLE"), 'a poll round got an angle');
    assert.ok(!poll.row || poll.row.Angle === undefined || poll.row.Angle === null, String(poll.row && poll.row.Angle));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(`CRASH ${e.stack}`); process.exit(1); });
