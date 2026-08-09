/**
 * Who is allowed to CLOSE a round, and who is only allowed to READ one?
 *
 * `POST /games/get-results` is public — it has to be, because PlayerPage calls
 * it with a plain `fetch` the moment the room enters RESULTS. But the same
 * handler also performs a state transition: it writes STATE = RESULTS#nnn,
 * flips `AuthorsRevealed` on the round (which is what ENDS THE ROOM'S
 * ANONYMITY), awards scores and announces the move to every connection.
 *
 * So until this file existed, any participant who could read the four-digit
 * game id off the projector could force the whole room forward from their
 * phone and strip the anonymity of a round mid-vote — and, because get-results
 * does not redact, be handed every author's name in the response while doing
 * it.
 *
 * The split this file pins:
 *
 *   - the TRANSITION is host-only. It happens on the authenticated route
 *     `POST /games/{gameId}/close-round` and nowhere else.
 *   - the READ stays public and byte-identical for players, but ONLY once the
 *     round it asks about is already resolved. Then there is nothing left to
 *     transition and the call cannot change anything.
 *
 * Both halves are load-bearing. Assertions about the refusal alone would pass
 * against a handler that had simply stopped working for players.
 *
 * FAIL CLOSED: an event with no route information at all is not a host. A
 * caller that cannot prove it came through the authenticated route does not
 * get the transition.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

let sent = [];

/** Honest UpdateCommand applier: a stub that returned {} would hide the bug. */
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
    item[attr] = values[rhs];
  }
  store.set(k, item);
  return {};
}

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
      case 'update':
        return applyUpdate(inp);
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
    return {};
  }
}

const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'game'),
  path.join(REPO, 'lambda-functions', 'websocket'),
];

function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: FakeApiGatewayClient,
  PostToConnectionCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const itemAt = (gameId, sk) => store.get(key(`GAME#${gameId}`, sk));
const stateOf = (gameId) => itemAt(gameId, 'STATE');
const snap = (gameId, sk) => JSON.stringify(itemAt(gameId, sk) ?? null);

/**
 * The two ways in.
 *
 * `requestContext.routeKey` is stamped by API Gateway from the route that
 * actually matched, so it cannot be forged in a request body or header — which
 * is exactly why the gate reads it rather than anything the caller sends.
 */
const hostEvent = (gameId, questionNumber) => ({
  version: '2.0',
  routeKey: 'POST /games/{gameId}/close-round',
  rawPath: `/dev/games/${gameId}/close-round`,
  pathParameters: { gameId },
  requestContext: {
    routeKey: 'POST /games/{gameId}/close-round',
    http: { method: 'POST', path: `/dev/games/${gameId}/close-round` },
    // What the Cognito authorizer leaves behind on an authenticated route.
    authorizer: { lambda: { sub: 'host-user-id' } },
  },
  body: JSON.stringify({ questionNumber }),
});

const publicEvent = (gameId, questionNumber) => ({
  version: '2.0',
  routeKey: 'POST /games/get-results',
  rawPath: '/dev/games/get-results',
  requestContext: {
    routeKey: 'POST /games/get-results',
    http: { method: 'POST', path: '/dev/games/get-results' },
  },
  body: JSON.stringify({ gameId, questionNumber }),
});

/** Seed a game mid-round with two live connections. */
function seedGame(gameId, gameType, phase, extras = {}) {
  store.clear();
  sent = [];

  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: gameType, Title: 'Test session', HideAuthors: true });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: phase, LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });

  for (const item of extras.items || []) put(item);
}

const answer = (gameId, player, text) => ({
  PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${player}`,
  PlayerName: player, Answer: text, SubmittedAt: '2026-01-01T00:00:00.000Z',
});

/** The four exits of this handler, each seeded on the phase it closes from. */
const EXITS = [
  {
    label: 'call-and-answer with votes',
    gameType: 'call-and-answer',
    phase: 'VOTE#001',
    items: (id) => [
      answer(id, 'Ada', 'a splendid answer'),
      answer(id, 'Grace', 'another answer'),
      { PK: `GAME#${id}`, SK: 'QUESTION#001#VOTE#Ada', PlayerName: 'Ada', Votes: { 1: 1 } },
    ],
  },
  {
    label: 'call-and-answer with zero votes',
    gameType: 'call-and-answer',
    phase: 'VOTE#001',
    items: (id) => [answer(id, 'Ada', 'unloved answer')],
  },
  {
    label: 'trivia',
    gameType: 'trivia',
    phase: 'ASK#001',
    items: (id) => [{
      PK: `GAME#${id}`, SK: 'QUESTION#001#ANSWER#Ada',
      PlayerName: 'Ada', Answer: 'A', IsCorrect: true, PointsEarned: 10,
    }],
  },
  {
    label: 'wavelength',
    gameType: 'wavelength',
    phase: 'ASK#001',
    items: (id) => [
      { ...answer(id, 'Ada', 'summit,ridge'), ProcessedWords: ['summit', 'ridge'] },
      { ...answer(id, 'Grace', 'summit,valley'), ProcessedWords: ['summit', 'valley'] },
    ],
  },
];

