const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const { callerMayDriveSession } = require('./tenant');
const { startSession } = require('./session-start');
const { SURVEY_OPEN } = require('./survey-names');
const { readSurveyRows, isAnswerable } = require('./survey-set');
const { recordSurveyOpened } = require('./platform-metrics');
const { toAll } = require('./survey-broadcast');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🚀 Starting game ${gameId}`);

    // Check if game exists and is in CREATED state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    if (!gameState.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    /* WHOSE SESSION IS THIS? Nothing here asked. A host in another organisation
       started somebody else's session on dev with nothing but the four-digit
       code. The owning org lives on METADATA; STATE does not carry it.
       404 rather than 403 — see tenant.callerMayDriveSession. */
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      // The owner, and — for a survey — the set it pins, so it can be opened.
      ProjectionExpression: 'orgId, GameType, QuestionSetId, QuestionSetScope, QuestionSetVersion'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const currentState = gameState.Item.State;
    if (currentState !== 'CREATED') {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Game cannot be started',
          message: `Game is in state '${currentState}'. Can only start games in 'CREATED' state.`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    /*
      A SURVEY OPENS, it does not start: every question is in front of the
      room at once and phones pace themselves, so STATE goes straight to
      SURVEY#OPEN and no round is ever served (IMPLEMENTATION-phase-2.md §2).
      A survey with nothing answerable in it is refused and left CREATED, as
      next-question refuses a first round with nothing to ask — a false start
      is a setup problem, not a session.
    */
    const meta = ownerRead.Item || {};
    const isSurvey = meta.GameType === 'survey';
    let surveyRows = [];
    let surveySet = null;
    if (isSurvey) {
      const read = await readSurveyRows(db, process.env.TABLE_NAME, meta);
      surveyRows = read.rows.filter(isAnswerable);
      surveySet = read.set;
      if (!surveyRows.length) {
        const reason = 'Nothing to ask yet: this survey\'s question set has no questions in it. Add questions, then open it again.';
        return {
          statusCode: 409,
          body: JSON.stringify({ error: reason, message: reason, nothingToAsk: true, gameId, state: currentState }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    /*
      STATE, the reservation, METADATA and the org's index row — the four rows
      session-ttl.js names — in the one function next-question.js also calls
      when it opens a round from CREATED. See session-start.js for what went
      missing while these writes lived here alone.

      The owning org comes from the METADATA read above, not from the caller: a
      session belongs to the org that created it, not to whichever org the
      person pressing Start happens to be acting for.
    */
    const { startedAt: now } = await startSession(db, process.env.TABLE_NAME, gameId, {
      orgId: meta.orgId || '',
      state: isSurvey ? SURVEY_OPEN : 'STARTED'
    });

    // Every question of a survey is served the moment it opens — the console
    // counts them here, once (platform-metrics.js; never throws).
    if (isSurvey) {
      await recordSurveyOpened({
        gameId,
        questions: surveyRows.length,
        set: { scope: surveySet.scope, pk: surveySet.pk },
        questionId: surveyRows[0].SK
      }, { db });
      // A phone that loaded the survey before it opened was told "not open
      // yet"; `gameStateChanged` is what both pages already re-fetch on
      // (get-results.js), so it reloads into the survey. Never throws.
      await toAll(db, process.env.TABLE_NAME, gameId, {
        type: 'gameStateChanged',
        gameId,
        state: `GAME#${gameId} ${SURVEY_OPEN}`,
        newState: SURVEY_OPEN,
        timestamp: now
      });
    }

    console.log(`✅ Game ${gameId} started successfully`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        state: isSurvey ? SURVEY_OPEN : 'STARTED',
        startedAt: now,
        ...(isSurvey ? { openedAt: now } : {}),
        message: 'Game started successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Start game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to start game: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};