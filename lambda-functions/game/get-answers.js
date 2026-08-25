const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { isHidden, redactAnswers } = require('./anonymity');
const { decryptItem, decryptItems } = require('./tenant-crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * WHOSE SESSION IS THIS? — off the row, because this route is PUBLIC.
 *
 * `GET /games/{gameId}/answers` carries no identity: `role` is a query
 * parameter (see the note at the role branch), so `tenant.callerOrgId(event)`
 * is '' for every caller and a blank orgId THROWS in tenant-crypto rather than
 * silently returning nothing. The session's own METADATA row is the authority.
 */
const orgOf = (item) => (item && typeof item.orgId === 'string' ? item.orgId.trim() : '');

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    // `role` is 'host' or 'player'. `question` is an accepted spelling of
    // `questionId` because that is what the player client has always sent.
    const { role, questionId, question, player, clientId } = queryParams;

    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📋 Getting answers for game ${gameId}, role: ${role || 'unspecified'}, questionId: ${questionId || question || 'current'}`);

    let targetQuestionId = questionId || question;

    // If no specific question ID provided, get current question from game state
    if (!targetQuestionId) {
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

      // Use LessonNumber to construct the question ID 
      const lessonNumber = gameState.Item.LessonNumber;
      if (lessonNumber && lessonNumber > 0) {
        targetQuestionId = String(lessonNumber).padStart(3, '0');
      } else {
        targetQuestionId = gameState.Item.CurrentQuestionId;
      }
      
      if (!targetQuestionId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'No current question',
            message: 'No question is currently active'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    // Round numbers are stored zero-padded to 3 digits, everywhere: the ANSWER
    // rows (message.js handlePlayerAnswer pads before writing), the ROUND#
    // record (stage-beat.js, reveal-authors.js) and the STATE machine
    // (`ASK#001`). The `questionId` above is caller-supplied, so a client that
    // sends `?question=1` used to query the prefix `QUESTION#1#ANSWER#` and get
    // an empty list back — no error, no answers, and an anonymity lookup on
    // `ROUND#1` that also missed. Pad it here, once, before either read.
    //
    // Only digits are padded. `''` would pass a bare presence check and become
    // '000', and any other junk would become a key nothing ever wrote — the
    // same guard, for the same reason, as stage-beat.js and reveal-authors.js.
    if (/^\d+$/.test(String(targetQuestionId).trim())) {
      targetQuestionId = String(targetQuestionId).trim().padStart(3, '0');
    }

    console.log(`🎯 Getting answers for question: ${targetQuestionId}`);

    // A returning player asking for their OWN answer back.
    //
    // WHY THIS EXISTS. A player answers, backgrounds the tab, and comes back —
    // or reloads outright. The client re-runs its state check, and the only
    // question it needs answered is "did I already submit?". It has always
    // asked here, with `?player=&question=`, and read `hasAnswer` off the
    // response; nothing in this file has ever produced that field, so the
    // answer was permanently `undefined` and the phone reverted to the
    // un-answered form with the player's submission gone from the screen.
    //
    // Server-side is the only place this can be fixed durably: client-side
    // state preservation cannot survive a page reload, and this can.
    if (player) {
      return await getOwnAnswer(gameId, targetQuestionId, player, clientId);
    }

    // Get all answers for this question
    const answersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${targetQuestionId}#ANSWER#`
      }
    }));

    const answers = answersQuery.Items || [];
    console.log(`📊 Found ${answers.length} answers for question ${targetQuestionId}`);

    // Anonymity is decided here, once, for both role branches below.
    //
    // There is deliberately no host exemption: `role` arrives as a query
    // parameter (see :11), so a payload we would emit to role=host we would
    // emit to anybody who typed it. The only implementable guarantee is that
    // the names are not in the response at all.
    //
    // HOISTED ABOVE `fullAnswers` because the METADATA row is now needed for a
    // second reason: it carries the `orgId` that decrypts `Answer`. Both the
    // anonymity gate and the decrypt read the same row, so this costs nothing
    // extra — but the ORDER matters, and it is the ordering that would break
    // silently: build the payload first and every answer in it is an envelope.
    const [metaRes, roundRes] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `ROUND#${targetQuestionId}` }
      }))
    ]);

    const hidden = isHidden(metaRes.Item, roundRes.Item);

    // ── PLAINTEXT BEFORE REDACTION, NOT AFTER ────────────────────────────────
    //
    // `redactAnswers` strips the NAMES and keeps the text — it is the anonymity
    // rule, not the encryption one, and the two are independent. Redacting
    // envelopes would leave the ciphertext in place and hand the voting screen
    // `{v:1,iv:…}` to vote on, so the unwrap has to come first.
    //
    // `decryptItems` preserves order, and order is load-bearing here: the
    // ballot is POSITIONAL and get-results tallies vote index against
    // answers[index].
    const answerOrgId = orgOf(metaRes.Item);
    const decryptedAnswers = answerOrgId
      ? await decryptItems(answerOrgId, 'answer', answers)
      : answers;

    // Base answer information
    const fullAnswers = decryptedAnswers.map(answer => ({
      playerName: answer.PlayerName,
      name: answer.PlayerName, // Add name field for frontend compatibility
      answer: answer.Answer,
      answerType: answer.AnswerType || 'text',
      submittedAt: answer.SubmittedAt
    }));

    // Order is preserved by redactAnswers and must stay that way: the ballot is
    // positional and get-results tallies vote index against answers[index].
    const baseAnswers = hidden ? redactAnswers(fullAnswers) : fullAnswers;

    // Role-specific information
    if (role === 'host') {
      // Host gets complete answer information plus question details
      const result = {
        gameId: gameId,
        questionId: targetQuestionId,
        answers: baseAnswers,
        answerCount: answers.length,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning host answer info for ${gameId}: ${answers.length} answers`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Check if game is in voting phase - if so, players can see answers to vote on
      const gameState = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
      }));
      
      const currentState = gameState.Item?.State || 'CREATED';
      
      if (currentState.startsWith('VOTE#')) {
        // During voting, players can see answers to vote on
        const result = {
          gameId: gameId,
          questionId: targetQuestionId,
          answers: baseAnswers,
          answerCount: answers.length,
          timestamp: new Date().toISOString()
        };

        console.log(`✅ Returning player voting answers for ${gameId}: ${answers.length} answers`);
        return {
          statusCode: 200,
          body: JSON.stringify(result),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      } else {
        // Players get limited answer information (just count, not actual answers)
        const result = {
          gameId: gameId,
          questionId: targetQuestionId,
          answerCount: answers.length,
          timestamp: new Date().toISOString()
        };

        console.log(`✅ Returning player answer info for ${gameId}: ${answers.length} answers (count only)`);
        return {
          statusCode: 200,
          body: JSON.stringify(result),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

  } catch (error) {
    console.error('Get answers error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get answers: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

/**
 * One player's own answer, for recovering their place in the round.
 *
 * TWO FIELDS, TWO DIFFERENT DISCLOSURE RULES, and the split is the whole design:
 *
 *   `hasAnswer` — whether a named player has submitted. Discloses nothing new.
 *     GET /games/{id}/state already returns `answerProgress.answererIds`, the
 *     full list of who has answered, to any caller with no identity at all.
 *     This is the "who has not acted" half of the anonymity split that
 *     anonymity.js draws, and it is deliberately public: the host needs it to
 *     know whether the room can move on.
 *
 *   `answer` — the text, bound to a name. This is the "who wrote which answer"
 *     half, and handing it out on a client-supplied `?player=` would be a
 *     de-anonymisation oracle: the roster is readable, so anyone could walk the
 *     names and rebuild the attributed board that get-answers.js redacts three
 *     lines further down. So the text is returned ONLY to a caller that proves
 *     it is that player, by presenting the `clientId` join-game.js stamped on
 *     the PLAYER# row. Same secret, same check, as the rejoin path.
 *
 * An unowned PLAYER# row — one joined by a bundle older than client ids, which
 * join-game.js has not yet claimed — cannot prove anything, so it gets
 * `hasAnswer` and `answerWithheld: true`. That still restores the answered/
 * un-answered state, which is the part the player can see is wrong.
 *
 * Never 404s on a missing answer: "you have not answered" is a fact about a
 * round that exists, not a missing resource, and the caller is a phone
 * re-checking on every tab focus.
 */
async function getOwnAnswer(gameId, questionId, playerName, clientId) {
  const [answerRes, playerRes, metaRes] = await Promise.all([
    db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionId}#ANSWER#${playerName}` }
    })),
    db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` }
    })),
    // The session row, for its `orgId` alone. This path returns the ANSWER TEXT
    // to a caller that proved it wrote it, so it needs the same unwrap the
    // board does — otherwise a player recovering their place after a reload
    // gets their own submission back as an envelope and the screen shows it.
    db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }))
  ]);

  const answerOrgId = orgOf(metaRes.Item);
  const answerItem = answerRes.Item && answerOrgId
    ? await decryptItem(answerOrgId, 'answer', answerRes.Item)
    : answerRes.Item;
  const storedClientId = (playerRes.Item && playerRes.Item.ClientId) || null;
  const identityProven = !!(clientId && storedClientId && storedClientId === clientId);

  const result = {
    gameId,
    questionId,
    playerName,
    hasAnswer: !!answerItem,
    timestamp: new Date().toISOString()
  };

  if (answerItem && identityProven) {
    result.answer = answerItem.Answer;
    result.answerType = answerItem.AnswerType || 'text';
    result.submittedAt = answerItem.SubmittedAt;
  } else if (answerItem) {
    result.answerWithheld = true;
  }

  console.log(`✅ Own-answer lookup for ${playerName} on ${questionId}: hasAnswer=${result.hasAnswer}, identityProven=${identityProven}`);

  return {
    statusCode: 200,
    body: JSON.stringify(result),
    headers: { 'Access-Control-Allow-Origin': '*' }
  };
}