const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

// TTL Constants
const TTL_CREATION_PHASE = 90 * 24 * 60 * 60; // 90 days
const TTL_ACTIVE_PHASE = 7 * 24 * 60 * 60;    // 7 days

// Create game with proper schema compliance
const createGame = async (gameId, gameData) => {
  try {
    const ttl = Math.floor(Date.now() / 1000) + TTL_CREATION_PHASE;
    const now = new Date().toISOString();
    
    console.log(`🎮 Creating game ${gameId} with schema compliance`);
    
    // 1. Create GAMES list entry (for efficient game listing - DATABASE_DESIGN.md requirement)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: 'GAMES',
        SK: `GAME#${gameId}`,
        Title: gameData.title || 'Engagement Session',
        CreatedAt: now,
        HostName: gameData.hostName || 'Host',
        GameType: gameData.engagementType || 'call-and-answer',
        QuestionSetId: gameData.questionSetId,
        Visibility: gameData.visibility || 'public',
        AccessCode: gameData.accessCode || null,
        Started: false, // Game is created but not started
        LastPlayedAt: null,
        ttl
      }
    }));
    
    // 2. Create METADATA record (for template compatibility)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'METADATA',
        Title: gameData.title || 'Engagement Session',
        CreatedAt: now,
        HostName: gameData.hostName || 'Host',
        GameType: gameData.engagementType || 'call-and-answer',
        QuestionSetId: gameData.questionSetId,
        AIContext: gameData.aiContext || '',
        Details: gameData.details || '',
        Visibility: gameData.visibility || 'public',
        AccessCode: gameData.accessCode || null,
        Started: false, // Game is created but not started
        LastPlayedAt: null,
        // Configurable scoring system with defaults
        ScoringConfig: {
          firstPlacePoints: gameData.scoring?.firstPlacePoints || 3,
          secondPlacePoints: gameData.scoring?.secondPlacePoints || 2,
          thirdPlacePoints: gameData.scoring?.thirdPlacePoints || 1,
          participationPoints: gameData.scoring?.participationPoints || 0
        },
        ttl
      }
    }));

    // 3. Create initial STATE record
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'STATE',
        State: 'CREATED',
        GameState: 'created',
        Started: false, // Game is created but not started
        LessonNumber: 0,
        CurrentQuestionId: null,
        UsedQuestions: [],
        PlayedQuestions: [],
        UpdatedAt: now,
        ttl
      }
    }));

    // 4. Create STATE#CATS record for category state management
    if (gameData.questionSetId) {
      console.log(`🏷️ Setting up categories for game ${gameId} from question set ${gameData.questionSetId}`);
      
      // First, get ALL categories from the question set
      const allCategoriesQuery = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SET#${gameData.questionSetId}`,
          ':sk': 'CATEGORY#'
        }
      }));
      
      const allCategories = allCategoriesQuery.Items || [];
      console.log(`📋 Found ${allCategories.length} total categories in question set`);
      
      if (allCategories.length > 0) {
        // Create bitmasks for selected categories (supporting up to 24 categories)
        let hostMask1_8 = '00000000';
        let hostMask9_16 = '00000000';
        let hostMask17_24 = '00000000';
        let availMask1_8 = '00000000';
        let availMask9_16 = '00000000';
        let availMask17_24 = '00000000';
        
        // Set bits for each selected category based on their position in the full category list
        const selectedCategories = gameData.selectedCategories || [];
        console.log(`🎯 DEBUG: Raw selectedCategories from gameData:`, selectedCategories);
        console.log(`🎯 DEBUG: selectedCategories type:`, typeof selectedCategories, 'Array.isArray:', Array.isArray(selectedCategories));
        console.log(`🎯 DEBUG: All categories found:`, allCategories.map(cat => cat.SK.replace('CATEGORY#', '')));
        console.log(`🎯 DEBUG: Selected categories count: ${selectedCategories.length}/${allCategories.length}`);
        
        // If no categories selected, select all categories by default
        const effectiveSelectedCategories = selectedCategories.length > 0 
          ? selectedCategories 
          : allCategories.map(cat => cat.SK.replace('CATEGORY#', ''));
        
        console.log(`🎯 DEBUG: Effective selected categories:`, effectiveSelectedCategories);
        console.log(`🎯 DEBUG: Will process ${effectiveSelectedCategories.length} categories for bitmask generation`);
        
        // Debug: Show all category details
        allCategories.forEach((cat, idx) => {
          console.log(`📝 Category ${idx + 1}: ID=${cat.SK.replace('CATEGORY#', '')}, Name="${cat.CategoryName || cat.Name || 'N/A'}", QuestionCount=${cat.QuestionCount}`);
        });
        
        for (let i = 0; i < allCategories.length; i++) {
          const category = allCategories[i];
          const categoryId = category.SK.replace('CATEGORY#', '');
          const categoryName = category.CategoryName || category.Name || '';
          const bitPosition = i + 1;
          
          // Check if this category is selected (for HostMask)
          // Support both category IDs and category names
          const isSelected = effectiveSelectedCategories.includes(categoryId) || 
                           effectiveSelectedCategories.includes(categoryName);
          
          if (isSelected) {
            console.log(`✅ Category ${categoryId} (${categoryName}) is selected - setting bit ${bitPosition}`);
          }
          
          // Check if this category has questions (for AvailMask)
          const hasQuestions = category.QuestionCount > 0;
          
          if (bitPosition <= 8) {
            const pos = bitPosition - 1;
            if (isSelected) {
              hostMask1_8 = hostMask1_8.substring(0, pos) + '1' + hostMask1_8.substring(pos + 1);
            }
            if (hasQuestions) {
              availMask1_8 = availMask1_8.substring(0, pos) + '1' + availMask1_8.substring(pos + 1);
            }
          } else if (bitPosition <= 16) {
            const pos = bitPosition - 9;
            if (isSelected) {
              hostMask9_16 = hostMask9_16.substring(0, pos) + '1' + hostMask9_16.substring(pos + 1);
            }
            if (hasQuestions) {
              availMask9_16 = availMask9_16.substring(0, pos) + '1' + availMask9_16.substring(pos + 1);
            }
          } else if (bitPosition <= 24) {
            const pos = bitPosition - 17;
            if (isSelected) {
              hostMask17_24 = hostMask17_24.substring(0, pos) + '1' + hostMask17_24.substring(pos + 1);
            }
            if (hasQuestions) {
              availMask17_24 = availMask17_24.substring(0, pos) + '1' + availMask17_24.substring(pos + 1);
            }
          }
        }
        
        console.log(`🔢 Host Bitmasks: ${hostMask1_8} ${hostMask9_16} ${hostMask17_24}`);
        console.log(`🔢 Avail Bitmasks: ${availMask1_8} ${availMask9_16} ${availMask17_24}`);
        
        // Create STATE#CATS record for category state management
        await db.send(new PutCommand({
          TableName: process.env.TABLE_NAME,
          Item: {
            PK: `GAME#${gameId}`,
            SK: 'STATE#CATS',
            'HostMask1-8': hostMask1_8,
            'HostMask9-16': hostMask9_16,
            'HostMask17-24': hostMask17_24,
            'AvailMask1-8': availMask1_8,
            'AvailMask9-16': availMask9_16,
            'AvailMask17-24': availMask17_24,
            SubmittedAt: now,
            ttl
          }
        }));

        // Query the question set to get questions for ALL categories (not just selected ones)
        const questionSetQueries = await Promise.all(
          allCategories.map(async (category) => {
            const categoryId = category.SK.replace('CATEGORY#', '');
            const categoryQuestions = await db.send(new QueryCommand({
              TableName: process.env.TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
              ExpressionAttributeValues: {
                ':pk': `SET#${gameData.questionSetId}`,
                ':sk': `QUESTION#${categoryId}#`
              }
            }));
            
            return {
              categoryId,
              questions: categoryQuestions.Items || []
            };
          })
        );

        // Create category order and active records for ALL categories
        for (let i = 0; i < questionSetQueries.length; i++) {
          const { categoryId, questions } = questionSetQueries[i];
          
          if (questions.length > 0) {
            const categoryNumber = (i + 1).toString().padStart(3, '0');
            const isRandom = gameData.hostPreferences?.randomizeQuestions !== false;
            
            // Create CATEGORY#c001#ORDER record
            const orderRecord = {
              PK: `GAME#${gameId}`,
              SK: `CATEGORY#${categoryId}#ORDER`,
              IsRandom: isRandom,
              SubmittedAt: now,
              ttl
            };
            
            if (isRandom) {
              // Shuffle questions if randomization is enabled
              const shuffledOrder = questions.map((_, idx) => idx + 1).sort(() => Math.random() - 0.5);
              orderRecord.QuestionOrder = shuffledOrder;
            }
            
            await db.send(new PutCommand({
              TableName: process.env.TABLE_NAME,
              Item: orderRecord
            }));

            // Create CATEGORY#c001#ACTIVE record
            await db.send(new PutCommand({
              TableName: process.env.TABLE_NAME,
              Item: {
                PK: `GAME#${gameId}`,
                SK: `CATEGORY#${categoryId}#ACTIVE`,
                QuestionCount: questions.length,
                ActiveIndex: 0,
                SubmittedAt: now,
                ttl
              }
            }));

            console.log(`✅ Category ${categoryNumber} (${categoryId}) set up with ${questions.length} questions`);
          }
        }
      }
    }
    
    console.log(`✅ Game ${gameId} created with full schema compliance`);
    return true;
  } catch (error) {
    console.error(`❌ Error creating game ${gameId}:`, error);
    throw error;
  }
};

