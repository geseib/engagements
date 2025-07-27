const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { setId } = event.pathParameters || {};
    const { quickstart } = JSON.parse(event.body || '{}');
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Question set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🚀 Toggling quickstart status for set ${setId} to: ${quickstart}`);

    // Update the question set metadata with the new quickstart status
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` },
      UpdateExpression: 'SET #quickstart = :quickstart, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#quickstart': 'Quickstart',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':quickstart': quickstart,
        ':updatedAt': new Date().toISOString()
      }
    }));

    console.log(`✅ Question set ${setId} quickstart status updated to: ${quickstart}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Question set quickstart status ${quickstart ? 'enabled' : 'disabled'} successfully`,
        setId: setId,
        quickstart: quickstart
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Toggle quickstart error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to toggle quickstart status: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};