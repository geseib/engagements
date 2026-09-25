const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('📚 Listing archive items');
    
    // Get query parameters for filtering
    const queryParams = event.queryStringParameters || {};
    const { type, category, search } = queryParams;
    
    // Build filter expression
    let filterExpression = 'PK = :pk';
    const expressionAttributeValues = {
      ':pk': 'ARCHIVE'
    };
    
    // Add type filter if provided
    if (type) {
      filterExpression += ' AND ContentType = :type';
      expressionAttributeValues[':type'] = type;
    }
    
    // Add category filter if provided
    if (category) {
      filterExpression += ' AND Category = :category';
      expressionAttributeValues[':category'] = category;
    }
    
    // Add search filter if provided
    if (search) {
      filterExpression += ' AND (contains(Title, :search) OR contains(Description, :search))';
      expressionAttributeValues[':search'] = search;
    }
    
    // Scan archive items from DynamoDB, every page: a Scan reads 1 MB and
    // filters afterwards, so one page can hold none of the matches while more
    // remain. tests/library-reads-paged.js.
    const items = [];
    let ExclusiveStartKey;
    do {
      const result = await db.send(new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExclusiveStartKey,
      }));
      items.push(...(result.Items || []));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    
    // Sort by CreatedAt descending (newest first)
    items.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
    
    console.log(`✅ Found ${items.length} archive items`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        items: items,
        count: items.length
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('List archive error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to list archive items' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};