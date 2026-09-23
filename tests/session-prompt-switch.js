/**
 * THE STAGE'S "APPROACH (NEXT ROUND)" SWITCH REFUSED EVERY SESSION IT WAS SHOWN ON.
 *
 * 584c11f6 put a summary-approach select on the results stage beside the voice
 * one, and wrote it through `PUT /games/{gameId}` — update-game.js, the pre-start
 * edit route, which answers any session whose STATE is not `CREATED` with 400
 * "Game cannot be edited". The select only renders on a results stage, i.e. on a
 * session that has started, so the switch failed every time it could be pressed,
 * and the picker snapped back with "Could not switch approach: Game cannot be
 * edited". Its test pinned the route in source and drove update-game.js on a
 * CREATED session only, so nothing ever ran the handler in the state the control
 * lives in.
 *
 * The voice select beside it has always worked, because it has its own route:
 * `PUT /games/{gameId}/persona` (update-game-persona.js), a narrow one-attribute
 * write with no state gate. The approach now has the same shape —
 * `PUT /games/{gameId}/prompt` (update-game-prompt.js) — and update-game.js keeps
 * its CREATED-only rule for everything else.
 *
 * This suite drives the REAL handlers against an in-memory table:
 *
 *   1. a STARTED session (on a results stage) takes an approach switch through
 *      the new route — PromptId only, next-round semantics, '' clears;
 *   2. the same session is STILL refused every other edit through
 *      PUT /games/{gameId}, including a promptId sent there;
 *   3. the switch asks whose room it is (callerMayDriveSession, 404 not 403),
 *      and reads prompts only from the session's own org and the platform;
 *   4. the route is closed in the template and in the authorizer's table.
 *
 * rejects: a mid-session control wired to a pre-start-only route; a second
 *          writer of a session attribute that skips the guard the first applies.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// Intercept by request name, as tests/persona-controls.js does: several SDK
// packages these handlers import exist only in the deployed bundle.
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const writes = [];

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
    if (cmd.type === 'put') { writes.push(inp); store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {}; }
    if (cmd.type === 'update') {
      writes.push(inp);
      const k = key(inp.Key.PK, inp.Key.SK);
      const item = store.get(k);
      // Honour the guard, or "unknown game 404s" passes against a handler that
      // would conjure a METADATA row holding nothing but a PromptId.
      if (/attribute_exists\(PK\)/.test(inp.ConditionExpression || '') && !item) {
        const e = new Error('The conditional request failed');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      if (!item) return {};
      const expr = inp.UpdateExpression || '';
      const names = inp.ExpressionAttributeNames || {};
      const values = inp.ExpressionAttributeValues || {};
      const resolve = (t) => (t.startsWith('#') ? names[t] : t);
      const setPart = (expr.match(/SET\s+(.*?)(?=\s+REMOVE\b|$)/i) || [])[1];
      if (setPart) {
        for (const clause of setPart.split(',')) {
          const [lhs, rhs] = clause.split('=').map((s) => s.trim());
          if (lhs && rhs && rhs in values) item[resolve(lhs)] = values[rhs];
        }
      }
      const removePart = (expr.match(/REMOVE\s+(.*)$/i) || [])[1];
      if (removePart) for (const t of removePart.split(',')) delete item[resolve(t.trim())];
      return {};
    }
    return { Items: [], Count: 0 };
  },
};

stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, UpdateCommand, PutCommand, QueryCommand,
});

process.env.TABLE_NAME = 'test-table';

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}

const { ORG, PLATFORM, promptsMetadataPk } = require(path.join(REPO, 'lambda-functions', 'game', 'tenant.js'));

const ORG_A = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';   // owns the room
const ORG_B = 'org_Tb2VnQ8sLxK4WmC7gRdYpF';   // a rival holding the code
const host = (orgId) => ({ requestContext: { authorizer: { lambda: { userId: 'u', groups: 'hosts', orgId } } } });

const PLATFORM_PROMPTS = promptsMetadataPk(PLATFORM);
const seedPrompt = (pk, promptId, extra = {}) => store.set(key(pk, `AIPROMPT#${promptId}`), {
  PK: pk, SK: `AIPROMPT#${promptId}`, promptId, name: promptId, gameType: 'trivia',
  promptType: 'analysis', status: 'active', ...extra,
});

/** A session sitting on a results stage, owned by `orgId` (or nobody). */
function seedStartedSession(gameId, orgId = '') {
  store.set(key(`GAME#${gameId}`, 'STATE'), {
    PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#002', Started: true,
  });
  store.set(key(`GAME#${gameId}`, 'METADATA'), {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    Title: 'A live session', Details: 'what it is about', GameType: 'trivia',
    QuestionSetId: 'set-a', Visibility: 'private', AccessCode: '1234', Started: true,
    PersonaId: 'comedian', PromptId: 'trivia-vj',
    ScoringConfig: { firstPlacePoints: 3, secondPlacePoints: 2 },
    ...(orgId ? { orgId } : {}),
  });
}
const metadataOf = (gameId) => store.get(key(`GAME#${gameId}`, 'METADATA'));

