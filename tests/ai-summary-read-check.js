/**
 * THE READ CHECK, IN THE WORKER — get-ai-summary.js with read-check.js.
 *
 * Review #38: Workie's read invented a "15-minute hold", called one objection
 * "the strongest resistance", and wrote a next step as if the route lead had
 * already agreed to run it. docs/design/workie-grounding/STEP0.md. After the
 * reply lands it is checked; a reply with issues is written once more with a
 * note naming the exact words, the better of the two is kept, and what is
 * left is stored as ReadCheck — returned to the host's route only.
 *
 * rejects: a bad first reply stored without a rewrite; the rewrite not told
 * the exact words, or not shown its previous reply; a worse rewrite kept over
 * a better first reply; a failed rewrite losing the read; a second model call
 * on a clean read; ReadCheck on the public read; ReadCheck left out of the
 * sealed fields; the read's words or the room's answers in the logs; the
 * prompt's own text not reaching the check as `instructions`, so an owner
 * copied from its example passes (review #46).
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

// ---- Bedrock: one scripted reply per call ------------------------------------
let replies = [];
let bedrockBodies = [];
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      const next = replies.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('an unscripted model call');
      const body = { content: [{ type: 'text', text: next }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 } };
      return { body: new TextEncoder().encode(JSON.stringify(body)) };
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
const { ENCRYPTED_FIELDS } = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));

// ---- harness ---------------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// The #38 round: four answers, exactly as the room wrote them.
const ANSWERS = {
  Maya: "Keep the pilot to Friday's return route until every transfer has an acknowledged receiver. Growth sponsors will object to delaying nine-branch coverage.",
  Theo: "At Friday's van departure, unacknowledged returns stay coordinator-owned. The route lead objects because waiting can break the next branch's pickup slot.",
  Lena: "At Friday van departure, an unacknowledged return stays coordinator-owned. The driver objects: waiting can strand the next branch's booked stop.",
  Omar: "Stop van loading if returns lack an acknowledged owner at 4pm Friday. The route lead objects: a missed departure strands two branches.",
};

function seedRound(gameId) {
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Transfer pilot' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  for (const [name, text] of Object.entries(ANSWERS)) {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${name}`, PlayerName: name, Answer: text });
    put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}`, PlayerName: name });
  }
  // Split votes: no answer takes every point.
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Maya', Votes: { 1: 1, 2: 2, 3: 3 } });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Theo', Votes: { 0: 1, 2: 2, 3: 3 } });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Lena', Votes: { 1: 1, 0: 2, 3: 3 } });
}

// After the prefilled "## Summary" heading.
const BAD = '\n\nFour answers hold the line at Friday van departure. The strongest resistance came from the route lead.'
  + '\n\n## Discussion Questions\n1. What does an acknowledged receiver look like?'
  + '\n\n## Next Steps\n1. The route lead will run one Friday with a 15-minute hold on departure for unacknowledged returns.';
const BETTER = '\n\nFour answers hold the line at Friday van departure. The objection named most often came from the route lead.'
  + '\n\n## Discussion Questions\n1. What does an acknowledged receiver look like?'
  + '\n\n## Next Steps\n1. **Suggested:** try one Friday with a 15-minute hold, and see who acknowledges.';
const GOOD = '\n\nFour answers hold the line at Friday van departure. The objection named most often came from the route lead.'
  + '\n\n## Discussion Questions\n1. What does an acknowledged receiver look like?'
  + '\n\n## Next Steps\n1. **Suggested:** try one Friday at van departure and see who acknowledges.';
const WORSE = '\n\nA unanimous, decisive consensus. The strongest resistance came from the route lead.'
  + '\n\n## Discussion Questions\n1. Why?'
  + '\n\n## Next Steps\n1. The route lead will run one Friday with a 15-minute hold, and Theo will draft a 30% target.';

const lines = [];
async function run(gameId, script) {
  replies = script.slice();
  bedrockBodies = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(util.format(...a));
  try {
    await getAiSummary({ __workerMode: true, gameId, questionId: '001' });
  } catch { /* surfaces below */ } finally {
    Object.assign(console, orig);
  }
  return {
    calls: bedrockBodies.length,
    prompts: bedrockBodies.map((b) => b.messages[0].content),
    row: store.get(key(`GAME#${gameId}`, 'QUESTION#001#AISummary')),
    left: replies.length,
  };
}

