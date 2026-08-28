const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveSetPartition, setMetadataKey } = require('./set-version');
const { ORG, callerMayDriveSession } = require('./tenant');
const { uniquePlayerRecords } = require('./player-rows');
const { isHidden } = require('./anonymity');
const { parseCommentSk } = require('./comment-keys');
const { decryptItem, decryptItems, encryptItem } = require('./tenant-crypto');

/**
 * WHOSE SESSION IS THIS? — off the row, though the route is no longer public.
 *
 * `POST /games/{gameId}/report` WAS public: a four-digit id and no identity at
 * all, on the route that assembles every participant's name against their
 * answer. It carries the Cognito authorizer as of 2026-08-28, and the handler
 * asks `callerMayDriveSession` below — the two had to arrive together, because
 * that guard passes every caller holding no groups (the participant journey is
 * never gated) and on an open route that is everyone. template-clean.yaml's
 * comment on CreateReportEvent has the whole account.
 *
 * THE ORG STILL COMES OFF THE ROW, and that does not change with the
 * authorizer. This report is about the SESSION, so the key it decrypts under is
 * the session's; the caller's own org is a fact about the caller. With the
 * guard in place the two agree whenever the session has an owner, and where
 * they cannot — a pre-tenancy or orgless session, which the guard deliberately
 * lets through — the row is the only answer there is. A blank orgId THROWS in
 * tenant-crypto rather than defaulting, which is why every call below is
 * guarded on `reportOrgId` rather than passing whatever the caller had.
 */
