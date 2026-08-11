const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    const { role } = queryParams; // 'host' or 'player'
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🎮 Getting game info for ${gameId}, role: ${role || 'unspecified'}`);

    // Get game metadata
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    // Get category state
    const categoryState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
    }));

    // Same default-ON rule as the anonymity gate (game/anonymity.js:isHidden):
    // only an explicit `false` turns it off, so a game with no HostPreferences
    // recorded — including every game created before this flag existed —
    // reports `true`, matching what the gate would actually do for it.
    const hostPreferences = gameMetadata.Item.HostPreferences || {};
    const anonymousUntilReveal = hostPreferences.anonymousUntilReveal !== false;

    // Base game information (common to both host and player)
    const baseGameInfo = {
      gameId: gameId,
      title: gameMetadata.Item.Title,
      gameType: gameMetadata.Item.GameType,
      anonymousUntilReveal: anonymousUntilReveal,
      createdAt: gameMetadata.Item.CreatedAt,
      hostName: gameMetadata.Item.HostName,
      visibility: gameMetadata.Item.Visibility || 'public',
      started: gameMetadata.Item.Started || false,
      state: gameState.Item?.State || 'CREATED',
      currentQuestionId: gameState.Item?.CurrentQuestionId || null,
      lessonNumber: gameState.Item?.LessonNumber || 0
    };

    // Role-specific information.
    //
    // `role` IS A QUERY PARAMETER. This route is public and must stay public —
    // it is the session brief the root page checks a typed join code against,
    // and every participant's phone calls it — so `?role=host` is a CLAIM that
    // anyone can make, not a fact the API established. Nothing below this line
    // may be a secret.
    //
    // `accessCode: gameMetadata.Item.AccessCode` used to be here, and it was
    // the whole private-game control: `join-game.js:58-83` compares the code a
    // player types against exactly that value and nothing else. So
    // `GET /games/{id}?role=host` handed the password for a private session to
    // any unauthenticated caller who knew — or walked — the four-digit id.
    // DELETED, not gated: no caller ever read it. `attemptAutoJoin` and the
    // access-code form in PlayerPage.jsx supply the code from what the player
    // typed; GameHostPage's two `?role=host` reads take `started`,
    // `anonymousUntilReveal` and `categoryState`; the host already holds the
    // code because the create form chose it (`create-game.js:9`). Re-adding it
    // behind an `Authorization` check would mean this handler verifying a JWT
    // itself — the route carries no authorizer — to restore a field with no
    // reader. If a surface ever genuinely needs to display a running session's
    // own code, put it on a route that IS authorized.
    if (role === 'host') {
      // Host gets additional administrative information
      const result = {
        ...baseGameInfo,
        questionSetId: gameMetadata.Item.QuestionSetId,
        aiContext: gameMetadata.Item.AIContext,
        details: gameMetadata.Item.Details,
        usedQuestions: gameState.Item?.UsedQuestions || [],
        playedQuestions: gameState.Item?.PlayedQuestions || [],
        categoryState: categoryState.Item ? {
          hostMask1_8: categoryState.Item['HostMask1-8'],
          hostMask9_16: categoryState.Item['HostMask9-16'],
          hostMask17_24: categoryState.Item['HostMask17-24'],
          availMask1_8: categoryState.Item['AvailMask1-8'],
          availMask9_16: categoryState.Item['AvailMask9-16'],
          availMask17_24: categoryState.Item['AvailMask17-24']
        } : null
      };

      console.log(`✅ Returning host game info for ${gameId}`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Player gets basic game information
      const result = {
        ...baseGameInfo,
        engagementInfo: gameMetadata.Item.Details || ''
      };

      console.log(`✅ Returning player game info for ${gameId}`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

  } catch (error) {
    console.error('Get game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get game: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};