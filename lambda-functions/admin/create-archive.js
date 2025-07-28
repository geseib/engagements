const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const { v4: uuidv4 } = require('uuid');

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event, context) => {
  console.log('Create Archive:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const { name, description = '' } = JSON.parse(event.body || '{}');

    if (!name || !name.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Archive name is required'
        })
      };
    }

    const archiveId = uuidv4();
    const timestamp = new Date().toISOString();

    // Create the archive metadata record
    const archive = {
      PK: `ARCHIVE#${archiveId}`,
      SK: 'METADATA',
      id: archiveId,
      name: name.trim(),
      description: description.trim(),
      createdAt: timestamp,
      lastModified: timestamp,
      itemCount: 0,
      questionSetsCount: 0,
      promptsCount: 0
    };

    // Start a transaction to create the archive and update the archives list
    const transactItems = [
      // Create the archive metadata
      {
        Put: {
          TableName: TABLE_NAME,
          Item: archive,
          ConditionExpression: 'attribute_not_exists(PK)'
        }
      }
    ];

    // Get current archives list to update it
    const archivesResult = await dynamodb.get({
      TableName: TABLE_NAME,
      Key: {
        PK: 'ARCHIVES',
        SK: 'METADATA'
      }
    }).promise();

    let currentArchives = [];
    if (archivesResult.Item && archivesResult.Item.archives) {
      currentArchives = archivesResult.Item.archives;
    }

    // Add new archive to the list
    const updatedArchives = [...currentArchives, archiveId];

    // Update the archives list
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: 'ARCHIVES',
          SK: 'METADATA',
          archives: updatedArchives,
          lastUpdated: timestamp
        }
      }
    });

    // Execute the transaction
    await dynamodb.transactWrite({
      TransactItems: transactItems
    }).promise();

    console.log(`Archive created successfully: ${archiveId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        archive: {
          ...archive,
          itemCount: 0,
          questionSetsCount: 0,
          promptsCount: 0
        }
      })
    };

  } catch (error) {
    console.error('Error creating archive:', error);
    
    let errorMessage = 'Failed to create archive';
    let statusCode = 500;

    if (error.code === 'ConditionalCheckFailedException') {
      errorMessage = 'Archive already exists';
      statusCode = 409;
    } else if (error.code === 'ValidationException') {
      errorMessage = 'Invalid input data';
      statusCode = 400;
    }

    return {
      statusCode,
      headers,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        details: error.message
      })
    };
  }
};