/** Response bodies carry a wall-clock stamp; everything else must match. */
const withoutTimestamps = (body) => {
  const parsed = JSON.parse(body);
  delete parsed.timestamp;
  return JSON.stringify(parsed);
};

(async () => {
  // ------------------------------------------------------------------------
  console.log('\n1. an unauthenticated caller cannot close a round — on ANY exit');
  // enterResultsState is shared by all four exits and its own comment records
  // that the state write was once missing from two of them. Every exit is
  // driven here so the gate cannot be added to some and forgotten on others.

  for (const exit of EXITS) {
    const id = '9001';
    seedGame(id, exit.gameType, exit.phase, { items: exit.items(id) });
    const before = { state: snap(id, 'STATE'), round: snap(id, 'ROUND#001') };

    const res = await handler(publicEvent(id, 1));

    await check(`${exit.label}: refused with 403`, () =>
      assert.strictEqual(res.statusCode, 403, `got ${res.statusCode}: ${res.body}`));
    await check(`${exit.label}: the room stays on ${exit.phase}`, () =>
      assert.strictEqual(stateOf(id).State, exit.phase,
        `state moved to '${stateOf(id).State}' — a participant drove the room`));
    await check(`${exit.label}: STATE record untouched`, () =>
      assert.strictEqual(snap(id, 'STATE'), before.state));
    await check(`${exit.label}: ANONYMITY HOLDS — AuthorsRevealed not set`, () =>
      assert.notStrictEqual(itemAt(id, 'ROUND#001').AuthorsRevealed, true,
        'a participant ended the room\'s anonymity'));
    await check(`${exit.label}: ROUND record untouched`, () =>
      assert.strictEqual(snap(id, 'ROUND#001'), before.round));
    await check(`${exit.label}: nothing announced to the room`, () =>
      assert.strictEqual(sent.length, 0, `sent ${sent.length} frame(s)`));
    await check(`${exit.label}: no author names in the refusal`, () =>
      assert.ok(!res.body.includes('Ada') && !res.body.includes('Grace'), res.body));
    await check(`${exit.label}: no scores awarded`, () =>
      assert.strictEqual(
        [...store.keys()].filter((k) => k.endsWith('#SCORE')).length, 0,
        'scoring ran for a refused request'));
  }

  // ------------------------------------------------------------------------
  console.log('\n2. an event with no route information is not a host either');
  // Fail closed. A future caller that reaches this handler without proving
  // which route it came through must not inherit the host\'s privileges.
  {
    const id = '9002';
    seedGame(id, 'call-and-answer', 'VOTE#001', {
      items: [answer(id, 'Ada', 'an answer'),
        { PK: `GAME#${id}`, SK: 'QUESTION#001#VOTE#Grace', PlayerName: 'Grace', Votes: { 0: 1 } }],
    });

    const res = await handler({ body: JSON.stringify({ gameId: id, questionNumber: 1 }) });

    await check('no routeKey: refused with 403', () =>
      assert.strictEqual(res.statusCode, 403, `got ${res.statusCode}: ${res.body}`));
    await check('no routeKey: the room stays on VOTE#001', () =>
      assert.strictEqual(stateOf(id).State, 'VOTE#001'));
    await check('no routeKey: anonymity holds', () =>
      assert.notStrictEqual(itemAt(id, 'ROUND#001').AuthorsRevealed, true));
  }

  // ------------------------------------------------------------------------
  console.log('\n3. the host route still closes the round — on ANY exit');
  // The gate must not have been bought by breaking the host.

  for (const exit of EXITS) {
    const id = '9003';
    seedGame(id, exit.gameType, exit.phase, { items: exit.items(id) });

    const res = await handler(hostEvent(id, 1));

    await check(`${exit.label}: host closes with 200`, () =>
      assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));
    await check(`${exit.label}: STATE moved to RESULTS#001`, () =>
      assert.strictEqual(stateOf(id).State, 'RESULTS#001'));
    await check(`${exit.label}: the round is revealed`, () =>
      assert.strictEqual(itemAt(id, 'ROUND#001').AuthorsRevealed, true));
    await check(`${exit.label}: the room is told, host connection included`, () =>
      assert.deepStrictEqual(sent.map((s) => s.connectionId).sort(), ['host-1', 'player-1']));
  }

  // ------------------------------------------------------------------------
  console.log('\n4. gameId may come from the path on the host route');
  // The authenticated route is nested under the game (/games/{gameId}/...),
  // so unlike the public one it carries no gameId in the body.
  {
    const id = '9004';
    seedGame(id, 'trivia', 'ASK#001', {
      items: [{
        PK: `GAME#${id}`, SK: 'QUESTION#001#ANSWER#Ada',
        PlayerName: 'Ada', Answer: 'A', IsCorrect: true, PointsEarned: 10,
      }],
    });

    const res = await handler(hostEvent(id, 1));
    await check('path gameId alone is enough to close the round', () =>
      assert.strictEqual(stateOf(id).State, 'RESULTS#001', `got ${res.statusCode}: ${res.body}`));
  }

  // ------------------------------------------------------------------------
  console.log('\n5. the post-transition read is unchanged for players, and pure');
  // What PlayerPage actually does: it waits for the state to say RESULTS#nnn
  // and only then fetches. By that point the transition has happened and this
  // call has nothing left to do but report.

  for (const exit of EXITS) {
    const id = '9005';
    seedGame(id, exit.gameType, exit.phase, { items: exit.items(id) });

    const hostRes = await handler(hostEvent(id, 1));
    const afterClose = { state: snap(id, 'STATE'), round: snap(id, 'ROUND#001') };
    sent = [];

    const playerRes = await handler(publicEvent(id, 1));

    await check(`${exit.label}: player read answers 200`, () =>
      assert.strictEqual(playerRes.statusCode, 200, `got ${playerRes.statusCode}: ${playerRes.body}`));
    await check(`${exit.label}: player read is byte-identical to the host's`, () =>
      assert.strictEqual(withoutTimestamps(playerRes.body), withoutTimestamps(hostRes.body)));
    await check(`${exit.label}: player read rewrites no STATE`, () =>
      assert.strictEqual(snap(id, 'STATE'), afterClose.state,
        'the read wrote to STATE — a player could rewind the room'));
    await check(`${exit.label}: player read rewrites no ROUND record`, () =>
      assert.strictEqual(snap(id, 'ROUND#001'), afterClose.round));
    await check(`${exit.label}: player read announces nothing`, () =>
      assert.strictEqual(sent.length, 0, `re-announced ${sent.length} frame(s)`));
  }

  // ------------------------------------------------------------------------
  console.log('\n6. the public read is scoped to the round the room is actually on');
  // The gate is "this round is already resolved", not "this game has resolved
  // something". Otherwise a room sitting on RESULTS#003 would hand out the
  // authors of round 2 — a round that may have been abandoned before RESULTS
  // and is therefore still anonymous.
  {
    const id = '9006';
    seedGame(id, 'call-and-answer', 'RESULTS#003');
    put({ PK: `GAME#${id}`, SK: 'ROUND#002', QuestionNumber: '002' });
    put({ PK: `GAME#${id}`, SK: 'QUESTION#002#ANSWER#Ada', PlayerName: 'Ada', Answer: 'a hidden answer' });
    put({ PK: `GAME#${id}`, SK: 'QUESTION#002#VOTE#Grace', PlayerName: 'Grace', Votes: { 0: 1 } });

    const res = await handler(publicEvent(id, 2));

    await check('an unresolved earlier round is refused', () =>
      assert.strictEqual(res.statusCode, 403, `got ${res.statusCode}: ${res.body}`));
    await check('and its author is not named in the refusal', () =>
      assert.ok(!res.body.includes('Ada'), res.body));
    await check('and the room is not rewound to RESULTS#002', () =>
      assert.strictEqual(stateOf(id).State, 'RESULTS#003',
        `state is '${stateOf(id).State}' — a player moved the room backwards`));
  }

  // ------------------------------------------------------------------------
  console.log('\n7. padding does not decide who gets in');
  // The round arrives as 1, '1' or '001' depending on the caller; the state
  // stores it padded. Comparing the raw strings would refuse honest players.
  {
    const id = '9007';
    seedGame(id, 'trivia', 'ASK#001', {
      items: [{
        PK: `GAME#${id}`, SK: 'QUESTION#001#ANSWER#Ada',
        PlayerName: 'Ada', Answer: 'A', IsCorrect: true, PointsEarned: 10,
      }],
    });
    await handler(hostEvent(id, 1));

    for (const spelling of [1, '1', '001']) {
      const res = await handler(publicEvent(id, spelling));
      await check(`round ${JSON.stringify(spelling)} reads back fine`, () =>
        assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));
    }
  }

  // ------------------------------------------------------------------------
  console.log('\n8. a public read with no round at all follows the state');
  // PlayerPage always sends one, but the handler has always accepted the
  // omission by reading the current round off the state — which, on this path,
  // is by construction the resolved one.
  {
    const id = '9008';
    seedGame(id, 'trivia', 'ASK#001', {
      items: [{
        PK: `GAME#${id}`, SK: 'QUESTION#001#ANSWER#Ada',
        PlayerName: 'Ada', Answer: 'A', IsCorrect: true, PointsEarned: 10,
      }],
    });
    await handler(hostEvent(id, 1));
    sent = [];

    const res = await handler({
      version: '2.0',
      routeKey: 'POST /games/get-results',
      requestContext: { routeKey: 'POST /games/get-results' },
      body: JSON.stringify({ gameId: id }),
    });

    await check('omitted round on a resolved game still reads', () =>
      assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));
    await check('omitted round announces nothing', () =>
      assert.strictEqual(sent.length, 0));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
