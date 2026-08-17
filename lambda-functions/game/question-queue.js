/**
 * THE QUEUE'S ONE WRITER — `GET`/`POST /games/{gameId}/queue`.
 *
 * The owner asked to line several questions up during a round and have them
 * fire only when the round ends, with the list visible locally and stored in
 * the backend. This is the "stored in the backend" half; `next-question.js`
 * drains it, and `config/questionQueue.js` (mirrored here as `queue-order.js`)
 * owns what the ordering MEANS.
 *
 * ── THE CLIENT SENDS AN OPERATION. NEVER AN ARRAY. ─────────────────────────
 *
 * `{ op, questionKey, expectedVersion }`, replayed server-side against the list
 * this handler has JUST read. That is the entire design, and the reason is that
 * there are two live host surfaces, not one:
 *
 *   the stage panel, and the phone remote — which holds no socket and polls
 *   `/state` every 2s (HostRemote.jsx), so it is a beat behind BY DESIGN.
 *
 * A whole-array PUT from either one is a snapshot of the queue as it was up to
 * two seconds ago. Two hosts, or one host with a phone in their hand and a
 * projector in front of them, and the second write silently erases the first
 * with a 200 and no sign anywhere that anything was lost. Worse, the naive
 * repair — an optimistic-lock retry that re-sends the SAME array on conflict —
 * looks identical in every test except a real race: the loser re-reads, sees
 * the winner's edit, and then overwrites it with its own stale snapshot. Step 4
 * of the loop below re-applies the OPERATION, not the array, which is what
 * makes both edits land. `tests/question-queue-race.js` drives exactly that
 * interleaving.
 *
 * ── expectedVersion IS ADVISORY, AND THAT IS DELIBERATE ────────────────────
 *
 * A mismatch does NOT refuse the write. It applies the op anyway and answers
 * `staleView: true`, because the surface most likely to be behind is the phone,
 * and the phone is where the host's thumb is. Rejecting on mismatch would mean
 * a remote two seconds out of date can never press a button — the queue would
 * appear frozen precisely while the session is busiest. The host's INTENT ("put
 * this one next") is still perfectly meaningful against a list that has moved;
 * the flag is there so the surface knows to re-render from what came back
 * rather than from what it thought it had.
 *
 * ── WHY NOT `gameStateChanged` ─────────────────────────────────────────────
 *
 * `questionQueueChanged` is its own type. `stage-beat.js:40-43` records what
 * reusing `gameStateChanged` costs: it makes GameHostPage call
 * `restoreGameState`, restoring rewrites `currentQuestionId`, and every piece
 * of round-local state hanging off that dependency is thrown away. Reordering a
 * queue must not re-sync the room.
 *
 * ── 90 DAYS, NOT 24 HOURS ──────────────────────────────────────────────────
 *
 * The queue rides the SESSION's lifetime (`TTL_CREATION_PHASE`), not a round's.
 * A facilitator can build a running order a week before the session; the 24h
 * TTL that `QUESTION#<nnn>#REF` uses would quietly delete that plan before
 * anybody walked into the room, and the failure would look like the feature
 * never worked rather than like an expiry.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { resolveSetPartition } = require('./set-version');
const { QUEUE_OPS, applyQueueOp, normaliseQueue } = require('./queue-order');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * THE SESSION'S TTL, and it is `schema-compliant-manager.js`'s TTL_CREATION_PHASE.
 *
 * Copied rather than imported for the reason `set-version.js` lives in three
 * directories: a Lambda package is rooted at its `CodeUri`
 * (`lambda-functions/game/`), so `require('../websocket/…')` resolves in the
 * repo and throws MODULE_NOT_FOUND in the deployed bundle — a fault that no
 * local test can see. `tests/question-queue-flow.js` asserts this number equals
 * the one `schema-compliant-manager.js` actually exports, so the copy cannot
 * drift silently; that assertion is the import, in the only form that survives
 * packaging.
 */
const TTL_CREATION_PHASE = 90 * 24 * 60 * 60; // 90 days — see above before editing

