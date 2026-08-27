/**
 * Which beat of RESULTS the room is on.
 *
 * RESULTS is two beats (config/hostControls.js): the tally, then "What We
 * Heard" — the AI's read-back of the round. Which one is showing used to be
 * client-only React state in GameHostPage (`resultsBeat`), and that had three
 * consequences:
 *
 *   1. the phone remote could not drive it. There was no display channel at
 *      all — every host WebSocket type is a game-state fact, and the only
 *      display commands were `postMessage` into a window the remote itself had
 *      opened, which is useless across devices and across-devices is the entire
 *      point of scanning the QR;
 *   2. the stage could not tell the phone it had moved, so the phone's own
 *      RESULTS control skipped the beat and offered "Next Round" while the
 *      room was reading the discussion prompt;
 *   3. a host page reload landed back on the tally.
 *
 * So the beat is a durable fact on the ROUND# record, and this endpoint is the
 * one writer. Both surfaces then read one source of truth: the stage over
 * `stageBeatChanged`, the phone over `get-game-state`'s `stageBeat` (the remote
 * holds no socket — see HostRemote.jsx's note on host-row eviction).
 *
 * BIDIRECTIONAL. The host's own stage button posts here too. Tap it on the
 * projector and the phone follows; tap it on the phone and the projector
 * follows.
 *
 * PER ROUND, NOT PER GAME — the same reason reveal-authors.js is. The beat
 * belongs to the round whose results are showing; the next round's results must
 * open on its own tally, not inherit the previous round's discussion prompt.
 * Storing it on the STATE record would do exactly that.
 *
 * HOST ONLY — AND THIS SESSION'S HOST. The route carries the Cognito authorizer
 * (template-clean.yaml), like /close-round and /reveal-authors: a participant
 * knows the four-digit game id, and this moves what the whole room is looking
 * at. The authorizer alone only proves the caller is *a* host, though, and for
 * a long time that was the whole boundary — so the handler also asks whose
 * session this is. See the guard in the handler for what that was worth.
 *
 * IDEMPOTENT. The host is standing in front of a room; a double-tap must be a
 * no-op that still returns 200, not an error.
 *
 * NOT `gameStateChanged`. That type makes GameHostPage call restoreGameState,
 * and restoring rewrites `currentQuestionId` — the dependency that re-fires the
 * beat-reset effect at GameHostPage.jsx:313 and throws the beat away. A
 * distinct type is what lets the stage take the beat without a re-sync.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

// The closed set lives in its own module because `get-game-state.js` reads it
// too — see stage-beats.js for why a second reader moved it there.
const { BEATS } = require('./stage-beats');

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

/**
 * Tell the room. Never throws: the beat is already written by the time this
 * runs, and reporting a failure would train the host to tap again — the second
 * tap being the one that looks broken.
 */
const broadcastToGame = async (gameId, message) => {
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT
    });
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#' }
    }));

    const connections = res.Items || [];
    if (connections.length === 0) {
      console.log(`⚠️ STAGE BEAT: no active connections for game ${gameId}`);
      return;
    }

    await Promise.all(connections.map(async (conn) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: conn.ConnectionId,
          Data: JSON.stringify(message)
        }));
      } catch (err) {
        // 410 Gone == the client is long dead. Drop the row inline; PK/SK are
        // known from the connection item, so no table scan is needed. Same
        // cleanup next-question.js and get-results.js do.
        const status = err.statusCode || err.$metadata?.httpStatusCode || err.$response?.statusCode;
        if (status === 410 || err.name === 'GoneException') {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: conn.PK, SK: conn.SK }
          })).catch(() => {});
        } else {
          console.error(`❌ STAGE BEAT: broadcast failed for ${conn.ConnectionId}:`, err.message);
        }
      }
    }));

    console.log(`✅ STAGE BEAT: sent to ${connections.length} connection(s)`);
  } catch (err) {
    console.error('❌ STAGE BEAT: broadcast failed entirely (continuing):', err);
  }
};

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  const { gameId } = event.pathParameters || {};

  let body = {};
  try {
    body = JSON.parse(event.body || '{}') || {};
  } catch {
    return respond(400, { error: 'Body must be JSON' });
  }

  const { beat, questionNumber } = body;

  if (!gameId) {
    return respond(400, { error: 'gameId is required' });
  }

  if (!BEATS.includes(beat)) {
    return respond(400, { error: `beat must be one of: ${BEATS.join(', ')}` });
  }

  // The question number becomes part of the SK, so anything that is not a plain
  // round number is rejected rather than padded. `''` would pass a bare presence
  // check and pad to '000'; any other junk writes a ROUND#<junk> item into the
  // game's partition that nothing will ever read again. Same guard, same
  // reasoning, as reveal-authors.js.
  if (!/^\d+$/.test(String(questionNumber ?? '').trim())) {
    return respond(400, { error: 'a numeric questionNumber is required' });
  }

  const padded = String(questionNumber).trim().padStart(3, '0');
  const now = new Date().toISOString();

  try {
    /*
      WHOSE ROOM IS THIS? The Cognito authorizer above says the caller is *a*
      host; until this read, nothing said they were THIS session's host. The
      owning org lives on METADATA — STATE does not carry it — so this is one
      extra GetItem, the same one start-game.js and next-question.js pay.
      404 rather than 403: see tenant.callerMayDriveSession.

      THE BEAT IS A WRITE GRANT, which is why this matters more here than the
      "idempotent and reversible" note in the header suggests. comments.js is
      deliberately public — participants hold no Cognito identity — and its gate
      is two table facts: STATE is `RESULTS#nnn`, and THIS attribute is
      `feedback`. Its header names this route as the thing that is not public.
      So while this was unscoped, posting `{beat:'feedback'}` at any of the
      9,000 four-digit ids opened somebody else's round for comment by anyone
      holding the code — and those rows are written encrypted under the VICTIM
      org's key, into their round report and their session report. The beat
      undoes; the comments do not.
    */
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return respond(404, { error: 'Game not found' });
    }

    // UPDATE, never PUT. AuthorsRevealed lives on this same item, and a PUT here
    // would un-reveal a round get-results had already revealed — every
    // attributed answer on the stage would go back in the box the moment the
    // host asked for the read-back.
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `ROUND#${padded}` },
      UpdateExpression: 'SET #beat = :beat, #updatedAt = :now, #qn = :qn',
      ExpressionAttributeNames: {
        '#beat': 'StageBeat', '#updatedAt': 'UpdatedAt', '#qn': 'QuestionNumber'
      },
      ExpressionAttributeValues: { ':beat': beat, ':now': now, ':qn': padded }
    }));

    await broadcastToGame(gameId, {
      type: 'stageBeatChanged',
      gameId,
      questionNumber: padded,
      beat,
      timestamp: now
    });

    return respond(200, { status: 'OK', gameId, questionNumber: padded, beat });
  } catch (error) {
    console.error('❌ Stage beat error:', error);
    return respond(500, { error: 'Failed to set the stage beat' });
  }
};

/** Re-exported so a test can assert the vocabulary without driving the handler.
 *  The canonical list is `./stage-beats.js`. */
exports.BEATS = BEATS;
