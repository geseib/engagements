const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};

    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Verify game exists
    const gameExists = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameExists.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game state to determine current question and readiness checking
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    const currentQuestionId = gameState.Item?.CurrentQuestionId;
    const currentGameState = gameState.Item?.State || 'CREATED';

    // Get all players for this game
    const playersResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'PLAYER#'
      }
    }));

    let players = (playersResult.Items || []).filter(player => {
      const playerName = player.PlayerName || player.playerName;
      if (!playerName) {
        console.log(`⚠️ Filtering out player record with no name:`, player);
        return false;
      }
      return true;
    });

    // Deduplicate players by name, keeping the most recent record
    const playerMap = new Map();
    players.forEach(player => {
      const playerName = player.PlayerName || player.playerName;
      const existing = playerMap.get(playerName);
      
      if (!existing || (player.JoinedAt && (!existing.JoinedAt || player.JoinedAt > existing.JoinedAt))) {
        playerMap.set(playerName, player);
        console.log(`👤 Player ${playerName}: keeping record with JoinedAt ${player.JoinedAt}`);
      } else {
        console.log(`👤 Player ${playerName}: skipping duplicate record with JoinedAt ${player.JoinedAt}`);
      }
    });
    
    players = Array.from(playerMap.values());
    console.log(`✅ After deduplication: ${players.length} unique players`);

    // Get player readiness for current question if there is one
    let playerReadiness = {};
    if (currentQuestionId) {
      // Get all answers for current question
      const answersResult = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`,
          ':sk': `QUESTION#${currentQuestionId}#ANSWER#`
        }
      }));

      // Get all votes for current question
      const votesResult = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`,
          ':sk': `QUESTION#${currentQuestionId}#VOTE#`
        }
      }));

      // Build readiness map
      const answeredPlayers = new Set((answersResult.Items || []).map(item => item.PlayerName));
      const votedPlayers = new Set((votesResult.Items || []).map(item => item.PlayerName));

      players.forEach(player => {
        const playerName = player.PlayerName || player.playerName;
        playerReadiness[playerName] = {
          hasAnswered: answeredPlayers.has(playerName),
          hasVoted: votedPlayers.has(playerName)
        };
      });
    }

    // Calculate actual scores from all question results
    console.log(`🧮 About to calculate scores for players:`, players.map(p => ({ name: p.PlayerName || p.playerName, currentScore: p.TotalScore })));
    const actualScores = await calculatePlayerScores(gameId, players.map(p => p.PlayerName || p.playerName));
    
    // Format player data with enhanced information
    const formattedPlayers = players.map(player => {
      const playerName = player.PlayerName || player.playerName;
      const totalScore = actualScores[playerName] || 0; // Use calculated score
      const readiness = playerReadiness[playerName] || { hasAnswered: false, hasVoted: false };

      // Determine readiness status based on current game state
      let isReady = false;
      let readinessType = 'none';
      
      if (currentGameState.startsWith('ASK#')) {
        isReady = readiness.hasAnswered;
        readinessType = 'answered';
      } else if (currentGameState.startsWith('VOTE#')) {
        isReady = readiness.hasVoted;
        readinessType = 'voted';
      } else if (currentGameState.startsWith('RESULTS#')) {
        isReady = true; // Everyone is "ready" for results
        readinessType = 'viewing_results';
      }

      return {
        playerId: player.PlayerId || player.playerId,
        playerName: playerName,
        totalScore: totalScore,
        joinedAt: player.JoinedAt || player.joinedAt || new Date().toISOString(),
        isConnected: player.isConnected || false,
        readiness: {
          isReady: isReady,
          type: readinessType,
          hasAnswered: readiness.hasAnswered,
          hasVoted: readiness.hasVoted
        }
      };
    });

    // Sort by total score (descending) then by name
    formattedPlayers.sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return a.playerName.localeCompare(b.playerName);
    });

    // Add ranking information for players with scores > 0
    const playersWithScores = formattedPlayers.filter(p => p.totalScore > 0);
    const top3Players = playersWithScores.slice(0, 3);
    
    // Assign rankings
    formattedPlayers.forEach((player, index) => {
      let rank = null;
      let rankLabel = null;
      
      if (player.totalScore > 0) {
        const rankPosition = top3Players.findIndex(p => p.playerId === player.playerId);
        if (rankPosition !== -1) {
          rank = rankPosition + 1;
          rankLabel = rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd';
        }
      }
      
      player.ranking = {
        rank: rank,
        label: rankLabel,
        isTop3: rank !== null,
        position: index + 1 // Overall position in sorted list
      };
    });

    // Calculate readiness statistics
    const readinessStats = {
      totalPlayers: formattedPlayers.length,
      readyCount: formattedPlayers.filter(p => p.readiness.isReady).length,
      answeredCount: formattedPlayers.filter(p => p.readiness.hasAnswered).length,
      votedCount: formattedPlayers.filter(p => p.readiness.hasVoted).length,
      connectedCount: formattedPlayers.filter(p => p.isConnected).length
    };

    readinessStats.readyPercentage = readinessStats.totalPlayers > 0 ? 
      Math.round((readinessStats.readyCount / readinessStats.totalPlayers) * 100) : 0;

    console.log(`✅ Returning ${formattedPlayers.length} players for game ${gameId} (${readinessStats.readyCount} ready)`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        gameId: gameId,
        players: formattedPlayers,
        stats: readinessStats,
        currentState: currentGameState,
        currentQuestionId: currentQuestionId,
        timestamp: new Date().toISOString()
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get players error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get players: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

// Calculate player scores from consolidated PLAYER#{playerName}#SCORE records
async function calculatePlayerScores(gameId, playerNames) {
  try {
    console.log(`🧮 Calculating scores from simplified score records for ${playerNames.length} players in game ${gameId}`);
    
    // Initialize score tracking
    const playerScores = {};
    playerNames.forEach(name => {
      playerScores[name] = 0;
    });
    
    // Get score records directly by playerName for efficiency
    const scorePromises = playerNames.map(async (playerName) => {
      try {
        const scoreRecord = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `GAME#${gameId}`, 
            SK: `PLAYER#${playerName}#SCORE`
          }
        }));

        if (scoreRecord.Item) {
          const score = scoreRecord.Item.score || 0;
          const afterRound = scoreRecord.Item.afterRound;
          playerScores[playerName] = score;
          console.log(`📊 Player ${playerName}: ${score} points (last scored in round ${afterRound})`);
        } else {
          console.log(`📊 Player ${playerName}: No score record found, defaulting to 0`);
        }
      } catch (error) {
        console.error(`Error getting score for ${playerName}:`, error);
      }
    });

    await Promise.all(scorePromises);
    
    console.log(`✅ Final scores from simplified records:`, playerScores);
    return playerScores;
    
  } catch (error) {
    console.error('Error reading consolidated score records:', error);
    
    // Fallback: try to get from TotalScore field in player records
    console.log('🔄 Falling back to TotalScore field from player records');
    try {
      const playerQuery = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`,
          ':sk': 'PLAYER#'
        }
      }));
      
      const fallbackScores = {};
      playerNames.forEach(name => {
        fallbackScores[name] = 0;
      });
      
      (playerQuery.Items || []).forEach(player => {
        const playerName = player.PlayerName || player.playerName;
        if (fallbackScores.hasOwnProperty(playerName)) {
          fallbackScores[playerName] = player.TotalScore || 0;
        }
      });
      
      console.log(`✅ Fallback scores from TotalScore:`, fallbackScores);
      return fallbackScores;
      
    } catch (fallbackError) {
      console.error('Fallback score calculation also failed:', fallbackError);
      // Return empty scores on complete failure
      const emptyScores = {};
      playerNames.forEach(name => {
        emptyScores[name] = 0;
      });
      return emptyScores;
    }
  }
}