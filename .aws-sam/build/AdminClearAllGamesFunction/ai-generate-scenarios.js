const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

// Function to call Claude via Bedrock
const invokeClaude = async (prompt) => {
  const modelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';

  console.log('🤖 Calling Claude for scenario generation...');

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4000,
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

    const { scenarioType, prompt, count, difficulty, context, audience, customPrompt, customTitle, numberOfCategories, mustHaveCategories } = JSON.parse(event.body);

    // Allow up to 100 scenarios with increased timeout
    const limitedCount = Math.min(count, 100);
    if (limitedCount !== count) {
      console.log('⚠️ Limited scenario count from', count, 'to', limitedCount, 'maximum allowed is 100');
    }

    console.log('🤖 Generating scenarios:', { scenarioType, count: limitedCount, difficulty, promptLength: prompt?.length });

    // Build optimized prompt for scenario generation
    let fullPrompt = 'Create ' + limitedCount + ' workplace scenarios. ';

    // Add scenario type specific context
    if (scenarioType === 'amazon-principles') {
      fullPrompt += 'Focus on Amazon Leadership Principles with STAR format examples. ';
    } else if (scenarioType === 'interview-prep') {
      fullPrompt += 'Create interview practice scenarios. ';
    } else if (scenarioType === 'problem-solving') {
      fullPrompt += 'Create problem-solving challenges. ';
    } else if (scenarioType === 'lessons-learned') {
      fullPrompt += 'Create lessons learned scenarios. ';
    } else if (scenarioType === 'team-building') {
      fullPrompt += 'Create team collaboration scenarios. ';
    }

    fullPrompt += prompt;
    
    // Add category requirements
    if (numberOfCategories) {
      fullPrompt += `\n\nOrganize scenarios into ${numberOfCategories} categories.`;
    }
    
    if (mustHaveCategories) {
      fullPrompt += `\nMust include these categories: ${mustHaveCategories}`;
    }
    
    fullPrompt += '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]';
    fullPrompt += '\nReturn ONLY the JSON array.';

    console.log('🤖 Sending prompt to Claude...', { promptLength: fullPrompt.length });
    const aiResponse = await invokeClaude(fullPrompt);
    console.log('✅ Received response from Claude', { responseLength: aiResponse?.length });

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
