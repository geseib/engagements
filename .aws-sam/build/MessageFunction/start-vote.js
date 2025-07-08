const { updateHostState } = require('./clean-state-manager');
const { broadcastToGame } = require('./broadcast-utils');

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { questionNumber } = JSON.parse(event.body || '{}');

  console.log(`🗳️ Starting vote for game ${gameId}, question ${questionNumber}`);

  try {
    // Update host state to VOTE/Q{questionNumber}
    await updateHostState(gameId, `VOTE/${questionNumber}`, questionNumber, {
      VoteStartedAt: new Date().toISOString()
    });

    // Broadcast state change to all clients
    await broadcastToGame(gameId, {
      type: 'gameStateChanged',
      gameId: gameId,
      newState: `VOTE/${questionNumber}`,
      questionNumber: questionNumber
    }, process.env.WEBSOCKET_ENDPOINT);

    console.log(`✅ Vote started successfully for game ${gameId}, question ${questionNumber}`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'OK',
        questionNumber: questionNumber,
        newState: `VOTE/${questionNumber}`
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Start vote error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to start vote' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
