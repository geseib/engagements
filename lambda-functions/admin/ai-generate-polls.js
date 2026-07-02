const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { invokeClaudeWithRetry, planTopicList, buildTopicAssignmentText } = require('./shared/bedrock-utils');

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
  try {
    console.log('📊 Lambda function started for poll generation');
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

    const { topic, category, audience, difficulty, count, allowMultiple, customPrompt, planTopics, assignedTopics, otherTopics } = JSON.parse(event.body);

    // Phase 1 of two-phase generation: plan distinct sub-topics before the
    // client fans out parallel batches (each batch is then anchored to its
    // assigned topics so parallel batches can't duplicate each other)
    if (planTopics === true) {
      let brief = `Poll questions about ${topic}.`;
      if (category) brief += ` Category: ${category}.`;
      if (audience) brief += ` Target audience: ${audience}.`;
      if (difficulty) brief += ` Complexity level: ${difficulty}.`;
      if (customPrompt) brief += ` Additional requirements: ${customPrompt}`;

      const topics = await planTopicList(bedrockClient, InvokeModelCommand, {
        brief,
        itemNoun: 'poll questions',
        count
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ topics }),
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      };
    }

    // Allow up to 100 poll questions
    const limitedCount = Math.min(count, 100);
    if (limitedCount !== count) {
      console.log('⚠️ Limited poll count from', count, 'to', limitedCount, 'maximum allowed is 100');
    }

    console.log('📊 Generating polls:', { topic, category, audience, difficulty, count: limitedCount, allowMultiple });

    // Build poll generation prompt
    let fullPrompt = 'You are an expert poll question creator. ';
    fullPrompt += 'Create ' + limitedCount + ' poll questions about ' + topic + '. ';

    if (category) fullPrompt += 'Category: ' + category + '. ';
    if (audience) fullPrompt += 'Target audience: ' + audience + '. ';
    fullPrompt += 'Complexity level: ' + difficulty + '. ';

    if (allowMultiple) {
      fullPrompt += 'Some questions should allow multiple selections where appropriate. ';
    }

    if (customPrompt) {
      fullPrompt += 'Additional requirements: ' + customPrompt + '. ';
    }

    // Phase 2 of two-phase generation: anchor this batch to its assigned
    // topics so parallel batches stay distinct by construction
    const topicAssignmentText = buildTopicAssignmentText(assignedTopics, otherTopics, 'poll questions');
    if (topicAssignmentText) {
      fullPrompt += topicAssignmentText + '\n\n';
    }

    fullPrompt += 'Return as JSON array with this structure: ';
    fullPrompt += '[{"title": "Poll question text", "category": "Category", "detail": "Context or explanation", "school": "Context", "customInstructions": "Instructions", "options": ["Option 1", "Option 2", "Option 3"], "allowMultiple": false}]';
    fullPrompt += ' Return ONLY the JSON array.';

    // Right-size max_tokens to the requested count so responses finish well
    // under API Gateway's ~30s integration timeout
    const maxTokens = Math.min(800 + (limitedCount * 300), 8000);

    console.log('🤖 Sending prompt to Claude...', { maxTokens });
    const aiResponse = await invokeClaudeWithRetry(bedrockClient, InvokeModelCommand, fullPrompt, maxTokens);
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

      console.log('✅ Successfully parsed', questions.length, 'poll questions');
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('Raw response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON: ' + parseError.message);
    }

    // Add IDs and ensure proper structure
    const processedQuestions = questions.map((question, index) => ({
      id: Date.now() + index,
      title: question.title || 'Untitled Poll Question',
      category: question.category || category || 'General',
      detail: question.detail || '',
      school: question.school || 'General Context',
      customInstructions: question.customInstructions || '',
      options: Array.isArray(question.options) ? question.options : ['Option 1', 'Option 2', 'Option 3'],
      allowMultiple: question.allowMultiple || false
    }));

    console.log('✅ Successfully generated poll questions');

    return {
      statusCode: 200,
      body: JSON.stringify({
        questions: processedQuestions,
        count: processedQuestions.length,
        message: 'Generated poll questions successfully'
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };

  } catch (error) {
    console.error('❌ Poll generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate polls: ' + error.message }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }
};