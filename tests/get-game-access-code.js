/**
 * `GET /games/{gameId}` is PUBLIC, and it must never hand back the access code.
 *
 * WHAT THIS PINS. `get-game.js` used to end its host branch with
 *
 *     accessCode: gameMetadata.Item.AccessCode
 *
 * reached by `?role=host` — a QUERY PARAMETER, on a route with no authorizer,
 * read straight off `event.queryStringParameters` (`get-game.js:10-11`). "Host"
 * was a claim any caller could make by typing five characters into a URL.
 *
 * That field was the whole private-session control. `join-game.js:57-89`
 * compares what a player typed against `gameMetadata.AccessCode` and nothing
 * else — no rate limit, no lockout, no second factor. And `gameId` is FOUR
 * DIGITS with no throttling anywhere in `template-clean.yaml` (no `Throttl*`,
 * no `RouteSettings`, no WAF), so the id space is walkable. One unauthenticated
 * GET per id returned the password for every private session in the
 * environment. Closing `GET /games` (tests/games-list-authorization.js) removed
 * the free directory of ids; it did not touch this, because the ids can simply
 * be counted.
 *
 * The field is now deleted rather than gated, and section 1 is what keeps it
 * deleted. Deletion was the right move because nothing read it: PlayerPage
 * supplies the code from what the player TYPED (`:229-237`, `:1117-1127`), the
 * host already holds it because the create form chose it (`create-game.js`),
 * and GameHostPage's two `?role=host` reads want `started` (`:448`) and
 * `anonymousUntilReveal` + `categoryState` (`:1695`). Section 2 pins those
 * three so the fix cannot be "widened" into gutting the host payload.
 *
 * THE FIX THAT WOULD TAKE THE PRODUCT DOWN IS ATTACHING AN AUTHORIZER, and
 * section 3 exists to stop it. It is the obvious move and it is wrong here:
 * `CognitoAuthorizer` is configured with an `IdentitySource`, so API Gateway
 * rejects a request with no `Authorization` header BEFORE the authorizer lambda
 * runs. `RootPage.jsx:110` calls this route with a bare `fetch` to check a typed
 * four-digit code and branches on 404 to say "no such game"; behind an
 * authorizer that 404 becomes a 401 and the front door stops telling anyone
 * anything. PlayerPage's session brief (`:325`) and every participant GET under
 * `/games/{gameId}/*` fail the same way. The route stays public; only the
 * PAYLOAD is trimmed.
 *
 * NO AUTHORIZER FIXTURES HERE, DELIBERATELY. tests/games-list-authorization.js
 * is the model for those and its warning stands — this API's `CognitoAuthorizer`
 * is a CUSTOM lambda authorizer (payload 2.0, simple responses) whose context
 * lands at `event.requestContext.authorizer.lambda` with groups comma-joined,
 * NOT `.jwt.claims`. An earlier round of tests asserted the `.jwt.claims` shape
 * this API never produces and eighteen of them passed green against a broken
 * guard. This file needs none of it: the route carries no authorizer, section 3
 * asserts it must stay that way, and the events below are plain payload-2.0
 * proxy events built from the two fields the handler actually reads.
 *
 * KNOWINGLY NOT FIXED HERE: the public payload still reports
 * `visibility: 'private'`, so walking the id space still tells an attacker
 * WHICH sessions are private. That is a much smaller finding than handing over
 * their codes, PlayerPage needs the flag to show the access-code form, and it
 * is its own decision — noted so the next reader knows it was seen, not missed.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before any handler loads -----------------------------
// Poisoning require.cache by resolved path silently misses: several of these
// SDK packages exist only in the deployed bundle and cannot be resolved from
// here at all. Intercept Module._load by request name instead, the same way
// tests/persona-controls.js and tests/ai-prompt-lifecycle.js do.
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

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'] ?? v[':PK'];
        const prefix = v[':sk'] ?? v[':prefix'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand, ScanCommand,
});
stubs.set('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const getGame = require(path.join(REPO, 'lambda-functions/game/get-game.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js')).handler;

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
const say = (s) => console.log(s);
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// The handlers narrate heavily and this file asserts on payloads, not stdout.
const realLog = console.log, realWarn = console.warn, realErr = console.error;
const quiet = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => { console.log = realLog; console.warn = realWarn; console.error = realErr; };

/**
 * The secret. Deliberately unlike anything else seeded below and unlike the
 * game id, so the raw-body scan in section 1 cannot pass or fail by accident.
 */
