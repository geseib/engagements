const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

// Function to call Claude via Bedrock
const invokeClaude = async (prompt) => {
  const modelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';

  console.log('🤖 Calling Claude for survey generation...');
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
    console.log('📋 Lambda function started for survey generation');
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

    const {
      title, description, topic, audience, purpose, questionCount,
      includeRating, includeMultipleChoice, includeTextEntry, customPrompt
    } = JSON.parse(event.body);

    // Allow up to 50 survey questions
    const limitedCount = Math.min(questionCount, 50);
    if (limitedCount !== questionCount) {
      console.log('⚠️ Limited survey question count from', questionCount, 'to', limitedCount, 'maximum allowed is 50');
    }

    console.log('📋 Generating survey:', { title, topic, audience, purpose, count: limitedCount });

    // Build survey generation prompt
    let fullPrompt = 'You are an expert survey designer. ';
    fullPrompt += 'Create a comprehensive survey with ' + limitedCount + ' questions. ';
    fullPrompt += 'Survey title: "' + title + '". ';
    fullPrompt += 'Topic: ' + topic + '. ';

    if (description) fullPrompt += 'Description: ' + description + '. ';
    if (audience) fullPrompt += 'Target audience: ' + audience + '. ';
    if (purpose) fullPrompt += 'Purpose: ' + purpose + '. ';

    // Specify question types to include
    const questionTypes = [];
    if (includeRating) questionTypes.push('rating scale questions (1-5, 1-10, etc.)');
    if (includeMultipleChoice) questionTypes.push('multiple choice questions');
    if (includeTextEntry) questionTypes.push('text entry questions (short and long form)');

    if (questionTypes.length > 0) {
      fullPrompt += 'Include a mix of: ' + questionTypes.join(', ') + '. ';
    }

    if (customPrompt) {
      fullPrompt += 'Additional requirements: ' + customPrompt + '. ';
    }

    fullPrompt += 'Return as JSON object with this structure: ';
    fullPrompt += '{"title": "Survey Title", "description": "Survey Description", "questions": [';
    fullPrompt += '{"id": 1, "question": "Question text", "type": "rating|multiple_choice|text_entry", ';
    fullPrompt += '"scale": {"type": "1-5", "lowLabel": "Low", "highLabel": "High"}, ';
    fullPrompt += '"options": ["Option 1", "Option 2"], "allowMultiple": false, ';
    fullPrompt += '"textType": "short|long|email|number", "placeholder": "Placeholder text", "required": true}]}';
    fullPrompt += ' Return ONLY the JSON object.';

    console.log('🤖 Sending prompt to Claude...');
    const aiResponse = await invokeClaude(fullPrompt);
    console.log('✅ Received response from Claude');

    // Parse the JSON response with improved error handling
    let survey;
    try {
      console.log('🔍 Parsing AI response...');
      console.log('Raw response length:', aiResponse.length);
      console.log('First 500 chars:', aiResponse.substring(0, 500));

      // Try multiple parsing strategies
      let jsonString = aiResponse.trim();

      // Strategy 1: Direct parse if it looks like JSON
      if (jsonString.startsWith('{') && jsonString.endsWith('}')) {
        console.log('✅ Direct JSON parsing...');
        survey = JSON.parse(jsonString);
      } else {
        // Strategy 2: Extract JSON object with regex
        console.log('🔍 Extracting JSON with regex...');
        const jsonMatch = jsonString.match(/{[\s\S]*}/);
        if (jsonMatch) {
          console.log('✅ Found JSON match, parsing...');
          survey = JSON.parse(jsonMatch[0]);
        } else {
          // Strategy 3: Try to find and clean JSON
          console.log('🔍 Cleaning and extracting JSON...');
          const startIndex = jsonString.indexOf('{');
          const endIndex = jsonString.lastIndexOf('}');
          if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const extractedJson = jsonString.substring(startIndex, endIndex + 1);
            console.log('✅ Extracted JSON, parsing...');
            survey = JSON.parse(extractedJson);
          } else {
            throw new Error('No JSON object found in response');
          }
        }
      }

      console.log('✅ Successfully parsed survey with', survey.questions?.length || 0, 'questions');
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('Raw response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON: ' + parseError.message);
    }

    // Ensure proper structure and add metadata
    const processedSurvey = {
      id: Date.now(),
      title: survey.title || title,
      description: survey.description || description,
      topic: topic,
      audience: audience,
      purpose: purpose,
      createdAt: new Date().toISOString(),
      questions: (survey.questions || []).map((question, index) => ({
        id: index + 1,
        question: question.question || 'Untitled Question',
        type: question.type || 'text_entry',
        scale: question.scale || { type: '1-5', lowLabel: 'Low', highLabel: 'High' },
        options: question.options || [],
        allowMultiple: question.allowMultiple || false,
        textType: question.textType || 'short',
        placeholder: question.placeholder || '',
        required: question.required || false
      }))
    };

    console.log('✅ Successfully generated survey:', processedSurvey.title);

    return {
      statusCode: 200,
      body: JSON.stringify({
        survey: processedSurvey,
        message: 'Generated survey successfully'
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };

  } catch (error) {
    console.error('❌ Survey generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate survey: ' + error.message }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }
};