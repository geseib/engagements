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

    // Base game information (common to both host and player)
    const baseGameInfo = {
      gameId: gameId,
      title: gameMetadata.Item.Title,
      gameType: gameMetadata.Item.GameType,
      createdAt: gameMetadata.Item.CreatedAt,
      hostName: gameMetadata.Item.HostName,
      visibility: gameMetadata.Item.Visibility || 'public',
      started: gameMetadata.Item.Started || false,
      state: gameState.Item?.State || 'CREATED',
      currentQuestionId: gameState.Item?.CurrentQuestionId || null,
      lessonNumber: gameState.Item?.LessonNumber || 0
    };

    // Role-specific information
    if (role === 'host') {
      // Host gets additional administrative information
      const result = {
        ...baseGameInfo,
        questionSetId: gameMetadata.Item.QuestionSetId,
        aiContext: gameMetadata.Item.AIContext,
        details: gameMetadata.Item.Details,
        accessCode: gameMetadata.Item.AccessCode,
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