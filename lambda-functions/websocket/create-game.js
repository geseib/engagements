const { createGame } = require('./schema-compliant-manager');

exports.handler = async (event) => {
  // ⚠️ This destructure is a whitelist: anything not named here is dropped on
  // the floor without a word. `triviaTimer` was sent by the frontend for months
  // and silently discarded that way. If you add a field to the create payload,
  // it needs THREE edits — here, the createGame() argument below, and the
  // METADATA item in schema-compliant-manager.js.
  const { eventTitle, engagementInfo, aiContext, gameType, questionSetId, questionSetVersion, randomizeQuestions, anonymousUntilReveal, selectedCategories, hostName, visibility, accessCode, personaId } = JSON.parse(event.body || '{}');

  // Generate a unique 4-digit game ID
  const gameId = Math.floor(1000 + Math.random() * 9000).toString();

  console.log(`🎮 Creating game ${gameId} with title: ${eventTitle}, questionSetId: ${questionSetId}, randomize: ${randomizeQuestions}, visibility: ${visibility || 'public'}`);

  try {
    await createGame(gameId, {
      title: eventTitle || 'Engagement Session',
      engagementType: gameType || 'call-and-answer',
      questionSetId: questionSetId,
      // Optional explicit version pin. Omitted by the normal create flow, in
      // which case createGame() resolves the set's activeVersion and pins THAT
      // — the game keeps reading the questions it started on even after the set
      // is replaced. Supplying it lets a host deliberately run an older version.
      questionSetVersion: questionSetVersion,
      selectedCategories: selectedCategories || [],
      hostPreferences: {
        randomizeQuestions: randomizeQuestions !== false, // Default to true if not specified
        // Default ON, per the owner: a host who never touches setup still gets
        // an anonymous round. Only an explicit false opts out.
        anonymousUntilReveal: anonymousUntilReveal !== false
      },
      aiContext: aiContext,
      // The host's voice pick. Empty means "adapt to the session" — the
      // designed default — not "fall back to the legacy template".
      personaId: (personaId || '').trim(),
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
