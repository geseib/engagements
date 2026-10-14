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
const { normaliseScoreboard, scoreboardWrite, revAfter, scoreboardFrame } = require('./scoreboard-state');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { callerMayDriveSession } = require('./tenant');
const { ttlFrom, ROUND_RECORD_DAYS } = require('./session-ttl');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * A CLOSED SET, for the reason BEATS is closed in stage-beat.js: an open enum's
 * worst failure is that everything succeeds. The write lands, the frame goes
 * out, every client compares the value against the three it knows, and the host
 * watches a button do nothing with no error anywhere in the system.
 */
/*
 * 'join' puts the join code and QR on the wall mid-session (owner,
 * 2026-10-13: "when presenting i still need ability to show qr code"). Like
 * 'question', it carries no index, part or phase. Mirrored in
 * src/src/config/stageFocus.js (tests/stage-focus-vote.js §8).
 */
const FOCUS_KINDS = ['none', 'question', 'answer', 'join'];

/**
 * THE PHASES AN ANSWER FOCUS MAY BE SET IN (two-surface PLAN 1.10, D5), a
 * closed set mirrored in src/src/config/stageFocus.js (tests/stage-focus-vote.js
 * §7). The index means a different order in each: the voting order every
 * ballot shows during VOTE (answer-order.js), tally order at RESULTS. So the
 * phase is STAMPED, from STATE — never taken from the client — and
 * get-game-state hands a focus back only in the phase it was stamped for.
 */
const { FOCUS_PHASES } = require('./stage-beats');

/** The most parts one response may be split into on the wall. */
const MAX_PARTS = 9;

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

  const { focus, index, questionNumber, part, parts } = body;

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

  /*
    THE PART OF A LONG RESPONSE (two-surface D1): a response too long for the
    wall at the profile's floor is split by sentence, and "Part 1 of 2" is a
    server fact so every surface agrees on it. Integers, 0 <= part < parts <= 9.
    Absent means the whole response: part 0 of 1. A non-answer focus has none.
  */
  let storedPart = null;
  let storedParts = null;
  if (focus === 'answer') {
    storedPart = part === undefined ? 0 : part;
    storedParts = parts === undefined ? 1 : parts;
    if (!Number.isInteger(storedPart) || !Number.isInteger(storedParts)
        || storedPart < 0 || storedParts < 1 || storedParts > MAX_PARTS || storedPart >= storedParts) {
      return respond(400, { error: `part and parts must be integers with 0 <= part < parts <= ${MAX_PARTS}` });
    }
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
    const [ownerRead, stateRead] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
        ProjectionExpression: 'orgId'
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
        ProjectionExpression: '#state, #sb',
        ExpressionAttributeNames: { '#state': 'State', '#sb': 'Scoreboard' }
      }))
    ]);
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return respond(404, { error: 'Game not found' });
    }

    /*
      AN ANSWER ON THE WALL BELONGS TO ITS ROUND'S VOTE OR RESULTS, and to
      no other moment. Before VOTE the answers are still arriving and nobody
      has agreed to see them; after the round they are another round's rows.
      The phase is read here and stamped on the row (FOCUS_PHASES above).
    */
    let stampedPhase = null;
    if (focus === 'answer') {
      const m = /^(VOTE|RESULTS)#(\d+)$/.exec(String((stateRead.Item && stateRead.Item.State) || ''));
      if (!m || Number(m[2]) !== Number(padded)) {
        return respond(409, { error: 'A response can be shown only while its round is voting or showing results' });
      }
      stampedPhase = m[1];
    }

    /*
      UPDATE, NEVER PUT. `AuthorsRevealed` and `StageBeat` live on this same
      item. A PUT here would un-reveal a round get-results had already revealed
      — every attributed answer on the stage going back in the box because the
      host enlarged one of them — and would throw the round back to its tally.

      #ttl = if_not_exists(#ttl, :ttl) (bug sweep Task 2, fix round 1): see
      get-results.js's enterResultsState for why this row now needs one at
      all. Whichever of the four ROUND# writers touches a round first stamps
      the 30-day clock; the rest leave it alone.
    */
    const written = await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `ROUND#${padded}` },
      UpdateExpression: 'SET #focus = :focus, #idx = :idx, #phase = :phase, #part = :part, #parts = :parts, '
        + '#updatedAt = :now, #qn = :qn, #ttl = if_not_exists(#ttl, :ttl) ADD #rev :one',
      ExpressionAttributeNames: {
        '#focus': 'StageFocus',
        '#idx': 'StageFocusIndex',
        '#phase': 'StageFocusPhase',
        '#part': 'StageFocusPart',
        '#parts': 'StageFocusParts',
        '#rev': 'StageFocusRev',
        '#updatedAt': 'UpdatedAt',
        '#qn': 'QuestionNumber',
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: {
        ':focus': focus, ':idx': storedIndex, ':phase': stampedPhase, ':part': storedPart, ':parts': storedParts,
        ':now': now, ':qn': padded, ':ttl': ttlFrom(null, ROUND_RECORD_DAYS), ':one': 1
      },
      // The new rev comes back with the write, so the frame can carry it.
      ReturnValues: 'UPDATED_NEW'
    }));
    const rev = Number.isInteger(written && written.Attributes && written.Attributes.StageFocusRev)
      ? written.Attributes.StageFocusRev : null;

    await broadcastToGame(gameId, {
      type: 'stageFocusChanged',
      gameId,
      questionNumber: padded,
      focus,
      index: storedIndex,
      part: storedPart,
      parts: storedParts,
      phase: stampedPhase,
      rev,
      timestamp: now
    });

    /*
      THE JOIN CODE AND THE SCOREBOARD ARE ONE AT A TIME (owner, 2026-10-13:
      "turn on qr after scoreboard or scoreboard after qr code they flip the
      other one off and then pop up"). Putting the join code up closes an open
      scoreboard, here on the server, so the laptop, the Remote and every wall
      follow the one frame. scoreboard.js does the other half.
    */
    if (focus === 'join') {
      const board = normaliseScoreboard(stateRead.Item && stateRead.Item.Scoreboard);
      if (board.open) {
        try {
          const closed = { ...board, open: false };
          const sbWritten = await db.send(new UpdateCommand(scoreboardWrite(process.env.TABLE_NAME, gameId, closed)));
          closed.rev = revAfter(sbWritten);
          await broadcastToGame(gameId, scoreboardFrame(gameId, closed));
        } catch (sbError) {
          // The join code is up; a board that did not close is a nuisance, not a failure.
          console.error('⚠️ STAGE FOCUS: the scoreboard did not close for the join code:', sbError?.message);
        }
      }
    }

    return respond(200, {
      status: 'OK', gameId, questionNumber: padded, focus, index: storedIndex,
      part: storedPart, parts: storedParts, phase: stampedPhase, rev,
    });
  } catch (error) {
    console.error('❌ Stage focus error:', error);
    return respond(500, { error: 'Failed to set the stage focus' });
  }
};

exports.FOCUS_PHASES = FOCUS_PHASES;
exports.FOCUS_KINDS = FOCUS_KINDS;