/** Attempts, and the gap between them. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = Number(process.env.QUEUE_RETRY_BASE_MS || 100);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});

const queueKey = (gameId) => ({ PK: `GAME#${gameId}`, SK: 'QUEUE' });

/**
 * The one payload shape, used by BOTH the GET here and the `questionQueue`
 * block `get-game-state.js` hands the polling remote. Two shapes would be two
 * parsers on the same surface, and the remote reads both.
 */
const projectQueue = (item) => ({
  queue: normaliseQueue(item && item.Queue),
  version: Number(item && item.Version) || 0,
  setId: (item && item.SetId) || null,
  setVersion: item && item.SetVersion !== undefined ? item.SetVersion : null,
  updatedAt: (item && item.UpdatedAt) || null,
});

/**
 * Tell the room — or rather, tell the other host surface.
 *
 * Never throws. The write has already landed by the time this runs, and
 * reporting a failure would train the host to press again; the second press is
 * the one that looks broken. Same contract as `stage-beat.js`.
 */
const broadcastToGame = async (gameId, message) => {
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT,
    });

    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#' },
    }));

    const connections = res.Items || [];
    if (connections.length === 0) {
      console.log(`⚠️ QUEUE: no active connections for game ${gameId}`);
      return;
    }

    await Promise.all(connections.map(async (conn) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: conn.ConnectionId,
          Data: JSON.stringify(message),
        }));
      } catch (err) {
        // 410 Gone == the client is long dead. Drop the row inline; PK/SK come
        // from the connection item itself, so no Scan is needed. Same cleanup
        // stage-beat.js and next-question.js do — and the reason this function
        // needs DeleteItem, which DynamoDBWritePolicy does NOT grant.
        const status = err.statusCode || err.$metadata?.httpStatusCode || err.$response?.statusCode;
        if (status === 410 || err.name === 'GoneException') {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: conn.PK, SK: conn.SK },
          })).catch(() => {});
        } else {
          console.error(`❌ QUEUE: broadcast failed for ${conn.ConnectionId}:`, err.message);
        }
      }
    }));

    console.log(`✅ QUEUE: announced to ${connections.length} connection(s)`);
  } catch (err) {
    console.error('❌ QUEUE: broadcast failed entirely (continuing):', err);
  }
};

