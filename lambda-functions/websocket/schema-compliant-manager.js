const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { resolveSetPartition } = require('./set-version');
const { GAMES_RESERVATION_PK, gamesIndexPk, PLATFORM } = require('./tenant');
const { encryptItem } = require('./tenant-crypto');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

// TTL Constants
const TTL_CREATION_PHASE = 90 * 24 * 60 * 60; // 90 days
const TTL_ACTIVE_PHASE = 7 * 24 * 60 * 60;    // 7 days

/**
 * WHERE A SESSION LIVES, NOW THAT SESSIONS HAVE OWNERS.
 *
 *   PK: GAMES            SK: GAME#{id}   the GLOBAL reservation. `{orgId, ttl}`
 *                                        and nothing else, ever.
 *   PK: ORG#{org}#GAMES  SK: GAME#{id}   the brief a host lists.
 *   PK: GAME#{id}        SK: METADATA…   stays global, gains an `orgId`.
 *
 * The reservation STAYS GLOBAL because a participant types four digits with no
 * idea which organisation they belong to, so the code space is one space. It
 * also stays the LOCK: `attribute_not_exists(PK)` on this row is what stops a
 * fresh draw from overwriting a living session (issue #26), and it is still the
 * first write of the nine.
 *
 * The brief MOVED because `GET /games` must be structurally incapable of
 * returning another org's sessions — one Query of one partition, not a global
 * Query with a filter bolted on. A filter is a line of code somebody can delete;
 * a partition boundary is not.
 *
 * A HALF-CREATED GAME IS IMPOSSIBLE, and not by transaction: the nine writes
 * are interleaved with Queries of the question set, so they cannot be one
 * TransactWriteItems. Instead the reservation is taken first and RELEASED again
 * if anything after it fails — so a failed create leaves no rows and no burnt
 * code. The release deliberately does not run for a ConditionalCheckFailed,
 * because that row belongs to the session that won the race.
 */
