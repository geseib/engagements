const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { decryptItem } = require('./tenant-crypto');
const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/*
  ONE ANSWER FOR EVERY REFUSAL. No identity, another team's host and a session
  with no stored report all get this, word for word — a different reply for
  "it exists but it is not yours" is an existence oracle over 9,000 codes.
*/
const NOT_FOUND = {
  statusCode: 404,
  body: JSON.stringify({
    error: 'Report not found',
    message: 'No report has been generated for this game yet. Use POST /games/{gameId}/report to create one.'
  }),
  headers: { 'Access-Control-Allow-Origin': '*' }
};

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

    /*
      WHOSE REPORT IS THIS? This route was PUBLIC, and `role=host` — a query
      parameter anyone can type — returned the whole stored room, decrypted:
      every name against every answer, the AI summaries, the comments. That is
      what POST /report was closed to protect, and the stored row exists from
      the first time a host opens the report. It carries the Cognito authorizer
      now (template-clean.yaml, GetReportEvent; authorizer.js demands a host)
      and asks what create-report.js asks. Closed 2026-09-23 on the owner's
      "Yes"; nothing in the frontend called it.

      NO IDENTITY IS REFUSED OUTRIGHT, as save-report.js and the comments
      feature route do: callerMayDriveSession passes a caller with no groups,
      so on its own it would hand an orgless session's report to anyone the
      day this route lost its authorizer.

      METADATA is read FIRST, before the report, so a refused caller costs no
      read of the room. It is also the only place the owning org lives: the
      REPORT row does not carry `orgId` (create-report.js spreads `reportData`,
      which has none), and a blank org throws in tenant-crypto rather than
      defaulting. A session whose METADATA has expired has no owner to check
      against and answers not-found — the report is in Reports by then.
    */
    const authorizer = event?.requestContext?.authorizer;
    const identity = authorizer?.jwt?.claims || authorizer?.lambda;
    if (!identity) return NOT_FOUND;

    const metaRes = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    if (!metaRes.Item || !callerMayDriveSession(event, metaRes.Item)) return NOT_FOUND;

    // Get the report
    const reportQuery = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: `GAME#${gameId}`,
        SK: 'REPORT'
      }
    }));

    if (!reportQuery.Item) return NOT_FOUND;

    const reportOrgId = typeof metaRes.Item?.orgId === 'string' ? metaRes.Item.orgId.trim() : '';
    const report = reportOrgId
      ? await decryptItem(reportOrgId, 'report', reportQuery.Item)
      : reportQuery.Item;
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
        // Whether this report is everything the session produced, and what it
        // was assembled from. Named here for the reason the comment above
        // gives: this branch is a whitelist, so a field create-report.js stores
        // faithfully is invisible to the host until it appears in this list —
        // and a completeness warning nothing renders is not a warning.
        // Absent on reports written before report-merge.js existed.
        reportCompleteness: report.reportCompleteness || null,
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