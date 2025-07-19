const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('🎮 Getting games list for game history');

    // Get all games from GAMES partition
    const gamesResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'GAMES'
      },
      ScanIndexForward: false // Sort by SK in descending order (most recent first)
    }));

    const games = (gamesResult.Items || []).map(game => ({
      gameId: game.SK.replace('GAME#', ''),
      title: game.Title,
      gameType: game.GameType,
      questionSetId: game.QuestionSetId,
      createdAt: game.CreatedAt,
      started: game.Started || false,
      lastPlayedAt: game.LastPlayedAt,
      visibility: game.Visibility || 'public',
      hostName: game.HostName
    }));

    // Sort by creation date (most recent first)
    games.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    console.log(`✅ Returning ${games.length} games for history`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        games: games,
        count: games.length,
        timestamp: new Date().toISOString()
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get games list error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get games list: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};