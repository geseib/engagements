const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    const { role, questionNumber } = queryParams; // 'host' or 'player'
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🗳️ Getting votes for game ${gameId}, role: ${role || 'unspecified'}, questionNumber: ${questionNumber || 'current'}`);

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

    const votes = votesQuery.Items || [];
    console.log(`📊 Found ${votes.length} votes for question ${paddedQuestionNumber}`);

    // Format votes for host consumption
    const formattedVotes = votes.map(vote => ({
      voter: vote.VoterName || vote.PlayerName,
      questionNumber: vote.QuestionNumber,
      votes: vote.Votes, // e.g., {"0": 1, "1": 2, "2": 3}
      submittedAt: vote.SubmittedAt
    }));

    // Role-specific information
    if (role === 'host') {
      // Host gets complete vote information
      const result = {
        gameId: gameId,
        questionNumber: paddedQuestionNumber,
        votes: formattedVotes,
        voteCount: votes.length,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning host vote info for ${gameId}: ${votes.length} votes`);
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
        voteCount: votes.length,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning player vote info for ${gameId}: ${votes.length} votes (count only)`);
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