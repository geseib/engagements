const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const db = DynamoDBDocumentClient.from(new DynamoDBClient());

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    console.log('📚 Listing local archive items');
    
    // Get query parameters for filtering
    const queryParams = event.queryStringParameters || {};
    const { type, category, search } = queryParams;
    
    // Build filter expression - looking for exported items in main table
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
    
    console.log(`🔍 Scanning with filter: ${filterExpression}`);
    console.log(`📊 Expression values:`, expressionAttributeValues);
    
    // Scan archive items from archive DynamoDB table
    const archiveTableName = 'engage2-archive';
    console.log(`📊 Using archive table: ${archiveTableName}`);
    
    const result = await db.send(new ScanCommand({
      TableName: archiveTableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues
    }));
    
    const items = result.Items || [];
    
    console.log(`📋 Raw items found:`, items.length);
    console.log(`📊 Archive table used:`, archiveTableName);
    console.log(`🔍 Full result:`, JSON.stringify(result, null, 2));
    
    // Also try a simple query to see if there are ANY items with PK=ARCHIVE in archive table
    const testQuery = await db.send(new ScanCommand({
      TableName: archiveTableName,
      FilterExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ARCHIVE' },
      Limit: 5
    }));
    console.log(`🧪 Test query found ${testQuery.Items?.length || 0} ARCHIVE items in ${archiveTableName}`);
    
    if (testQuery.Items && testQuery.Items.length > 0) {
      console.log(`🧪 Sample archive item:`, JSON.stringify(testQuery.Items[0], null, 2));
    }
    
    items.forEach((item, index) => {
      console.log(`📄 Item ${index + 1}:`, {
        PK: item.PK,
        SK: item.SK,
        Title: item.Title,
        ContentType: item.ContentType,
        ArchiveId: item.ArchiveId
      });
    });
    
    // Transform to match expected format and sort by CreatedAt descending
    const transformedItems = items.map(item => ({
      archiveId: item.ArchiveId,
      title: item.Title,
      description: item.Description || '',
      contentType: item.ContentType,
      category: item.Category || 'general',
      tags: item.Tags || [],
      fileName: item.FileName,
      fileSize: item.FileSize,
      createdAt: item.CreatedAt,
      updatedAt: item.UpdatedAt,
      downloadUrl: `/archive/items/${item.ArchiveId}` // Will be resolved by get-archive-item
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    console.log(`✅ Returning ${transformedItems.length} transformed archive items`);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        items: transformedItems,
        count: transformedItems.length
      })
    };
    
  } catch (error) {
    console.error('❌ List local archive error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to list local archive items',
        details: error.message
      })
    };
  }
};