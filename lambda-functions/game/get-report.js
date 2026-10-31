const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { readReport } = require('./report-store');
const { callerMayDriveSession } = require('./tenant');
const { findReportIndexRow } = require('./report-access');

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
      defaulting. A session whose METADATA has expired is checked against its
      index row in Reports instead (below), so a saved or auto-built report
      still opens for the team that owns it.
    */
    const authorizer = event?.requestContext?.authorizer;
    const identity = authorizer?.jwt?.claims || authorizer?.lambda;
    if (!identity) return NOT_FOUND;

    const metaRes = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    /*
      AFTER THE SESSION HAS EXPIRED (the automatic report sweep, 2026-10-31).
      A saved or auto-built report's rows live 90 days; METADATA lives 7 from
      the start. With METADATA gone, the session's index row in Reports is the
      owner record instead (report-access.js): it carries the session's orgId,
      and the same callerMayDriveSession question is asked of it. A session
      that still exists is judged on METADATA alone, as before.
    */
    let owner = metaRes.Item || null;
    if (!owner) {
      owner = await findReportIndexRow(db, { table: process.env.TABLE_NAME, event, gameId });
    }
    if (!owner || !callerMayDriveSession(event, owner)) return NOT_FOUND;

    // Get the report
    // The head and its round rows, assembled (report-store.js).
    const reportOrgId = typeof owner.orgId === 'string' ? owner.orgId.trim() : '';
    const report = await readReport(db, { table: process.env.TABLE_NAME, gameId, orgId: reportOrgId });
    if (!report) return NOT_FOUND;
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
        // What the PDF prints on its front page and survey section. Named
        // here so a report opened from Reports (ReportsPanel's "Make the
        // PDF" on an auto-built report) draws the same document the host
        // page draws from POST /report. Absent on older reports.
        eventDetails: report.eventDetails || '',
        surveyNames: report.surveyNames || null,
        surveyResults: report.surveyResults || null,
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
        
        // Build Room only (build-points-report.js); null elsewhere.
        talkingPoints: report.talkingPoints || null,
        // "Include items not reviewed" as the report was built, and what it
        // left out (create-report.js). Absent on reports from before it.
        includeNotReviewed: report.includeNotReviewed !== false,
        notReviewedLeftOut: report.notReviewedLeftOut || null,
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