/**
 * THE SCOREBOARD, OPENED AND CLOSED — `POST /games/{gameId}/scoreboard`.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md. The owner asked for
 * a full-screen standings moment the host opens from the remote, a key, or the
 * Players tab, in one of three looks they can switch between. The stage draws
 * it; this route is the one writer of whether it is up and how it looks.
 *
 * ── WHY A SERVER FACT ──────────────────────────────────────────────────────
 *
 * For stage-focus.js's reason, and read that header first: the phone remote
 * and the stage are two devices, the phone holds no socket and polls /state,
 * and a refreshed host page must come back up on what the room was looking at.
 * Client-only state on the stage could do none of the three.
 *
 * ── PER SESSION, NOT PER ROUND ─────────────────────────────────────────────
 *
 * Unlike the focus, the board is not an index into a round's rows — it is the
 * whole room's totals — so it lives on STATE (`Scoreboard`, scoreboard-state.js)
 * rather than a ROUND# record. That is also what lets it open in ENDED, where
 * there is no round.
 *
 * ── WHAT THE BODY MAY SAY ──────────────────────────────────────────────────
 *
 *   { open?: boolean, style?: 'departure'|'olympic'|'tote', step?: 'next'|'prev' }
 *
 * At least one. A closed set each, refused out loud: an open enum's worst
 * failure is that everything succeeds and a button silently does nothing.
 *
 *   open:true on a closed board   starts an opening — openedAt now, page 0
 *   open:true on an open board    a no-op that still answers 200 (double-tap)
 *   style                         applies live; the opening and page are kept
 *   step                          the remote's page turn; refused (409) with
 *                                 the board closed, where there is no page.
 *                                 With an open, it counts from the new
 *                                 opening's first page
 *
 * Opening is refused (409, "Scores appear after the first round") until a
 * round has been counted — the clients already say so; this is the same rule
 * where it cannot be skipped. Every write counts a revision
 * (`STATE.ScoreboardRev`, scoreboard-state.js) that rides on the frame, the
 * reply and get-game-state.
 *
 * ── WHO MAY ────────────────────────────────────────────────────────────────
 *
 * Host only: the Cognito authorizer on the route, and `callerMayDriveSession`
 * here, exactly as stage-focus.js. A session in another organisation answers
 * 404, not 403 (tenant.js: a 403 is an existence oracle over the codes).
 *
 * Trivia and Call & Answer only (owner, 2026-09-25). Poll, Wavelength and
 * Survey have no totals worth a board; they are refused with 409 and nothing
 * is written.
 *
 * NOTHING HERE LOGS A NAME. The frame carries the board's own state; the stage
 * fetches the rows from the public /players roster, where totals already live.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { callerMayDriveSession } = require('./tenant');
const {
  SCOREBOARD_STYLES, STEPS, hasScoreboard, normaliseScoreboard,
  scoreboardWrite, revAfter, scoreboardFrame,
} = require('./scoreboard-state');
const { roundNumber } = require('./standings');

/** The client's own words (config/scoreboard.js NOT_SCORED_YET). */
const NOT_SCORED_YET = 'Scores appear after the first round';

/**
 * Has any round of this session been counted? get-results.js records it on
 * STATE (`ScoresAfterRound`); a session counted before that record existed is
 * judged by its score rows instead — any row past the "000" join-game writes.
 */
const anyRoundCounted = async (gameId, stateItem) => {
  if (roundNumber(stateItem && stateItem.ScoresAfterRound) > 0) return true;
  const rows = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'PLAYER#' }
  }));
  return (rows.Items || []).some((row) => String(row.SK).endsWith('#SCORE') && roundNumber(row.afterRound) > 0);
};

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

/**
 * Tell the room. Never throws — the board is written by the time this runs.
 * Dead connections are reaped inline, which is why the function's policy is
 * Crud and not Write (DynamoDBWritePolicy grants no DeleteItem — see
 * template-clean.yaml). The same broadcast stage-focus.js carries.
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
        const status = err.statusCode || err.$metadata?.httpStatusCode;
        if (status === 410) {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `CONNECTION#${connectionId}` }
          })).catch(() => {});
        }
      }
    }));
  } catch (err) {
    console.error('❌ SCOREBOARD: broadcast failed entirely (continuing):', err?.message);
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

  if (!gameId) {
    return respond(400, { error: 'gameId is required' });
  }

  const { open, style, step } = body;
  const hasOpen = open !== undefined;
  const hasStyle = style !== undefined;
  const hasStep = step !== undefined;

  if (!hasOpen && !hasStyle && !hasStep) {
    return respond(400, { error: 'Say what to change: open, style or step' });
  }
  if (hasOpen && typeof open !== 'boolean') {
    return respond(400, { error: 'open must be true or false' });
  }
  if (hasStyle && !SCOREBOARD_STYLES.includes(style)) {
    return respond(400, { error: `style must be one of: ${SCOREBOARD_STYLES.join(', ')}` });
  }
  if (hasStep && !STEPS.includes(step)) {
    return respond(400, { error: `step must be one of: ${STEPS.join(', ')}` });
  }

  try {
    const meta = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: '#org, #type',
      ExpressionAttributeNames: { '#org': 'orgId', '#type': 'GameType' }
    }));
    if (!meta.Item) {
      return respond(404, { error: 'Game not found' });
    }
    // 404 rather than 403: see tenant.callerMayDriveSession.
    if (!callerMayDriveSession(event, meta.Item)) {
      return respond(404, { error: 'Game not found' });
    }
    // A session with no GameType predates the field and plays call-and-answer,
    // which is what every other reader defaults it to.
    if (!hasScoreboard(meta.Item.GameType || 'call-and-answer')) {
      const reason = 'Scoreboards are for Trivia and Call & Answer sessions.';
      return respond(409, { error: reason, message: reason });
    }

    const stateRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      ProjectionExpression: '#sb, #r',
      ExpressionAttributeNames: { '#sb': 'Scoreboard', '#r': 'ScoresAfterRound' }
    }));
    const was = normaliseScoreboard(stateRead.Item && stateRead.Item.Scoreboard);

    if (open === true && !was.open && !(await anyRoundCounted(gameId, stateRead.Item))) {
      return respond(409, { error: NOT_SCORED_YET, message: NOT_SCORED_YET });
    }

    const next = { ...was };
    if (hasStyle) next.style = style;
    if (hasOpen) {
      if (open && !was.open) {
        next.open = true;
        next.openedAt = new Date().toISOString();
        next.page = 0;
      } else if (!open) {
        next.open = false;
      }
    }
    if (hasStep) {
      if (!next.open) {
        return respond(409, { error: 'The scoreboard is not open' });
      }
      // From `next`, not `was`: an open in the same request has already put
      // the page back to the new opening's first.
      next.page += step === 'next' ? 1 : -1;
    }

    /*
      UPDATE, NEVER PUT. STATE carries the round the room is on, its lesson
      number, the survey's warning — a PUT here would throw the session back
      to CREATED because the host opened a scoreboard.
    */
    const written = await db.send(new UpdateCommand(scoreboardWrite(process.env.TABLE_NAME, gameId, next)));
    next.rev = revAfter(written);

    // The transition only — never a name, never a score.
    console.log(`✅ SCOREBOARD ${gameId}: ${next.open ? 'open' : 'closed'}, ${next.style}, page ${next.page}, rev ${next.rev}`);

    await broadcastToGame(gameId, scoreboardFrame(gameId, next));

    return respond(200, { status: 'OK', gameId, scoreboard: next });
  } catch (error) {
    console.error('❌ Scoreboard error:', error?.message);
    return respond(500, { error: 'Failed to change the scoreboard' });
  }
};