const SECRET = 'zqx-private-code-4417';
const PRIVATE_GAME = '8431';
const PUBLIC_GAME = '8432';

function seedGame(gameId, { visibility, accessCode }) {
  store.set(key(`GAME#${gameId}`, 'METADATA'), {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    Title: 'Quarterly strategy review',
    GameType: 'poll',
    HostName: 'Ada',
    QuestionSetId: 'set-strategy',
    AIContext: 'board offsite',
    Details: 'Bring last quarter’s numbers.',
    CreatedAt: '2026-08-01T09:00:00.000Z',
    Visibility: visibility,
    AccessCode: accessCode,
    Started: true,
    HostPreferences: { anonymousUntilReveal: false },
  });
  store.set(key(`GAME#${gameId}`, 'STATE'), {
    PK: `GAME#${gameId}`, SK: 'STATE',
    State: 'ASK', CurrentQuestionId: '003', LessonNumber: 3,
    UsedQuestions: ['001', '002'], PlayedQuestions: ['001', '002'],
  });
  store.set(key(`GAME#${gameId}`, 'STATE#CATS'), {
    PK: `GAME#${gameId}`, SK: 'STATE#CATS',
    'HostMask1-8': 255, 'HostMask9-16': 3, 'HostMask17-24': 0,
    'AvailMask1-8': 255, 'AvailMask9-16': 7, 'AvailMask17-24': 0,
  });
}

/**
 * A payload-2.0 HTTP API proxy event, as API Gateway builds one for this route.
 *
 * `queryStringParameters` is OMITTED when there is no query string — API
 * Gateway does not send an empty object — which is why `noRole()` below drops
 * the key entirely rather than passing `{}`. That is the shape RootPage's bare
 * `fetch` produces, and the handler's `|| {}` on `:10` is what absorbs it.
 */
const getEvent = (gameId, query) => {
  const e = {
    version: '2.0',
    routeKey: 'GET /games/{gameId}',
    rawPath: `/games/${gameId}`,
    pathParameters: { gameId },
    headers: {},
    requestContext: {
      http: { method: 'GET', path: `/games/${gameId}` },
      routeKey: 'GET /games/{gameId}',
    },
  };
  if (query) {
    e.queryStringParameters = query;
    e.rawQueryString = new URLSearchParams(query).toString();
  }
  return e;
};

const asRole = (gameId, role) => getEvent(gameId, { role });
const noRole = (gameId) => getEvent(gameId);

/** Drive get-game and hand back both the parsed body and the raw one. */
async function fetchGame(event) {
  quiet();
  const res = await getGame(event);
  loud();
  return { status: res.statusCode, raw: res.body, body: JSON.parse(res.body) };
}

/** Every key name in a payload, at every depth. */
function allKeys(value, out = []) {
  if (Array.isArray(value)) { value.forEach((v) => allKeys(v, out)); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); allKeys(v, out); }
  }
  return out;
}

const ACCESS_CODE_KEY = /access[\s_-]*code/i;