// Add player with proper schema compliance
const addPlayer = async (gameId, playerName, playerData = {}) => {
  try {
    const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
    const now = new Date().toISOString();
    
    console.log(`👤 Adding player ${playerName} to game ${gameId}`);
    
    // 1. Create PLAYER record (according to spec: PlayerName, JoinedAt, TotalScore, ttl)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `PLAYER#${playerName}`,
        PlayerName: playerName,
        JoinedAt: now,
        TotalScore: 0,
        ttl
      }
    }));
    
    // 3. Broadcast player joined notification
    await broadcastToGame(gameId, {
      type: 'playerJoined',
      gameId,
      playerName,
      playerData: {
        playerName,
        joinedAt: now,
        totalScore: 0,
        isActive: true
      },
      timestamp: now
    });
    
    console.log(`✅ Player ${playerName} added to game ${gameId} with notifications`);
    return true;
  } catch (error) {
    console.error(`❌ Error adding player ${playerName} to game ${gameId}:`, error);
    throw error;
  }
};

// Remove player with proper cleanup
const removePlayer = async (gameId, playerName) => {
  try {
    console.log(`👤 Removing player ${playerName} from game ${gameId}`);
    
    // Delete player record
    await db.send(new DeleteCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` }
    }));
    
    // Broadcast player left notification
    await broadcastToGame(gameId, {
      type: 'playerLeft',
      gameId,
      playerName,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Player ${playerName} removed from game ${gameId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error removing player ${playerName} from game ${gameId}:`, error);
    throw error;
  }
};

