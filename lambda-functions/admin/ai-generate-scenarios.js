const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const tableName = process.env.TABLE_NAME;
const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

// Fallback prompt template used when no DynamoDB template exists. Wavelength
// items are short SUBJECTS for word-association alignment (players list up to
// 10 words each, the game measures overlap), so they get their own shape.
const buildFallbackTemplate = (engagementType, prompt) => {
  if (engagementType === 'wavelength') {
    return {
      basePrompt: prompt || 'Create wavelength subjects for a team word-association alignment game. Each item is a single short, evocative SUBJECT (1-4 words, e.g. "Remote Work", "Customer Trust") that every participant responds to by listing up to 10 words or short phrases that come to mind; the game then measures how many words overlap across participants. Pick subjects broad enough that everyone can produce 10 associations, yet specific enough that overlap is meaningful. Mix concrete and abstract subjects. Do NOT write questions, scenarios, sentences to complete, or anything with a correct answer.',
      contextTemplate: '\n\nContext: {context}',
      audienceTemplate: '\nAudience: {audience}',
      categoryTemplate: '\nIMPORTANT: Organize subjects into EXACTLY {numberOfCategories} categories - no more, no less.\nMust include these categories: {mustHaveCategories}',
      outputFormat: '\n\nReturn as JSON array: [{"title": "Subject (1-4 words)", "detail": "One sentence of framing for the subject", "category": "Category", "customInstructions": "Enter up to 10 words or short phrases that come to mind when you think about this subject."}]\nIMPORTANT: Use EXACTLY the specified number of categories. Return ONLY the JSON array.'
    };
  }
  return {
    basePrompt: prompt || 'Create scenarios based on the requirements provided',
    contextTemplate: '\n\nContext: {context}',
    audienceTemplate: '\nAudience: {audience}',
    categoryTemplate: '\nIMPORTANT: Organize scenarios into EXACTLY {numberOfCategories} categories - no more, no less.\nMust include these categories: {mustHaveCategories}',
    outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "customInstructions": "Instructions"}]\nIMPORTANT: Use EXACTLY the specified number of categories. Return ONLY the JSON array.'
  };
};

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

    // Enforce 24-category system limit due to bitmask constraints, and never
    // ask for more categories than scenarios in this request (small parallel
    // batches would otherwise get a contradictory prompt)
    const limitedCategories = Math.min(numberOfCategories || 3, 24, Math.max(limitedCount, 1));
    if (limitedCategories !== numberOfCategories) {
      console.log('⚠️ Limited category count from', numberOfCategories, 'to', limitedCategories, '(max 24 categories, and no more categories than scenarios per request)');
    }

    console.log('🤖 Generating scenarios:', { scenarioType, engagementType, count: limitedCount, difficulty, categories: limitedCategories, promptLength: prompt?.length });

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
        promptTemplate = buildFallbackTemplate(engagementType, prompt);
      }
    } catch (dbError) {
      console.error('❌ Error fetching prompt template:', dbError);
      // Use fallback prompt (removed business defaults)
      promptTemplate = buildFallbackTemplate(engagementType, prompt);
    }

    // Build prompt using template (remove hardcoded business context)
    const itemNoun = engagementType === 'wavelength' ? 'wavelength subjects' : 'scenarios';
    let fullPrompt = `Create ${limitedCount} ${itemNoun}. ${promptTemplate.basePrompt}`;

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
    if (promptTemplate.categoryTemplate && (limitedCategories || mustHaveCategories)) {
      let categoryText = promptTemplate.categoryTemplate;
      if (limitedCategories) {
        categoryText = categoryText.replace('{numberOfCategories}', limitedCategories);
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

    // Right-size max_tokens to the requested count (~500 output tokens per
    // scenario observed, plus headroom) so we never over-generate and each
    // call stays well under API Gateway's ~30s timeout. Wavelength items are
    // tiny (a 1-4 word subject plus one framing sentence), so they need far
    // fewer tokens per item.
    const perItemTokens = engagementType === 'wavelength' ? 150 : 700;
    const maxTokens = Math.min(1000 + (limitedCount * perItemTokens), 8000);

    console.log('🤖 Sending prompt to Claude...', { promptLength: fullPrompt.length, maxTokens });

    // Use Claude Sonnet 4.6 inference profile ARN (same as working ai-generate-questions)
    let aiResponse;
    try {
      const response = await bedrockClient.send(new InvokeModelCommand({
        modelId: `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-6`,
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
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
      console.log('🔄 BEDROCK: Trying Claude Haiku 4.5 as fallback...');
      
      // Try Claude Haiku 4.5 inference profile ARN as fallback
      const haikuResponse = await bedrockClient.send(new InvokeModelCommand({
        modelId: `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
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

      // Strategy 0: Strip markdown code fences (Claude 4.x may wrap JSON in ```json ... ```)
      const fenceMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch) {
        console.log('🔍 Stripped markdown code fence from response');
        jsonString = fenceMatch[1].trim();
      }

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
      
      // Validate category count if specified
      if (limitedCategories) {
        const uniqueCategories = [...new Set(scenarios.map(s => s.category))];
        console.log(`🔍 Category validation: Expected ${limitedCategories}, got ${uniqueCategories.length} categories:`, uniqueCategories);
        
        if (uniqueCategories.length > limitedCategories) {
          console.warn(`⚠️ AI generated ${uniqueCategories.length} categories but only ${limitedCategories} were requested. This exceeds system limit of 24.`);
          // Truncate to requested number of categories
          const allowedCategories = uniqueCategories.slice(0, limitedCategories);
          scenarios = scenarios.filter(s => allowedCategories.includes(s.category));
          console.log(`✅ Filtered scenarios to use only first ${limitedCategories} categories, now have ${scenarios.length} scenarios`);
        }
      }
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
    // Surface throttling as 429 so the client backs off instead of retrying immediately
    const isThrottled = error.name === 'ThrottlingException' ||
                        error.message?.includes('Too many requests') ||
                        error.message?.includes('throttl') ||
                        error.$metadata?.httpStatusCode === 429;
    return {
      statusCode: isThrottled ? 429 : 500,
      body: JSON.stringify({ error: `Failed to generate scenarios: ${error.message || 'unexpected error'}` }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }
};
