const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { resolvePartitionFromMeta, toVersion, knownVersions } = require('./set-version');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Getting active question sets for game creation...');
    
    // Get all question set metadata
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'SETS' }
    }));

    // Filter for active sets only and add categories
    const activeSets = [];
    for (const item of res.Items) {
      if (item.active !== false) { // Include if active is true or undefined
        const setId = item.SK.replace('SET#', '');

        // No game exists yet at picker time, so there is no pin: this is the
        // set's activeVersion, falling through to the legacy partition for a
        // set that has never been versioned.
        const resolved = resolvePartitionFromMeta(setId, item, null);

        // Get categories for the active version of this set
        const categoriesRes = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': resolved.pk,
            ':sk': 'CATEGORY#'
          }
        }));
        
        const categories = categoriesRes.Items.map(cat => ({
          name: cat.Name,
          description: cat.Description || '',
          count: cat.QuestionCount || 10
        }));
        
        activeSets.push({
          id: setId,
          name: item.name || 'Unknown Set',
          description: item.description || '',
          totalQuestions: item.questionCount || 0,
          categoryCount: item.categoryCount || categories.length,
          customInstruction: item.customInstruction || null,
          aiContextInstruction: item.aiContextInstruction || null,
          // The admin projection has carried these for a while; the game-side
          // picker was missing them, so the host/player surfaces could not badge
          // an art set, name its persona, or show which summary prompt it uses.
          promptId: item.promptId || null,
          personaId: item.personaId || null,
          roundNoun: item.roundNoun || null,
          hasImages: item.hasImages === true,
          // The version a game created from this set right now would pin to.
          // null on an unmigrated set, which reads its legacy partition.
          activeVersion: toVersion(item.activeVersion),
          availableVersions: knownVersions(item),
          active: true,
          categories: categories,
          engagementType: item.engagementType || 'call-and-answer'
        });
      }
    }
    
    console.log(`Found ${activeSets.length} active question sets`);
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ sets: activeSets }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET'
      }
    };
    
  } catch (error) {
    console.error('Get question sets error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get question sets: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