// Get all players (simplified according to spec)
const getGamePlayers = async (gameId) => {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'PLAYER#'
      }
    }));
    
    const players = {};
    result.Items?.forEach(item => {
      if (item.SK.startsWith('PLAYER#') && !item.SK.includes('#STATE')) {
        const playerName = item.PlayerName;
        players[playerName] = {
          playerName,
          joinedAt: item.JoinedAt,
          totalScore: item.TotalScore || 0
        };
      }
    });
    
    return players;
  } catch (error) {
    console.error(`❌ Error getting players for game ${gameId}:`, error);
    return {};
  }
};

// Efficient WebSocket broadcasting (no scans)
const broadcastToGame = async (gameId, message, targetType = 'ALL') => {
  try {
    const connectionsResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#'
      }
    }));
    
    const connections = connectionsResult.Items || [];
    console.log(`🔌 Broadcasting to ${connections.length} connections for game ${gameId}:`, message.type);
    
    if (connections.length === 0) {
      console.log(`⚠️ No active connections found for game ${gameId}`);
      return;
    }
    
    // Filter connections based on target type
    let targetConnections = connections;
    if (targetType === 'HOST') {
      targetConnections = connections.filter(conn => conn.IsHost === true);
    } else if (targetType === 'PARTICIPANTS') {
      targetConnections = connections.filter(conn => conn.IsHost !== true);
    }
    
    const broadcastPromises = targetConnections.map(async (connection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message)
        }));
        console.log(`✅ Message sent to connection ${connection.ConnectionId} (${connection.PlayerName || 'Host'})`);
      } catch (error) {
        console.log(`❌ Failed to send to connection ${connection.ConnectionId}:`, error.message);
        
        // Remove stale connections (410 = Gone)
        if (error.statusCode === 410 || error.$metadata?.httpStatusCode === 410) {
          console.log(`🧹 Removing stale connection: ${connection.ConnectionId}`);
          try {
            await db.send(new DeleteCommand({
              TableName: process.env.TABLE_NAME,
              Key: { PK: connection.PK, SK: connection.SK }
            }));
          } catch (deleteError) {
            console.error(`❌ Failed to delete stale connection:`, deleteError);
          }
        }
      }
    });
    
    await Promise.all(broadcastPromises);
    console.log(`✅ Broadcast complete for game ${gameId} (${targetType})`);
  } catch (error) {
    console.error('❌ Broadcast error:', error);
    throw error;
  }
};

module.exports = {
  createGame,
  addPlayer,
  removePlayer,
  getGamePlayers,
  broadcastToGame,
  TTL_CREATION_PHASE,
  TTL_ACTIVE_PHASE
};
