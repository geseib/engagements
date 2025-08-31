const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { archiveId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    
    if (!archiveId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Archive ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    console.log(`📝 Updating archive item: ${archiveId}`);
    
    // First check if item exists
    const existing = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: 'ARCHIVE',
        SK: `ITEM#${archiveId}`
      }
    }));
    
    if (!existing.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Archive item not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Build update expression
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    if (body.title) {
      updateExpressions.push('#title = :title');
      expressionAttributeNames['#title'] = 'Title';
      expressionAttributeValues[':title'] = body.title;
    }
    
    if (body.description !== undefined) {
      updateExpressions.push('#desc = :desc');
      expressionAttributeNames['#desc'] = 'Description';
      expressionAttributeValues[':desc'] = body.description;
    }
    
    if (body.category) {
      updateExpressions.push('#cat = :cat');
      expressionAttributeNames['#cat'] = 'Category';
      expressionAttributeValues[':cat'] = body.category;
    }
    
    if (body.tags) {
      updateExpressions.push('#tags = :tags');
      expressionAttributeNames['#tags'] = 'Tags';
      expressionAttributeValues[':tags'] = body.tags;
    }
    
    // Always update the timestamp and increment version
    updateExpressions.push('#updated = :updated');
    updateExpressions.push('#version = #version + :inc');
    expressionAttributeNames['#updated'] = 'UpdatedAt';
    expressionAttributeNames['#version'] = 'Version';
    expressionAttributeValues[':updated'] = new Date().toISOString();
    expressionAttributeValues[':inc'] = 1;
    
    // Update the item
    const result = await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: 'ARCHIVE',
        SK: `ITEM#${archiveId}`
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }));
    
    console.log(`✅ Archive item updated: ${archiveId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item: result.Attributes,
        message: 'Archive item updated successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Update archive error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to update archive item' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};