const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const format = event.queryStringParameters?.format || 'auto'; // 'csv', 'json', or 'auto'
    
    console.log(`Downloading question set ${setId} in format: ${format}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Get question set metadata
    const metaRes = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` }
    }));
    
    if (!metaRes.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Question set not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    const metadata = metaRes.Item;
    const setName = metadata.name || metadata.Name;
    const engagementType = metadata.engagementType || metadata.EngagementType || 'call-and-answer';
    
    // Get all questions for this set
    const questionsRes = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :setpk AND begins_with(SK, :questionPrefix)',
      ExpressionAttributeValues: { 
        ':setpk': `SET#${setId}`,
        ':questionPrefix': 'QUESTION#'
      }
    }));
    
    const questions = questionsRes.Items || [];
    
    // Determine output format based on engagement type and user preference
    let outputFormat = format;
    if (format === 'auto') {
      // CSV for simple types, JSON for complex types
      outputFormat = (engagementType === 'survey' || engagementType === 'mixed') ? 'json' : 'csv';
    }
    
    console.log(`Exporting ${questions.length} questions as ${outputFormat} for engagement type: ${engagementType}`);
    
    if (outputFormat === 'json') {
      // JSON export - full data structure
      const jsonData = {
        metadata: {
          setId: setId,
          name: setName,
          description: metadata.description || metadata.Description || '',
          engagementType: engagementType,
          customInstruction: metadata.customInstruction || metadata.CustomInstruction || '',
          aiContextInstruction: metadata.aiContextInstruction || metadata.AIContextInstruction || '',
          createdAt: metadata.createdAt || metadata.CreatedAt,
          questionCount: questions.length
        },
        questions: questions.map(q => ({
          id: q.SK,
          title: q.Title || q.title,
          detail: q.Detail || q.detail || '',
          category: q.Category || q.category,
          school: q.School || q.school || '',
          customInstructions: q.CustomInstructions || q.customInstructions || '',
          // Include all question-specific fields
          ...Object.fromEntries(
            Object.entries(q).filter(([key]) => 
              !['PK', 'SK', 'Title', 'Detail', 'Category', 'School', 'CustomInstructions'].includes(key)
            )
          )
        }))
      };
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          filename: `${setName.replace(/[^a-zA-Z0-9-_]/g, '_')}.json`,
          content: JSON.stringify(jsonData, null, 2),
          contentType: 'application/json'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // CSV export - structured for re-import
      let csvContent = '';
      
      if (engagementType === 'trivia') {
        csvContent = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,CorrectAnswer,WrongAnswer1,WrongAnswer2,WrongAnswer3,Difficulty\n';
        questions.forEach((q, index) => {
          const category = q.Category || q.category || '';
          const questionNum = index + 1;
          const title = (q.Title || q.title || '').replace(/"/g, '""');
          const detail = (q.Detail || q.detail || '').replace(/"/g, '""');
          const school = (q.School || q.school || '').replace(/"/g, '""');
          const customInst = (q.CustomInstructions || q.customInstructions || '').replace(/"/g, '""');
          const correct = (q.CorrectAnswer || q.correctAnswer || '').replace(/"/g, '""');
          const wrong1 = (q.WrongAnswer1 || q.wrongAnswer1 || q.optionA || '').replace(/"/g, '""');
          const wrong2 = (q.WrongAnswer2 || q.wrongAnswer2 || q.optionB || '').replace(/"/g, '""');
          const wrong3 = (q.WrongAnswer3 || q.wrongAnswer3 || q.optionC || '').replace(/"/g, '""');
          const difficulty = q.Difficulty || q.difficulty || 'medium';
          
          csvContent += `"${category}",${questionNum},"${title}","${detail}","${school}","${customInst}","${correct}","${wrong1}","${wrong2}","${wrong3}","${difficulty}"\n`;
        });
      } else if (engagementType === 'poll') {
        csvContent = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple\n';
        questions.forEach((q, index) => {
          const category = q.Category || q.category || '';
          const questionNum = index + 1;
          const title = (q.Title || q.title || '').replace(/"/g, '""');
          const detail = (q.Detail || q.detail || '').replace(/"/g, '""');
          const school = (q.School || q.school || '').replace(/"/g, '""');
          const customInst = (q.CustomInstructions || q.customInstructions || '').replace(/"/g, '""');
          const options = Array.isArray(q.Options) ? q.Options.join('|') : (q.Options || '');
          const allowMultiple = q.AllowMultiple || q.allowMultiple || false;
          
          csvContent += `"${category}",${questionNum},"${title}","${detail}","${school}","${customInst}","${options}","${allowMultiple}"\n`;
        });
      } else {
        // call-and-answer (default)
        csvContent = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction\n';
        questions.forEach((q, index) => {
          const category = q.Category || q.category || '';
          const questionNum = index + 1;
          const title = (q.Title || q.title || '').replace(/"/g, '""');
          const detail = (q.Detail || q.detail || '').replace(/"/g, '""');
          const school = (q.School || q.school || '').replace(/"/g, '""');
          const customInst = (q.CustomInstructions || q.customInstructions || '').replace(/"/g, '""');
          
          csvContent += `"${category}",${questionNum},"${title}","${detail}","${school}","${customInst}"\n`;
        });
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          filename: `${setName.replace(/[^a-zA-Z0-9-_]/g, '_')}.csv`,
          content: csvContent,
          contentType: 'text/csv'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
  } catch (error) {
    console.error('Download question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to download question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};