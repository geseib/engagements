/**
 * WHAT THE ROOM IS LOOKING AT CLOSELY — the phone's answer to "make that bigger".
 *
 * The owner: the phone remote *"should handle the happy path through the
 * session, and being able to enlarge a question, a specific response, etc."*
 *
 * ── WHY THIS IS A SERVER FACT AND NOT A postMessage ────────────────────────
 *
 * The stage can already enlarge both things. `lessonExpanded` blows up the
 * current question and `spotlightIndex` opens one response full-screen
 * (components/AnswerSpotlight.jsx), and BOTH are client-only React state in
 * GameHostPage. The only way to reach them from elsewhere is the
 * `REMOTE_COMMAND` postMessage path, which needs a window handle — so it works
 * only when the remote itself opened the projector, and is dead across devices.
 * Across devices is the entire point of scanning the QR.
 *
 * `stage-beat.js` had exactly this problem and solved it exactly this way, and
 * this file is deliberately its sibling rather than a new idea. Read that header
 * first; everything it says about being host-only, idempotent, per-round and
 * carrying its OWN WebSocket type applies here unchanged and for the same
 * reasons.
 *
 * ── PER ROUND, NOT PER GAME ────────────────────────────────────────────────
 *
 * The same rule as the beat, and here it is sharper: a focus is an index INTO A
 * ROUND'S ANSWERS. Round 4's answers are different rows from round 3's, so a
 * focus stored per game would open round 4 on "response 2" meaning whatever now
 * happens to be second — a real answer, attributed to a real person, that the
 * host never chose. Storing it on the ROUND# record makes a stale focus
 * impossible rather than unlikely.
 *
 * ── THE INDEX IS NOT RANGE-CHECKED HERE, AND THAT IS DELIBERATE ────────────
 *
 * Validating it would mean querying the round's answers on every tap, on the
 * one control a host presses while a room waits. The count also moves under us:
 * on a call-and-answer round the rows are still arriving. So the contract is
 * "a non-negative integer", and the SURFACE clamps — GameHostPage ignores a
 * focus it cannot resolve rather than opening an empty spotlight. An index that
 * is briefly out of range resolves itself the moment the next answer lands.
 *
 * ── 'none' IS A VALUE, NOT AN ABSENCE ──────────────────────────────────────
 *
 * Closing the spotlight is a thing the host DID, and it has to travel. Deleting
 * the attribute instead would make "the host closed it" and "nobody has opened
 * one this round" the same state on the wire, and the phone could not draw a
 * close button that reflects reality.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * A CLOSED SET, for the reason BEATS is closed in stage-beat.js: an open enum's
 * worst failure is that everything succeeds. The write lands, the frame goes
 * out, every client compares the value against the three it knows, and the host
 * watches a button do nothing with no error anywhere in the system.
 */
const FOCUS_KINDS = ['none', 'question', 'answer'];

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

/**
 * Tell the room. Never throws — the focus is written by the time this runs, and
 * reporting a failure would train the host to tap again, the second tap being
 * the one that looks broken. Dead connections are reaped inline, which is why
 * the function's policy is Crud and not Write (DynamoDBWritePolicy grants no
 * DeleteItem — see template-clean.yaml).
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

    await Promise.all(connections.map(async (connection) => {
      const connectionId = connection.ConnectionId || String(connection.SK).replace('CONNECTION#', '');
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(message)
        }));
      } catch (err) {
        // 410 Gone is a connection that has closed. Drop the row rather than
        // retrying it on every future broadcast for the rest of the session.
        const status = err.statusCode || err.$metadata?.httpStatusCode;
        if (status === 410) {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `CONNECTION#${connectionId}` }
          })).catch(() => {});
        }
      }
    }));

    console.log(`✅ STAGE FOCUS: sent to ${connections.length} connection(s)`);
  } catch (err) {
    console.error('❌ STAGE FOCUS: broadcast failed entirely (continuing):', err);
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

  const { focus, index, questionNumber } = body;

  if (!gameId) {
    return respond(400, { error: 'gameId is required' });
  }

  if (!FOCUS_KINDS.includes(focus)) {
    return respond(400, { error: `focus must be one of: ${FOCUS_KINDS.join(', ')}` });
  }

  /*
    The question number becomes part of the SK, so anything that is not a plain
    round number is rejected rather than padded. `''` passes a bare presence
    check and pads to '000'; any other junk writes a ROUND#<junk> row into the
    game's partition that nothing will ever read again. Same guard, same
    reasoning, as stage-beat.js and reveal-authors.js.
  */
  if (!/^\d+$/.test(String(questionNumber ?? '').trim())) {
    return respond(400, { error: 'a numeric questionNumber is required' });
  }

  /*
    An 'answer' focus without an index is the request that would open a
    spotlight on nothing. Refused rather than defaulted to 0: defaulting would
    put a specific person's response on a wall because a client forgot a field.
    'question' and 'none' carry no index and storing whatever arrived with them
    would leave a stale number for the next reader to misinterpret.
  */
  let storedIndex = null;
  if (focus === 'answer') {
    if (!/^\d+$/.test(String(index ?? '').trim())) {
      return respond(400, { error: 'an answer focus requires a non-negative integer index' });
    }
    storedIndex = Number(index);
  }

  const padded = String(questionNumber).trim().padStart(3, '0');
  const now = new Date().toISOString();

  try {
    /*
      WHOSE ROOM IS THIS? The Cognito authorizer says the caller is *a* host;
      until this read, nothing said they were THIS session's host, so the
      boundary was "any `hosts` account plus one of the 9,000 four-digit ids".

      The header above already says what this route does that /stage-beat does
      not: it puts ONE NAMED PERSON'S RESPONSE full-screen on a wall. Unscoped,
      that was a stranger reaching into a room they had never been in and
      choosing whose answer everyone looks at.

      One extra GetItem, the same one start-game.js and stage-beat.js pay: the
      owning org lives on METADATA and this handler otherwise touches only the
      ROUND# record. 404 rather than 403: see tenant.callerMayDriveSession.
    */
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return respond(404, { error: 'Game not found' });
    }

    /*
      UPDATE, NEVER PUT. `AuthorsRevealed` and `StageBeat` live on this same
      item. A PUT here would un-reveal a round get-results had already revealed
      — every attributed answer on the stage going back in the box because the
      host enlarged one of them — and would throw the round back to its tally.
    */
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `ROUND#${padded}` },
      UpdateExpression: 'SET #focus = :focus, #idx = :idx, #updatedAt = :now, #qn = :qn',
      ExpressionAttributeNames: {
        '#focus': 'StageFocus',
        '#idx': 'StageFocusIndex',
        '#updatedAt': 'UpdatedAt',
        '#qn': 'QuestionNumber'
      },
      ExpressionAttributeValues: {
        ':focus': focus, ':idx': storedIndex, ':now': now, ':qn': padded
      }
    }));

    await broadcastToGame(gameId, {
      type: 'stageFocusChanged',
      gameId,
      questionNumber: padded,
      focus,
      index: storedIndex,
      timestamp: now
    });

    return respond(200, { status: 'OK', gameId, questionNumber: padded, focus, index: storedIndex });
  } catch (error) {
    console.error('❌ Stage focus error:', error);
    return respond(500, { error: 'Failed to set the stage focus' });
  }
};
