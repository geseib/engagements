const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveSetPartition } = require('./set-version');

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

    console.log(`📖 Found question reference: ${sourceQuestionId} from set ${questionSetId}`);

    // The REF row records the set VERSION the round was started on
    // (next-question.js writes SetVersion beside SetId). That is the tightest
    // pin available — tighter than the game's, and it costs no extra read. REF
    // rows written before versioning have no SetVersion, so the resolver falls
    // through to the set's activeVersion and then to the legacy partition.
    const resolved = await resolveSetPartition(
      db, process.env.TABLE_NAME, questionSetId, questionRef.Item.SetVersion
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
      // never reached a player at all. Set metadata is already public via
      // GET /question-sets, so there is nothing sensitive to withhold.
      setId: questionSetId,
      title: question.Item.Title || '',
      questionDetail: question.Item.questionDetail || question.Item.Detail || '',
      detail: question.Item.Detail || question.Item.questionDetail || '',
      // No answerDetails here, deliberately. It is the spoiler — the real title
      // and its trivia on an art round, the answer explanation on a trivia one —
      // and game/get-ai-summary.js is its only reader, at RESULTS. This used to
      // project `question.Item.answerDetails`, which looked harmless only
      // because admin/upload-questions.js writes `AnswerDetails`; sets built by
      // admin/ai-generate-trivia.js store the lower-case spelling, and those
      // leaked the explanation to players during ASK.
      category: question.Item.Category,
      school: question.Item.School || '',
      image: question.Item.Image || '', // Optional artwork URL ("Art Title" rounds)
      customInstructions: question.Item.CustomInstructions || '',
      lessonNumber: lessonNumber,
      gameState: gameStateValue,
      startedAt: questionRef.Item.StartedAt,
      // Include trivia options if they exist (check both cases)
      optionA: question.Item.optionA || question.Item.OptionA || '',
      optionB: question.Item.optionB || question.Item.OptionB || '',
      optionC: question.Item.optionC || question.Item.OptionC || '',
      optionD: question.Item.optionD || question.Item.OptionD || '',
      optionE: question.Item.optionE || question.Item.OptionE || '',
      optionF: question.Item.optionF || question.Item.OptionF || ''
    };

    // Include correct answer for both host and player in RESULTS state
    if (gameStateValue.startsWith('RESULTS#')) {
      let correctAnswer = question.Item.correctAnswer || '';
      
      // Convert option IDs (OptionA, OptionB, etc.) to actual answer text
      if (typeof correctAnswer === 'string' && correctAnswer.startsWith('Option')) {
        const optionLetter = correctAnswer.replace('Option', '').toLowerCase();
        const optionField = `option${optionLetter.toUpperCase()}`;
        correctAnswer = question.Item[optionField] || correctAnswer;
      } else if (Array.isArray(correctAnswer)) {
        // Handle multiple correct answers
        correctAnswer = correctAnswer.map(answer => {
          if (typeof answer === 'string' && answer.startsWith('Option')) {
            const optionLetter = answer.replace('Option', '').toLowerCase();
            const optionField = `option${optionLetter.toUpperCase()}`;
            return question.Item[optionField] || answer;
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
        orderInCategory: question.Item.OrderInCategory,
        active: question.Item.Active,
        sourceQuestionId: sourceQuestionId,
        points: question.Item.points || 10 // Points value for trivia
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