/**
 * MOVE THE ROOM INTO ASK — for this session's host, and nobody else's.
 *
 * HOST ONLY, AND THIS SESSION'S HOST. The route carries the Cognito authorizer
 * (template-clean.yaml), which it did not always: it was public, and the note
 * there records why that was closed. But an authorizer only proves the caller
 * is *a* host. For as long as this handler asked nothing else, the real
 * boundary was "any `hosts` account plus one of the 9,000 four-digit ids", and
 * an account in any organisation could advance a stranger's live room.
 *
 * That mattered more here than the two writes below suggest, because the second
 * one is a PUT of the STATE record rather than an update. It does not nudge a
 * room forward; it replaces where the room is.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { sendHostMessage } = require('./clean-websocket-utils');
const { callerMayDriveSession } = require('./tenant');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);


exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { questionNumber, questionRef, setId, category } = JSON.parse(event.body);
  const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60);
  
  console.log(`📝 Starting question ${questionNumber} for game ${gameId}, ref: ${questionRef}`);
  
  try {
    /*
      Whose room is this? One GetItem on METADATA, the shape start-game.js and
      stage-beat.js use, BEFORE either write — the first PUT below stores a
      question pointer and the second replaces the STATE record outright, so a
      check after them would refuse a room it had already moved. 404 rather
      than 403: see tenant.callerMayDriveSession.
    */
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Store question pointer: GAME#1234 / QUESTION#001
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `QUESTION#${questionNumber}`,
        QuestionRef: questionRef, // Pointer to SET#setId / QUESTION#category#number
        SetId: setId,
        Category: category,
        StartedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    // Update game state: current question and stage
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'STATE',
        CurrentQuestion: questionNumber, // "001", "002", etc.
        Stage: 'ASK', // BEGIN, ASK, VOTE, RESULTS, END
        State: 'question', // Frontend expects this field
        UpdatedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    // Broadcast ASK#Q{questionNumber} via new clean WebSocket system
    console.log(`🔌 Broadcasting ASK#${questionNumber} for game ${gameId}`);
    await sendHostMessage(gameId, `ASK#${questionNumber}`, {
      questionId: questionNumber,
      questionRef,
      setId,
      category
    });
    
    console.log(`✅ Question ${questionNumber} started successfully for game ${gameId}`);
    return { 
      statusCode: 200, 
      body: JSON.stringify({ status: 'OK' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Start question error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Failed to start question' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
