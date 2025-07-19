const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

async function testReportData(gameId) {
  console.log(`🔍 Testing report data for game ${gameId}`);
  
  try {
    // Get all question-related data
    const resultsQuery = await db.send(new QueryCommand({
      TableName: 'engdev', // Replace with your table name
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'QUESTION#'
      }
    }));

    const allQuestionItems = resultsQuery.Items || [];
    console.log(`📊 Total question items found: ${allQuestionItems.length}`);
    
    // Filter items by type
    const results = allQuestionItems.filter(item => item.SK.includes('#RESULTS'));
    const answers = allQuestionItems.filter(item => item.SK.includes('#ANSWER#'));
    const votes = allQuestionItems.filter(item => item.SK.includes('#VOTE#'));
    const aiSummaries = allQuestionItems.filter(item => item.SK.includes('#AISummary'));
    
    console.log(`📊 Results: ${results.length}, Answers: ${answers.length}, Votes: ${votes.length}, AI Summaries: ${aiSummaries.length}`);
    
    // Show sample data
    if (results.length > 0) {
      console.log('📊 Sample RESULTS entry:', results[0]);
    }
    if (answers.length > 0) {
      console.log('📊 Sample ANSWER entry:', answers[0]);
    }
    if (votes.length > 0) {
      console.log('📊 Sample VOTE entry:', votes[0]);
    }
    if (aiSummaries.length > 0) {
      console.log('📊 Sample AI Summary entry:', aiSummaries[0]);
    }
    
    // Get question numbers from votes
    const questionNumbersFromVotes = [...new Set(votes.map(v => {
      const match = v.SK.match(/QUESTION#(\d+)#VOTE#/);
      return match ? match[1] : null;
    }).filter(Boolean))];
    
    console.log(`📊 Question numbers from votes: ${questionNumbersFromVotes.join(', ')}`);
    
  } catch (error) {
    console.error('❌ Error testing report data:', error);
  }
}

// Test with a specific game ID
const gameId = process.argv[2] || '9998';
testReportData(gameId);