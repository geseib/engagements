/**
 * WORKIE'S READ STARTS WHEN THE HOST CLOSES THE ROUND — not when a stage tab
 * happens to be open.
 *
 * Owner, 2026-10-12, dev session 5479 driven from the Host Remote: *"I didn't
 * get it to finish Workie work until I switched to the host screen."* Not a
 * coincidence. CloudWatch for engagedev-get-ai-summary that morning:
 *
 *   12:59:25  get-results closes round 2 (no WebSocket connections: no stage)
 *   12:59:36  the remote's public read, questionId=current -> 404 cache miss,
 *             every four seconds for half a minute
 *   13:00:07  the stage is opened: its read misses, it sends generateNew,
 *             "dispatching async generation worker for 5479:002"
 *   13:00:13  the read is stored and broadcast
 *
 * and round 3 (closed 13:05:07) sat on 404s with nothing ever dispatched. The
 * only thing that ever started a read was GameHostPage's RESULTS effect, so a
 * host on the remote alone got no read and no follow-up suggestions.
 *
 * Runs the REAL get-results and get-ai-summary handlers against an in-memory
 * table that honours the claim's conditions, and asserts:
 *
 *   1. closing a round on the host route starts the read: one worker invoke at
 *      the get-ai-summary function, with a claim on the round
 *   2. a public read of a resolved round starts nothing; neither does a second
 *      close while the first read runs, nor a close of a round already read
 *   3. the stage's own generateNew while that read runs starts nothing more —
 *      no double generation when both surfaces are open — and a Regenerate
 *      after the read has landed (the claim released) still works
 *   4. the worker releases the claim whether it succeeds or fails
 *   5. the template lets get-results invoke get-ai-summary and tells it the name
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

process.env.TABLE_NAME = 'engage-test';
process.env.AWS_REGION = 'us-east-1';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.AI_SUMMARY_FUNCTION_NAME = 'engagedev-get-ai-summary';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'engagedev-get-ai-summary';

// ---- an in-memory table that honours the claim's two conditions -------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

function applyUpdate(input) {
  const k = key(input.Key.PK, input.Key.SK);
  const item = store.get(k) || { ...input.Key };
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const setClause = String(input.UpdateExpression || '').replace(/^\s*SET\s+/i, '');
  for (const pair of setClause.split(',')) {
    const [lhs, rhs] = pair.split('=').map((s) => s.trim());
    if (!lhs || !rhs) continue;
    const attr = names[lhs] || lhs;
    const m = /^if_not_exists\(([^,]+),\s*([^)]+)\)$/.exec(rhs);
    item[attr] = m ? (item[names[m[1].trim()] || m[1].trim()] ?? values[m[2].trim()]) : values[rhs];
  }
  store.set(k, item);
  return {};
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    const vals = inp.ExpressionAttributeValues || {};
    switch (cmd.type) {
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'put': {
        const cond = inp.ConditionExpression || '';
        if (cond.includes('attribute_not_exists(PK) OR StartedAt < :stale')) {
          const held = store.get(key(inp.Item.PK, inp.Item.SK));
          if (held && !(held.StartedAt < vals[':stale'])) throw conditionFailed();
        }
        put(inp.Item);
        return {};
      }
      case 'delete': {
        const k = key(inp.Key.PK, inp.Key.SK);
        if ((inp.ConditionExpression || '') === 'JobId = :id') {
          const held = store.get(k);
          if (!held || held.JobId !== vals[':id']) throw conditionFailed();
        }
        store.delete(k);
        return {};
      }
      case 'update':
        return applyUpdate(inp);
      case 'query': {
        const pk = vals[':pk'];
        const prefix = vals[':sk'] ?? vals[':skPrefix'] ?? '';
        const items = [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
        return { Items: items, Count: items.length };
      }
      default:
        return { Items: [] };
    }
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

const invokes = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class {
    async send(cmd) {
      invokes.push({
        functionName: cmd.input.FunctionName,
        type: cmd.input.InvocationType,
        payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
      });
      return {};
    }
  },
  InvokeCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('Bedrock was called'); } },
  InvokeModelCommand: class {},
});
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

const getResults = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
const getAiSummary = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); }
  catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

const GAME = '5479';
const PK = `GAME#${GAME}`;
const claimOf = (padded = '003') => store.get(key(PK, `QUESTION#${padded}#AISummaryJob`));

/** A Call & Answer round mid-vote: two answers, one ballot as submit-vote writes it. */
function seedRound() {
  store.clear();
  invokes.length = 0;
  put({ PK, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Offsite', Started: true });
  put({ PK, SK: 'STATE', State: 'VOTE#003', LessonNumber: 3, CurrentQuestionId: 'c005#003' });
  put({ PK, SK: 'QUESTION#003#ANSWER#Ada', PlayerName: 'Ada', Answer: 'trade first' });
  put({ PK, SK: 'QUESTION#003#ANSWER#Dana', PlayerName: 'Dana', Answer: 'people first' });
  put({ PK, SK: 'QUESTION#003#VOTE#Dana', VoterName: 'Dana', QuestionNumber: '003', Votes: { 0: 1 } });
}

const closeRound = () => getResults.handler({
  requestContext: { routeKey: 'POST /games/{gameId}/close-round' },
  pathParameters: { gameId: GAME },
  body: JSON.stringify({ questionNumber: 3 }),
});
const publicRead = () => getResults.handler({
  requestContext: { routeKey: 'POST /games/get-results' },
  body: JSON.stringify({ gameId: GAME, questionNumber: 3 }),
});
const HOST_ROUTE = 'GET /games/{gameId}/ai-summary/host';
const stageGenerate = () => getAiSummary.handler({
  routeKey: HOST_ROUTE,
  rawPath: `/games/${GAME}/ai-summary/host`,
  pathParameters: { gameId: GAME },
  queryStringParameters: { questionId: '003', generateNew: 'true' },
  requestContext: { routeKey: HOST_ROUTE, authorizer: { lambda: { userId: 'u-1', groups: 'hosts' } } },
});

(async () => {
  say('\n1. closing the round on the host route starts the read');
  seedRound();
  const closed = await closeRound();
  await check('the round closes as before (200, RESULTS#003)', () => {
    assert.strictEqual(closed.statusCode, 200, closed.body);
    assert.strictEqual(store.get(key(PK, 'STATE')).State, 'RESULTS#003');
  });
  await check('exactly one worker is started, at get-ai-summary, for round 003', () => {
    assert.strictEqual(invokes.length, 1, `invokes: ${JSON.stringify(invokes)}`);
    const [inv] = invokes;
    assert.strictEqual(inv.functionName, 'engagedev-get-ai-summary');
    assert.strictEqual(inv.type, 'Event');
    assert.strictEqual(inv.payload.__workerMode, true);
    assert.strictEqual(inv.payload.gameId, GAME);
    assert.strictEqual(inv.payload.questionId, '003');
    assert.ok(inv.payload.jobId, 'the worker is not told which claim is its own');
  });
  await check('the round is claimed under that job', () => {
    assert.ok(claimOf(), 'no claim row');
    assert.strictEqual(claimOf().JobId, invokes[0].payload.jobId);
  });

  say('\n2. nothing else starts a second read');
  invokes.length = 0;
  await publicRead();
  await check('a phone\'s public read of the resolved round starts nothing', () =>
    assert.deepStrictEqual(invokes, []));
  await closeRound();
  await check('closing the same round again while the read runs starts nothing', () =>
    assert.deepStrictEqual(invokes, []));

  say('\n3. the stage opening mid-read does not start a second generation');
  const stage = await stageGenerate();
  await check('the stage\'s generateNew answers 202 generating', () => {
    assert.strictEqual(stage.statusCode, 202, stage.body);
    assert.strictEqual(JSON.parse(stage.body).status, 'generating');
  });
  await check('...and dispatches no second worker', () => assert.deepStrictEqual(invokes, []));

  say('\n4. the worker lets the claim go when it finishes');
  // The worker's own first read is METADATA; take it away and the worker
  // returns early — the cheapest finish that runs the real handler.
  const jobId = (claimOf() || {}).JobId;
  const meta = store.get(key(PK, 'METADATA'));
  store.delete(key(PK, 'METADATA'));
  await getAiSummary.handler({ __workerMode: true, gameId: GAME, questionId: '003', paddedQuestionNumber: '003', jobId });
  put(meta);
  await check('the claim is gone once the worker is done', () => assert.strictEqual(claimOf(), undefined));

  invokes.length = 0;
  const regen = await stageGenerate();
  await check('a Regenerate after the read has landed still dispatches a worker', () => {
    assert.strictEqual(regen.statusCode, 202, regen.body);
    assert.strictEqual(invokes.length, 1);
    assert.ok(invokes[0].payload.jobId);
  });

  await check('a worker that is not the claim\'s owner leaves the claim alone', async () => {
    const held = claimOf().JobId;
    store.delete(key(PK, 'METADATA'));
    await getAiSummary.handler({ __workerMode: true, gameId: GAME, questionId: '003', jobId: 'someone-else' });
    put(meta);
    assert.strictEqual(claimOf().JobId, held);
  });

  await check('a claim older than the stale window can be retaken', async () => {
    claimOf().StartedAt = Date.now() - 10 * 60 * 1000;
    invokes.length = 0;
    const r = await stageGenerate();
    assert.strictEqual(r.statusCode, 202);
    assert.strictEqual(invokes.length, 1);
  });

  say('\n5. a round already read is not read again by a re-close');
  seedRound();
  put({ PK, SK: 'QUESTION#003#AISummary', Summary: 'already here' });
  await closeRound();
  await check('closing a round that has its read starts nothing', () => assert.deepStrictEqual(invokes, []));

  say('\n6. the template grants it');
  const tpl = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const start = tpl.indexOf('\n  GetResultsFunction:');
  const block = tpl.slice(start, tpl.indexOf('\n  ', tpl.indexOf('Events:', start)) === -1 ? undefined : tpl.indexOf('Events:', start));
  await check('get-results is told the get-ai-summary function name', () =>
    assert.ok(/AI_SUMMARY_FUNCTION_NAME: !Sub '\$\{StackName\}-get-ai-summary'/.test(block), 'no AI_SUMMARY_FUNCTION_NAME'));
  await check('get-results may invoke get-ai-summary', () =>
    assert.ok(/lambda:InvokeFunction[\s\S]*function:\$\{StackName\}-get-ai-summary/.test(block), 'no invoke grant'));

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