const quietly = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { log, warn, error }); }
};

(async () => {
  let promptHandler;
  try {
    promptHandler = require(path.join(REPO, 'lambda-functions', 'game', 'update-game-prompt.js')).handler;
  } catch (e) {
    console.log(`  FAIL - lambda-functions/game/update-game-prompt.js loads\n    ${e.message}`);
    fail++;
  }
  const updateGameHandler = require(path.join(REPO, 'lambda-functions', 'game', 'update-game.js')).handler;

  const putPrompt = async (gameId, body, caller = {}) => {
    const res = await quietly(() => promptHandler({
      pathParameters: { gameId }, body: JSON.stringify(body), ...caller,
    }));
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const putGame = async (gameId, body, caller = {}) => {
    const res = await quietly(() => updateGameHandler({
      pathParameters: { gameId }, body: JSON.stringify(body), ...caller,
    }));
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  seedPrompt(PLATFORM_PROMPTS, 'trivia-vj');
  seedPrompt(PLATFORM_PROMPTS, 'trivia-quiet');
  seedPrompt(PLATFORM_PROMPTS, 'retired-approach', { status: 'inactive' });
  seedPrompt(PLATFORM_PROMPTS, 'trivia-writer', { promptType: 'generation' });
  seedPrompt(promptsMetadataPk(ORG, ORG_A), 'team-a-approach');
  seedPrompt(promptsMetadataPk(ORG, ORG_B), 'team-b-approach');

  // ---------- 1 ----------
  console.log('\n1. a STARTED session takes an approach switch through PUT /games/{gameId}/prompt');
  if (promptHandler) {
    const gameId = '4821';
    seedStartedSession(gameId);

    await check('the switch lands on a session sitting on a results stage', async () => {
      const before = structuredClone(metadataOf(gameId));
      const res = await putPrompt(gameId, { promptId: 'trivia-quiet' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const after = metadataOf(gameId);
      assert.strictEqual(after.PromptId, 'trivia-quiet');
      // One attribute, never a Put of the row: the save-game-context trap.
      for (const k of Object.keys(before)) {
        if (k === 'PromptId') continue;
        assert.deepStrictEqual(after[k], before[k], `${k} was changed by an approach switch`);
      }
      const added = Object.keys(after).filter((k) => !(k in before));
      assert.deepStrictEqual(added, [], `unexpected new attributes: ${added.join(', ')}`);
    });

    await check('it says it applies from the next round, not the one on screen', async () => {
      const res = await putPrompt(gameId, { promptId: 'trivia-vj' });
      assert.strictEqual(res.body.appliesTo, 'next-question');
      assert.strictEqual(res.body.promptId, 'trivia-vj');
    });

    await check('the STATE row is not touched — a switch is not a state change', async () => {
      assert.strictEqual(store.get(key(`GAME#${gameId}`, 'STATE')).State, 'RESULTS#002');
      assert(!writes.some((w) => (w.Key || w.Item || {}).SK === 'STATE'), 'the switch wrote the STATE row');
    });

    await check("'' clears it: the attribute is REMOVED, not written empty", async () => {
      const res = await putPrompt(gameId, { promptId: '' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.promptId, null);
      assert(!('PromptId' in metadataOf(gameId)), 'an empty pick left an empty attribute behind');
    });

    await check('null and an omitted promptId clear it too', async () => {
      await putPrompt(gameId, { promptId: 'trivia-quiet' });
      assert.strictEqual((await putPrompt(gameId, { promptId: null })).status, 200);
      assert(!('PromptId' in metadataOf(gameId)));
      await putPrompt(gameId, { promptId: 'trivia-quiet' });
      assert.strictEqual((await putPrompt(gameId, {})).status, 200);
      assert(!('PromptId' in metadataOf(gameId)));
    });

    await check('an unknown prompt is refused rather than written as a dangling id', async () => {
      await putPrompt(gameId, { promptId: 'trivia-quiet' });
      const res = await putPrompt(gameId, { promptId: 'no-such-prompt' });
      assert.strictEqual(res.status, 404, JSON.stringify(res.body));
      assert.strictEqual(metadataOf(gameId).PromptId, 'trivia-quiet', 'a refused id was written anyway');
    });

    await check('an inactive prompt is refused', async () => {
      const res = await putPrompt(gameId, { promptId: 'retired-approach' });
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(metadataOf(gameId).PromptId, 'trivia-quiet');
    });

    await check('a generation prompt is refused — it cannot write a round summary', async () => {
      const res = await putPrompt(gameId, { promptId: 'trivia-writer' });
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(metadataOf(gameId).PromptId, 'trivia-quiet');
    });

    await check('an unknown game 404s and does NOT conjure a METADATA row', async () => {
      const res = await putPrompt('0000', { promptId: 'trivia-quiet' });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(store.get(key('GAME#0000', 'METADATA')), undefined);
    });

    await check('a missing gameId is a 400', async () => {
      const res = await quietly(() => promptHandler({ pathParameters: {}, body: '{}' }));
      assert.strictEqual(res.statusCode, 400);
    });
  }

  // ---------- 2 ----------
  console.log('\n2. PUT /games/{gameId} still refuses every other edit on a started session');
  {
    const gameId = '4822';
    seedStartedSession(gameId);
    const before = structuredClone(metadataOf(gameId));

    for (const [label, body] of [
      ['a rename', { eventTitle: 'Renamed mid-session' }],
      ['a details edit', { engagementInfo: 'changed' }],
      ['a visibility change', { visibility: 'public' }],
      ['a voice change', { personaId: 'facilitator' }],
      // The old route for this very control. It stays pre-start only; the
      // stage uses /prompt.
      ['an approach change', { promptId: 'trivia-quiet' }],
    ]) {
      await check(`${label} is refused with 400 "Game cannot be edited"`, async () => {
        const res = await putGame(gameId, body);
        assert.strictEqual(res.status, 400, JSON.stringify(res.body));
        assert.strictEqual(res.body.error, 'Game cannot be edited');
      });
    }
    await check('and none of them landed', async () =>
      assert.deepStrictEqual(metadataOf(gameId), before));

    await check('a CREATED session can still be edited there (the rule is unchanged)', async () => {
      const created = '4823';
      seedStartedSession(created);
      store.get(key(`GAME#${created}`, 'STATE')).State = 'CREATED';
      const res = await putGame(created, { promptId: 'trivia-quiet' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(metadataOf(created).PromptId, 'trivia-quiet');
    });
  }

  // ---------- 3 ----------
  console.log('\n3. whose room is this?');
  if (promptHandler) {
    const owned = '7432';
    seedStartedSession(owned, ORG_A);

    await check('another organisation cannot change the approach (404, not 403)', async () => {
      const res = await putPrompt(owned, { promptId: 'trivia-quiet' }, host(ORG_B));
      assert.strictEqual(res.status, 404, `got ${res.status}`);
      assert.strictEqual(metadataOf(owned).PromptId, 'trivia-vj', 'the write landed despite the refusal');
    });

    await check('nor clear it', async () => {
      const res = await putPrompt(owned, { promptId: '' }, host(ORG_B));
      assert.strictEqual(res.status, 404, `got ${res.status}`);
      assert.strictEqual(metadataOf(owned).PromptId, 'trivia-vj');
    });

    await check('the owning organisation can, with a platform prompt', async () => {
      const res = await putPrompt(owned, { promptId: 'trivia-quiet' }, host(ORG_A));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(metadataOf(owned).PromptId, 'trivia-quiet');
    });

    await check('and with its own team\'s prompt', async () => {
      const res = await putPrompt(owned, { promptId: 'team-a-approach' }, host(ORG_A));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(metadataOf(owned).PromptId, 'team-a-approach');
    });

    await check('but not another team\'s prompt — the summary could never read it', async () => {
      const res = await putPrompt(owned, { promptId: 'team-b-approach' }, host(ORG_A));
      assert.strictEqual(res.status, 404, JSON.stringify(res.body));
      assert.strictEqual(metadataOf(owned).PromptId, 'team-a-approach');
    });

    await check('a session with no owning org is left alone', async () => {
      const legacy = '7433';
      seedStartedSession(legacy);
      const res = await putPrompt(legacy, { promptId: 'trivia-quiet' }, host(ORG_B));
      assert.strictEqual(res.status, 200, `got ${res.status}`);
    });
  }

  // ---------- 4 ----------
  console.log('\n4. the route is closed in the template and in the authorizer');
  {
    const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');
    const { requiredGroupsForRoute, hasPermission } =
      require(path.join(REPO, 'lambda-functions', 'auth', 'authorizer.js'));
    const routes = routesFromTemplate();
    await check('the template scanner works', async () => assertScannerWorks(routes));
    await check('PUT /games/{gameId}/prompt is in the template with CognitoAuthorizer', async () => {
      const hit = findRoute(routes, 'PUT', '/games/{gameId}/prompt');
      assert.ok(hit, 'the route is not in template-clean.yaml');
      assert.strictEqual(hit.authorizer, 'CognitoAuthorizer');
    });
    for (const p of ['games/{gameId}/prompt', 'games/4821/prompt']) {
      await check(`PUT ${p} requires hosts or admins, and refuses pending`, async () => {
        assert.deepStrictEqual(requiredGroupsForRoute('PUT', p), ['hosts', 'admins']);
        assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('PUT', p)), false);
      });
    }
    await check('the function runs update-game-prompt.handler from the game bundle', async () => {
      const src = require('fs').readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
      const at = src.indexOf('Handler: update-game-prompt.handler');
      assert(at > -1, 'no function runs update-game-prompt.handler');
      const block = src.slice(src.lastIndexOf('Type: AWS::Serverless::Function', at), at + 1200);
      assert(/CodeUri: lambda-functions\/game\//.test(block), 'not in the game bundle (tenant.js lives there)');
      assert(/DynamoDBCrudPolicy:\s*\n\s*TableName: !Ref GameTable/.test(block),
        'it reads METADATA and the prompt libraries and updates METADATA — it needs the table');
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
