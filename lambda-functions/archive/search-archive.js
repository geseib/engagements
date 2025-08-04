const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { query, filters = {}, limit = 50, lastEvaluatedKey } = body;
    
    console.log(`🔍 Searching archive with query: ${query}`);
    
    // Build scan parameters
    const scanParams = {
      TableName: process.env.TABLE_NAME,
      Limit: Math.min(limit, 100), // Cap at 100 items per request
      FilterExpression: 'PK = :pk'
    };
    
    const expressionAttributeValues = {
      ':pk': 'ARCHIVE'
    };
    const expressionAttributeNames = {};
    const filterConditions = ['PK = :pk'];
    
    // Add search query if provided
    if (query) {
      filterConditions.push('(contains(#title, :query) OR contains(#desc, :query) OR contains(#tags, :query))');
      expressionAttributeValues[':query'] = query;
      expressionAttributeNames['#title'] = 'Title';
      expressionAttributeNames['#desc'] = 'Description';
      expressionAttributeNames['#tags'] = 'Tags';
    }
    
    // Add filters
    if (filters.contentType) {
      filterConditions.push('#contentType = :contentType');
      expressionAttributeNames['#contentType'] = 'ContentType';
      expressionAttributeValues[':contentType'] = filters.contentType;
    }
    
    if (filters.category) {
      filterConditions.push('#category = :category');
      expressionAttributeNames['#category'] = 'Category';
      expressionAttributeValues[':category'] = filters.category;
    }
    
    if (filters.dateFrom) {
      filterConditions.push('#createdAt >= :dateFrom');
      expressionAttributeNames['#createdAt'] = 'CreatedAt';
      expressionAttributeValues[':dateFrom'] = filters.dateFrom;
    }
    
    if (filters.dateTo) {
      filterConditions.push('#createdAt <= :dateTo');
      expressionAttributeNames['#createdAt'] = 'CreatedAt';
      expressionAttributeValues[':dateTo'] = filters.dateTo;
    }
    
    // Build final filter expression
    scanParams.FilterExpression = filterConditions.join(' AND ');
    scanParams.ExpressionAttributeValues = expressionAttributeValues;
    
    if (Object.keys(expressionAttributeNames).length > 0) {
      scanParams.ExpressionAttributeNames = expressionAttributeNames;
    }
    
    // Add pagination if provided
    if (lastEvaluatedKey) {
      scanParams.ExclusiveStartKey = lastEvaluatedKey;
    }
    
    // Execute search
    const result = await db.send(new ScanCommand(scanParams));
    
    const items = result.Items || [];
    
    // Sort by relevance (if query provided) or by date
    if (query) {
      // Simple relevance scoring based on matches
      items.forEach(item => {
        let score = 0;
        if (item.Title && item.Title.toLowerCase().includes(query.toLowerCase())) score += 3;
        if (item.Description && item.Description.toLowerCase().includes(query.toLowerCase())) score += 2;
        if (item.Tags && item.Tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))) score += 1;
        item._relevanceScore = score;
      });
      
      items.sort((a, b) => {
        if (b._relevanceScore !== a._relevanceScore) {
          return b._relevanceScore - a._relevanceScore;
        }
        return new Date(b.CreatedAt) - new Date(a.CreatedAt);
      });
      
      // Remove the temporary score field
      items.forEach(item => delete item._relevanceScore);
    } else {
      // Sort by date if no query
      items.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
    }
    
    console.log(`✅ Found ${items.length} matching archive items`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        items: items,
        count: items.length,
        lastEvaluatedKey: result.LastEvaluatedKey,
        hasMore: !!result.LastEvaluatedKey
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Search archive error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to search archive' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};