/** The set this game plays, so the queue records what it was built against. */
const resolveGameSet = async (gameId) => {
  const metadata = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
  }));

  if (!metadata.Item) return null;

  const setId = metadata.Item.QuestionSetId;
  if (!setId) return { setId: null, version: null };

  const resolved = await resolveSetPartition(
    db, process.env.TABLE_NAME, setId, metadata.Item.QuestionSetVersion
  );
  return { setId, version: resolved.version };
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === 'OPTIONS') return respond(200, {});

  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'gameId is required' });

  try {
    if (method === 'GET') {
      const current = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: queueKey(gameId),
      }));
      // A game that has never queued anything has no QUEUE row, and that is an
      // empty queue at version 0 — not a 404. The panel must be able to render
      // before the host has pressed anything.
      return respond(200, { gameId, ...projectQueue(current.Item) });
    }

    if (method !== 'POST') return respond(405, { error: `${method} is not supported` });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}') || {};
    } catch {
      return respond(400, { error: 'Body must be JSON' });
    }

    const { op, expectedVersion } = body;
    const key = body.questionKey ?? body.questionId ?? body.key;

    /*
      A CLOSED ENUM, REFUSED OUT LOUD — the same 400 stage-beat.js gives an
      unknown beat, for the same reason. `applyQueueOp` would answer
      `refused: 'unknown-op'` and change nothing, which is right for a pure
      function replaying whatever it is handed; but on the wire an op this
      build has never heard of means a client from a different deploy, and
      swallowing that as a cheerful 200 is how a rename ships half-done and
      nobody finds out for a week.
    */
    if (!QUEUE_OPS.includes(op)) {
      return respond(400, { error: `op must be one of: ${QUEUE_OPS.join(', ')}` });
    }
    if (!String(key ?? '').trim()) {
      return respond(400, { error: 'questionKey is required' });
    }

    const gameSet = await resolveGameSet(gameId);
    if (!gameSet) return respond(404, { error: 'Game not found' });

    let staleView = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 1. READ. Every attempt re-reads, including the retries — a retry that
      //    reuses the list from the failed attempt is the bug this loop exists
      //    to avoid.
      const current = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: queueKey(gameId),
      }));

      const item = current.Item;
      const queue = normaliseQueue(item && item.Queue);
      const version = Number(item && item.Version) || 0;

      // Advisory only: recorded and reported, never a refusal. See the header.
      if (expectedVersion !== undefined && expectedVersion !== null
        && Number(expectedVersion) !== version) {
        staleView = true;
      }

      // 2. APPLY, to the list JUST READ.
      const result = applyQueueOp(queue, { op, questionKey: key });

      if (!result.changed) {
        // Nothing to write, so nothing is written and nothing is announced.
        // A press that could not do anything costs zero writes and still
        // answers 200 with the reason — `full`, `duplicate`, `at-edge`,
        // `not-queued` — because "why did that button do nothing" is the
        // question the host will ask.
        return respond(200, {
          gameId,
          ...projectQueue(item),
          changed: false,
          refused: result.refused,
          staleView,
        });
      }

      const now = new Date().toISOString();
      const nextVersion = version + 1;

      try {
        // 3. WRITE, conditional on the version being exactly the one just read.
        //    `attribute_not_exists` covers the very first write, where there is
        //    no row and therefore no version to match.
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: queueKey(gameId),
          UpdateExpression: 'SET #queue = :queue, #version = :next, #setId = :setId, '
            + '#setVersion = :setVersion, #updatedAt = :now, #ttl = :ttl',
          ConditionExpression: 'attribute_not_exists(#version) OR #version = :expected',
          ExpressionAttributeNames: {
            '#queue': 'Queue',
            '#version': 'Version',
            '#setId': 'SetId',
            '#setVersion': 'SetVersion',
            '#updatedAt': 'UpdatedAt',
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':queue': result.queue,
            ':next': nextVersion,
            ':expected': version,
            ':setId': gameSet.setId,
            // Which VERSION of the set this running order was built against.
            // next-question.js refuses to serve from a queue whose set has been
            // replaced underneath it — the keys would name questions that are
            // no longer in the partition the game reads.
            ':setVersion': gameSet.version,
            ':now': now,
            ':ttl': Math.floor(Date.now() / 1000) + TTL_CREATION_PHASE,
          },
        }));

        await broadcastToGame(gameId, {
          type: 'questionQueueChanged',
          gameId,
          version: nextVersion,
          queue: result.queue,
          timestamp: now,
        });

        return respond(200, {
          gameId,
          queue: result.queue,
          version: nextVersion,
          setId: gameSet.setId,
          setVersion: gameSet.version,
          updatedAt: now,
          changed: true,
          refused: null,
          staleView,
        });
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') throw error;

        // 4. LOST THE RACE. Go round again: RE-READ and RE-APPLY THE OP. Not
        //    the array — re-sending the array is what discards the winner's
        //    edit while looking, in every test but a real interleaving, like a
        //    working retry.
        console.log(`🔁 QUEUE: version ${version} was taken for game ${gameId}; re-reading (attempt ${attempt}/${MAX_ATTEMPTS})`);
        if (attempt === MAX_ATTEMPTS) {
          return respond(409, {
            error: 'The queue was being changed elsewhere; try again',
            gameId,
            attempts: MAX_ATTEMPTS,
          });
        }
        await sleep(RETRY_BASE_MS * attempt);
      }
    }

    // Unreachable: the loop either returns or exhausts its attempts above.
    return respond(409, { error: 'The queue could not be updated', gameId });
  } catch (error) {
    console.error('❌ Question queue error:', error);
    return respond(500, { error: 'Failed to read or change the question queue' });
  }
};

// Exported for the tests that pin the TTL against schema-compliant-manager.js
// and the retry budget against the race fixture. Not part of the wire contract.
exports.TTL_CREATION_PHASE = TTL_CREATION_PHASE;
exports.MAX_ATTEMPTS = MAX_ATTEMPTS;
