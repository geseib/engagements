const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const { name, description, customInstruction, aiContextInstruction, promptId } = JSON.parse(event.body || '{}');
    
    console.log(`Editing question set ${setId}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    if (!name || !name.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Update the question set metadata
    const updateParams = {
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` },
      UpdateExpression: 'SET #name = :name, UpdatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':name': name.trim(),
        ':updatedAt': new Date().toISOString()
      }
    };
    
    // Add optional fields if provided
    if (description !== null && description !== undefined) {
      updateParams.UpdateExpression += ', description = :description';
      updateParams.ExpressionAttributeValues[':description'] = description;
    }
    
    if (customInstruction !== null && customInstruction !== undefined) {
      updateParams.UpdateExpression += ', customInstruction = :customInstruction';
      updateParams.ExpressionAttributeValues[':customInstruction'] = customInstruction;
    }
    
    if (aiContextInstruction !== null && aiContextInstruction !== undefined) {
      updateParams.UpdateExpression += ', aiContextInstruction = :aiContextInstruction';
      updateParams.ExpressionAttributeValues[':aiContextInstruction'] = aiContextInstruction;
    }

    if (promptId !== null && promptId !== undefined) {
      updateParams.UpdateExpression += ', promptId = :promptId';
      updateParams.ExpressionAttributeValues[':promptId'] = promptId;
    }
    
    await db.send(new UpdateCommand(updateParams));
    
    console.log(`✏️ Updated question set "${setId}" with name: ${name}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Question set "${name}" updated successfully`,
        setId: setId,
        name: name
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Edit question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to edit question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};