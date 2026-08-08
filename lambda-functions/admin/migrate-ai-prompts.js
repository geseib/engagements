const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { normalizeGameType } = require('./shared/game-types');

const tableName = process.env.TABLE_NAME || 'engdev';

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

async function migrateAIPrompts() {
  console.log('🔄 Starting AI Prompts migration...');
  
  try {
    // Find all old format prompts
    const scanResult = await dynamodb.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :oldPK)',
      ExpressionAttributeValues: {
        ':oldPK': 'AI_PROMPT#'
      }
    }));
    
    const oldPrompts = scanResult.Items || [];
    console.log(`📊 Found ${oldPrompts.length} prompts to migrate`);
    
    if (oldPrompts.length === 0) {
      console.log('ℹ️ No prompts to migrate');
      return;
    }
    
    // Migrate each prompt
    const migrations = [];
    for (const oldPrompt of oldPrompts) {
      console.log(`🔄 Migrating prompt: ${oldPrompt.promptId} - ${oldPrompt.name}`);
      
      // Create new format record
      const newPrompt = {
        PK: 'AIPROMPTS',
        SK: `AIPROMPT#${oldPrompt.promptId}`,
        promptId: oldPrompt.promptId,
        name: oldPrompt.name,
        description: oldPrompt.description,
        gameType: normalizeGameType(oldPrompt.gameType),
        category: oldPrompt.category,
        scenario: oldPrompt.scenario,
        isDefault: oldPrompt.isDefault || false,
        status: oldPrompt.status || 'active',
        questionSetIds: oldPrompt.questionSetIds || [],
        tags: oldPrompt.tags || [],
        s3Key: oldPrompt.s3Key,
        version: oldPrompt.version || 1,
        createdAt: oldPrompt.createdAt,
        updatedAt: oldPrompt.updatedAt || oldPrompt.createdAt
        // NO `ttl`. AI prompts are configuration; the table's TTL exists for
        // GAME#/PLAYER# records only. See create-ai-prompt.js.
      };
      
      migrations.push(
        dynamodb.send(new PutCommand({
          TableName: tableName,
          Item: newPrompt
        }))
      );
      
      // If this was a default prompt, create default lookup
      if (oldPrompt.isDefault) {
        console.log(`🏷️ Creating default lookup for ${oldPrompt.gameType}/${oldPrompt.category}`);
        migrations.push(
          dynamodb.send(new PutCommand({
            TableName: tableName,
            Item: {
              PK: 'AIPROMPTS',
              SK: `GAMETYPE#${newPrompt.gameType}#CATEGORY#${oldPrompt.category}`,
              defaultPrompt: `PROMPT#${oldPrompt.promptId}`,
              gameType: newPrompt.gameType,
              category: oldPrompt.category,
              promptId: oldPrompt.promptId,
              updatedAt: newPrompt.updatedAt
              // NO `ttl` — see above.
            }
          }))
        );
      }
    }
    
    // Execute all migrations
    await Promise.all(migrations);
    
    console.log(`✅ Successfully migrated ${oldPrompts.length} prompts to new structure`);
    console.log('ℹ️ Old format prompts are still in the database - you can delete them manually if desired');
    
    // Show what was migrated
    oldPrompts.forEach(prompt => {
      console.log(`  - ${prompt.name} (${prompt.gameType}/${prompt.category})${prompt.isDefault ? ' [DEFAULT]' : ''}`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  migrateAIPrompts()
    .then(() => {
      console.log('🎉 Migration completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateAIPrompts };