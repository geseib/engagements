const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { broadcastToGame } = require('./schema-compliant-manager');
const { isHidden, redactAnswers } = require('./anonymity');
const { inDisplayOrder } = require('./answer-order');
const { callerMayDriveSession } = require('./tenant');
const { decryptItems } = require('./tenant-crypto');
const { clearQuestionFocus } = require('./question-focus');
const { timerForOpening, openingClauses, stateAfterOpening, timerView, isDue, endsAtMs } = require('./round-timer');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const body = JSON.parse(event.body || '{}');
  const { questionNumber } = body;
  // `timeUp: true` is the opt-in close at zero (round-timer.js), sent by
  // whichever host screen is open when answering runs out. Checked against
  // the server's clock and STATE below, so a skewed laptop cannot close early
  // and two screens firing at once open voting once.
  const timeUp = body.timeUp === true;

  console.log(`🗳️ Starting vote for game ${gameId}, question ${questionNumber}`);

  try {
    /*
      WHOSE ROOM IS THIS? The Cognito authorizer on this route says the caller
      is *a* host; nothing here said they were THIS session's host, so the
      boundary was "any `hosts` account plus one of the 9,000 four-digit ids".

      THIS ROUTE IS THE REVEAL BY ANOTHER DOOR, which is why the check is here
      rather than only on the state write. /reveal-authors is gated because it
      answers with the names. So does this: the ballot below carries
      `playerName` against `answer` for everyone who has responded, redacted
      only when the session is hiding authors. On a session that is not, an
      account in any organisation could ask a stranger's room to start voting
      and be handed the roster in the reply — without ever asking for a reveal.

      BEFORE THE UPDATE, and that ordering is the point: the state write is the
      first thing this handler does. `metaRes` forty lines below reads the same
      row for the anonymity gate, but by then the room has already moved, so
      this read is not a duplicate that could be folded into it.

      404 rather than 403: see tenant.callerMayDriveSession.
    */
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId, GameType'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    /*
      A SURVEY HAS NO ROUNDS, and the unconditional write below would put one
      into SURVEY#OPEN: VOTE#nnn on STATE sends every phone off the survey to a
      round that does not exist, and no answer can be saved again (the survey
      PUT's ConditionCheck needs SURVEY#OPEN). Refused as next-question refuses
      it — 409, STATE untouched (IMPLEMENTATION-phase-2.md §1).
    */
    if (ownerRead.Item && ownerRead.Item.GameType === 'survey') {
      const reason = 'A survey has no rounds to vote on.';
      return {
        statusCode: 409,
        body: JSON.stringify({ error: reason, message: reason, survey: true, gameId }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    // A POLL HAS NO VOTE since typed polls (27 Sep 2026): its question is a
    // survey question, counted as the room answers, and the round goes from
    // ASK straight to RESULTS. A VOTE#nnn here would send every phone to a
    // ballot for answers that are option picks, not responses.
    if (ownerRead.Item && ['poll', 'polls'].includes(String(ownerRead.Item.GameType || '').toLowerCase())) {
      const reason = 'A poll has no vote: its results count as the room answers.';
      return {
        statusCode: 409,
        body: JSON.stringify({ error: reason, message: reason, poll: true, gameId }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Update game state to VOTE#questionNumber (using the main STATE record)
    const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
    const newState = `VOTE#${paddedQuestionNumber}`;
    const askState = `ASK#${paddedQuestionNumber}`;
    const now = new Date().toISOString();

    // The round's STATE as it stands: the session's last voting-time choice
    // lives on it, and the close at zero is judged against it.
    const stateRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));
    const stateBefore = stateRead.Item || {};

    const readAnswers = () => db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionNumber}#ANSWER#`
      }
    }));

    /*
      THE CLOSE AT ZERO (opt-in, round-timer.js). Not a scheduler: the stack is
      near CloudFormation's resource limit and a per-round schedule needs a
      role and a schedule group; it would also be a second copy of this
      transition. Whichever host screen is open (the laptop's console or the
      phone Remote) asks with `timeUp`, and the server decides:
        - the room has already moved on (the other screen, or the host): 200,
          nothing written, nothing sent;
        - the host did not tick "Close answering at zero", or zero has not been
          reached by THIS clock: 409, nothing written;
        - nobody has answered: 409, a vote on nothing is not opened by a timer.
      The write itself is conditioned on ASK#nnn, so two screens arriving
      together open voting once.
    */
    let answersResult = null;
    if (timeUp) {
      const reply = (statusCode, payload) => ({
        statusCode, body: JSON.stringify({ questionNumber, ...payload }), headers: { 'Access-Control-Allow-Origin': '*' }
      });
      if (stateBefore.State !== askState) {
        return reply(200, { status: 'OK', alreadyMoved: true, newState: stateBefore.State || null });
      }
      const nowMs = Date.now();
      if (!isDue(stateBefore, nowMs)) {
        const ends = endsAtMs(stateBefore);
        return reply(409, {
          error: stateBefore.TimeCloses === true ? 'Time is not up yet' : 'This round does not close on its own',
          notDue: true,
          remainingMs: ends === null ? null : Math.max(0, ends - nowMs),
          serverNow: nowMs
        });
      }
      answersResult = await readAnswers();
      if (!(answersResult.Items || []).length) {
        return reply(409, { error: 'Nobody has answered yet', nothingToVoteOn: true });
      }
    }

    // The voting timer: the body's `time`, else this session's last voting
    // choice, else No limit (Q3: voting defaults to No limit).
    const voteTimer = openingClauses(newState, now, timerForOpening(body, stateBefore, 'vote'), 'vote');
    try {
      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
        UpdateExpression: `SET #state = :state, #updatedAt = :updatedAt, ${voteTimer.set.join(', ')}`
          + (voteTimer.remove.length ? ` REMOVE ${voteTimer.remove.join(', ')}` : ''),
        ...(timeUp ? { ConditionExpression: '#state = :ask' } : {}),
        ExpressionAttributeNames: {
          '#state': 'State',
          '#updatedAt': 'UpdatedAt',
          ...voteTimer.names
        },
        ExpressionAttributeValues: {
          ':state': newState,
          ':updatedAt': now,
          ...(timeUp ? { ':ask': askState } : {}),
          ...voteTimer.values
        }
      }));
    } catch (writeError) {
      if (timeUp && writeError && writeError.name === 'ConditionalCheckFailedException') {
        return {
          statusCode: 200,
          body: JSON.stringify({ status: 'OK', alreadyMoved: true, questionNumber }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      throw writeError;
    }
    const timedState = stateAfterOpening(stateBefore, newState, now, voteTimer.timer);

    // Get answers for this question to return to the host
    if (!answersResult) answersResult = await readAnswers();

    const answers = answersResult.Items || [];
    console.log(`🗳️ Found ${answers.length} answers for question ${paddedQuestionNumber}`);

    // Anonymity gate. The answers travel over HTTP, which is where the
    // redaction belongs — the votingStarted broadcast below carries no
    // attribution and never has.
    const [metaRes, roundRes] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `ROUND#${paddedQuestionNumber}` }
      }))
    ]);
    const hidden = isHidden(metaRes.Item, roundRes.Item);

    // The room's order (answer-order.js), as get-answers.js serves it: the
    // stage draws this list, and the phones number theirs the same way.
    //
    // PLAINTEXT FIRST. On an org session `Answer` is an envelope at rest
    // (tenant-crypto), and this ballot is what the host's VOTE stage draws the
    // moment it lands: built from the raw Query, every card read
    // "[object Object]" until a later get-answers refetch replaced it (owner,
    // 2026-10-11). get-answers.js decrypts before it builds; so does this.
    const orgId = metaRes.Item && typeof metaRes.Item.orgId === 'string' ? metaRes.Item.orgId.trim() : '';
    const opened = orgId ? await decryptItems(orgId, 'answer', answers) : answers;
    const ballot = inDisplayOrder(opened, gameId, paddedQuestionNumber).map(answer => ({
      playerId: answer.PlayerName,
      playerName: answer.PlayerName,
      name: answer.PlayerName, // Add name field for frontend compatibility
      answer: answer.Answer,
      submittedAt: answer.SubmittedAt
    }));

    // Broadcast voting started to everyone attached to the game, host included.
    //
    // `newState` is not decoration. GameHostPage's votingStarted handler reads
    // this exact field and nothing else, so a frame without it made the host
    // page a no-op: drive the session from the phone remote and every player
    // moved to VOTE while the projector sat on ASK. It used to live only in the
    // HTTP response below, which the caller sees and nobody else does.
    //
    // get-results.js already puts `newState` on its gameStateChanged frame; the
    // convention existed, this handler just didn't follow it.
    // A question put up during ASK comes down as voting opens (question-focus.js):
    // the wall shows the ballot the dock and the Remote say it shows.
    await clearQuestionFocus({
      db, UpdateCommand, broadcast: broadcastToGame, table: process.env.TABLE_NAME, gameId, padded: paddedQuestionNumber,
    });

    await broadcastToGame(gameId, {
      type: 'votingStarted',
      gameId: gameId,
      newState: newState,
      state: `GAME#${gameId} ${newState}`,
      questionNumber: paddedQuestionNumber,
      timestamp: now,
      // The room's view of the voting timer, or null (round-timer.js).
      time: timerView(timedState),
      serverNow: Date.now(),
      ...(timeUp ? { closedAtZero: true } : {})
    });
    // The host's screens hear every timer change, including a voting time the
    // room is not shown, and that the answering timer is over. A round with no
    // timer either side sends nothing extra.
    if (stateBefore.TimeLimitMs || timedState.TimeLimitMs) {
      await broadcastToGame(gameId, {
        type: 'roundTimeChanged', gameId, time: timerView(timedState, { host: true }), serverNow: Date.now()
      }, 'HOST');
    }

    console.log(`✅ Vote started successfully for game ${gameId}, question ${questionNumber}`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'OK',
        questionNumber: questionNumber,
        newState: newState,
        answers: hidden ? redactAnswers(ballot) : ballot,
        hostTime: timerView(timedState, { host: true }),
        serverNow: Date.now(),
        ...(timeUp ? { closedAtZero: true } : {})
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Start vote error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to start vote' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
