const { createGame } = require('./schema-compliant-manager');

exports.handler = async (event) => {
  // ⚠️ This destructure is a whitelist: anything not named here is dropped on
  // the floor without a word. `triviaTimer` was sent by the frontend for months
  // and silently discarded that way. If you add a field to the create payload,
  // it needs THREE edits — here, the createGame() argument below, and the
  // METADATA item in schema-compliant-manager.js.
  const { eventTitle, engagementInfo, aiContext, gameType, questionSetId, questionSetVersion, randomizeQuestions, anonymousUntilReveal, selectedCategories, hostName, visibility, accessCode, personaId } = JSON.parse(event.body || '{}');

  /*
    DRAW UNTIL THE ID IS ACTUALLY FREE (issue #26). The comment here used to
    read "Generate a unique 4-digit game ID" above a bare Math.random with no
    uniqueness anywhere — 9,000 values, and every session the table retains
    raises the odds that a new draw lands on a LIVING one and overwrites it
    row by row. The manager's first write (the GAMES index row) now carries
    attribute_not_exists, so a collision fails before anything is damaged and
    this loop simply draws again.

    Eight attempts, then an honest 503: eight straight collisions means the
    id space is effectively full, and creating by luck at that point would be
    the same bug with better odds.
  */
  const MAX_ID_ATTEMPTS = 8;
  let gameId = null;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && !gameId; attempt += 1) {
    const candidate = Math.floor(1000 + Math.random() * 9000).toString();
    console.log(`🎮 Creating game ${candidate} with title: ${eventTitle}, questionSetId: ${questionSetId}, randomize: ${randomizeQuestions}, visibility: ${visibility || 'public'}`);
    try {
      await createGame(candidate, {
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
      gameId = candidate;
    } catch (error) {
      if (error && error.name === 'ConditionalCheckFailedException') {
        console.warn(`⚠️ Game id ${candidate} is already taken — drawing again (attempt ${attempt + 1}/${MAX_ID_ATTEMPTS})`);
        lastError = error;
        continue;
      }
      // Any other failure is the old 500, answered HERE: the loop's throw has
      // nothing above it to land in, and an unhandled throw turns the friendly
      // error into a raw invocation failure.
      console.error(`❌ Create game error for ${candidate}:`, error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create game', details: error.message }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
  }

  if (!gameId) {
    console.error('❌ Could not allocate a free game id after', MAX_ID_ATTEMPTS, 'attempts', lastError);
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'Could not allocate a session code — too many sessions are live. Try again, or delete old sessions.' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }

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
};
