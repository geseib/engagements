const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const defaultPrompts = require('./default-ai-prompts.json');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const s3 = new S3Client({ region: process.env.AWS_REGION });

exports.handler = async (event, context) => {
  console.log('🚀 Starting default AI prompts population...');
  
  try {
    const results = {
      created: 0,
      skipped: 0,
      errors: 0,
      prompts: []
    };

    // Check existing prompts to avoid duplicates
    console.log('📋 Checking existing prompts...');
    const existingPrompts = await db.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: {
        ':pk': 'AI_PROMPT#'
      }
    }));

    const existingPromptNames = new Set(
      existingPrompts.Items?.map(item => item.name) || []
    );

    // Process each game type and category
    for (const [gameType, categories] of Object.entries(defaultPrompts)) {
      console.log(`🎮 Processing ${gameType} prompts...`);
      
      for (const [categoryKey, promptData] of Object.entries(categories)) {
        try {
          // Skip if prompt already exists
          if (existingPromptNames.has(promptData.name)) {
            console.log(`⏭️ Skipping existing prompt: ${promptData.name}`);
            results.skipped++;
            continue;
          }

          const promptId = uuidv4();
          const timestamp = new Date().toISOString();

          // Store prompt template in S3
          const s3Key = `prompts/${gameType}/${categoryKey}/${promptId}.txt`;
          await s3.send(new PutObjectCommand({
            Bucket: process.env.AI_PROMPTS_BUCKET,
            Key: s3Key,
            Body: promptData.template,
            ContentType: 'text/plain',
            Metadata: {
              promptId: promptId,
              category: promptData.category,
              gameType: promptData.gameType,
              version: '1.0'
            }
          }));

          // Store metadata in DynamoDB
          const metadataRecord = {
            PK: `AI_PROMPT#${promptId}`,
            SK: 'METADATA',
            promptId: promptId,
            name: promptData.name,
            description: promptData.description,
            gameType: promptData.gameType,
            category: promptData.category,
            scenario: categoryKey,
            status: promptData.status,
            isDefault: promptData.isDefault,
            tags: promptData.tags,
            s3Key: s3Key,
            s3Bucket: process.env.AI_PROMPTS_BUCKET,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: 'system',
            version: '1.0',
            usageCount: 0
          };

          await db.send(new PutCommand({
            TableName: process.env.TABLE_NAME,
            Item: metadataRecord,
            ConditionExpression: 'attribute_not_exists(PK)'
          }));

          console.log(`✅ Created default prompt: ${promptData.name}`);
          results.created++;
          results.prompts.push({
            id: promptId,
            name: promptData.name,
            gameType: promptData.gameType,
            category: promptData.category
          });

        } catch (error) {
          console.error(`❌ Error creating prompt ${promptData.name}:`, error);
          results.errors++;
        }
      }
    }

    console.log(`🎉 Default prompts population completed!`);
    console.log(`📊 Results: ${results.created} created, ${results.skipped} skipped, ${results.errors} errors`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Default AI prompts populated successfully',
        results: results
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('❌ Error populating default prompts:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to populate default prompts',
        details: error.message 
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};