// Create game with proper schema compliance
const createGame = async (gameId, gameData) => {
  const orgId = typeof gameData.orgId === 'string' ? gameData.orgId.trim() : '';
  let reserved = false;
  try {
    const ttl = Math.floor(Date.now() / 1000) + TTL_CREATION_PHASE;
    const now = new Date().toISOString();

    console.log(`🎮 Creating game ${gameId} for org ${orgId || '(none)'} with schema compliance`);

    // Resolve — and then PIN — the question-set version this game plays.
    //
    // Resolution is the shared 1-2-3: an explicit pin from the caller, else the
    // set's activeVersion, else the legacy unversioned partition. Whatever comes
    // back is written to METADATA as QuestionSetVersion and used for every set
    // read below, so the categories and counts this game is built from are the
    // same rows it will be served during play. Replacing the set afterwards
    // writes a NEW version and cannot disturb this game.
    //
    // `null` means the set has never been versioned; the attribute is then
    // omitted entirely so the resolver's legacy branch keeps firing.
    //
    // A SET REFERENCE IS A PAIR NOW, `{scope, setId}` — `teamretro` names a
    // different partition in each of platform, org and public (tenant.js
    // header), so the id alone can no longer be handed to the resolver and the
    // scope can no longer be left off the game. It defaults to `platform`,
    // which is where every set that exists today lives and therefore what a
    // create payload that says nothing still means.
    const setScope = (gameData.questionSetScope || '').trim() || PLATFORM;
    let resolvedSet = { pk: null, version: null, scope: setScope, source: 'none' };
    if (gameData.questionSetId) {
      resolvedSet = await resolveSetPartition(
        db,
        process.env.TABLE_NAME,
        { scope: setScope, orgId, setId: gameData.questionSetId },
        gameData.questionSetVersion
      );
    }
    const pinnedVersion = resolvedSet.version;
    // THE SCOPE PIN, written beside the version pin and read by every runtime
    // resolver. Without it a game whose set was replaced in one scope would
    // start reading a same-named set in another.
    const pinnedScope = resolvedSet.scope || setScope;

    // 1. Create GAMES list entry (for efficient game listing - DATABASE_DESIGN.md requirement)
    //
    // THE ID RESERVATION, and it is load-bearing (issue #26). The 4-digit id
    // is drawn at random from 9,000 values with — until this line — no
    // uniqueness check anywhere: nine blind Puts. A collision OVERWROTE a
    // living session in place: new METADATA, new masks, a new title on this
    // very index row. The owner watched it from the outside: a session whose
    // categories and questions "disappeared" after unrelated activity, and
    // which then went missing from history — because this row now described
    // the newer session that had silently taken its id.
    //
    // This row is written FIRST of the nine, so conditioning it makes it the
    // lock: a collision fails HERE, before anything else has been touched,
    // and the caller draws a fresh id and retries with the losing session
    // completely unharmed.
    await db.send(new PutCommand({
      ConditionExpression: 'attribute_not_exists(PK)',
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: GAMES_RESERVATION_PK,
        SK: `GAME#${gameId}`,
        // NOTHING ELSE BELONGS ON THIS ROW. It used to carry the whole session
        // brief — title, host name, visibility — in a partition every account
        // could Query, which is how `GET /games` returned every session in the
        // environment. `orgId` is here for one reason: it is the only thing that
        // says which org's index row to clean up when the code is released, and
        // without it a deleted session's code stays reserved for 90 days.
        ...(orgId ? { orgId } : {}),
        ttl
      }
    }));
    reserved = true;

    // 1b. THE SESSION BRIEF, in the owning org's partition.
    //
    // Everything the reservation row used to carry lives here instead, and this
    // is the ONLY row `GET /games` reads. An org with no sessions has an empty
    // partition; an org that is not yours is a partition your Query never names.
    //
    // Skipped, loudly, when the caller has no organisation. That session is then
    // listed by nobody — which is the safe direction, and the same answer
    // get-games-list gives an orgless caller. Once every host carries an org,
    // create-game.js's `requireOrg` makes this branch unreachable.
    // ── ENCRYPTION STARTS HERE, AND ONLY WHERE THERE IS A TENANT ─────────────
    //
    // `ENCRYPTED_FIELDS.session` is Title/HostName/Details/AIContext, and both
    // rows below carry the first two — the index row so `GET /games` can list a
    // session without reading its brief, METADATA because it IS the brief. The
    // same sentence must be ciphertext in both or a `Scan` reads the one that
    // was forgotten; that is the exact inconsistency `session` was added to the
    // boundary to close (tenant-crypto.js:174).
    //
    // Skipped entirely for an orgless session. That is not a loophole, it is
    // the only honest answer: there is no organisation, therefore no data key,
    // and `encryptItem('')` throws rather than inventing one. Such a session is
    // already listed by nobody (see the warning below) and `create-game.js`'s
    // `requireOrg` is making the branch unreachable.
    const encryptSession = (item) => (orgId ? encryptItem(orgId, 'session', item) : item);

    if (orgId) {
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: await encryptSession({
          PK: gamesIndexPk(orgId),
          SK: `GAME#${gameId}`,
          orgId,
          Title: gameData.title || 'Engagement Session',
          CreatedAt: now,
          HostName: gameData.hostName || 'Host',
          GameType: gameData.engagementType || 'call-and-answer',
          QuestionSetId: gameData.questionSetId,
          QuestionSetScope: pinnedScope,
          // Mirrored onto the index row so DELETE /versions/{n} can find the
          // games pinned to a version with ONE Query of an org's partition
          // instead of a GetItem per game.
          ...(pinnedVersion !== null ? { QuestionSetVersion: pinnedVersion } : {}),
          Visibility: gameData.visibility || 'public',
          AccessCode: gameData.accessCode || null,
          Started: false, // Game is created but not started
          LastPlayedAt: null,
          ttl
        })
      }));
    } else {
      console.warn(`⚠️ Game ${gameId} was created with no organisation — it will appear in no session list`);
    }

    // 2. Create METADATA record (for template compatibility)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: await encryptSession({
        PK: `GAME#${gameId}`,
        SK: 'METADATA',
        // THE OWNER, and until this line there was not one — not `hostId`, not
        // `createdBy`, nothing. `HostName` is free text off the create form and
        // has never identified anybody. Every handler that needs to know which
        // org a session belongs to reads THIS attribute; the partition it sits
        // in stays global because participants reach it by code alone.
        ...(orgId ? { orgId } : {}),
        Title: gameData.title || 'Engagement Session',
        CreatedAt: now,
        HostName: gameData.hostName || 'Host',
        GameType: gameData.engagementType || 'call-and-answer',
        QuestionSetId: gameData.questionSetId,
        // …and WHICH `questionSetId`. See the scope pin above: the id alone
        // names a partition in three different scopes now.
        QuestionSetScope: pinnedScope,
        // THE PIN. Every runtime reader (next-question, get-question,
        // select-question, get-categories) resolves through this first. Absent
        // means "no version anywhere" — every game created before this change —
        // and those fall through to activeVersion and then to legacy.
        ...(pinnedVersion !== null ? { QuestionSetVersion: pinnedVersion } : {}),
        AIContext: gameData.aiContext || '',
        // Workie's voice for this session. `get-ai-summary.js` reads
        // `metadata.PersonaId`, and `PUT /games/{id}/persona` updates this one
        // attribute mid-game. Absent/empty means "adapt to the session".
        ...(gameData.personaId ? { PersonaId: gameData.personaId } : {}),
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
        // The host's setup choices. Read by the anonymity gate on every answer
        // payload; `randomizeQuestions` is read at :264 for question selection.
        // This is the third of the three edits create-game.js warns about —
        // destructure, createGame() argument, and here. Miss this one and the
        // field is accepted by the API and silently discarded, which is what
        // happened to triviaTimer.
        HostPreferences: {
          randomizeQuestions: gameData.hostPreferences?.randomizeQuestions !== false,
          anonymousUntilReveal: gameData.hostPreferences?.anonymousUntilReveal !== false
        },
        ttl
      })
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
          ':pk': resolvedSet.pk,
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

        // Initialize category counts arrays for dynamic management
        const counts1_8 = new Array(8).fill(0);
        const counts9_16 = new Array(8).fill(0);
        const counts17_24 = new Array(8).fill(0);
        let totalQuestions = 0;

        // Query the question set to get questions for ALL categories (not just selected ones)
        const questionSetQueries = await Promise.all(
          allCategories.map(async (category) => {
            const categoryId = category.SK.replace('CATEGORY#', '');
            const categoryQuestions = await db.send(new QueryCommand({
              TableName: process.env.TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
              ExpressionAttributeValues: {
                ':pk': resolvedSet.pk,
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
            
            // Populate counts array based on category position (for ALL categories, regardless of selection)
            const categoryIndex = i;
            const categoryName = allCategories[categoryIndex]?.CategoryName || allCategories[categoryIndex]?.Name || '';
            const isSelected = effectiveSelectedCategories.includes(categoryId) || 
                             effectiveSelectedCategories.includes(categoryName);
            
            // Set actual question count for ALL categories (enabled and disabled)
            if (categoryIndex < 8) {
              counts1_8[categoryIndex] = questions.length;
            } else if (categoryIndex < 16) {
              counts9_16[categoryIndex - 8] = questions.length;
            } else if (categoryIndex < 24) {
              counts17_24[categoryIndex - 16] = questions.length;
            }
            
            // Only add to totalQuestions if category is selected/enabled
            if (isSelected) {
              totalQuestions += questions.length;
            }
          }
        }
        
        // Create STATE#CATS#COUNTS record for dynamic category management
        console.log(`📊 Creating category counts: total=${totalQuestions}, 1-8=[${counts1_8}], 9-16=[${counts9_16}], 17-24=[${counts17_24}]`);
        
        await db.send(new PutCommand({
          TableName: process.env.TABLE_NAME,
          Item: {
            PK: `GAME#${gameId}`,
            SK: 'STATE#CATS#COUNTS',
            Version: 1,
            '1-8': counts1_8,
            '9-16': counts9_16,
            '17-24': counts17_24,
            TotalEnabled: totalQuestions,
            TotalRemaining: totalQuestions, // Same as TotalEnabled - only count enabled categories
            CreatedAt: now,
            UpdatedAt: now,
            ttl
          }
        }));
      }
    }
    
    console.log(`✅ Game ${gameId} created with full schema compliance`);
    return true;
  } catch (error) {
    console.error(`❌ Error creating game ${gameId}:`, error);
    // RELEASE THE CODE. A create that fell over after the lock was taken would
    // otherwise burn one of 9,000 codes for 90 days for nothing, and leave a
    // half-built partition no list shows and no delete finds. Not attempted when
    // the failure IS the lock — that row is another session's.
    if (reserved && error && error.name !== 'ConditionalCheckFailedException') {
      try {
        await db.send(new DeleteCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` }
        }));
        if (orgId) {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: gamesIndexPk(orgId), SK: `GAME#${gameId}` }
          }));
        }
        console.log(`↩️ Released reservation for failed game ${gameId}`);
      } catch (releaseError) {
        console.error(`❌ Could not release reservation for ${gameId}:`, releaseError.message);
      }
    }
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