async function read(gameId, routeKey, authorizer) {
  const res = await getAiSummary({
    routeKey,
    rawPath: routeKey.endsWith('/host') ? `/games/${gameId}/ai-summary/host` : `/games/${gameId}/ai-summary`,
    pathParameters: { gameId },
    queryStringParameters: { questionId: '001' },
    requestContext: { routeKey, ...(authorizer ? { authorizer } : {}) },
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}'), raw: String(res.body || '') };
}

(async () => {
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned', s3Key: 'none',
        // The example owner is the prompt's own words (review #46): section 6.
        instructions: 'Read the round back. An owner is the role an answer implies, for example whoever runs the van departure. Answers: {responsesText}',
        outputFormat: 'Keep it short.' });

  console.log('\n1. a bad first reply, a good rewrite');
  seedRound('9301');
  const a = await run('9301', [BAD, GOOD]);
  await check('two model calls: the reply and one revision', () => assert.strictEqual(a.calls, 2));
  await check('the revision is the same prompt, plus the previous reply, plus the exact note', () => {
    const [p1, p2] = a.prompts;
    assert.ok(p2.startsWith(p1.replace(/\n\nBegin your reply[\s\S]*$/, '')), 'the revision prompt does not start with the first prompt');
    assert.ok(p2.includes(`YOUR PREVIOUS REPLY:\n## Summary${BAD}`), 'the previous reply is not in the revision prompt');
    assert.ok(p2.includes([
      'Revise your reply. Change only these, keep everything else, keep the headings:',
      '- "15-minute" is not in the material: remove it, or use a number the material contains.',
      '- "strongest" is not something the vote shows: say what it shows instead (for example, "named by three answers").',
      '- "The route lead will run…" is written as decided: the room has not agreed; make it a suggestion starting **Suggested**.',
    ].join('\n')), p2.slice(-700));
  });
  await check('the rewrite is what is stored', () => {
    assert.ok(a.row, 'no summary row');
    assert.ok(a.row.MarkdownResponse.includes('see who acknowledges'), a.row.MarkdownResponse);
    assert.ok(!a.row.MarkdownResponse.includes('15-minute'));
  });
  await check('ReadCheck: checked, rewritten, nothing left, three found first', () =>
    assert.deepStrictEqual(a.row.ReadCheck, { checked: true, rewritten: true, first: 3, issues: [] }));
  await check('the first prompt carries the ranking fact line', () =>
    assert.ok(a.prompts[0].includes('A ranking shows which answers people preferred among these, not that the room agreed to a plan or chose an owner. Say what the vote shows, as the counts and points above show it.')));

  console.log('\n2. a bad first reply, a rewrite that is better but not clean');
  seedRound('9302');
  const b = await run('9302', [BAD, BETTER]);
  await check('the better rewrite is kept, and what is left is listed', () => {
    assert.ok(b.row.MarkdownResponse.includes('**Suggested:** try one Friday with a 15-minute hold'), b.row.MarkdownResponse);
    assert.deepStrictEqual(b.row.ReadCheck, { checked: true, rewritten: true, first: 3, issues: [{ kind: 'number', token: '15-minute' }] });
  });
  await check('no third call: one rewrite only', () => assert.strictEqual(b.calls, 2));

  seedRound('9303');
  const c = await run('9303', [BAD, WORSE]);
  await check('a worse rewrite is dropped: the first reply is kept, its issues listed', () => {
    assert.ok(c.row.MarkdownResponse.includes('The route lead will run one Friday with a 15-minute hold on departure'), c.row.MarkdownResponse);
    assert.strictEqual(c.row.ReadCheck.rewritten, false);
    assert.deepStrictEqual(c.row.ReadCheck.issues.map((i) => i.kind).sort(), ['claim', 'commitment', 'number']);
    assert.strictEqual(c.row.ReadCheck.first, 3);
  });

  console.log('\n3. the rewrite fails');
  seedRound('9304');
  const boom = new Error('model unavailable'); boom.name = 'ServiceUnavailableException';
  const d = await run('9304', [BAD, boom]);
  await check('the first reply is kept and the row says the rewrite failed', () => {
    assert.ok(d.row && d.row.MarkdownResponse.includes('15-minute'), 'the read was lost');
    assert.ok(!d.row.Fallback, 'a failed rewrite turned the read into the template');
    assert.strictEqual(d.row.ReadCheck.rewriteError, true);
    assert.strictEqual(d.row.ReadCheck.rewritten, false);
    assert.strictEqual(d.row.ReadCheck.issues.length, 3);
  });

  console.log('\n4. a clean reply');
  seedRound('9305');
  const e = await run('9305', [GOOD]);
  await check('exactly one model call', () => assert.strictEqual(e.calls, 1));
  await check('ReadCheck: checked, nothing found, not rewritten', () =>
    assert.deepStrictEqual(e.row.ReadCheck, { checked: true, rewritten: false, first: 0, issues: [] }));

  console.log('\n5. who may read it');
  const pub = await read('9302', 'GET /games/{gameId}/ai-summary');
  await check('the public read (phones, wall, /present) carries no readCheck', () => {
    assert.strictEqual(pub.status, 200, pub.raw);
    assert.ok(!('readCheck' in pub.body) && !('ReadCheck' in pub.body), pub.raw.slice(0, 300));
    assert.ok(!pub.raw.includes('"15-minute"'), 'the token reached the public read');
  });
  const host = await read('9302', 'GET /games/{gameId}/ai-summary/host', { lambda: { userId: 'u-1', groups: 'hosts' } });
  await check('the host\'s read carries it', () => {
    assert.strictEqual(host.status, 200, host.raw);
    assert.deepStrictEqual(host.body.readCheck, { checked: true, rewritten: true, first: 3, issues: [{ kind: 'number', token: '15-minute' }] });
  });
  const stranger = await read('9302', 'GET /games/{gameId}/ai-summary/host');
  await check('the host route without an identity gets nothing', () => {
    assert.strictEqual(stranger.status, 404, stranger.raw);
    assert.ok(!stranger.raw.includes('readCheck'));
  });
  await check('ReadCheck is sealed with the read (ENCRYPTED_FIELDS.aiSummary)', () =>
    assert.ok(ENCRYPTED_FIELDS.aiSummary.includes('ReadCheck')));

  console.log('\n6. the prompt\'s own example owner (review #46)');
  // "departure" is in the answers, so only the prompt's text tells this owner
  // apart from one an answer named: the worker must pass it as `instructions`.
  const LEAK = '\n\nFour answers hold the line at Friday van departure. The objection named most often came from the route lead.'
    + '\n\n## Discussion Questions\n1. What does an acknowledged receiver look like?'
    + '\n\n## Next Steps\n1. **Suggested** Whoever runs the van departure: hold one Friday and see who acknowledges.';
  seedRound('9306');
  const f = await run('9306', [LEAK, GOOD]);
  await check('an owner copied from the prompt is flagged, and the note names it', () => {
    assert.strictEqual(f.calls, 2);
    assert.ok(f.prompts[1].includes('- "Whoever runs the van departure" is an owner the answers never named: use a person or a role an answer names.'),
      f.prompts[1].slice(-500));
    assert.deepStrictEqual(f.row.ReadCheck, { checked: true, rewritten: true, first: 1, issues: [] });
  });
  await check('the first prompt carries the owner-and-practice sentence', () =>
    assert.ok(f.prompts[0].includes('Never say what the organisation currently or usually does unless an answer says it; never name an owner the answers did not name.')));

  console.log('\n7. the logs');
  const checkLines = lines.filter((l) => l.includes('READ CHECK') || l.includes('read-check'));
  await check('the check logs its kinds and counts', () => {
    assert.ok(checkLines.some((l) => /3 issue\(s\)/.test(l) && /"number":1/.test(l)), checkLines.join('\n'));
    assert.ok(lines.some((l) => l.includes('ai-summary-read-check-rewrite-failed') && l.includes('ServiceUnavailableException')));
  });
  await check('no log line carries a flagged token, the read, or an answer', () => {
    const banned = ['15-minute', 'strongest', 'route lead', 'acknowledged receiver', 'coordinator-owned',
      'nine-branch', 'strands two branches', 'Suggested', 'Theo will'];
    for (const l of lines) for (const b of banned) assert.ok(!l.includes(b), `a log line carries "${b}": ${l.slice(0, 200)}`);
  });
  await check('the read check\'s own lines name nobody', () => {
    for (const l of checkLines) for (const n of Object.keys(ANSWERS)) assert.ok(!l.includes(n), l);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(`CRASH ${e.stack}`); process.exit(1); });
