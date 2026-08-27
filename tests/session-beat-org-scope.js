/**
 * THE STAGE BEAT AND THE REVEAL BELONG TO THE ORGANISATION THAT OWNS THE ROOM.
 *
 * ── THE HOLE ───────────────────────────────────────────────────────────────
 *
 * `session-org-ownership.js` closed this for `next-question`, `update-game` and
 * `start-game`. Two host-only session routes were left behind, and both write:
 *
 *     POST /games/{gameId}/stage-beat      moves what the room is looking at
 *     POST /games/{gameId}/reveal-authors  ends the round's anonymity
 *
 * Both carry the Cognito authorizer, so the boundary was "any `hosts` account",
 * and neither ever compared the caller's organisation to the session's. Game
 * ids are four digits (create-game.js:191), so the whole id space is 9,000
 * values and a rival's live session is found by walking it.
 *
 * ── WHY THE BEAT IS THE SHARP ONE ──────────────────────────────────────────
 *
 * The beat was reversible and idempotent, so on its own it read as a prank —
 * somebody else's projector jumping between the tally and the read-back. The
 * round-feedback feature made it a WRITE GRANT.
 *
 * `comments.js` is deliberately public, because participants hold no Cognito
 * identity, and its own header explains that the thing which is NOT public is
 * OPENING a feedback round — `stage-beat`, "which carries the Cognito
 * authorizer". The comment write gate is exactly two table facts:
 *
 *     STATE === `RESULTS#nnn`  AND  ROUND#nnn.StageBeat === 'feedback'
 *
 * So an unscoped `stage-beat` hands a stranger the second half of a gate the
 * comment route trusts. Post `{beat:'feedback'}` at a rival's live session and
 * anyone holding that code may write comments into their round — comments that
 * are stored ENCRYPTED UNDER THE VICTIM ORGANISATION'S KEY and that flow into
 * their round report and their session report. The beat is reversible; those
 * rows are not.
 *
 * That chain is what section 2 asserts, and it is why this file exists rather
 * than one more line in `session-org-ownership.js`: the source scan there
 * proves the guard is CALLED, and this proves the write never lands.
 *
 * // rejects: a cross-org caller opening a feedback round, revealing a rival's
 * //          authors, or either handler calling the guard and ignoring it.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before any handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

/** Frames the handler tried to push, in order. A refused call must push none. */
let sent = [];

/**
 * A real UpdateCommand applier, not a `return {}` stub — the same one
 * `stage-beat-flow.js` uses, and for the same reason. The assertion that
 * matters here is that the ROUND# record was NEVER TOUCHED, and a stub which
 * swallowed writes would let a handler that ignores the guard pass.
 */
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

const { handler: stageBeat } = require(path.join(REPO, 'lambda-functions/game/stage-beat.js'));
const { handler: revealAuthors } = require(path.join(REPO, 'lambda-functions/game/reveal-authors.js'));
const { handler: comments } = require(path.join(REPO, 'lambda-functions/game/comments.js'));

// ---- Harness ---------------------------------------------------------------
let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

const ORG_A = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';   // owns the room
const ORG_B = 'org_Tb2VnQ8sLxK4WmC7gRdYpF';   // the rival, holding only the code

const put = (item) => store.set(key(item.PK, item.SK), item);
const round = (gameId, padded = '001') => store.get(key(`GAME#${gameId}`, `ROUND#${padded}`));

/** An authenticated host in `orgId`. Matches the Lambda authorizer context. */
const host = (orgId) => ({
  requestContext: {
    http: { method: 'POST' },
    authorizer: { lambda: { userId: 'u', groups: 'hosts', orgId } },
  },
});

/**
 * One live session owned by ORG_A, showing round 1's results, with the round
 * record already present and NO beat yet — the state a room is in the moment
 * before its host opens the feedback round.
 */
function seedGame(gameId, { orgId = ORG_A } = {}) {
  store.clear();
  sent = [];
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA', Title: 'Their session',
    ...(orgId ? { orgId } : {}),
  });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001' });
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#p1',
    PlayerName: 'Ada', Answer: 'a private answer', SubmittedAt: '2026-08-27T10:00:00.000Z',
  });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
}

const postBeat = (gameId, event, body) =>
  stageBeat({ ...event, pathParameters: { gameId }, body: JSON.stringify(body) });

const postReveal = (gameId, event, body) =>
  revealAuthors({ ...event, pathParameters: { gameId }, body: JSON.stringify(body) });

/** The public comment route — no identity, exactly as a participant reaches it. */
const postComment = (gameId, body) => comments({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId },
  body: JSON.stringify(body),
});

const COMMENT = {
  questionNumber: 1, playerName: 'A stranger', anchorKind: 'summary',
  text: 'written into a room I do not belong to',
};

