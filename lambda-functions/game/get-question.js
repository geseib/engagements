const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveSetPartition } = require('./set-version');
const { ORG } = require('./tenant');
const { decryptItem } = require('./tenant-crypto');

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

    console.log(`📖 Getting current question for game ${gameId}, role: ${role || 'unspecified'}`);

    // Get current game state to find the current question
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    if (!gameState.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const gameStateValue = gameState.Item.State;
    const lessonNumber = gameState.Item.LessonNumber || 0;
    
    // A round is in progress in ASK#, VOTE# and RESULTS# — the same triple that
    // get-game-state.js and next-question.js already treat as "there is a
    // current question". This guard used to accept ASK# alone, which stranded
    // the RESULTS# correct-answer block below and 400d two real callers:
    // PlayerPage.loadResultsData (which swallows the failure and rebuilds the
    // question from get-results, losing image/school/category/setId along the
    // way) and GameHostPage's refresh-restore path.
    const roundInProgress = !!gameStateValue && (
      gameStateValue.startsWith('ASK#') ||
      gameStateValue.startsWith('VOTE#') ||
      gameStateValue.startsWith('RESULTS#')
    );
    if (!roundInProgress) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'No active question',
          message: 'Game is not currently asking a question',
          currentState: gameStateValue
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Use QUESTION#REF system as per game flow specification
    const questionNumber = String(lessonNumber).padStart(3, '0');
    console.log(`📖 Looking up question reference: QUESTION#${questionNumber}#REF`);

    // Get question reference record
    const questionRef = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionNumber}#REF` }
    }));

    if (!questionRef.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: 'Question reference not found',
          questionNumber: questionNumber,
          expectedRef: `QUESTION#${questionNumber}#REF`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const sourceQuestionId = questionRef.Item.SourceQuestionId;
    const questionSetId = questionRef.Item.SetId;
    // THE SESSION IS THE AUTHORITY ON WHICH LIBRARY, NOT THE CALLER.
    //
    // Most participants here are anonymous — they joined with a 4-digit code
    // and have no org context at all — so resolving the scope from the REQUEST
    // would resolve it to platform for every player in every org session, and
    // they would read an empty partition and see no question.
    //
    // The REF row is the right source: the host picked the set, the session
    // pinned the pair, and that pin already carries the authorisation. Rows
    // written before tenancy have no SetScope, which means platform — the same
    // reading of an absent scope as everywhere else (set-version.js setRef).
    const questionSetRef = {
      scope: questionRef.Item.SetScope,
      orgId: questionRef.Item.SetOrgId,
      setId: questionSetId,
    };

    console.log(`📖 Found question reference: ${sourceQuestionId} from set ${questionSetId}`);

    // The REF row records the set VERSION the round was started on
    // (next-question.js writes SetVersion beside SetId). That is the tightest
    // pin available — tighter than the game's, and it costs no extra read. REF
    // rows written before versioning have no SetVersion, so the resolver falls
    // through to the set's activeVersion and then to the legacy partition.
    const resolved = await resolveSetPartition(
      db, process.env.TABLE_NAME, questionSetRef, questionRef.Item.SetVersion
    );

    // Get the actual question from the resolved version of the question set
    const question = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: resolved.pk,
        SK: sourceQuestionId
      }
    }));

    if (!question.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: 'Source question not found',
          sourceQuestionId: sourceQuestionId,
          questionSetId: questionSetId
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // ── DECRYPT FROM THE ROW'S OWN ORG, NEVER FROM THE CALLER ────────────────
    //
    // THIS ROUTE IS PUBLIC AND ITS CALLERS ARE ANONYMOUS. A participant joined
    // with a four-digit code and carries no authorizer context at all, so
    // `tenant.callerOrgId(event)` resolves to '' for every player in every
    // organisation's session — and a blank orgId does not "fall back", it
    // THROWS (`tenant-crypto: an orgId is required`). Every question in the
    // product would 500.
    //
    // The org therefore comes from the same place the PARTITION did: the REF
    // row the host pinned when the round started, resolved above. That pin is
    // the authorisation — the host chose this set for this session — and it is
    // the only org that could possibly decrypt these rows anyway, because the
    // orgId is the AES-GCM AAD.
    //
    // Platform and public sets are never encrypted (upload-questions.js says
    // why), so they are used exactly as they came back.
    const setOrgId = resolved.scope === ORG ? String(resolved.orgId || '') : '';
    const questionItem = setOrgId
      ? await decryptItem(setOrgId, 'question', question.Item)
      : question.Item;
    // `resolved.metadata` is the SETS row this handler already had in hand, and
    // two of its fields ride out on the payload below — so it needs the same
    // treatment or a player sees an envelope where a per-set instruction goes.
    //
    // Replaced IN PLACE rather than bound to a new name, deliberately:
    // tests/question-set-routes-authorization.js pins the projection as the
    // literal source text `setCustomInstruction: resolved.metadata`, because
    // that payload is what let `GET /question-sets` be closed to anonymous
    // callers. Renaming the expression here would read as a harmless tidy-up
    // and would quietly strand every participant. `decryptItem` returns a new
    // object, so nothing shared is mutated.
    if (setOrgId && resolved.metadata) {
      resolved.metadata = await decryptItem(setOrgId, 'set', resolved.metadata);
    }

    // Base question information (common to both host and player)
    const baseQuestionInfo = {
      questionId: sourceQuestionId,
      questionNumber: questionNumber,
      // `id` is what get-game-state's currentQuestionData calls the round number
      // (padded, e.g. "001"). It was missing here, so the player's round badge
      // rendered blank wherever this payload drove the screen rather than
      // get-game-state's.
      id: questionNumber,
      // The set id reaches the player too. PlayerPage guards its per-set
      // instruction fetch on `setId`, and this payload only ever carried
      // `questionSetId`, and only on the host branch — so per-set instructions
      // never reached a player at all.
      setId: questionSetId,
      // …and the scope beside it, for the same reason the id is here: the
      // player's per-set instruction fetch addresses a set, and a bare slug
      // addresses whichever library the recipient happens to search first.
      setScope: resolved.scope,
      setOrgId: resolved.orgId || null,
      // ── THE TWO SET-LEVEL FIELDS, AND WHY THEY LIVE HERE ─────────────────
      //
      // These are the ONLY things PlayerPage ever wanted from a question set,
      // and until this change it got them by downloading `GET /question-sets`
      // — the WHOLE catalogue, every set in the environment with its name,
      // description, categories, counts, engagement type and persona id — and
      // running `.find()` over it for the one set its own game was playing
      // (PlayerPage.jsx `loadQuestionSetMeta`). Every anonymous participant in
      // every session received the entire library, with no login, to read two
      // strings.
      //
      // A previous pass here optimised the NUMBER of those downloads (one per
      // set instead of one per question) without noticing what each one
      // contained. Caching a leak makes it quieter, not smaller.
      //
      // They cost this handler nothing. `resolveSetPartition` above already
      // reads the SETS row to decide which partition to serve and hands it
      // back as `resolved.metadata`, so this is a projection of a row that is
      // already in memory — no extra GetItem, no extra latency.
      //
      // `|| null` and not `?? null`, deliberately: it mirrors what
      // `loadQuestionSetMeta` did (`questionSet?.customInstruction || null`),
      // so an empty string keeps collapsing to null and `resolveInstruction`
      // keeps distinguishing "this set says nothing" from "this set says ''".
      setCustomInstruction: resolved.metadata?.customInstruction || null,
      setRoundNoun: resolved.metadata?.roundNoun || null,
      title: questionItem.Title || '',
      questionDetail: questionItem.questionDetail || questionItem.Detail || '',
      detail: questionItem.Detail || questionItem.questionDetail || '',
      // No answerDetails here, deliberately. It is the spoiler — the real title
      // and its trivia on an art round, the answer explanation on a trivia one —
      // and game/get-ai-summary.js is its only reader, at RESULTS. This used to
      // project `questionItem.answerDetails`, which looked harmless only
      // because admin/upload-questions.js writes `AnswerDetails`; sets built by
      // admin/ai-generate-trivia.js store the lower-case spelling, and those
      // leaked the explanation to players during ASK.
      category: questionItem.Category,
      school: questionItem.School || '',
      image: questionItem.Image || '', // Optional artwork URL ("Art Title" rounds)
      customInstructions: questionItem.CustomInstructions || '',
      lessonNumber: lessonNumber,
      gameState: gameStateValue,
      startedAt: questionRef.Item.StartedAt,
      // Include trivia options if they exist (check both cases)
      optionA: questionItem.optionA || questionItem.OptionA || '',
      optionB: questionItem.optionB || questionItem.OptionB || '',
      optionC: questionItem.optionC || questionItem.OptionC || '',
      optionD: questionItem.optionD || questionItem.OptionD || '',
      optionE: questionItem.optionE || questionItem.OptionE || '',
      optionF: questionItem.optionF || questionItem.OptionF || ''
    };

    // Include correct answer for both host and player in RESULTS state
    if (gameStateValue.startsWith('RESULTS#')) {
      let correctAnswer = questionItem.correctAnswer || '';
      
      // Convert option IDs (OptionA, OptionB, etc.) to actual answer text
      if (typeof correctAnswer === 'string' && correctAnswer.startsWith('Option')) {
        const optionLetter = correctAnswer.replace('Option', '').toLowerCase();
        const optionField = `option${optionLetter.toUpperCase()}`;
        correctAnswer = questionItem[optionField] || correctAnswer;
      } else if (Array.isArray(correctAnswer)) {
        // Handle multiple correct answers
        correctAnswer = correctAnswer.map(answer => {
          if (typeof answer === 'string' && answer.startsWith('Option')) {
            const optionLetter = answer.replace('Option', '').toLowerCase();
            const optionField = `option${optionLetter.toUpperCase()}`;
            return questionItem[optionField] || answer;
          }
          return answer;
        });
      }
      
      baseQuestionInfo.correctAnswer = correctAnswer;
    }

    // Role-specific information
    if (role === 'host') {
      // Host gets additional information (correct answer only shown in RESULTS state)
      const result = {
        ...baseQuestionInfo,
        gameId: gameId,
        questionSetId: questionSetId,
        orderInCategory: questionItem.OrderInCategory,
        active: questionItem.Active,
        sourceQuestionId: sourceQuestionId,
        points: questionItem.points || 10 // Points value for trivia
      };
      
      // Correct answer is already included in baseQuestionInfo if in RESULTS state

      console.log(`✅ Returning host question info for ${gameId}: ${sourceQuestionId} (lesson ${lessonNumber})`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Player gets basic question information
      const result = {
        ...baseQuestionInfo,
        gameId: gameId
      };

      console.log(`✅ Returning player question info for ${gameId}: ${sourceQuestionId} (lesson ${lessonNumber})`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

  } catch (error) {
    console.error('Get question error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get question: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};