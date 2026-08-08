const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

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

    console.log(`📋 Getting report for game ${gameId}, role: ${role || 'unspecified'}`);

    // Get the report
    const reportQuery = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { 
        PK: `GAME#${gameId}`, 
        SK: 'REPORT' 
      }
    }));

    if (!reportQuery.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: 'Report not found',
          message: 'No report has been generated for this game yet. Use POST /games/{gameId}/report to create one.'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const report = reportQuery.Item;
    console.log(`📊 Found report for game ${gameId}: ${report.gameStats?.totalQuestions || 0} questions`);

    // Role-specific information
    if (role === 'host') {
      // Host gets complete report information including detailed questions
      const result = {
        gameId: report.gameId,
        gameTitle: report.gameTitle,
        hostName: report.hostName,
        questionSetId: report.questionSetId,
        gameType: report.gameType,
        createdAt: report.createdAt,
        startedAt: report.startedAt,
        currentState: report.currentState,
        lessonNumber: report.lessonNumber,
        // Per-set round-label override. This branch is an explicit whitelist,
        // not a spread, so a field create-report.js stores is invisible to the
        // host until it is named here.
        roundNoun: report.roundNoun || null,
        gameStats: report.gameStats,
        playerPerformance: report.playerPerformance,
        
        // Enhanced detailed questions with rankings and AI summaries
        detailedQuestions: report.detailedQuestions || [],
        
        // Legacy question summaries for backward compatibility
        questionSummaries: report.questionSummaries,
        
        // Additional enhanced data
        scoringConfig: report.scoringConfig,
        questionSetData: report.questionSetData,
        
        reportGeneratedAt: report.reportGeneratedAt,
        reportVersion: report.reportVersion,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning enhanced host report for ${gameId}: ${report.detailedQuestions?.length || report.questionSummaries?.length || 0} detailed questions with ${report.gameStats?.totalPlayers || 0} players`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Players get limited report information (summary stats and leaderboard)
      const result = {
        gameId: report.gameId,
        gameTitle: report.gameTitle,
        gameType: report.gameType,
        gameStats: {
          totalPlayers: report.gameStats?.totalPlayers || 0,
          totalQuestions: report.gameStats?.totalQuestions || 0,
          totalAnswers: report.gameStats?.totalAnswers || 0,
          totalVotes: report.gameStats?.totalVotes || 0
        },
        leaderboard: report.playerPerformance?.map(player => ({
          playerName: player.playerName,
          gamesWon: player.gamesWon,
          participationRate: player.participationRate
        })) || [],
        reportGeneratedAt: report.reportGeneratedAt,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning player report info for ${gameId}: summary with leaderboard`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

  } catch (error) {
    console.error('Get report error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get report: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};