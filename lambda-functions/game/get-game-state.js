const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveSetPartition } = require('./set-version');
const { ORG } = require('./tenant');
const { decryptItem } = require('./tenant-crypto');

const { isPresent } = require('./player-presence');

/**
 * WHOSE SESSION IS THIS? — read off the row, never off the caller.
 *
 * `GET /games/{gameId}/state` is PUBLIC: every participant's phone polls it
 * with no identity, and the Host Remote polls it every two seconds. So the
 * organisation cannot come from `tenant.callerOrgId(event)` — that is '' for
 * every anonymous caller, and a blank orgId THROWS in tenant-crypto rather
 * than defaulting. The METADATA row carries `orgId` for exactly this reason
 * (schema-compliant-manager.js:164).
 *
 * '' for a session created before tenancy, or by a host with no org. Those
 * rows were never encrypted, so there is nothing to unwrap.
 */
const orgOf = (item) => (item && typeof item.orgId === 'string' ? item.orgId.trim() : '');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  try {
    const { gameId, playerId } = event.pathParameters || {};

    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

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

    // THE SESSION BRIEF, in the clear for this response only. `Title`,
    // `HostName`, `Details` and `AIContext` are ciphertext at rest on an org's
    // session (ENCRYPTED_FIELDS.session) — a session title like "Q3
    // Restructure Retro" names the meeting and often the problem, and the
    // threat this guards against is a scan of the table, not the person in the
    // room who is about to be shown it anyway.
    const sessionOrgId = orgOf(gameMetadata.Item);
    const sessionMeta = sessionOrgId
      ? await decryptItem(sessionOrgId, 'session', gameMetadata.Item)
      : gameMetadata.Item;

    // Get game state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    // Extract state information from the current schema
    const stateItem = gameState.Item;
    const currentState = stateItem?.State || 'CREATED';
    const lessonNumber = stateItem?.LessonNumber || 0;
    let currentQuestionData = null;
    
    // Use the actual state directly (ASK#001, VOTE#001, etc.)
    const frontendState = currentState;
    /*
      HAS THE ROUND REVEALED ITS ANSWER YET? The same predicate get-question.js
      uses for the same field, spelled the same way on purpose — two handlers
      serving one question had two different rules, and only one of them was a
      rule. See the block that reads this, below.
    */
    const revealed = String(currentState).startsWith('RESULTS#');
    // Try to get question number from LessonNumber, CurrentQuestionId is the source question ID
    const currentQuestionId = stateItem?.CurrentQuestionId;
    const currentQuestionNumber = lessonNumber > 0 ? String(lessonNumber).padStart(3, '0') : null;
    
    console.log(`📊 GET-STATE: currentState=${currentState}, lessonNumber=${lessonNumber}, questionNumber=${currentQuestionNumber}`);

    // The durable fact for whether THIS round has shown its authors — read
    // straight from the ROUND# record rather than inferred from `frontendState`.
    // enterResultsState (get-results.js) and reveal-authors.js both write it
    // unconditionally, so it is true the instant either happens, independent of
    // which state the round is currently in. The frontend used to derive this
    // from `state.startsWith('RESULTS#')`, which meant an early reveal (the
    // override for a host who reveals before closing the vote) got silently
    // reverted by the next ordinary re-sync that ran before RESULTS — a
    // reconnect, `gameStateChanged`, `questionStarted`, `votingStarted` — none
    // of which are a page refresh, so this was easy to hit mid-round.
    let authorsRevealed = false;
    /**
     * Which beat of RESULTS this round is on — the tally, or the AI read-back.
     *
     * Same record, same read, no extra round trip. It is here because the Host
     * Remote holds no WebSocket (HostRemote.jsx explains why) and polls this
     * endpoint every two seconds, so this field is the ONLY way a beat pushed
     * from the projector reaches the phone.
     *
     * Defaults to 'results' rather than undefined: a round nobody has moved is
     * showing its tally, and saying so explicitly keeps every client off the
     * business of inventing a default.
     */
    let stageBeat = 'results';
    /**
     * WHAT THE ROOM IS LOOKING AT CLOSELY — see `stage-focus.js`.
     *
     * Same record, same read, no extra round trip, and here for the same reason
     * `stageBeat` is: the Host Remote holds no WebSocket and polls this endpoint
     * every two seconds, so this field is the only way a spotlight opened on the
     * projector reaches the phone. It is also what lets a reloading host page
     * come back up on the response it was showing rather than dropping the room
     * out of a spotlight nobody asked to close.
     *
     * Defaults to `'none'`, never undefined. "The host closed it" and "nobody
     * has opened one this round" are the same picture on stage but different
     * facts on the wire, and a client inventing its own default is how the two
     * surfaces come to disagree.
     */
    let stageFocus = { focus: 'none', index: null };
    if (currentQuestionNumber) {
      try {
        const roundRecord = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: `ROUND#${currentQuestionNumber}` }
        }));
        authorsRevealed = !!(roundRecord.Item && roundRecord.Item.AuthorsRevealed);
        if (roundRecord.Item && roundRecord.Item.StageBeat === 'field-notes') {
          stageBeat = 'field-notes';
        }
        /*
          Read against the CLOSED set the writer enforces. A value this build
          has never heard of — an older or newer deploy's — resolves to 'none'
          rather than travelling on to a client that will compare it against
          three strings and silently do nothing.

          `Number.isInteger` and not a truthiness test: index 0 is the FIRST
          response and the most likely one a host enlarges, and `|| null` would
          erase exactly that case.
        */
        const storedFocus = roundRecord.Item && roundRecord.Item.StageFocus;
        if (storedFocus === 'question') {
          stageFocus = { focus: 'question', index: null };
        } else if (storedFocus === 'answer' && Number.isInteger(roundRecord.Item.StageFocusIndex)) {
          stageFocus = { focus: 'answer', index: roundRecord.Item.StageFocusIndex };
        }
      } catch (error) {
        console.error(`❌ Error fetching round record for question ${currentQuestionNumber}:`, error);
        // Fall back to false — undecided is the safe (hidden) state.
      }
    }

    // If we're in a question state (ASK#, VOTE#, or RESULTS#) but don't have question data, fetch it
    if ((frontendState.startsWith('ASK#') || frontendState.startsWith('VOTE#') || frontendState.startsWith('RESULTS#')) && currentQuestionNumber && !currentQuestionData) {
      console.log(`🔍 Fetching question data for question ${currentQuestionNumber}`);
      
      try {
        // Get question reference record
        const questionRef = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${currentQuestionNumber}#REF` }
        }));

        if (questionRef.Item) {
          const sourceQuestionId = questionRef.Item.SourceQuestionId;
          const questionSetId = questionRef.Item.SetId;
          
          // Read the VERSION this round was served from. The REF row records it
          // (next-question.js writes SetVersion); the resolver falls through to
          // the set's activeVersion and then to the legacy `SET#<id>` partition,
          // so rounds started before versioning are unaffected.
          //
          // AND THE SCOPE, FROM THE SAME ROW. Since tenancy a `setId` alone no
          // longer names one partition — setId is a slug of the title
          // (upload-questions.js:298), so two organisations can both produce
          // `teamretro`. The REF row pins the PAIR, and this reads it from
          // there rather than from the request for the reason get-question.js
          // gives at the same call: THIS ROUTE IS PUBLIC and its callers are
          // anonymous participants, so a request-derived scope would resolve to
          // `platform` for every player in every organisation's session and
          // serve them nothing.
          //
          // A REF written before tenancy carries no SetScope, which reads as
          // platform — the same reading of an absent scope as everywhere else
          // (set-version.js `setRef`).
          const resolvedSet = await resolveSetPartition(
            db, process.env.TABLE_NAME,
            {
              scope: questionRef.Item.SetScope,
              orgId: questionRef.Item.SetOrgId,
              setId: questionSetId,
            },
            questionRef.Item.SetVersion
          );

          // Get the actual question from the question set
          const question = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: {
              PK: resolvedSet.pk,
              SK: sourceQuestionId
            }
          }));

          // Decrypted from the SET's org, which is not necessarily the
          // SESSION's: a host in org A can run a platform set, and the pinned
          // pair on the REF row is the only authority on which. Platform and
          // public content is never encrypted, so it passes through as-is.
          const setOrgId = resolvedSet.scope === ORG ? String(resolvedSet.orgId || '') : '';
          const questionItem = question.Item && setOrgId
            ? await decryptItem(setOrgId, 'question', question.Item)
            : question.Item;

          if (question.Item) {
            currentQuestionData = {
              id: currentQuestionNumber,
              questionNumber: currentQuestionNumber,
              title: questionItem.Title || '',
              detail: questionItem.Detail || '',
              questionDetail: questionItem.Detail || '',
              category: questionItem.Category,
              field: questionItem.Category,
              school: questionItem.School || '',
              image: questionItem.Image || '', // Optional artwork URL ("Art Title" rounds)
              customInstructions: questionItem.CustomInstructions || '',
              setId: questionSetId,
              startedAt: questionRef.Item.StartedAt,
              // For trivia questions (check both cases)
              optionA: questionItem.optionA || questionItem.OptionA || '',
              optionB: questionItem.optionB || questionItem.OptionB || '',
              optionC: questionItem.optionC || questionItem.OptionC || '',
              optionD: questionItem.optionD || questionItem.OptionD || '',
              optionE: questionItem.optionE || questionItem.OptionE || '',
              optionF: questionItem.optionF || questionItem.OptionF || '',
              /*
                THE ANSWER IS A SPOILER UNTIL THE ROUND REVEALS IT.

                This route carries NO authorizer (template-clean.yaml — unlike
                `/games/{gameId}/queue`, which does), and `currentQuestionData`
                is in the BASE response, gated by neither `playerId` nor
                `includeHostData`. So this line handed the correct answer to
                anyone holding the four digits projected on the wall, during
                ASK, while the room was still answering.

                RESULTS is the line because that is where the answer goes on the
                projector anyway — and it is the same line `get-question.js`
                already draws for the identical field. Two handlers serving one
                question had two different rules; now they have one.

                NOT gated on `includeHostData`: that flag is a query parameter
                on an unauthenticated route, so it proves nothing and would only
                move the leak somewhere slightly less obvious.
              */
              ...(revealed ? { correctAnswer: questionItem.correctAnswer } : {}),
              points: questionItem.points || 10
            };
            
            console.log(`✅ Fetched question data for question ${currentQuestionNumber}: ${currentQuestionData.title}`);
          } else {
            console.warn(`❌ Question not found: ${sourceQuestionId} from set ${questionSetId}`);
          }
        } else {
          console.warn(`❌ Question reference not found: QUESTION#${currentQuestionNumber}#REF`);
        }
      } catch (error) {
        console.error(`❌ Error fetching question data for question ${currentQuestionNumber}:`, error);
      }
    }

    const response = {
      gameId: gameId,
      state: frontendState,
      currentQuestion: lessonNumber, // Return numeric lesson number for frontend
      currentQuestionData: currentQuestionData,
      authorsRevealed: authorsRevealed,
      stageBeat: stageBeat,
      stageFocus: stageFocus,
      gameType: gameMetadata.Item.GameType || 'call-and-answer',
      gameMetadata: {
        title: sessionMeta.Title,
        hostName: sessionMeta.HostName,
        gameType: gameMetadata.Item.GameType || 'call-and-answer',
        questionSetId: gameMetadata.Item.QuestionSetId,
        // THE OTHER HALF OF THE PIN, so a restoring host reloads the categories
        // from the library the session actually plays. An id alone names one
        // set per library (tenant.js), and without this the host page had to
        // fall back to the backend's org-first SEARCH — right almost always,
        // ambiguous exactly when two libraries hold the same slug. Not a
        // secret: it is one of platform/org/public and names no organisation.
        // Absent on sessions created before the pin, read as platform.
        questionSetScope: gameMetadata.Item.QuestionSetScope || 'platform',
        selectedCategories: gameMetadata.Item.SelectedCategories || [],
        // Workie's voice for this session. Another whitelist projection: without
        // this line the host's in-game voice picker resets to "Adapt to the
        // session" every time a game is resumed, while the game itself still
        // has a persona set — a picker that misreports its own state.
        personaId: gameMetadata.Item.PersonaId || null,
        createdAt: gameMetadata.Item.CreatedAt
      }
    };

    // If playerId is provided, get player-specific state
    if (playerId) {
      const playerData = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerId}` }
      }));

      if (!playerData.Item) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Player not found in this game' }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      // Get player's current total score from the score record (single source of truth)
      const playerScoreRecord = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { 
          PK: `GAME#${gameId}`, 
          SK: `PLAYER#${playerId}#SCORE` 
        }
      }));

      const currentTotalScore = playerScoreRecord.Item ? playerScoreRecord.Item.score || 0 : 0;

      response.playerData = {
        playerId: playerId,
        playerName: playerData.Item.PlayerName,
        totalScore: currentTotalScore,
        joinedAt: playerData.Item.JoinedAt
      };

      // Check player's participation in current question
      if (currentQuestionNumber) {
        const questionNumberStr = currentQuestionNumber.toString().padStart(3, '0');
        
        // Check if player answered
        const playerAnswer = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `GAME#${gameId}`, 
            SK: `QUESTION#${questionNumberStr}#ANSWER#${playerId}` 
          }
        }));

        // Check if player voted
        const playerVote = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `GAME#${gameId}`, 
            SK: `QUESTION#${questionNumberStr}#VOTE#${playerId}` 
          }
        }));

        response.playerQuestionState = {
          questionNumber: currentQuestionNumber,
          hasAnswered: !!playerAnswer.Item,
          hasVoted: !!playerVote.Item
        };
      }
    }

    // If host is requesting, get additional host-specific data
    if (!playerId || event.queryStringParameters?.includeHostData === 'true') {
      /*
        THE QUEUED RUNNING ORDER — and the remote is the reason it is HERE.

        The phone remote holds no WebSocket at all (HostRemote.jsx explains
        why: the host connection row gets evicted, so the remote deliberately
        does not hold one). It polls this endpoint every 2s and that is its
        ONLY channel. A queue announced solely over `questionQueueChanged`
        would be invisible on the surface the host is actually holding — they
        would queue three questions on the stage and see nothing on the phone,
        which reads as the feature not working rather than as a missing field.

        The projection is the SAME shape `GET /games/{id}/queue` returns, on
        purpose: the remote reads both, and two shapes would be two parsers of
        one fact. `version` travels with it because the next thing the phone
        does with this is post an op carrying `expectedVersion`.

        Its own try/catch, like the category block below — a session that has
        never queued anything must not lose its whole state payload to a
        failure in an optional extra.
      */
      try {
        const queueResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'QUEUE' }
        }));

        const queueItem = queueResult.Item;
        // No QUEUE row is an EMPTY queue at version 0, not an absent field. A
        // surface that has to distinguish "no queue yet" from "queue of none"
        // is a surface that will get it wrong on first render.
        response.questionQueue = {
          queue: Array.isArray(queueItem?.Queue) ? queueItem.Queue : [],
          version: Number(queueItem?.Version) || 0,
          setId: queueItem?.SetId || null,
          setVersion: queueItem?.SetVersion !== undefined ? queueItem.SetVersion : null,
          updatedAt: queueItem?.UpdatedAt || null
        };
      } catch (error) {
        console.error('Error fetching question queue:', error);
      }

      // Get category counts and state for dynamic management
      try {
        const categoryCountsResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' }
        }));

        const categoryStateResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
        }));

        if (categoryCountsResult.Item) {
          response.categoryCounts = {
            '1-8': categoryCountsResult.Item['1-8'] || [],
            '9-16': categoryCountsResult.Item['9-16'] || [],
            '17-24': categoryCountsResult.Item['17-24'] || [],
            totalRemaining: categoryCountsResult.Item.TotalRemaining || 0
          };
        }

        if (categoryStateResult.Item) {
          response.categoryState = {
            'HostMask1-8': categoryStateResult.Item['HostMask1-8'] || '00000000',
            'HostMask9-16': categoryStateResult.Item['HostMask9-16'] || '00000000',
            'HostMask17-24': categoryStateResult.Item['HostMask17-24'] || '00000000'
          };
        }
      } catch (error) {
        console.error('Error fetching category data:', error);
        // Don't fail the request if category data is unavailable
      }

      // Get voting progress if in voting state
      if (frontendState.startsWith('VOTE#') && currentQuestionNumber) {
        const questionNumberStr = currentQuestionNumber.toString().padStart(3, '0');
        
        // Get all votes for current question
        const votesResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': `QUESTION#${questionNumberStr}#VOTE#`
          }
        }));

        // Get all players to calculate voting progress
        const playersResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': 'PLAYER#'
          }
        }));

        // Deduplicate players by name, keeping the most recent record (same logic as get-players.js)
        let players = (playersResult.Items || []).filter(player => {
          const playerName = player.PlayerName || player.playerName;
          if (!playerName) {
            console.log(`⚠️ Filtering out player record with no name:`, player);
            return false;
          }
          return true;
        });

        const playerMap = new Map();
        players.forEach(player => {
          const playerName = player.PlayerName || player.playerName;
          const existing = playerMap.get(playerName);
          
          if (!existing || (player.JoinedAt && (!existing.JoinedAt || player.JoinedAt > existing.JoinedAt))) {
            playerMap.set(playerName, player);
          }
        });
        
        // WHO IS STILL IN THE ROOM — the denominator of "3 of 4 have voted".
        //
        // A player the host removed because they left must not be voted for by
        // nobody forever: the round would never read as complete and the host
        // would sit waiting on an empty chair. `player-presence.js` records
        // which counts drop them and which (the report, the AI summary) must
        // not — this is a live number, so it drops them.
        const uniquePlayers = Array.from(playerMap.values()).filter(isPresent);
        console.log(`✅ Game state voting progress: ${uniquePlayers.length} unique players still in the room after deduplication`);

        response.votingProgress = {
          votesReceived: votesResult.Items?.length || 0,
          totalPlayers: uniquePlayers.length,
          votersIds: (votesResult.Items || []).map(vote => vote.PlayerName)
        };
      }

      // Get answer progress if in answer state
      if (frontendState.startsWith('ASK#') && currentQuestionNumber) {
        const questionNumberStr = currentQuestionNumber.toString().padStart(3, '0');
        
        // Get all answers for current question
        const answersResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': `QUESTION#${questionNumberStr}#ANSWER#`
          }
        }));

        // Get all players to calculate answer progress
        const playersResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': 'PLAYER#'
          }
        }));

        // Deduplicate players by name, keeping the most recent record (same logic as get-players.js)
        let players = (playersResult.Items || []).filter(player => {
          const playerName = player.PlayerName || player.playerName;
          if (!playerName) {
            console.log(`⚠️ Filtering out player record with no name:`, player);
            return false;
          }
          return true;
        });

        const playerMap = new Map();
        players.forEach(player => {
          const playerName = player.PlayerName || player.playerName;
          const existing = playerMap.get(playerName);
          
          if (!existing || (player.JoinedAt && (!existing.JoinedAt || player.JoinedAt > existing.JoinedAt))) {
            playerMap.set(playerName, player);
          }
        });
        
        // Removed players drop out here too, for the same reason as the voting
        // denominator twenty lines up. See player-presence.js.
        const uniquePlayers = Array.from(playerMap.values()).filter(isPresent);
        console.log(`✅ Game state answer progress: ${uniquePlayers.length} unique players still in the room after deduplication`);

        response.answerProgress = {
          answersReceived: answersResult.Items?.length || 0,
          totalPlayers: uniquePlayers.length,
          answererIds: (answersResult.Items || []).map(answer => answer.PlayerName)
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(response),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get game state error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get game state: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};