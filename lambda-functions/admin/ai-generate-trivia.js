const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

// Function to call Claude via Bedrock
const invokeClaude = async (prompt) => {
  const modelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';

  console.log('🤖 Calling Claude for trivia generation...');
  console.log('📝 Prompt length:', prompt.length);

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
    console.log('🧠 Lambda function started for trivia generation');
    console.log('Event:', JSON.stringify(event, null, 2));

    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
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

    const { topic, category, audience, difficulty, count, numChoices, numCorrect, customPrompt } = JSON.parse(event.body);

    // Allow up to 100 trivia questions
    const limitedCount = Math.min(count, 100);
    if (limitedCount !== count) {
      console.log('⚠️ Limited trivia count from', count, 'to', limitedCount, 'maximum allowed is 100');
    }

    console.log('🧠 Generating trivia:', { topic, category, audience, difficulty, count: limitedCount, numChoices, numCorrect });

    // Build trivia generation prompt
    let fullPrompt = 'You are an expert trivia question creator. ';
    fullPrompt += 'Create ' + limitedCount + ' trivia questions about ' + topic + '. ';

    if (category) fullPrompt += 'Category: ' + category + '. ';
    if (audience) fullPrompt += 'Target audience: ' + audience + '. ';
    fullPrompt += 'Difficulty level: ' + difficulty + '. ';
    fullPrompt += 'Each question should have ' + numChoices + ' answer choices. ';
    if (numCorrect > 1) {
      fullPrompt += 'Some questions should have ' + numCorrect + ' correct answers. ';
    }

    if (customPrompt) {
      fullPrompt += 'Additional requirements: ' + customPrompt + '. ';
    }

    fullPrompt += 'Return as JSON array with this structure: ';
    fullPrompt += '[{"title": "Question text", "category": "Category", "detail": "Explanation", "school": "Context", "customInstructions": "Instructions", "optionA": "Choice A", "optionB": "Choice B", "optionC": "Choice C", "optionD": "Choice D"';
    if (numChoices >= 5) fullPrompt += ', "optionE": "Choice E"';
    if (numChoices >= 6) fullPrompt += ', "optionF": "Choice F"';
    fullPrompt += ', "correctAnswer": "The correct answer text", "difficulty": "' + difficulty + '"}]';
    fullPrompt += ' Return ONLY the JSON array.';

    console.log('🤖 Sending prompt to Claude...');
    const aiResponse = await invokeClaude(fullPrompt);
    console.log('✅ Received response from Claude');

    // Parse the JSON response with improved error handling
    let questions;
    try {
      console.log('🔍 Parsing AI response...');
      console.log('Raw response length:', aiResponse.length);
      console.log('First 500 chars:', aiResponse.substring(0, 500));

      // Try multiple parsing strategies
      let jsonString = aiResponse.trim();

      // Strategy 1: Direct parse if it looks like JSON
      if (jsonString.startsWith('[') && jsonString.endsWith(']')) {
        console.log('✅ Direct JSON parsing...');
        questions = JSON.parse(jsonString);
      } else {
        // Strategy 2: Extract JSON array with regex
        console.log('🔍 Extracting JSON with regex...');
        const jsonMatch = jsonString.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          console.log('✅ Found JSON match, parsing...');
          questions = JSON.parse(jsonMatch[0]);
        } else {
          // Strategy 3: Try to find and clean JSON
          console.log('🔍 Cleaning and extracting JSON...');
          const startIndex = jsonString.indexOf('[');
          const endIndex = jsonString.lastIndexOf(']');
          if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const extractedJson = jsonString.substring(startIndex, endIndex + 1);
            console.log('✅ Extracted JSON, parsing...');
            questions = JSON.parse(extractedJson);
          } else {
            throw new Error('No JSON array found in response');
          }
        }
      }

      console.log('✅ Successfully parsed', questions.length, 'trivia questions');
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('Raw response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON: ' + parseError.message);
    }

    // Add IDs and ensure proper structure
    const processedQuestions = questions.map((question, index) => ({
      id: Date.now() + index,
      title: question.title || 'Untitled Question',
      category: question.category || category || 'General',
      detail: question.detail || '',
      school: question.school || 'General Knowledge',
      customInstructions: question.customInstructions || '',
      optionA: question.optionA || '',
      optionB: question.optionB || '',
      optionC: question.optionC || '',
      optionD: question.optionD || '',
      optionE: question.optionE || '',
      optionF: question.optionF || '',
      correctAnswer: question.correctAnswer || question.optionA || '',
      difficulty: question.difficulty || difficulty || 'medium'
    }));

    console.log('✅ Successfully generated trivia questions');

    return {
      statusCode: 200,
      body: JSON.stringify({
        questions: processedQuestions,
        count: processedQuestions.length,
        message: 'Generated trivia questions successfully'
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };

  } catch (error) {
    console.error('❌ Trivia generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate trivia: ' + error.message }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }
};