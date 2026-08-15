const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const { currentRoundNumber } = require('./round-key');
const { isRemoved } = require('./player-presence');
const { publicHandoverState } = require('./handover');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * THE ROSTER, AND IT IS A PUBLIC ENDPOINT.
 *
 * `GET /games/{gameId}/players` carries no authorizer (template-clean.yaml:820)
 * — the host's phone polls it, and so can anything else that knows the
 * four-digit game id. Everything below is therefore an allow-list, and two
 * fields in particular must never reach it:
 *
 *   ClientId              the secret `get-answers.js:247` accepts as proof of
 *                         identity before returning a player's own answer text.
 *   HandoverRequestedBy   the same kind of value, for whoever asked for a
 *                         handover. `handover.js`'s `publicHandoverState` is
 *                         the filter, and it is a named function so that "does
 *                         the roster leak a capability?" is one assertion.
 *
 * Two things this projection reports that the underlying rows do not spell out:
 *
 *   `players` EXCLUDES REMOVED PLAYERS, and `stats` counts only what is in
 *   `players`. That is the point of removal — see `player-presence.js` for
 *   which counts drop them and which must keep them. They are returned
 *   separately as `removedPlayers` so the host can see who left and put them
 *   back, rather than vanishing from the only screen that could undo it.
 *
 *   `handover` says whether a name is unlocked and whether somebody has asked
 *   for it. Booleans and a timestamp only.
 */

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

    // THE ROUND NUMBER, NOT THE SOURCE QUESTION ID.
    //
    // This read `gameState.Item?.CurrentQuestionId` and built
    // `QUESTION#${that}#ANSWER#` out of it. `CurrentQuestionId` is the id of a
    // question in a SET (`c005#001`, next-question.js:717); answers are filed
    // under the padded ROUND (`QUESTION#001#ANSWER#Ada`,
    // websocket/message.js:366). The two queries below therefore matched
    // nothing in every session that has ever run, so `hasAnswered`/`hasVoted`
    // were false for everybody and `readyCount` was 0 for ever. Owner: *"still
    // to answer did not change when players have answered, although the count
    // above stays accurate"* — the accurate count is get-game-state's, which
    // derived this correctly. See round-key.js.
    const currentRound = currentRoundNumber(gameState.Item);
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
    if (currentRound) {
      // Get all answers for current question
      const answersResult = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`,
          ':sk': `QUESTION#${currentRound}#ANSWER#`
        }
      }));

      // Get all votes for current question
      const votesResult = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`,
          ':sk': `QUESTION#${currentRound}#VOTE#`
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
    
    // WHO IS STILL IN THE ROOM. Split before formatting so that everything
    // downstream — the ranking, the stats, the percentage — is computed over
    // the room as it is now, and a player the host removed cannot be waited on.
    // `player-presence.js` records which counts drop them and which keep them.
    const presentPlayers = players.filter(player => !isRemoved(player));
    const departedPlayers = players.filter(player => isRemoved(player));

    // Format player data with enhanced information
    const formattedPlayers = presentPlayers.map(player => {
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
        },
        // Booleans and a timestamp — never the requester's clientId. See the
        // header of this file and of handover.js.
        handover: publicHandoverState(player)
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

    // THE PEOPLE WHO LEFT, still carrying everything they did.
    //
    // Returned rather than dropped because the host's Players tab is the only
    // place a removal can be undone, and a row you cannot see is a row you
    // cannot put back. Their score is read from the same `PLAYER#…#SCORE`
    // records as everyone else's — removal touches neither the score row nor a
    // single answer or vote, and the report counts them (create-report.js:147).
    // `actualScores` was already computed over EVERY player row above, present
    // and departed alike, so this needs no second round of Gets.
    const formattedDeparted = departedPlayers.map(player => {
      const playerName = player.PlayerName || player.playerName;
      return {
        playerId: player.PlayerId || player.playerId,
        playerName: playerName,
        totalScore: actualScores[playerName] || 0,
        joinedAt: player.JoinedAt || player.joinedAt || null,
        removedAt: player.RemovedAt
      };
    }).sort((a, b) => a.playerName.localeCompare(b.playerName));

    console.log(`✅ Returning ${formattedPlayers.length} players for game ${gameId} (${readinessStats.readyCount} ready, ${formattedDeparted.length} removed)`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        gameId: gameId,
        players: formattedPlayers,
        removedPlayers: formattedDeparted,
        stats: readinessStats,
        currentState: currentGameState,
        // The SOURCE question id, unchanged — it is what this field has always
        // carried and what a `QUESTION#…#REF` row points at. `currentRound` is
        // the padded round number, i.e. the thing the SKs above are built from;
        // the two were conflated here and that was the readiness bug.
        currentQuestionId: gameState.Item?.CurrentQuestionId,
        currentRound: currentRound,
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