(async () => {
  seedGame(PRIVATE_GAME, { visibility: 'private', accessCode: SECRET });
  seedGame(PUBLIC_GAME, { visibility: 'public', accessCode: undefined });

  // ------------------------------------------------------------------------
  say('\n1. the access code never leaves this route, whatever the caller claims to be');
  // REJECTS: re-adding `accessCode: gameMetadata.Item.AccessCode` to the host
  // branch. Also rejects re-adding it under any other name, and rejects the
  // lazier regression — spreading `...gameMetadata.Item` into the response,
  // which would leak it as `AccessCode` and satisfy a key-name check written
  // only for the camelCase spelling.
  //
  // `role` is swept rather than tested once because it is an unvalidated string
  // off the query string: a guard written as `role !== 'player'`, or one that
  // lowercases, or one that treats an absent role as trusted, all leave a
  // spelling that still reaches the privileged branch.

  const CLAIMS = ['host', 'player', 'HOST', 'Host', 'admin', '', 'hostx', 'host '];

  for (const role of CLAIMS) {
    const { status, raw, body } = await fetchGame(asRole(PRIVATE_GAME, role));

    await check(`?role=${JSON.stringify(role)} returns 200 and no access-code key`, () => {
      assert.strictEqual(status, 200);
      const offenders = allKeys(body).filter((k) => ACCESS_CODE_KEY.test(k));
      assert.deepStrictEqual(offenders, [],
        `the private-game access code is being returned to an unauthenticated ` +
        `caller as ${offenders.join(', ')} — this is join-game.js's only gate`);
    });

    // The value scan, which is the one that cannot be worked around by renaming.
    await check(`?role=${JSON.stringify(role)} does not contain the secret anywhere`, () =>
      assert.ok(!raw.includes(SECRET),
        `the code '${SECRET}' appears in the response body: ${raw}`));
  }

  {
    const { status, raw } = await fetchGame(noRole(PRIVATE_GAME));
    await check('and with no query string at all (RootPage\'s bare fetch)', () => {
      assert.strictEqual(status, 200);
      assert.ok(!raw.includes(SECRET), raw);
    });
  }

  // ------------------------------------------------------------------------
  say('\n2. the host payload still carries what GameHostPage actually reads');
  // REJECTS: "fixing" the leak by gutting the host branch, or by deleting the
  // branch outright. Each field below has a named call site; losing one is a
  // silent behaviour change that surfaces mid-session, not at deploy.

  {
    const { body } = await fetchGame(asRole(PRIVATE_GAME, 'host'));

    await check('started — GameHostPage.jsx:448 checkGameStatus', () =>
      assert.strictEqual(body.started, true));
    await check('anonymousUntilReveal — GameHostPage.jsx:1700, restore-from-game', () =>
      assert.strictEqual(body.anonymousUntilReveal, false,
        'an explicit false must survive; only a MISSING preference defaults to true'));
    await check('categoryState — GameHostPage.jsx:1702, bitmask restore', () => {
      assert.ok(body.categoryState, 'the category bitmasks are gone — the host ' +
        'reopens a game with every category reset');
      assert.strictEqual(body.categoryState.hostMask1_8, 255);
      assert.strictEqual(body.categoryState.availMask9_16, 7);
    });
    await check('questionSetId, details and the played/used lists are still host-only extras', () => {
      assert.strictEqual(body.questionSetId, 'set-strategy');
      assert.deepStrictEqual(body.usedQuestions, ['001', '002']);
      assert.deepStrictEqual(body.playedQuestions, ['001', '002']);
    });
  }

  {
    const { body } = await fetchGame(asRole(PRIVATE_GAME, 'player'));
    await check('the player brief still carries engagementInfo — PlayerPage.jsx:325', () =>
      assert.strictEqual(body.engagementInfo, 'Bring last quarter’s numbers.'));
    await check('and the player branch does not gain the host-only extras', () =>
      assert.strictEqual(body.questionSetId, undefined));
  }

  {
    // RootPage branches on exactly this to say "no such game". If it ever stops
    // being a 404 — including becoming a 401 — the front door goes quiet.
    const { status } = await fetchGame(noRole('0000'));
    await check('an unknown game is still a 404, which RootPage.jsx:110 branches on', () =>
      assert.strictEqual(status, 404));
  }

  // ------------------------------------------------------------------------
  say('\n3. the route is still PUBLIC in the template — the tempting fix that breaks everything');
  // REJECTS: attaching `Auth: Authorizer: CognitoAuthorizer` to this route, by
  // analogy with the GET /games fix. CognitoAuthorizer has an IdentitySource,
  // so API Gateway 401s a request with no Authorization header before the
  // authorizer lambda ever runs. RootPage.jsx:110, PlayerPage.jsx:325 and every
  // participant GET beneath this path are bare fetches with no token.

  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const start = template.indexOf('GetGameFunction:');
  await check('GetGameFunction exists in the template', () =>
    assert.ok(start !== -1, 'the function was renamed or removed'));

  // Bound at the next top-level resource key (two-space indent) so this reads
  // only this function's own events and cannot be satisfied — or tripped — by a
  // neighbouring route's block.
  const rest = template.slice(start);
  const nextResource = rest.slice(1).search(/\n {2}\S/);
  const block = nextResource === -1 ? rest : rest.slice(0, nextResource + 1);

  await check('the block is the /games/{gameId} route and only that route', () => {
    const paths = (block.match(/^\s*Path:.*$/gm) || []).map((s) => s.trim());
    assert.deepStrictEqual(paths, ['Path: /games/{gameId}']);
  });
  await check('it is the GET', () =>
    assert.ok(/^\s*Method:\s*GET\s*$/m.test(block), block));
  await check('and it carries NO authorizer', () =>
    assert.ok(!/^\s*Auth:\s*$/m.test(block) && !/Authorizer:/.test(block),
      'GET /games/{gameId} now requires a token. RootPage cannot check a typed ' +
      'code, PlayerPage cannot load the brief, and the join flow 401s. The leak ' +
      'is fixed by trimming the PAYLOAD, not by closing the route.'));

  // ------------------------------------------------------------------------
  say('\n4. and the control the leak defeated still works');
  // REJECTS: a regression in join-game.js's comparison. The access code is only
  // worth keeping out of section 1's payload if it is still the thing that gates
  // a private room, so the gate is pinned in the same file as the leak.

  const join = async (gameId, body) => {
    quiet();
    const res = await joinGame({ pathParameters: { gameId }, body: JSON.stringify(body) });
    loud();
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  await check('a private game refuses a join with no code (401)', async () => {
    const r = await join(PRIVATE_GAME, { playerName: 'mallory' });
    assert.strictEqual(r.status, 401);
  });

  await check('a private game refuses the WRONG code (403)', async () => {
    const r = await join(PRIVATE_GAME, { playerName: 'mallory', accessCode: 'not-it' });
    assert.strictEqual(r.status, 403);
  });

  // REJECTS: a refusal that echoes the expected code back in its message — the
  // same leak through a different door.
  await check('and the refusal does not name the code it wanted', async () => {
    const r = await join(PRIVATE_GAME, { playerName: 'mallory', accessCode: 'not-it' });
    assert.ok(!JSON.stringify(r.body).includes(SECRET), JSON.stringify(r.body));
  });

  await check('the RIGHT code is admitted', async () => {
    const r = await join(PRIVATE_GAME, { playerName: 'ada', accessCode: SECRET });
    assert.strictEqual(r.status, 200, 'a legitimate participant was locked out');
    assert.strictEqual(r.body.success, true);
  });

  await check('a public game needs no code', async () => {
    const r = await join(PUBLIC_GAME, { playerName: 'grace' });
    assert.strictEqual(r.status, 200);
  });

  // ------------------------------------------------------------------------
  say('\n5. the handler does not read the attribute at all, not even to log it');
  // REJECTS: keeping the read and writing it somewhere other than the response
  // — `console.log('code', gameMetadata.Item.AccessCode)`, or stashing it in a
  // local for a later "debug" line. Section 1 scans the BODY, so a mutation
  // that only logs leaves every assertion above green while writing the
  // password of every private session into CloudWatch, on a route that is
  // public and unauthenticated so anyone can trigger the write at will.
  // Verified: with section 1 in place and this absent, that mutation survives.
  //
  // Comments are stripped first — the header above quotes the deleted line on
  // purpose, and this must pin the CODE, not the prose about it.
  {
    const source = fs.readFileSync(path.join(REPO, 'lambda-functions/game/get-game.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    await check('get-game.js never touches Item.AccessCode outside comments', () =>
      assert.ok(!/AccessCode/.test(code),
        'the access code is still being read here; the only safe number of reads is zero'));
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { loud(); console.error('harness error:', e); process.exit(2); });
