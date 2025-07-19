const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const s3Client = new S3Client({});

// Function to call Claude via Bedrock
const invokeClaude = async (prompt) => {
  const modelId = 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0';

  console.log('🤖 Calling Claude for prompt analysis...');

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
    modelId,
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return responseBody.content[0].text;
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
      
      const existingPrompt = await dynamodb.send(new GetCommand({
        TableName: tableName,
        Key: {
          PK: `AI_PROMPT#${existingPromptId}`,
          SK: 'METADATA'
        }
      }));

      if (!existingPrompt.Item) {
        throw new Error(`Prompt not found: ${existingPromptId}`);
      }

      // Fetch full content from S3
      const s3Response = await s3Client.send(new GetObjectCommand({
        Bucket: aiPromptsBucket,
        Key: existingPrompt.Item.s3Key
      }));
      
      const promptData = JSON.parse(await s3Response.Body.transformToString());
      currentPromptText = promptData.template;
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
You are an expert AI prompt engineer specializing in engagement platform prompts. Analyze and improve the following prompt template.

**Current Prompt Template:**
\`\`\`
${currentPromptText}
\`\`\`

**Context:**
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Scenario: ${scenario || currentContext.scenario || 'General engagement'}
- Target Audience: ${targetAudience || 'Professional teams'}
- Goals: ${goals || 'Effective engagement and meaningful insights'}

**Analysis Request:** Provide comprehensive improvement suggestions including:

1. **Clarity & Structure**: How to make the prompt clearer and better organized
2. **Engagement Optimization**: Ways to increase participant engagement
3. **Output Quality**: Improvements for better AI-generated content
4. **Specificity**: Areas where more specific instructions would help
5. **Edge Cases**: Potential issues and how to handle them
6. **Alternative Approaches**: Different prompt strategies to consider

**Response Format:**
Provide your analysis as JSON with this structure:
\`\`\`json
{
  "overallScore": 8.5,
  "strengths": ["Clear objectives", "Good structure"],
  "improvements": [
    {
      "category": "Clarity",
      "priority": "high",
      "issue": "Description of the issue",
      "suggestion": "Specific improvement suggestion",
      "example": "Example of improved text"
    }
  ],
  "improvedPrompt": "Complete rewritten prompt incorporating suggestions",
  "alternativeApproaches": [
    {
      "approach": "Name of approach",
      "description": "How this approach differs",
      "pros": ["Advantage 1", "Advantage 2"],
      "cons": ["Limitation 1"]
    }
  ],
  "contextualRecommendations": {
    "callandanswer": "Specific advice for call-and-answer games",
    "trivia": "Specific advice for trivia games",
    "polls": "Specific advice for polls"
  }
}
\`\`\`
`;

    } else if (analysisType === 'validate') {
      analysisPrompt = `
You are an expert AI prompt validator. Thoroughly validate the following prompt template for potential issues.

**Prompt Template to Validate:**
\`\`\`
${currentPromptText}
\`\`\`

**Context:**
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Scenario: ${scenario || currentContext.scenario || 'General engagement'}

**Validation Request:** Check for:

1. **Technical Issues**: Syntax, formatting, token limits
2. **Logic Problems**: Contradictions, unclear instructions
3. **Bias & Fairness**: Potential biases or exclusions
4. **Safety Concerns**: Inappropriate content generation risks
5. **Performance Issues**: Likely AI interpretation problems
6. **Completeness**: Missing essential components

**Response Format:**
Provide validation results as JSON:
\`\`\`json
{
  "isValid": true,
  "overallScore": 8.5,
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "technical|logic|bias|safety|performance|completeness",
      "issue": "Description of the issue",
      "location": "Where in the prompt",
      "recommendation": "How to fix it"
    }
  ],
  "safetyScore": 9.0,
  "biasScore": 8.5,
  "clarityScore": 8.0,
  "recommendations": ["Key recommendations for improvement"]
}
\`\`\`
`;

    } else if (analysisType === 'optimize') {
      analysisPrompt = `
You are an AI prompt optimization specialist. Optimize the following prompt for maximum effectiveness and efficiency.

**Current Prompt:**
\`\`\`
${currentPromptText}
\`\`\`

**Context:**
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Target Audience: ${targetAudience || 'Professional teams'}
- Performance Goals: ${goals || 'High-quality, engaging content'}

**Optimization Request:** Focus on:

1. **Token Efficiency**: Reduce unnecessary words while maintaining clarity
2. **Performance**: Optimize for consistent, high-quality AI responses
3. **Scalability**: Ensure prompt works across different scenarios
4. **User Experience**: Optimize for end-user engagement
5. **Maintainability**: Make prompt easy to update and modify

**Response Format:**
\`\`\`json
{
  "optimizedPrompt": "Fully optimized version of the prompt",
  "optimizations": [
    {
      "type": "token-reduction|clarity|performance|scalability",
      "change": "Description of what was changed",
      "benefit": "Expected improvement",
      "impact": "high|medium|low"
    }
  ],
  "metrics": {
    "tokenReduction": "25%",
    "expectedPerformanceGain": "15%",
    "maintainabilityScore": 9.0
  },
  "testingSuggestions": ["How to test the optimized prompt"]
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