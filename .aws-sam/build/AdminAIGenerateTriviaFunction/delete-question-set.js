const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    console.log(`Deleting question set: ${setId}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Get set metadata first to check if it exists
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
    
    const setName = metaRes.Item.name || metaRes.Item.Name;
    
    // Get all items for this question set from SET# partition
    const setRes = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :setpk',
      ExpressionAttributeValues: { ':setpk': `SET#${setId}` }
    }));
    
    // Delete the set metadata first
    await db.send(new DeleteCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` }
    }));
    
    let deletedCount = 1; // Count the metadata deletion
    
    // Delete all items from SET# partition in batches
    const setItems = setRes.Items || [];
    const batchSize = 25;
    
    for (let i = 0; i < setItems.length; i += batchSize) {
      const batch = setItems.slice(i, i + batchSize);
      const deleteRequests = batch.map(item => ({
        DeleteRequest: {
          Key: { PK: item.PK, SK: item.SK }
        }
      }));
      
      await db.send(new BatchWriteCommand({
        RequestItems: {
          [process.env.TABLE_NAME]: deleteRequests
        }
      }));
      
      deletedCount += deleteRequests.length;
    }
    
    console.log(`🗑️ Deleted question set "${setName}": ${deletedCount} items removed`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Question set "${setName}" deleted successfully`,
        itemsDeleted: deletedCount
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Delete question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to delete question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};