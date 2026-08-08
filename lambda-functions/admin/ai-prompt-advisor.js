const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const s3Client = new S3Client({});

// Function to call Claude via Bedrock using cross-region inference profiles (same as ai-summary)
const invokeClaude = async (prompt) => {
  console.log('🤖 BEDROCK: Calling Claude for prompt analysis via inference profile...');
  
  let response;
  let responseBody;
  
  try {
    // Use Claude Sonnet 4.6 inference profile ARN (cross-region) - primary for analysis tasks
    const sonnetProfileArn = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-6`;
    console.log('🤖 BEDROCK: Sonnet Inference Profile ARN:', sonnetProfileArn);
    console.log('🤖 BEDROCK: Prompt length:', prompt.length);
    
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4000,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
    };

    const command = new InvokeModelCommand({
      contentType: 'application/json',
      body: JSON.stringify(payload),
      modelId: sonnetProfileArn,
    });

    response = await bedrockClient.send(command);
    responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    console.log('✅ Successfully called Claude Sonnet 4.6 via inference profile');
    console.log('📝 Claude response length:', responseBody.content[0].text.length);
    
    return responseBody.content[0].text;
    
  } catch (primaryError) {
    console.error('❌ Error with Claude Sonnet 4.6:', primaryError);
    
    // Fallback to Claude Haiku 4.5 inference profile
    console.log('🔄 BEDROCK: Trying Claude Haiku 4.5 as fallback...');
    
    try {
      const haikuProfileArn = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
      console.log('🤖 BEDROCK: Haiku Inference Profile ARN:', haikuProfileArn);
      
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        ],
      };

      const command = new InvokeModelCommand({
        contentType: 'application/json',
        body: JSON.stringify(payload),
        modelId: haikuProfileArn,
      });

      response = await bedrockClient.send(command);
      responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      console.log('✅ Successfully called Claude Haiku 4.5 as fallback');
      console.log('📝 Claude response length:', responseBody.content[0].text.length);
      
      return responseBody.content[0].text;
      
    } catch (fallbackError) {
      console.error('❌ Both models failed:', fallbackError);
      throw new Error(`All Bedrock models failed. Primary: ${primaryError.message}, Fallback: ${fallbackError.message}`);
    }
  }
};

exports.handler = async (event) => {
  console.log('🪄 AI Prompt Advisor - Event:', JSON.stringify(event, null, 2));

  try {
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
      throw new Error('Request body is required');
    }

    const {
      promptText,
      gameType,
      scenario,
      targetAudience,
      context,
      goals,
      analysisType = 'improve',
      existingPromptId = null
    } = JSON.parse(event.body);

    if (!promptText && !existingPromptId) {
      throw new Error('Either promptText or existingPromptId is required');
    }

    console.log(`🪄 AI Prompt Advisor - Type: ${analysisType}, GameType: ${gameType}`);

    let currentPromptText = promptText;
    let currentContext = context || {};

    // If analyzing existing prompt, fetch it
    if (existingPromptId) {
      console.log(`📋 Fetching existing prompt: ${existingPromptId}`);
      
      // Canonical key first, legacy second — same D14 split that broke delete.
      // Everything create/get/update writes lives at AIPROMPTS/AIPROMPT#<id>;
      // only the dead populate-default-prompts.js ever wrote AI_PROMPT#/METADATA.
      let existingPrompt = await dynamodb.send(new GetCommand({
        TableName: tableName,
        Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${existingPromptId}` }
      }));

      if (!existingPrompt.Item) {
        console.warn(`⚠️ ${existingPromptId} not found under AIPROMPTS/AIPROMPT# — trying the legacy AI_PROMPT#/METADATA key`);
        existingPrompt = await dynamodb.send(new GetCommand({
          TableName: tableName,
          Key: { PK: `AI_PROMPT#${existingPromptId}`, SK: 'METADATA' }
        }));
      }

      if (!existingPrompt.Item) {
        throw new Error(`Prompt not found: ${existingPromptId}`);
      }

      // Fetch full content from S3
      const s3Response = await s3Client.send(new GetObjectCommand({
        Bucket: aiPromptsBucket,
        Key: existingPrompt.Item.s3Key
      }));
      
      const promptData = JSON.parse(await s3Response.Body.transformToString());
      // Only legacy prompts carry `template`. Structured (instructions +
      // outputFormat) and generation (basePrompt) prompts would otherwise hand
      // the advisor `undefined` and it would critique the string "undefined".
      currentPromptText = promptData.template
        || [promptData.instructions, promptData.outputFormat].filter(Boolean).join('\n\n')
        || promptData.basePrompt
        || '';
      currentContext = {
        name: promptData.name,
        description: promptData.description,
        gameType: promptData.gameType,
        category: promptData.category,
        scenario: promptData.scenario,
        ...currentContext
      };
    }

    // Build analysis prompt based on type
    let analysisPrompt = '';

    if (analysisType === 'improve') {
      analysisPrompt = `
You are an expert AI prompt engineer specializing in enhancing existing engagement platform prompts while preserving the admin's original vision and intent.

**Current Prompt Template to Enhance:**
\`\`\`
${currentPromptText}
\`\`\`

**Admin Context:**
- Prompt Name: ${currentContext.name || 'Not provided'}
- Description: ${currentContext.description || 'Not provided'}
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Scenario: ${scenario || currentContext.scenario || 'General engagement'}
- Target Audience: ${targetAudience || 'Professional teams'}
- Goals: ${goals || 'Effective engagement and meaningful insights'}

**Enhancement Request:** Analyze and provide improvements that PRESERVE the admin's original purpose and direction:

1. **Preserve Intent**: Identify and maintain the core purpose and direction
2. **Enhance Clarity**: Make existing content clearer without changing meaning
3. **Add Detail**: Expand on existing concepts with more specificity
4. **Improve Structure**: Better organize existing content
5. **Template Variables**: Suggest relevant variables for the game type
6. **Professional Polish**: Enhance language and presentation

**IMPORTANT**: Do not change the fundamental approach or purpose. Enhance what exists.

**Response Format:**
Provide your analysis as JSON with this structure:
\`\`\`json
{
  "overallScore": 8.5,
  "adminIntent": "What the admin was trying to achieve",
  "strengths": ["Aspects that work well and should be preserved"],
  "improvements": [
    {
      "category": "Enhancement type (Clarity/Detail/Structure/etc.)",
      "priority": "high|medium|low",
      "currentText": "Existing text that needs enhancement",
      "enhancedText": "Improved version that preserves intent",
      "rationale": "Why this enhancement helps"
    }
  ],
  "enhancedPrompt": "Enhanced version that builds on the original, not replaces it",
  "templateVariableSuggestions": ["Relevant variables for this game type"],
  "preservationNotes": "Key elements that must remain unchanged"
}
\`\`\`
`;

    } else if (analysisType === 'validate') {
      analysisPrompt = `
You are an expert AI prompt validator. Thoroughly validate the admin's prompt template while respecting their intended approach and goals.

**Admin's Prompt Template to Validate:**
\`\`\`
${currentPromptText}
\`\`\`

**Admin Context:**
- Prompt Name: ${currentContext.name || 'Not provided'}
- Description: ${currentContext.description || 'Not provided'}
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Scenario: ${scenario || currentContext.scenario || 'General engagement'}

**Validation Request:** Check for potential issues while respecting the admin's vision:

1. **Technical Issues**: Syntax, formatting, token limits that could cause failures
2. **Logic Problems**: Internal contradictions or unclear instructions
3. **Bias & Fairness**: Potential biases that conflict with inclusive engagement
4. **Safety Concerns**: Risks of inappropriate content generation
5. **Performance Issues**: Elements that might confuse AI interpretation
6. **Template Variables**: Missing or incorrect variable usage for the game type

**Important:** Focus on technical and safety validation, not changing the admin's approach.

**Response Format:**
Provide validation results as JSON:
\`\`\`json
{
  "isValid": true,
  "overallScore": 8.5,
  "adminApproachAssessment": "Assessment of the admin's intended approach",
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "technical|logic|bias|safety|performance|variables",
      "issue": "Description of the specific issue",
      "location": "Where in the prompt this occurs",
      "adminImpact": "How this affects the admin's intended outcome",
      "fixSuggestion": "How to fix while preserving intent"
    }
  ],
  "safetyScore": 9.0,
  "biasScore": 8.5,
  "clarityScore": 8.0,
  "technicalScore": 8.5,
  "strengths": ["What works well in the admin's approach"],
  "recommendations": ["Technical fixes that preserve the admin's vision"]
}
\`\`\`
`;

    } else if (analysisType === 'optimize') {
      analysisPrompt = `
You are an AI prompt optimization specialist. Optimize the admin's prompt while preserving their core approach and intent.

**Admin's Current Prompt:**
\`\`\`
${currentPromptText}
\`\`\`

**Admin Context:**
- Prompt Name: ${currentContext.name || 'Not provided'}
- Description: ${currentContext.description || 'Not provided'}
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Target Audience: ${targetAudience || 'Professional teams'}
- Performance Goals: ${goals || 'High-quality, engaging content'}

**Optimization Request:** Improve efficiency while preserving the admin's vision:

1. **Token Efficiency**: Reduce unnecessary words without changing meaning or approach
2. **Performance**: Optimize for consistent AI responses in the admin's intended style
3. **Clarity**: Make instructions clearer without changing the fundamental approach
4. **Template Variables**: Ensure proper variable usage for the game type
5. **Maintainability**: Organize content better while preserving all key elements

**Critical:** Do not change the admin's fundamental approach, just make it more efficient.

**Response Format:**
\`\`\`json
{
  "adminIntent": "Summary of what the admin was trying to achieve",
  "optimizedPrompt": "Optimized version that preserves the admin's approach",
  "optimizations": [
    {
      "type": "token-reduction|clarity|organization|variables",
      "originalText": "Text that was optimized",
      "optimizedText": "Improved version",
      "benefit": "Why this optimization helps",
      "preservedElements": "Key admin elements that remained unchanged"
    }
  ],
  "metrics": {
    "tokenReduction": "Percentage reduced",
    "clarityImprovement": "How clarity was enhanced",
    "preservationScore": "How well admin intent was maintained"
  },
  "adminApprovalNotes": "What the admin should review before accepting changes"
}
\`\`\`
`;
    }

    console.log(`🤖 Sending analysis request to Claude...`);
    const aiResponse = await invokeClaude(analysisPrompt);
    console.log(`✅ Received AI analysis response`);

    // Parse the JSON response
    let analysisResult;
    try {
      // Extract JSON from response
      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[1]);
      } else {
        // Try to parse the entire response as JSON
        analysisResult = JSON.parse(aiResponse);
      }
    } catch (parseError) {
      console.warn('⚠️ Could not parse AI response as JSON, returning raw response');
      analysisResult = {
        rawResponse: aiResponse,
        error: 'Could not parse structured response',
        analysisType: analysisType
      };
    }

    const result = {
      analysisType,
      promptId: existingPromptId,
      gameType: gameType || currentContext.gameType,
      analysis: analysisResult,
      metadata: {
        analyzedAt: new Date().toISOString(),
        modelUsed: 'claude-3.5-sonnet',
        promptLength: currentPromptText.length,
        context: currentContext
      }
    };

    console.log(`✅ AI Prompt Advisor completed analysis`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('❌ Error in AI Prompt Advisor:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        error: 'AI Prompt Advisor failed',
        message: error.message
      })
    };
  }
};