const orgOf = (item) => (item && typeof item.orgId === 'string' ? item.orgId.trim() : '');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

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

    console.log(`📊 Creating comprehensive report for game ${gameId}`);

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

    /*
      WHOSE SESSION IS THIS? The Cognito authorizer says the caller is *a* host;
      nothing here said they were THIS session's host, and the same four-digit
      code opens every one of them. 404 rather than 403, for the reason
      tenant.callerMayDriveSession gives: a 403 confirms that a guessed code
      names a real session belonging to somebody else.

      COSTS NOTHING. The owning org lives on METADATA and METADATA has just been
      read — this is the one route that was already holding the row the other
      handlers pay a second GetItem for. It also sits ABOVE the four queries
      below, so a refused caller does not read a single player, answer, vote or
      comment out of a partition that is not theirs.

      THIS ROUTE ANSWERS WITH THE WHOLE ROOM, which is what makes it the widest
      of the set: every participant's name against their answer, decrypted, plus
      the AI summaries and the round comments. `isHidden` a few dozen lines down
      decides what a report is allowed to attribute — a promise made to
      participants — and until this guard existed that judgement was being made
      on behalf of a caller nobody had identified.
    */
    if (!callerMayDriveSession(event, gameMetadata.Item)) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    // Get all players
    const playersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'PLAYER#'
      }
    }));

    // Get all player score records by filtering the player query results
    const playerScores = (playersQuery.Items || []).filter(item => 
      item.SK && item.SK.includes('#SCORE')
    );

    // Get all questions that were asked (based on results)
    const resultsQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'QUESTION#'
      }
    }));

    // All question-related data is retrieved in the single query above

    // ANONYMITY. The rounds this reports on are not all finished:
    // questionNumbers below is built from votes ∪ results ∪ AI summaries, so a
    // round still in VOTE joins the list the moment the first ballot lands.
    // Without this, the report would hand back the names the ballot itself is
    // withholding, mid-vote, from the projector in the room.
    //
    // This stands whether or not the route is public, and it is no longer
    // public — the guard above narrowed the caller from "anyone with the code"
    // to "this session's organisation". That closes the stranger and not the
    // promise: withholding names mid-vote is owed to the ROOM, and the host is
    // the person standing in front of it.
    //
    // Per round, from the same ROUND# records the rest of the feature reads,
    // through the same isHidden() gate — so the report cannot drift from what
    // GET /answers decided. In practice this narrows nothing: entering RESULTS
    // sets AuthorsRevealed by itself, so every round that finished is still
    // fully attributed. Only a round abandoned mid-vote loses its names.
    const roundsQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'ROUND#'
      }
    }));
    const roundsByNumber = new Map(
      (roundsQuery.Items || []).map((r) => [String(r.SK).replace('ROUND#', ''), r])
    );

    /*
      COMMENTS ON THIS SESSION'S ROUNDS.

      The owner: *"these will get added to the round report and the over all
      report as well. clearly called out as comments."* One query for the whole
      session — the sort key puts the round number immediately after the tag
      (COMMENT#003#…) precisely so this is one prefix read and not a scan.

      Decrypted as `comment`: Text, AnchorExcerpt and AnchorLabel are ciphertext
      at rest, and AnchorExcerpt is the one that matters most here. It is a
      verbatim slice of the response being commented on, and from day 8 — once
      the 7-day ANSWER rows have expired and `answers` below rebuilds empty — it
      is the only surviving copy of what the room was actually discussing.
    */
    const commentsQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'COMMENT#'
      }
    }));
    /** True when THIS round's authors must stay off the report. */
    const roundIsHidden = (paddedQuestionNumber) =>
      isHidden(gameMetadata.Item, roundsByNumber.get(paddedQuestionNumber));

    // Process the data with proper filtering
    const players = playersQuery.Items || [];
    const allQuestionItems = resultsQuery.Items || [];

    console.log(`📊 Found ${players.length} player records and ${playerScores.length} score records`);
    
    // ── EVERY SOURCE OF PROSE THIS REPORT QUOTES, UNWRAPPED ──────────────────
    //
    // One Query returned answers, votes, AI summaries and stored results in a
    // single pass, so they are split first and then decrypted per entity —
    // `decryptItem` needs to know WHICH boundary list applies, and there is no
    // single list that covers a mixed partition.
    //
    // `results` is deliberately absent: the `QUESTION#nnn#RESULTS` row is not
    // in ENCRYPTED_FIELDS at all. It is a derived tally written by
    // get-results.js, and it is recorded in the hand-off as a known gap rather
    // than quietly encrypted here — a boundary decision belongs in
    // tenant-crypto.js, not in a call site.
    //
    // Also note the session brief itself: `gameTitle` and `hostName` on the
    // report below are THE SAME TWO STRINGS as METADATA's Title and HostName,
    // which is why `session` is in the boundary at all.
    const reportOrgId = orgOf(gameMetadata.Item);
    const sessionMeta = reportOrgId
      ? await decryptItem(reportOrgId, 'session', gameMetadata.Item)
      : gameMetadata.Item;

    // Filter items by type using SK patterns
    const rawResults = allQuestionItems.filter(item => item.SK.includes('#RESULTS'));
    const rawAnswers = allQuestionItems.filter(item => item.SK.includes('#ANSWER#'));
    const rawVotes = allQuestionItems.filter(item => item.SK.includes('#VOTE#'));
    const rawAiSummaries = allQuestionItems.filter(item => item.SK.includes('#AISummary'));

    // The derived tally is encrypted too, and it has to be: the wavelength
    // branch of get-results stores `answers[].answer` — the participant's
    // literal submission — inside it, so decrypting the ANSWER rows and reading
    // this one raw would put the same sentences into the report in the clear.
    const results = reportOrgId ? await decryptItems(reportOrgId, 'results', rawResults) : rawResults;
    const answers = reportOrgId ? await decryptItems(reportOrgId, 'answer', rawAnswers) : rawAnswers;
    const votes = reportOrgId ? await decryptItems(reportOrgId, 'vote', rawVotes) : rawVotes;
    const aiSummaries = reportOrgId
      ? await decryptItems(reportOrgId, 'aiSummary', rawAiSummaries)
      : rawAiSummaries;

    /*
      Grouped by the round in the SORT KEY, not by an attribute, so a row whose
      QuestionNumber attribute ever disagreed with its key is filed where it can
      actually be found again. `parseCommentSk` returns null for anything that
      is not a comment key — the neighbouring QUESTION#/ROUND#/PLAYER# rows in
      this partition — rather than a half-filled object, which is what stops an
      answer being counted as a comment.
    */
    const rawComments = commentsQuery.Items || [];
    const commentItems = reportOrgId
      ? await decryptItems(reportOrgId, 'comment', rawComments)
      : rawComments;

    const commentsByRound = new Map();
    for (const row of commentItems) {
      const parsed = parseCommentSk(row.SK);
      if (!parsed) continue;
      const list = commentsByRound.get(parsed.questionNumber) || [];
      list.push({
        commentId: parsed.commentId,
        anchorKind: row.AnchorKind,
        anchorRef: row.AnchorRef,
        anchorLabel: row.AnchorLabel,
        anchorExcerpt: row.AnchorExcerpt,
        text: row.Text,
        // OMITTED, never nulled, on a round whose authors are still hidden —
        // the rule this file already applies to answers, so `displayLabelFor`
        // reads a comment exactly the way it reads a response, with no new
        // logic anywhere on the client.
        ...(roundIsHidden(parsed.questionNumber) ? {} : { playerName: row.playerName }),
        submittedAt: row.SubmittedAt,
      });
      commentsByRound.set(parsed.questionNumber, list);
    }
    // The id is time-ordered (comment-keys.js), so this is writing order.
    for (const list of commentsByRound.values()) {
      list.sort((a, b) => String(a.commentId).localeCompare(String(b.commentId)));
    }

    // Who actually played.
    //
    // Hoisted above gameStats deliberately. `players` is the raw result of a
    // begins_with(SK, 'PLAYER#') query, and each participant writes THREE rows
    // under that prefix — PLAYER#{name}, PLAYER#{name}#SCORE and
    // PLAYER#{name}#STATE — so `players.length` reported roughly three times
    // the room. A four-person session claimed twelve players on the front page
    // of the report.
    //
    // This is the same filter-then-dedupe that playerPerformance below already
    // ran; it just ran too late to be the number anybody read. One computation,
    // used by both.
    // Lifted to game/player-rows.js when the session-history list needed the
    // same count. Two readers, one rule — a player count that is right in the
    // report and wrong in the list is worse than one that is wrong in both,
    // because nobody can tell which to believe.
    const uniquePlayers = uniquePlayerRecords(players);
    console.log(`📊 Filtered and deduplicated players: ${players.length} → ${uniquePlayers.length}`);

    // Calculate statistics
    const gameStats = {
      totalPlayers: uniquePlayers.length,
      totalQuestions: results.length,
      totalAnswers: answers.length,
      totalVotes: votes.length,
      averageAnswersPerQuestion: results.length > 0 ? Math.round((answers.length / results.length) * 100) / 100 : 0,
      averageVotesPerQuestion: results.length > 0 ? Math.round((votes.length / results.length) * 100) / 100 : 0,
      // Counted off the rows the report actually renders, so the front page and
      // the rounds cannot disagree. Stays plaintext with the rest of gameStats —
      // it is a count, not content.
      totalComments: commentItems.length
    };

    // Get game metadata for scoring configuration
    const scoringConfig = gameMetadata.Item.ScoringConfig || {
      firstPlacePoints: 3,
      secondPlacePoints: 2,
      thirdPlacePoints: 1,
      participationPoints: 0
    };

    // Get question set details for question metadata
    const questionSetId = gameMetadata.Item.QuestionSetId;
    let questionSetData = null;
    let useNewFormat = false; // Track which format is being used

    // Which VERSION of the set this game played. The final report must quote
    // the questions the players actually saw, so it resolves through the game's
    // pin first, then the set's activeVersion, then the legacy partition.
    const resolvedSet = questionSetId
      ? await resolveSetPartition(db, process.env.TABLE_NAME, questionSetId, gameMetadata.Item.QuestionSetVersion)
      : { pk: null, version: null };
    
    if (questionSetId) {
      try {
        // Try the new metadata structure first (SET#{id} / METADATA)
        console.log(`📊 Attempting to fetch question set metadata for ${questionSetId} using new format...`);
        const newFormatResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `SET#${questionSetId}`, SK: 'METADATA' }
        }));
        
        if (newFormatResult.Item && newFormatResult.Item.metadata) {
          console.log(`📊 Found question set in NEW format`);
          questionSetData = newFormatResult.Item.metadata;
          useNewFormat = true;
        } else {
          // Fallback to the metadata row — IN THE RIGHT SCOPE.
          //
          // This read `PK: 'SETS'` unconditionally, which since tenancy is the
          // PLATFORM library and nothing else. An organisation's own set lives
          // at `ORG#<org>#SETS`, so for every org session this simply found
          // nothing and the report silently lost its set name, description and
          // instructions — no error, just absent fields.
          //
          // The session pins the pair (`QuestionSetScope` beside
          // `QuestionSetId`), so the scope comes from the row rather than from
          // the caller: this route is PUBLIC and its callers are anonymous
          // participants, and a caller-derived scope would resolve to platform
          // for every one of them.
          const setRef = {
            scope: sessionMeta.QuestionSetScope,
            orgId: sessionMeta.QuestionSetScope === ORG ? reportOrgId : '',
            setId: questionSetId,
          };
          console.log(`📊 New format not found, trying the metadata row in scope ${setRef.scope || 'platform'}...`);
          const oldFormatResult = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: setMetadataKey(setRef),
          }));

          if (oldFormatResult.Item) {
            console.log(`📊 Found question set metadata`);
            // Its name/description/instructions are encrypted for an org set.
            questionSetData = setRef.orgId
              ? await decryptItem(setRef.orgId, 'set', oldFormatResult.Item)
              : oldFormatResult.Item;
            useNewFormat = false;
          }
        }
        
        console.log(`📊 Question set data: ${questionSetData ? 'Found' : 'Not found'} for setId: ${questionSetId}`);
      } catch (error) {
        console.log('Could not fetch question set data:', error.message);
      }
    }

    // Process questions with complete data including rankings
    const detailedQuestions = [];
    
    // Get question numbers from votes (indicates completed questions)
    const questionNumbersFromVotes = [...new Set(votes.map(v => {
      // Extract question number from SK format: QUESTION#001#VOTE#playerId
      const match = v.SK.match(/QUESTION#(\d+)#VOTE#/);
      return match ? match[1] : null;
    }).filter(Boolean))];
    
    // Also check for RESULTS entries (might exist for some questions)
    const questionNumbersFromResults = [...new Set(results.map(r => {
      // Extract question number from SK format: QUESTION#001#RESULTS
      const match = r.SK.match(/QUESTION#(\d+)#RESULTS/);
      return match ? match[1] : null;
    }).filter(Boolean))];
    
    // And from AI summaries. A round that produced a Workie summary but neither a
    // vote nor a RESULTS record — a game ended mid-question, or any future
    // non-voting flow — would otherwise be dropped from the report entirely,
    // taking its Field Notes with it.
    const questionNumbersFromAISummaries = [...new Set(aiSummaries.map(ai => {
      // Extract question number from SK format: QUESTION#001#AISummary
      const match = ai.SK.match(/QUESTION#(\d+)#AISummary/);
      return match ? match[1] : null;
    }).filter(Boolean))];

    /*
      And from COMMENTS — the fourth source, and the one that is easiest to
      forget because a comment is not something the round itself produced.

      Without it a round whose only surviving artefact is a comment drops out of
      the report entirely, taking the comments with it and reporting nothing
      wrong. That is not hypothetical: the raw vote and results rows are 7 days
      and a comment row is 30, so any session read in its third week reaches
      exactly this state.
    */
    const questionNumbersFromComments = [...commentsByRound.keys()];

    // Combine all four sources and deduplicate
    const questionNumbers = [...new Set([
      ...questionNumbersFromVotes,
      ...questionNumbersFromResults,
      ...questionNumbersFromAISummaries,
      ...questionNumbersFromComments
    ])];

    console.log(`📊 Found ${questionNumbers.length} questions to process: ${questionNumbers.join(', ')}`);
    console.log(`📊 From votes: ${questionNumbersFromVotes.length}, from results: ${questionNumbersFromResults.length}, from AI summaries: ${questionNumbersFromAISummaries.length}`);

    for (const questionNumber of questionNumbers) {
      console.log(`📊 Processing question ${questionNumber} for report`);
      
      // Get question metadata from results
      const questionResults = results.find(r => r.SK.includes(`QUESTION#${questionNumber}#RESULTS`));
      const questionAnswers = answers.filter(a => a.SK.includes(`QUESTION#${questionNumber}#ANSWER#`));
      const questionVotes = votes.filter(v => v.SK.includes(`QUESTION#${questionNumber}#VOTE#`));
      const questionAISummary = aiSummaries.find(ai => ai.SK.includes(`QUESTION#${questionNumber}#AISummary`));
      
      console.log(`📊 Question ${questionNumber}: ${questionAnswers.length} answers, ${questionVotes.length} votes, hasResults=${!!questionResults}, hasAI=${!!questionAISummary}`);
      
      // Get question details from question set if available
      let questionDetails = null;
      let sourceQuestionId = null;
      
      // First try to get source question ID from results
      if (questionResults?.SourceQuestionId) {
        sourceQuestionId = questionResults.SourceQuestionId;
      } else {
        // If no results, try to find source question ID from question reference
        try {
          const questionRef = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionNumber}#REF` }
          }));
          
          if (questionRef.Item?.SourceQuestionId) {
            sourceQuestionId = questionRef.Item.SourceQuestionId;
            console.log(`📊 Found source question ID from reference: ${sourceQuestionId}`);
          }
        } catch (error) {
          console.log(`⚠️ Could not fetch question reference for ${questionNumber}:`, error.message);
        }
      }
      
      if (sourceQuestionId) {
        console.log(`📊 Source question ID: ${sourceQuestionId || 'Not found'} for question ${questionNumber}`);
        
        if (useNewFormat && questionSetId) {
          // For new format, questions are stored with PK=SET#{setId}
          try {
            console.log(`📊 Fetching question details using NEW format...`);
            const questionResult = await db.send(new GetCommand({
              TableName: process.env.TABLE_NAME,
              Key: {
                PK: resolvedSet.pk,
                SK: sourceQuestionId
              }
            }));
            questionDetails = questionResult.Item;
            console.log(`📊 Question details (new format): ${questionDetails ? 'Found' : 'Not found'} for sourceId: ${sourceQuestionId}`);
          } catch (error) {
            console.log(`Could not fetch question details (new format) for ${sourceQuestionId}:`, error.message);
          }
        } else if (questionSetData) {
          // For old format, we need to search through the question set data
          // or try a different query pattern
          console.log(`📊 Fetching question details using OLD format...`);
          try {
            // Try querying for questions in the old format
            const questionsQuery = await db.send(new QueryCommand({
              TableName: process.env.TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND SK = :sk',
              ExpressionAttributeValues: {
                ':pk': resolvedSet.pk,
                ':sk': sourceQuestionId
              }
            }));
            
            if (questionsQuery.Items && questionsQuery.Items.length > 0) {
              questionDetails = questionsQuery.Items[0];
              console.log(`📊 Question details (old format): Found for sourceId: ${sourceQuestionId}`);
            } else {
              console.log(`📊 Question details (old format): Not found for sourceId: ${sourceQuestionId}`);
            }
          } catch (error) {
            console.log(`Could not fetch question details (old format) for ${sourceQuestionId}:`, error.message);
          }
        }
        
        console.log(`📊 Question details final result: ${questionDetails ? 'Found' : 'Not found'}, Title: ${questionDetails?.Title || 'N/A'}`);
      }

      // Calculate vote tallies for ranking (same logic as get-ai-summary.js)
      const voteTallies = {};
      const answerScores = {};
      const hideAuthors = roundIsHidden(questionNumber);
      if (hideAuthors) {
        console.log(`🔒 Question ${questionNumber} is unrevealed — reporting it without attribution`);
      }

      // Initialize scores for each answer.
      //
      // Index-keyed and never filtered or reordered: the ballot is positional
      // (submit-vote stores {"0": 1}), so dropping a redacted row here would
      // land every later vote on the wrong answer. Authorship is OMITTED, not
      // nulled — same rule as the runtime payloads (game/anonymity.js) — so a
      // renderer that forgets about anonymity shows nothing rather than "null".
      questionAnswers.forEach((answer, index) => {
        answerScores[index] = 0;
        voteTallies[index] = {
          answerText: answer.Answer,
          ...(hideAuthors ? {} : { playerName: answer.PlayerName }),
          firstPlace: 0,
          secondPlace: 0,
          thirdPlace: 0,
          totalScore: 0
        };
      });

      // Process votes to calculate scores
      questionVotes.forEach(vote => {
        const voteData = vote.Votes; // e.g., {"0": 1, "1": 2, "2": 3}
        
        Object.entries(voteData).forEach(([answerIndex, rank]) => {
          const idx = parseInt(answerIndex);
          const position = parseInt(rank);
          
          if (voteTallies[idx]) {
            let points = 0;
            if (position === 1) {
              voteTallies[idx].firstPlace++;
              points = scoringConfig.firstPlacePoints;
            } else if (position === 2) {
              voteTallies[idx].secondPlace++;
              points = scoringConfig.secondPlacePoints;
            } else if (position === 3) {
              voteTallies[idx].thirdPlace++;
              points = scoringConfig.thirdPlacePoints;
            }
            
            voteTallies[idx].totalScore += points;
            answerScores[idx] += points;
          }
        });
      });

      // Create ranked answers list with proper tie handling
      const rankedAnswers = Object.entries(voteTallies)
        .map(([index, voteData]) => ({
          answerIndex: parseInt(index),
          // Absent on an unrevealed round — voteTallies omitted it above.
          ...(hideAuthors ? {} : { playerName: voteData.playerName }),
          answerText: voteData.answerText,
          totalScore: voteData.totalScore,
          firstPlace: voteData.firstPlace,
          secondPlace: voteData.secondPlace,
          thirdPlace: voteData.thirdPlace,
          voteBreakdown: `${voteData.firstPlace} first, ${voteData.secondPlace} second, ${voteData.thirdPlace} third`
        }))
        .sort((a, b) => {
          // Sort by total score first, then by first place votes as tiebreaker
          if (b.totalScore !== a.totalScore) {
            return b.totalScore - a.totalScore;
          }
          return b.firstPlace - a.firstPlace;
        });

      // Add ranking positions
      let currentRank = 1;
      rankedAnswers.forEach((answer, idx) => {
        if (idx > 0 && answer.totalScore !== rankedAnswers[idx - 1].totalScore) {
          currentRank = idx + 1;
        }
        answer.rank = currentRank;
        answer.rankDisplay = currentRank === 1 ? '🥇 1st Place' : 
                           currentRank === 2 ? '🥈 2nd Place' : 
                           currentRank === 3 ? '🥉 3rd Place' : 
                           `${currentRank}th Place`;
      });

      // Debug logging for trivia games
      if (gameMetadata.Item.GameType === 'trivia') {
        console.log(`🎯 TRIVIA DEBUG - Question ${questionNumber}:`);
        console.log(`  - GameType: ${gameMetadata.Item.GameType}`);
        console.log(`  - questionDetails exists: ${!!questionDetails}`);
        console.log(`  - questionDetails keys: ${questionDetails ? Object.keys(questionDetails).join(', ') : 'N/A'}`);
        if (questionDetails) {
          console.log(`  - optionA: ${questionDetails.optionA || questionDetails.OptionA || 'missing'}`);
          console.log(`  - optionB: ${questionDetails.optionB || questionDetails.OptionB || 'missing'}`);
          console.log(`  - correctAnswer: ${questionDetails.correctAnswer || questionDetails.CorrectAnswer || 'missing'}`);
        }
      }

      // Compile complete question data
      detailedQuestions.push({
        questionNumber,
        questionId: questionResults?.QuestionId || questionNumber,
        
        // Question metadata (enhanced for trivia games)
        questionData: {
          title: questionDetails?.Title || `Question ${questionNumber}`,
          detail: questionDetails?.Detail || questionDetails?.QuestionDetail || '',
          category: questionDetails?.Category || 'General',
          sourceQuestionId: sourceQuestionId,

          // Art Title rounds are ordinary call-and-answer sets that carry an
          // image, so `image` is the ONLY thing that lets resolveRoundNoun()
          // label the round "Artwork" in the report. `school` is the artist
          // credit that goes with it.
          image: questionDetails?.Image || questionDetails?.image || null,
          school: questionDetails?.School || questionDetails?.school || null,

          // Trivia-specific fields
          ...(gameMetadata.Item.GameType === 'trivia' && questionDetails ? {
            questionDetail: questionDetails.QuestionDetail || questionDetails.Detail,
            optionA: questionDetails.optionA || questionDetails.OptionA,
            optionB: questionDetails.optionB || questionDetails.OptionB, 
            optionC: questionDetails.optionC || questionDetails.OptionC,
            optionD: questionDetails.optionD || questionDetails.OptionD,
            optionE: questionDetails.optionE || questionDetails.OptionE,
            optionF: questionDetails.optionF || questionDetails.OptionF,
            correctAnswer: questionDetails.correctAnswer || questionDetails.CorrectAnswer,
            answerDetails: questionDetails.answerDetails || questionDetails.AnswerDetails
          } : {})
        },
        
        // Answer data ranked by vote results
        answers: rankedAnswers,
        
        // Vote statistics
        voteStats: {
          totalAnswers: questionAnswers.length,
          totalVotes: questionVotes.length,
          // Math.max() with no arguments is -Infinity, which JSON.stringify
          // turns into null. Reachable whenever a round has no answers — now
          // more so, since AI-summary-only rounds join the list above.
          maxScore: Object.values(answerScores).length > 0
            ? Math.max(...Object.values(answerScores))
            : 0,
          averageScore: Object.values(answerScores).length > 0 ? 
            Math.round((Object.values(answerScores).reduce((sum, score) => sum + score, 0) / Object.values(answerScores).length) * 100) / 100 : 0
        },
        
        // AI Summary (enhanced with structured data)
        aiSummary: questionAISummary ? {
          summaryText: questionAISummary.SummaryText || questionAISummary.Summary,
          discussionQuestions: questionAISummary.DiscussionQuestions || [],
          nextSteps: questionAISummary.NextSteps || [],
          fullResponse: questionAISummary.FullResponse,
          markdownResponse: questionAISummary.MarkdownResponse,
          generatedAt: questionAISummary.GeneratedAt,
          // Which Workie voice wrote this. Tolerant read: summaries generated
          // before the persona resolver started stamping the item carry neither
          // spelling, and must stay renderable.
          personaName: questionAISummary.PersonaName || questionAISummary.personaName || null,
          personaId: questionAISummary.PersonaId || questionAISummary.personaId || null,
          hasStructuredData: !!(questionAISummary.SummaryText && questionAISummary.DiscussionQuestions)
        } : null,
        
        /*
          WHAT THE ROOM SAID ABOUT THIS ROUND'S REPORT, in a feedback round.

          Always an array, never undefined: a renderer that has to tell "no
          comments" from "the field is missing" will get it wrong on one of the
          two surfaces that draw this.
        */
        comments: commentsByRound.get(questionNumber) || [],

        // Results metadata
        processedAt: questionResults?.ProcessedAt,
        completedAt: questionResults?.CompletedAt,

        // Wavelength rounds carry their stored word analysis — the ENDED
        // screen's session vocabulary aggregates these client-side, and the
        // stored copy is the one the room saw (a re-read never re-clusters,
        // get-results.js). Absent for every other game type on purpose.
        ...(gameMetadata.Item.GameType === 'wavelength' && questionResults?.wordAnalysis
          ? { wordAnalysis: questionResults.wordAnalysis }
          : {})
      });
    }

    // Legacy question summaries for backward compatibility
    const questionSummaries = detailedQuestions.map(q => ({
      questionId: q.questionId,
      answerCount: q.answers.length,
      voteCount: q.voteStats.totalVotes,
      // filter(Boolean): a redacted winner carries no playerName, and a
      // winners list of [undefined] is worse than an empty one — it renders as
      // a blank name and counts as a person.
      winners: q.answers.filter(a => a.rank === 1).map(a => a.playerName).filter(Boolean),
      maxVotes: q.voteStats.maxScore,
      voteTallies: q.answers.reduce((acc, answer) => {
        acc[answer.answerIndex] = {
          answerText: answer.answerText,
          // Omitted, not nulled, when the round it came from is unrevealed.
          ...(answer.playerName === undefined ? {} : { playerName: answer.playerName }),
          firstPlace: answer.firstPlace,
          secondPlace: answer.secondPlace,
          thirdPlace: answer.thirdPlace,
          totalScore: answer.totalScore
        };
        return acc;
      }, {})
    }));

    // (mainPlayerRecords / playerMap / uniquePlayers are built near the top of
    // this handler now, so gameStats.totalPlayers can use the same count.)

    // Calculate player performance
    const playerPerformance = uniquePlayers.map(player => {
      const playerName = player.PlayerName || player.playerName;
      const playerAnswers = answers.filter(a => (a.PlayerName || a.playerName) === playerName);
      // VoterName first: the writer of a VOTE# row stamps the voter as
      // `VoterName` (game/submit-vote.js:61 — the dead second writer,
      // websocket/submit-votes.js, wrote the same field and is deleted) and
      // never writes PlayerName. Filtering on PlayerName alone matched
      // nothing, so every player's votesGiven was 0 in every report ever
      // produced. get-votes.js:79 already reads it in this order; this line was
      // the outlier. The later fallbacks are kept for any legacy row shape.
      const playerVotes = votes.filter(
        (v) => (v.VoterName || v.PlayerName || v.playerName) === playerName
      );
      
      // Count how many times this player won
      let wins = 0;
      results.forEach(result => {
        if (result.Winners && result.Winners.includes(playerName)) {
          wins++;
        }
      });

      // Calculate total score from the consolidated score record (single source of truth)
      let totalScore = 0;
      
      // Find the player's score record
      const playerScoreRecord = playerScores.find(score => score.PlayerName === playerName);
      if (playerScoreRecord) {
        totalScore = playerScoreRecord.score || 0;
        console.log(`📊 Player ${playerName}: Found score record with totalScore=${totalScore} (afterRound: ${playerScoreRecord.afterRound})`);
      } else {
        // Fallback: Calculate from vote tallies across all questions if no score record exists
        console.log(`⚠️ Player ${playerName}: No score record found, calculating from question tallies`);
        detailedQuestions.forEach(question => {
          // `a.playerName &&` matters: rows from an unrevealed round omit it,
          // and a player record with no name would otherwise match every one
          // of them on undefined === undefined and collect the whole round's
          // points. An unrevealed round simply contributes nothing here — it
          // has no attributable score to contribute.
          const playerAnswer = question.answers.find(a => a.playerName && a.playerName === playerName);
          if (playerAnswer) {
            totalScore += playerAnswer.totalScore || 0;
          }
        });
      }

      console.log(`📊 Player ${playerName}: totalScore=${totalScore}, wins=${wins}, answers=${playerAnswers.length}`);

      return {
        playerName: playerName,
        totalScore: totalScore,
        answersGiven: playerAnswers.length,
        votesGiven: playerVotes.length,
        gamesWon: wins,
        participationRate: gameStats.totalQuestions > 0 ? 
          Math.round((playerAnswers.length / gameStats.totalQuestions) * 100) : 0
      };
    });

    // Create comprehensive report
    const reportData = {
      gameId,
      // schema-compliant-manager.js writes the metadata attribute as `Title`;
      // nothing has ever written `EventTitle`, so this always read
      // "Untitled Game". Same tolerant order get-ai-summary.js:947 uses.
      // From the DECRYPTED session row: these two strings are `session.Title`
      // and `session.HostName`, which are ciphertext at rest on an org's row.
      gameTitle: sessionMeta.EventTitle || sessionMeta.Title || 'Untitled Game',
      hostName: sessionMeta.HostName || 'Unknown Host',
      questionSetId: gameMetadata.Item.QuestionSetId,
      gameType: gameMetadata.Item.GameType || 'standard',
      createdAt: gameMetadata.Item.CreatedAt,
      startedAt: gameState.Item?.StartedAt,
      currentState: gameState.Item?.State || 'UNKNOWN',
      lessonNumber: gameState.Item?.LessonNumber || 0,

      // Per-set round-label override ("Lesson", "Scenario", ...). Top level
      // because resolveRoundNoun() is called as
      // resolveRoundNoun(questionData, reportData.gameType, reportData.roundNoun).
      roundNoun: questionSetData?.roundNoun || questionSetData?.RoundNoun || null,

      // Statistics
      gameStats,
      
      // Player performance, ordered by SCORE.
      //
      // This sorted by `gamesWon` and that was wrong for most of the product.
      // `wins` above is counted from `result.Winners`, and `Winners` is only
      // ever written in the vote-tally branch (game/get-results.js:546,
      // websocket/message.js:265), both gated on a VOTE# state. Trivia and
      // wavelength never enter one, so every one of their players carried
      // `gamesWon: 0` and Array#sort left them in whatever order DynamoDB
      // happened to return — a leaderboard that looked authoritative and was
      // arbitrary.
      //
      // `totalScore` on the same object is correct and is computed just above
      // from the consolidated score record. Ties break on name so the order is
      // stable across regenerations of the same report rather than reshuffling
      // on every call.
      //
      // The host stage's top-three reads this ordering, so it is a
      // prerequisite for that podium being truthful and not merely present.
      playerPerformance: playerPerformance.sort((a, b) => (
        (b.totalScore || 0) - (a.totalScore || 0)
        || String(a.playerName || '').localeCompare(String(b.playerName || ''))
      )),
      
      // Enhanced question data with rankings and AI summaries
      detailedQuestions: detailedQuestions.sort((a, b) => 
        parseInt(a.questionNumber) - parseInt(b.questionNumber)
      ),
      
      // Legacy question summaries for backward compatibility
      questionSummaries,
      
      // Scoring configuration
      scoringConfig,
      
      // Question set metadata
      questionSetData: questionSetData ? {
        title: questionSetData.title || questionSetData.Title || questionSetData.name,
        description: questionSetData.description || questionSetData.Description,
        category: questionSetData.category || questionSetData.Category,
        aiContext: questionSetData.aiContextInstruction || questionSetData.AIContextInstruction,
        customInstruction: questionSetData.customInstruction || questionSetData.CustomInstruction,
        roundNoun: questionSetData.roundNoun || questionSetData.RoundNoun || null
      } : null,
      
      // Metadata
      reportGeneratedAt: new Date().toISOString(),
      reportVersion: '2.0'
    };

    // Store the report in DynamoDB
    const reportRecord = {
      PK: `GAME#${gameId}`,
      SK: 'REPORT',
      ...reportData,
      ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
    };

    // ── THE REPORT IS THE DENSEST ROW IN THE TABLE ───────────────────────────
    //
    // It is a copy of everything above, in one item: every answer quoted,
    // every AI summary, the session title and the host's name. Encrypting the
    // sources and leaving this in plaintext would make the whole exercise
    // theatre — a `Scan` would simply read the report instead.
    //
    // `gameStats` and `scoringConfig` stay readable (counts and configuration),
    // and so do the identifiers and timestamps. That is the boundary
    // tenant-crypto.js draws for `report`, and it is not restated here.
    //
    // NOTE the split: `reportRecord` is what goes into DynamoDB, `reportData`
    // is what goes back to the caller — and `encryptItem` never mutates, so the
    // response stays plaintext for the host who just asked for it.
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: reportOrgId ? await encryptItem(reportOrgId, 'report', reportRecord) : reportRecord
    }));

    console.log(`✅ Report created for game ${gameId}: ${gameStats.totalQuestions} questions, ${gameStats.totalPlayers} players`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        report: reportData,
        message: 'Game report created successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Create report error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to create report: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};