(async () => {
  console.log('1. POST /stage-beat is scoped to the owning organisation');

  seedGame('4242');
  const foreignBeat = await postBeat('4242', host(ORG_B), { beat: 'feedback', questionNumber: 1 });

  // rejects: THE HOLE.
  check('a rival organisation is refused', () =>
    assert.strictEqual(foreignBeat.statusCode, 404,
      `got ${foreignBeat.statusCode}: ${foreignBeat.body}`));

  /* 404 and not 403: a 403 confirms that a guessed code names a real session
     belonging to somebody else, which is an existence oracle over a 9,000-wide
     space. The set routes made this choice first — see
     tenant.callerMayDriveSession. */
  check('...as "not found", never as "not yours"', () =>
    assert.ok(!/forbidden|not your|permission|organisation/i.test(foreignBeat.body),
      `the body leaks that the session exists: ${foreignBeat.body}`));

  // rejects: a handler that consults the guard and then writes anyway.
  check('the beat is NOT written to the round record', () =>
    assert.strictEqual(round('4242').StageBeat, undefined,
      'the refused call still moved the room'));

  check('the room is told nothing', () =>
    assert.strictEqual(sent.length, 0, `broadcast ${sent.length} frame(s) on a refused call`));

  console.log('\n2. …so the public comment route never opens (the chain)');

  /*
    The point of the whole file. `comments.js` is public by design and gates on
    two table facts, the second of which is the beat this route writes. With the
    beat refused above, the write window was never opened — so the rival cannot
    reach the victim's round even though the comment route asks them for nothing.
  */
  const strangerComment = await postComment('4242', COMMENT);
  // rejects: a cross-org beat becoming a write grant on somebody else's round.
  check('a stranger cannot comment into the round', () =>
    assert.strictEqual(strangerComment.statusCode, 409,
      `got ${strangerComment.statusCode}: ${strangerComment.body}`));

  check('...because no feedback round was ever opened', () =>
    assert.match(JSON.parse(strangerComment.body).error || '', /has not opened a feedback round/));

  console.log('\n3. the owning organisation is unaffected');

  seedGame('4242');
  const ownBeat = await postBeat('4242', host(ORG_A), { beat: 'feedback', questionNumber: 1 });

  // rejects: closing the hole by breaking the feature.
  check('its own host still opens the feedback round', () =>
    assert.strictEqual(ownBeat.statusCode, 200, `got ${ownBeat.statusCode}: ${ownBeat.body}`));

  check('and the beat lands on the round record', () =>
    assert.strictEqual(round('4242').StageBeat, 'feedback'));

  check('and the room is told', () =>
    assert.ok(sent.some((f) => f.message.type === 'stageBeatChanged'),
      'the stage was never notified'));

  console.log('\n4. POST /reveal-authors is scoped the same way');

  seedGame('4242');
  const foreignReveal = await postReveal('4242', host(ORG_B), { questionNumber: 1 });

  // rejects: THE HOLE, second route. This one answers WITH THE NAMES.
  check('a rival organisation is refused', () =>
    assert.strictEqual(foreignReveal.statusCode, 404,
      `got ${foreignReveal.statusCode}: ${foreignReveal.body}`));

  /* The anonymity promise is made to participants explicitly (anonymity.js);
     a stranger holding four digits must not be able to break it. */
  check('no author name is returned', () =>
    assert.ok(!foreignReveal.body.includes('Ada'),
      `the refusal still handed over the roster: ${foreignReveal.body}`));

  check('AuthorsRevealed is NOT flipped', () =>
    assert.strictEqual(round('4242').AuthorsRevealed, undefined,
      'the refused call still ended the round\'s anonymity'));

  check('the room is told nothing', () =>
    assert.strictEqual(sent.length, 0, `broadcast ${sent.length} frame(s) on a refused call`));

  seedGame('4242');
  const ownReveal = await postReveal('4242', host(ORG_A), { questionNumber: 1 });
  // rejects: closing the hole by breaking the feature.
  check('its own host still reveals', () =>
    assert.strictEqual(ownReveal.statusCode, 200, `got ${ownReveal.statusCode}: ${ownReveal.body}`));

  check('and gets the authors back', () =>
    assert.ok(ownReveal.body.includes('Ada'), 'the owning host was not given the roster'));

  console.log('\n5. what this deliberately does NOT refuse');

  /*
    A session with no orgId predates tenancy or was created by an orgless host.
    Refusing those would break running rooms to close a hole they are not part
    of — see tenant.callerMayDriveSession, which makes this choice once for
    every route rather than each route making it again.
  */
  seedGame('4242', { orgId: '' });
  const orphanBeat = await postBeat('4242', host(ORG_B), { beat: 'feedback', questionNumber: 1 });
  // rejects: breaking every pre-tenancy room to close a new hole.
  check('a session with no owning org is left alone', () =>
    assert.strictEqual(orphanBeat.statusCode, 200, `got ${orphanBeat.statusCode}: ${orphanBeat.body}`));

  seedGame('4242', { orgId: '' });
  const orphanReveal = await postReveal('4242', host(ORG_B), { questionNumber: 1 });
  check('…and can still be revealed', () =>
    assert.strictEqual(orphanReveal.statusCode, 200, `got ${orphanReveal.statusCode}: ${orphanReveal.body}`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
