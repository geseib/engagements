const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { 
    title,
    engagementType,
    questionSetId,
    selectedCategories,
    hostPreferences,
    aiContext,
    debugMode
  } = JSON.parse(event.body);
  
  console.log(`💾 Saving game context for ${gameId}:`, {
    title,
    engagementType,
    questionSetId,
    selectedCategories: selectedCategories?.length || 0,
    hostPreferences,
    debugMode
  });
  
  try {
    const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60); // 2 weeks TTL
    
    // Get existing context to preserve fields not being updated
    let existingContext = {};
    try {
      const existingResult = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'CONTEXT' }
      }));
      
      if (existingResult.Item) {
        existingContext = existingResult.Item;
        console.log(`📋 Found existing context for game ${gameId}`);
      }
    } catch (error) {
      console.log(`📋 No existing context found for game ${gameId}, creating new`);
    }
    
    // Build context item with updates
    const contextItem = {
      PK: `GAME#${gameId}`,
      SK: 'CONTEXT',
      ...existingContext, // Preserve existing fields
      UpdatedAt: new Date().toISOString(),
      ttl
    };
    
    // Update provided fields
    if (title !== undefined) contextItem.Title = title;
    if (engagementType !== undefined) contextItem.EngagementType = engagementType;
    if (questionSetId !== undefined) contextItem.QuestionSetId = questionSetId;
    if (selectedCategories !== undefined) contextItem.SelectedCategories = selectedCategories;
    if (hostPreferences !== undefined) contextItem.HostPreferences = hostPreferences;
    if (aiContext !== undefined) contextItem.AiContext = aiContext;
    if (debugMode !== undefined) contextItem.DebugMode = debugMode;
    
    // Set creation time if this is a new context
    if (!existingContext.CreatedAt) {
      contextItem.CreatedAt = new Date().toISOString();
    }
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: contextItem
    }));
    
    console.log(`✅ Game context saved successfully for game ${gameId}`);
    
    // Also update METADATA for backward compatibility
    try {
      const metadataItem = {
        PK: `GAME#${gameId}`,
        SK: 'METADATA',
        ...existingContext, // Preserve existing metadata
        UpdatedAt: new Date().toISOString(),
        ttl
      };
      
      // Update metadata with same fields
      if (title !== undefined) metadataItem.Title = title;
      if (engagementType !== undefined) metadataItem.EngagementType = engagementType;
      if (questionSetId !== undefined) metadataItem.QuestionSetId = questionSetId;
      if (selectedCategories !== undefined) metadataItem.SelectedCategories = selectedCategories;
      if (hostPreferences !== undefined) metadataItem.HostPreferences = hostPreferences;
      if (aiContext !== undefined) metadataItem.AiContext = aiContext;
      if (debugMode !== undefined) metadataItem.DebugMode = debugMode;
      
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: metadataItem
      }));
      
      console.log(`✅ Game metadata updated for backward compatibility`);
    } catch (metadataError) {
      console.error(`⚠️ Failed to update metadata (non-critical):`, metadataError);
    }
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        status: 'OK',
        gameId,
        savedFields: Object.keys(JSON.parse(event.body))
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Save game context error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Failed to save game context' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
