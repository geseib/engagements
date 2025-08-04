const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });
const tableName = process.env.TABLE_NAME;
const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

exports.handler = async (event) => {
  try {
    console.log('🤖 Lambda function started for scenario generation');

    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: ''
      };
    }

    if (!event.body) {
      throw new Error('No request body provided');
    }

    const { scenarioType, engagementType = 'call-and-answer', prompt, count, difficulty, context, audience, customPrompt, customTitle, numberOfCategories, mustHaveCategories } = JSON.parse(event.body);

    // Allow up to 100 scenarios with increased timeout
    const limitedCount = Math.min(count, 100);
    if (limitedCount !== count) {
      console.log('⚠️ Limited scenario count from', count, 'to', limitedCount, 'maximum allowed is 100');
    }

    console.log('🤖 Generating scenarios:', { scenarioType, engagementType, count: limitedCount, difficulty, promptLength: prompt?.length });

    // Fetch prompt template from database
    const promptSortKey = `AIPROMPT#GENERATION#${scenarioType}#${engagementType}`;
    console.log('🔍 Fetching prompt template:', promptSortKey);
    
    let promptTemplate;
    try {
      const promptResponse = await dynamodb.send(new GetCommand({
        TableName: tableName,
        Key: {
          PK: 'AIPROMPTS',
          SK: promptSortKey
        }
      }));

      promptTemplate = promptResponse.Item;
      if (!promptTemplate) {
        console.warn(`⚠️ No prompt template found for ${scenarioType}/${engagementType}, using fallback`);
        // Fallback to basic prompt construction (removed business defaults)
        promptTemplate = {
          basePrompt: prompt || 'Create scenarios based on the requirements provided',
          contextTemplate: '\n\nContext: {context}',
          audienceTemplate: '\nAudience: {audience}',
          categoryTemplate: '\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}',
          outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.'
        };
      }
    } catch (dbError) {
      console.error('❌ Error fetching prompt template:', dbError);
      // Use fallback prompt (removed business defaults)
      promptTemplate = {
        basePrompt: prompt || 'Create scenarios based on the requirements provided',
        contextTemplate: '\n\nContext: {context}',
        audienceTemplate: '\nAudience: {audience}',
        categoryTemplate: '\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}',
        outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.'
      };
    }

    // Build prompt using template (remove hardcoded business context)
    let fullPrompt = `Create ${limitedCount} scenarios. ${promptTemplate.basePrompt}`;

    // Add context if provided
    if (context && promptTemplate.contextTemplate) {
      fullPrompt += promptTemplate.contextTemplate.replace('{context}', context);
    }

    // Add audience if provided  
    if (audience && promptTemplate.audienceTemplate) {
      fullPrompt += promptTemplate.audienceTemplate.replace('{audience}', audience);
    }

    // Add custom requirements
    if (customPrompt) {
      fullPrompt += `\n\nAdditional Requirements: ${customPrompt}`;
    }

    // Add difficulty/detail level
    const levelLabel = engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail';
    fullPrompt += `\n\n${levelLabel}: ${difficulty}`;
    
    // Add category requirements using template (only if categories are specified)
    if (promptTemplate.categoryTemplate && (numberOfCategories || mustHaveCategories)) {
      let categoryText = promptTemplate.categoryTemplate;
      if (numberOfCategories) {
        categoryText = categoryText.replace('{numberOfCategories}', numberOfCategories);
      }
      if (mustHaveCategories) {
        categoryText = categoryText.replace('{mustHaveCategories}', mustHaveCategories);
      }
      fullPrompt += `\n${categoryText}`;
    }
    
    // Add output format
    if (promptTemplate.outputFormat) {
      fullPrompt += promptTemplate.outputFormat;
    }

    console.log('🤖 Sending prompt to Claude...', { promptLength: fullPrompt.length });
    
    // Use Claude 3.5 Sonnet inference profile ARN (same as working ai-generate-questions)
    let aiResponse;
    try {
      const response = await bedrockClient.send(new InvokeModelCommand({
        modelId: 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4000,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: fullPrompt
            }
          ]
        })
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      aiResponse = responseBody.content[0].text.trim();
      
      console.log('✅ Received response from Claude Sonnet', { responseLength: aiResponse?.length });
      
    } catch (error) {
      console.error('🚨 BEDROCK Sonnet ERROR:', error.message);
      console.log('🔄 BEDROCK: Trying Claude 3.5 Haiku as fallback...');
      
      // Try Claude 3.5 Haiku inference profile ARN as fallback
      const haikuResponse = await bedrockClient.send(new InvokeModelCommand({
        modelId: 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4000,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: fullPrompt
            }
          ]
        })
      }));

      const haikuResponseBody = JSON.parse(new TextDecoder().decode(haikuResponse.body));
      aiResponse = haikuResponseBody.content[0].text.trim();
      
      console.log('✅ Received response from Claude Haiku fallback', { responseLength: aiResponse?.length });
    }
      
    // Parse the JSON response with improved error handling
    let scenarios;
    try {
      console.log('🔍 Parsing AI response...');
      
      // Try multiple parsing strategies
      let jsonString = aiResponse.trim();

      // Strategy 1: Direct parse if it looks like JSON
      if (jsonString.startsWith('[') && jsonString.endsWith(']')) {
        console.log('✅ Direct JSON parsing...');
        scenarios = JSON.parse(jsonString);
      } else {
        // Strategy 2: Extract JSON array with regex
        console.log('🔍 Extracting JSON with regex...');
        const jsonMatch = jsonString.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          console.log('✅ Found JSON match, parsing...');
          scenarios = JSON.parse(jsonMatch[0]);
        } else {
          // Strategy 3: Try to find and clean JSON
          console.log('🔍 Cleaning and extracting JSON...');
          const startIndex = jsonString.indexOf('[');
          const endIndex = jsonString.lastIndexOf(']');
          if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const extractedJson = jsonString.substring(startIndex, endIndex + 1);
            console.log('✅ Extracted JSON, parsing...');
            scenarios = JSON.parse(extractedJson);
          } else {
            throw new Error('No JSON array found in response');
          }
        }
      }

      console.log('✅ Successfully parsed', scenarios.length, 'scenarios');
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('Raw response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON: ' + parseError.message);
    }

    // Add IDs and ensure proper structure
    const processedScenarios = scenarios.map(s => ({
      id: Date.now() + Math.random(),
      active: true,
      ...s
    }));

    console.log(`✅ Successfully generated ${processedScenarios.length} scenarios`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        scenarios: processedScenarios,
        message: `Generated ${processedScenarios.length} scenarios successfully`
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };

  } catch (error) {
    console.error('❌ AI scenario generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to generate scenarios: ${error.message}` }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }
};
