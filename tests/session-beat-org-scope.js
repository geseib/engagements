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
 * ── WHY THE BEAT WAS THE SHARP ONE, UNTIL 26 SEP 2026 ───────────────────────
 *
 * The beat was reversible and idempotent, so on its own it read as a prank —
 * somebody else's projector jumping between the tally and the read-back. The
 * round-feedback feature made it a WRITE GRANT: until that date, a comment
 * required BOTH `STATE === RESULTS#nnn` AND `ROUND#nnn.StageBeat ===
 * 'feedback'`, so an unscoped `stage-beat` handed a stranger the second half
 * of a gate the comment route trusted. Section 2 below used to assert exactly
 * that chain, and it is why this file exists rather than one more line in
 * `session-org-ownership.js`: the source scan there proves the guard is
 * CALLED, and this proved the write never landed.
 *
 * ── WHAT CHANGED, AND WHY THIS FILE STILL EXISTS ────────────────────────────
 *
 * The owner's ruling that day (see `comments.js`'s header) dropped the beat
 * requirement entirely: a player's own "Feedback" button posts a comment on
 * ANY beat of RESULTS, with no host action and no identity at all. That makes
 * the beat-hijack chain moot for comments specifically — a comment was never
 * going to need a hijacked beat again, because it needs no beat at all — but
 * it does NOT reopen the actual hole this file was written to close: a rival
 * org's HOST still cannot move this room's stage, reveal its authors, or make
 * this session's projector do anything (sections 1, 3, 4, 5, unchanged). What
 * section 2 asserts now is the piece that WAS always doing real work
 * underneath the old chain and still is: a comment lands encrypted under the
 * ROOM's own organisation no matter who posts it, because the public route
 * reads the org off the session row and never off the caller — there was
 * never an identity to read it from.
 *
 * // rejects: a cross-org caller opening a feedback round, revealing a rival's
 * //          authors, or either handler calling the guard and ignoring it.
 */
const suiteFinished = require('./helpers/finish-guard');
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

/*
  A KMS THAT BEHAVES THE WAY THE KEY POLICY WILL — needed as of the 26 Sep
  2026 ruling below, which is the first time this file's comment write
  actually REACHES `encryptItem` rather than being refused before it. Copied
  from `ai-summary-briefing.js`, the established pattern for this repo.
*/
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrapKey = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrapKey(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId !== ctx) throw new Error('InvalidCiphertextException: encryption context mismatch');
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

const { handler: stageBeat } = require(path.join(REPO, 'lambda-functions/game/stage-beat.js'));
const { handler: revealAuthors } = require(path.join(REPO, 'lambda-functions/game/reveal-authors.js'));
const { handler: comments } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
const tenantCrypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));

/** Give an org a real data key, the way `create-org` does. */
async function mintOrg(orgId) {
  const blob = await tenantCrypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  tenantCrypto.forgetOrg(orgId);
}

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

  console.log('\n2. the public comment route: what the 26 Sep 2026 ruling changed here, and what it did not');

  /*
    UNTIL 26 SEP 2026 this section asserted the opposite of what follows: with
    the beat refused above, `comments.js`'s second gate fact
    (`ROUND#nnn.StageBeat === 'feedback'`) meant the write window was never
    opened, so a rival's hijacked beat was the ONLY door in and closing that
    door (section 1) closed this one too.

    The owner's ruling that day removed that second fact entirely — see
    comments.js's header. A player's own "Feedback" button posts here with NO
    host action and no identity at all, on ANY beat of RESULTS, which is
    exactly how "a stranger" reaches this route too: `comments.js` has never
    checked who is asking, only whether the room is on this round's results
    right now (fact (1), unaffected by any of this). So a comment from anybody
    holding the four-digit code now succeeds the moment results are showing —
    which is no more than a real participant in ORG_A's own room could already
    do, and was always the point of the player-initiated button.

    WHAT IS STILL TRUE, and is what this section asserts now instead:

      - stage-beat and reveal-authors are still scoped to the owning org
        (sections 1 and 4) — a rival's HOST still cannot force this room's
        stage, and that was always the actual hole this file exists to close.
      - a comment always lands encrypted under the ROOM'S OWN organisation,
        never the caller's — `orgOf(meta)` reads it off the session row, which
        a public, identity-less route cannot do any other way.
      - fact (1) is untouched: a comment for a round the session is not
        currently showing is still refused, cross-org or not (section 2b).
  */
  await mintOrg(ORG_A);
  const strangerComment = await postComment('4242', COMMENT);
  check('anyone holding the code may comment once results are showing — the beat is no longer the gate', () =>
    assert.strictEqual(strangerComment.statusCode, 201,
      `got ${strangerComment.statusCode}: ${strangerComment.body}`));

  const writtenRow = [...store.values()]
    .find((i) => i.PK === 'GAME#4242' && String(i.SK).startsWith('COMMENT#'));
  check('the row exists and is not stored as plaintext', () => {
    assert.ok(writtenRow, 'no comment row was written');
    assert.notStrictEqual(writtenRow.Text, COMMENT.text, 'the comment was stored unencrypted');
  });

  const decryptedForOwner = await tenantCrypto.decryptItem(ORG_A, 'comment', writtenRow);
  check('it decrypts cleanly under the ROOM\'S OWN organisation', () =>
    assert.strictEqual(decryptedForOwner.Text, COMMENT.text));

  let rivalDecryptFailed = false;
  try { await tenantCrypto.decryptItem(ORG_B, 'comment', writtenRow); } catch { rivalDecryptFailed = true; }
  check('but never under the rival organisation\'s key', () =>
    assert.ok(rivalDecryptFailed, 'the rival org could read a comment it never wrote into'));

  console.log('\n2b. …and fact (1) — the state check — is unaffected by any of this');

  seedGame('4243');
  await mintOrg(ORG_A);
  put({ PK: 'GAME#4243', SK: 'STATE', State: 'RESULTS#002', LessonNumber: 2 });
  const wrongRoundComment = await postComment('4243', COMMENT);
  check('a comment for a round the session is not showing is still refused', () =>
    assert.strictEqual(wrongRoundComment.statusCode, 409,
      `got ${wrongRoundComment.statusCode}: ${wrongRoundComment.body}`));

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
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
