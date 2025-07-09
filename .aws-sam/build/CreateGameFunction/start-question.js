const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { sendHostMessage } = require('./clean-websocket-utils');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);


exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { questionNumber, questionRef, setId, category } = JSON.parse(event.body);
  const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60);
  
  console.log(`📝 Starting question ${questionNumber} for game ${gameId}, ref: ${questionRef}`);
  
  try {
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
