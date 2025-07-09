const { createGame } = require('./schema-compliant-manager');

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { eventTitle, aiContext, gameType, questionSetId, randomizeQuestions } = JSON.parse(event.body || '{}');

  console.log(`🎮 Creating game ${gameId} with title: ${eventTitle}, questionSetId: ${questionSetId}, randomize: ${randomizeQuestions}`);

  try {
    await createGame(gameId, {
      title: eventTitle || 'Engagement Session',
      engagementType: gameType || 'trivia',
      questionSetId: questionSetId,
      selectedCategories: [],
      hostPreferences: {
        randomizeQuestions: randomizeQuestions !== false // Default to true if not specified
      },
      aiContext: aiContext,
      debugMode: false
    });

    console.log(`✅ Game ${gameId} created successfully`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Game created successfully',
        gameId: gameId
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error(`❌ Create game error for ${gameId}:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to create game',
        details: error.message 
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
