const { createGame } = require('./schema-compliant-manager');

exports.handler = async (event) => {
  const { eventTitle, engagementInfo, aiContext, gameType, questionSetId, randomizeQuestions, selectedCategories, hostName, visibility, accessCode } = JSON.parse(event.body || '{}');
  
  // Generate a unique 4-digit game ID
  const gameId = Math.floor(1000 + Math.random() * 9000).toString();

  console.log(`🎮 Creating game ${gameId} with title: ${eventTitle}, questionSetId: ${questionSetId}, randomize: ${randomizeQuestions}, visibility: ${visibility || 'public'}`);

  try {
    await createGame(gameId, {
      title: eventTitle || 'Engagement Session',
      engagementType: gameType || 'call-and-answer',
      questionSetId: questionSetId,
      selectedCategories: selectedCategories || [],
      hostPreferences: {
        randomizeQuestions: randomizeQuestions !== false // Default to true if not specified
      },
      aiContext: aiContext,
      details: engagementInfo || '',
      hostName: hostName || 'Host',
      visibility: visibility || 'public',
      accessCode: accessCode || null,
      debugMode: false
    });

    console.log(`✅ Game ${gameId} created successfully`);
    return {
      statusCode: 201,
      body: JSON.stringify({
        gameId: gameId,
        title: eventTitle || 'Engagement Session',
        engagementType: gameType || 'call-and-answer',
        visibility: visibility || 'public',
        createdAt: new Date().toISOString(),
        joinUrl: `https://eng.dev.seibtribe.us/play?gameId=${gameId}`
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
