const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { updatePlayerState } = require('./clean-state-manager');
const { sendPlayerMessage } = require('./clean-websocket-utils');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);



exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { name, questionNumber, votes } = JSON.parse(event.body);
  const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60);
  
  console.log(`🗳️ Votes: game=${gameId}, question=${questionNumber}, voter=${name}`, votes);
  
  try {
    // Correct structure: GAME#1234 / QUESTION#001#VOTE#name
    // votes = { "0": 1, "1": 2, "2": 3 } (answerIndex: rank)
    const paddedQuestionNumber = questionNumber?.toString().padStart(3, '0') || '001';

    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `QUESTION#${paddedQuestionNumber}#VOTE#${name}`,
        VoterName: name,
        QuestionNumber: questionNumber,
        First: votes["0"] || null,   // Answer index for 1st place
        Second: votes["1"] || null,  // Answer index for 2nd place  
        Third: votes["2"] || null,   // Answer index for 3rd place
        VotesRaw: votes, // Keep original format for compatibility
        SubmittedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    console.log(`✅ Vote stored successfully for ${name} on question ${questionNumber}`);

    // Update player state using clean state management
    await updatePlayerState(gameId, name, `VOTED/${paddedQuestionNumber}`, paddedQuestionNumber, {
      VotesSubmitted: votes,
      VotedAt: new Date().toISOString()
    });

    // Send VOTED#Q{questionNumber} message to host via new clean WebSocket system
    await sendPlayerMessage(gameId, name, `VOTED#${paddedQuestionNumber}`, {
      questionNumber: paddedQuestionNumber,
      votes: votes
    });

    console.log(`✅ Vote submission complete for ${name} on question ${questionNumber}`);
    return { 
      statusCode: 200, 
      body: JSON.stringify({ status: 'OK' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Submit votes error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Failed to submit votes' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
