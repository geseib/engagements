const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { sendHostMessage } = require('./clean-websocket-utils');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);



exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { 
    state, 
    currentQuestion, 
    currentQuestionId, 
    scoredQuestions, 
    usedQuestions, 
    playedQuestions, 
    currentQuestionData 
  } = JSON.parse(event.body);
  
  console.log(`🎮 Setting game state for ${gameId}: ${state}, question: ${currentQuestion || currentQuestionId}`);
  
  try {
    const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60); // 2 weeks TTL
    
    // Build state item
    const stateItem = {
      PK: `GAME#${gameId}`,
      SK: 'STATE',
      Stage: state, // BEGIN, ASK, VOTE, RESULTS, END
      UpdatedAt: new Date().toISOString(),
      ttl
    };
    
    // Add current question if provided
    if (currentQuestion) stateItem.CurrentQuestion = currentQuestion;
    if (currentQuestionId) stateItem.CurrentQuestionId = currentQuestionId;
    
    // Add optional arrays if provided
    if (scoredQuestions) stateItem.ScoredQuestions = scoredQuestions;
    if (usedQuestions) stateItem.UsedQuestions = usedQuestions;
    if (playedQuestions) stateItem.PlayedQuestions = playedQuestions;
    if (currentQuestionData) stateItem.CurrentQuestionData = currentQuestionData;
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: stateItem
    }));
    
    // Send appropriate host message based on state via new clean WebSocket system
    console.log(`🔌 Sending host message for game ${gameId}: ${state}`);

    // Map game states to new clean WebSocket message types
    if (state === 'results' && (currentQuestionId || currentQuestion)) {
      // Send RESULT#Q{questionNumber} when showing results
      const questionNum = (currentQuestionId || currentQuestion).toString().padStart(3, '0');
      await sendHostMessage(gameId, `RESULT#${questionNum}`, {
        questionId: currentQuestionId || currentQuestion,
        state
      });
    } else if (state === 'end') {
      // Send END when game ends
      await sendHostMessage(gameId, 'END', {
        state
      });
    }
    // Note: ASK and VOTE messages are sent by start-question.js and start-vote.js respectively
    
    console.log(`✅ Game state updated successfully for game ${gameId}: ${state}`);
    return { 
      statusCode: 200, 
      body: JSON.stringify({ status: 'OK' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Set game state error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Failed to set game state' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
