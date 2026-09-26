const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { decryptItems } = require('./tenant-crypto');
const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/*
  THE HOST'S DOOR, `GET /games/{gameId}/votes/host`: a second event on this
  function (template-clean.yaml, GetVotesHostEvent), the way /host-details is
  on get-game.js. It returns every ballot in a round, decrypted, with its
  voter: what the stage reads to show who has voted.

  The public route used to return exactly that to a typed `?role=host`. A
  query parameter is a claim, not an identity, and a ballot ranks the round's
  answers by position, so who voted for what was one join away from who wrote
  what, for anyone holding the code. The public route now answers `role=host`
  with the count it gives everyone.

  Cognito in front, hosts|admins named in authorizer.js, and
  callerMayDriveSession here. NO IDENTITY IS REFUSED OUTRIGHT, before any read:
  callerMayDriveSession passes a caller with no groups, so on its own it would
  hand an orgless session's ballots to anyone the day this route lost its
  authorizer. The owner is checked on the RAW row, before the round is read or
  anything decrypted. Every refusal is the same "Game not found" as a code
  that names nothing. tests/get-votes-host.js.
*/
const HOST_VOTES_ROUTE = /\/votes\/host$/;

const gameNotFound = () => ({
  statusCode: 404,
  body: JSON.stringify({ error: 'Game not found' }),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    // `role` is logged and nothing more: the ROUTE decides who is the host.
    const { role, questionNumber } = queryParams;
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Which door: API Gateway sets routeKey; rawPath is the fallback.
    const rc = event.requestContext || {};
    const onHostDoor = HOST_VOTES_ROUTE.test(rc.routeKey || event.routeKey || event.rawPath || '');

    console.log(`🗳️ Getting votes for game ${gameId}, ${onHostDoor ? 'host door' : `role: ${role || 'unspecified'}`}, questionNumber: ${questionNumber || 'current'}`);

    // The host's door: an identity, then the session's owner, on the raw row,
    // before the round is read. The row's orgId is kept for the decrypt: WHOSE
    // SESSION IS THIS is answered off the row, never off the caller, the same
    // rule every session read here follows (schema-compliant-manager.js:164).
    let hostOrgId = '';
    if (onHostDoor) {
      const authorizer = rc.authorizer || {};
      const identity = (authorizer.jwt && authorizer.jwt.claims) || authorizer.lambda;
      if (!identity) return gameNotFound();
      const metaRes = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      }));
      if (!metaRes.Item || !callerMayDriveSession(event, metaRes.Item)) return gameNotFound();
      hostOrgId = typeof metaRes.Item.orgId === 'string' ? metaRes.Item.orgId.trim() : '';
    }

    let targetQuestionNumber = questionNumber;
    
    // If no specific question number provided, get current question from game state
    if (!targetQuestionNumber) {
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

      // Use LessonNumber to construct the question number
      const lessonNumber = gameState.Item.LessonNumber;
      if (lessonNumber && lessonNumber > 0) {
        targetQuestionNumber = String(lessonNumber).padStart(3, '0');
      } else {
        targetQuestionNumber = gameState.Item.CurrentQuestionId;
      }
      
      if (!targetQuestionNumber) {
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

    // Pad the question number to 3 digits
    const paddedQuestionNumber = String(targetQuestionNumber).padStart(3, '0');
    console.log(`🎯 Getting votes for question: ${paddedQuestionNumber}`);

    // Get all votes for this question
    const votesQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionNumber}#VOTE#`
      }
    }));

    const rawVotes = votesQuery.Items || [];
    console.log(`📊 Found ${rawVotes.length} votes for question ${paddedQuestionNumber}`);

    // Which payload: the ROUTE decides, never `role`.
    if (onHostDoor) {
      // Unwrapped ONLY on the branch that actually reads a ballot. The player
      // branch below returns a count and nothing else, and `rawVotes.length` is
      // the same number whether the rows are envelopes or not — so an anonymous
      // participant's two-second poll costs no KMS call and no decrypt. That is
      // not merely a saving: every decrypt is a logged, attributed act against
      // the organisation, and a vote meter ticking on a phone is not one worth
      // writing into the customer's "who read your data" record.
      // The door already read the session row; no second read for its org.
      const votes = hostOrgId && rawVotes.length ? await decryptItems(hostOrgId, 'vote', rawVotes) : rawVotes;

      // Format votes for host consumption
      const formattedVotes = votes.map(vote => ({
        voter: vote.VoterName || vote.PlayerName,
        questionNumber: vote.QuestionNumber,
        votes: vote.Votes, // e.g., {"0": 1, "1": 2, "2": 3}
        submittedAt: vote.SubmittedAt
      }));

      // Host gets complete vote information
      const result = {
        gameId: gameId,
        questionNumber: paddedQuestionNumber,
        votes: formattedVotes,
        voteCount: rawVotes.length,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning host vote info for ${gameId}: ${rawVotes.length} votes`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Players get limited vote information (just count, not actual votes)
      const result = {
        gameId: gameId,
        questionNumber: paddedQuestionNumber,
        voteCount: rawVotes.length,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning player vote info for ${gameId}: ${rawVotes.length} votes (count only)`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

  } catch (error) {
    console.error('Get votes error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get votes: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};