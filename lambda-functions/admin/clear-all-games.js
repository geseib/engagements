const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  console.log('🗑️ Admin: Starting clear all games operation');
  
  try {
    let totalDeleted = 0;
    let lastEvaluatedKey = null;
    
    do {
      // Scan for all items in the table
      const scanParams = {
        TableName: process.env.TABLE_NAME,
        Limit: 25 // Process in batches to avoid timeout
      };
      
      if (lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = lastEvaluatedKey;
      }
      
      const scanResult = await db.send(new ScanCommand(scanParams));
      
      if (scanResult.Items && scanResult.Items.length > 0) {
        // Filter to only delete game-related items, preserve question sets
        const gameItems = scanResult.Items.filter(item => {
          const pk = item.PK;
          // Delete items that start with GAME# OR are in the GAMES index
          return pk && (pk.startsWith('GAME#') || pk === 'GAMES');
        });
        
        if (gameItems.length === 0) {
          // No game items in this batch, continue to next batch
          lastEvaluatedKey = scanResult.LastEvaluatedKey;
          continue;
        }
        
        // Prepare batch delete requests for game items only
        const deleteRequests = gameItems.map(item => ({
          DeleteRequest: {
            Key: {
              PK: item.PK,
              SK: item.SK
            }
          }
        }));
        
        // Split into chunks of 25 (DynamoDB batch limit)
        const chunks = [];
        for (let i = 0; i < deleteRequests.length; i += 25) {
          chunks.push(deleteRequests.slice(i, i + 25));
        }
        
        // Process each chunk
        for (const chunk of chunks) {
          const batchParams = {
            RequestItems: {
              [process.env.TABLE_NAME]: chunk
            }
          };
          
          await db.send(new BatchWriteCommand(batchParams));
          totalDeleted += chunk.length;
          
          console.log(`🗑️ Deleted batch of ${chunk.length} items, total: ${totalDeleted}`);
        }
      }
      
      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      
    } while (lastEvaluatedKey);
    
    console.log(`✅ Admin: Successfully deleted ${totalDeleted} game items from table (question sets preserved)`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Successfully deleted ${totalDeleted} game items (question sets preserved)`,
        itemsDeleted: totalDeleted
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    };
    
  } catch (error) {
    console.error('❌ Admin: Clear all games error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: 'Failed to clear games',
        details: error.message
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    };
  }
};