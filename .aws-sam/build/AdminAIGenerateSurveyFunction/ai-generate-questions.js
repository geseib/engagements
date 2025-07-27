const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { invokeClaudeWithRetry } = require('./shared/bedrock-utils');

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  try {
    console.log('🤖 Lambda function started for question generation');

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

    const { engagementType, userInput, questionCount, existingQuestion, context } = JSON.parse(event.body);

    console.log(`🤖 Generating ${questionCount} ${engagementType} questions`);

    // Build the AI prompt based on engagement type
    let prompt = `You are an expert educational content creator. `;

    if (existingQuestion) {
      prompt += `Please improve the following ${engagementType} question based on the user's feedback.\n\n`;
      prompt += `EXISTING QUESTION:\n`;
      prompt += `Title: ${existingQuestion.title}\n`;
      prompt += `Category: ${existingQuestion.category}\n`;
      prompt += `Detail: ${existingQuestion.detail}\n`;
      if (engagementType === 'trivia') {
        prompt += `Option A: ${existingQuestion.optionA}\n`;
        prompt += `Option B: ${existingQuestion.optionB}\n`;
        prompt += `Option C: ${existingQuestion.optionC}\n`;
        prompt += `Option D: ${existingQuestion.optionD}\n`;
        prompt += `Correct Answer: ${existingQuestion.correctAnswer}\n`;
        if (existingQuestion.answerDetails) {
          prompt += `Answer Explanation: ${existingQuestion.answerDetails}\n`;
        }
      } else if (engagementType === 'poll') {
        prompt += `Options: ${existingQuestion.options.join(', ')}\n`;
      } else if (engagementType === 'wavelength') {
        prompt += `Topic/Word: ${existingQuestion.title}\n`;
        if (existingQuestion.detail) {
          prompt += `Instructions: ${existingQuestion.detail}\n`;
        }
      }
      prompt += `\nUSER FEEDBACK: ${userInput}\n\n`;
    } else {
      prompt += `Please create ${questionCount} high-quality ${engagementType} questions based on the following requirements:\n\n`;
      prompt += `REQUIREMENTS: ${userInput}\n\n`;
      if (context?.title) prompt += `Question Set Title: ${context.title}\n`;
      if (context?.description) prompt += `Description: ${context.description}\n`;
    }

    // Add format instructions based on engagement type
    if (engagementType === 'trivia') {
      prompt += '\n\nPlease format your response as a JSON array with this structure:';
      prompt += '\n[{"title": "Question title", "questionDetail": "Full question text", "category": "Category", "school": "School", "customInstructions": "Instructions", "optionA": "First option", "optionB": "Second option", "optionC": "Third option", "optionD": "Fourth option", "correctAnswer": "OptionA", "difficulty": "medium", "answerDetails": "Explanation of correct answer"}]';
      prompt += '\n\nFor trivia questions:';
      prompt += '\n- title: Short descriptive title of the question';
      prompt += '\n- questionDetail: The actual question text shown to players';
      prompt += '\n- optionA, optionB, optionC, optionD: The four answer choices';
      prompt += '\n- correctAnswer: Must be exactly "OptionA", "OptionB", "OptionC", or "OptionD"';
      prompt += '\n- answerDetails: Educational explanation about why the answer is correct';
      prompt += '\n- difficulty: "easy", "medium", or "hard"';
    } else if (engagementType === 'poll') {
      prompt += '\n\nPlease format your response as a JSON array with this structure:';
      prompt += '\n[{"title": "Poll question", "category": "Category", "detail": "Context", "school": "School", "customInstructions": "Instructions", "options": ["Option1", "Option2"], "allowMultiple": false}]';
    } else if (engagementType === 'wavelength') {
      prompt += '\n\nPlease format your response as a JSON array with this structure:';
      prompt += '\n[{"title": "Word or phrase", "category": "Category", "detail": "Contextual scenario", "school": "Business School", "customInstructions": "What are the first 10 words you think of when you think of this word?"}]';
      prompt += '\n\nFor wavelength questions:';
      prompt += '\n- title: The key word or phrase players will associate with (e.g., "Agentic AI", "Leadership", "Innovation")';
      prompt += '\n- detail: A brief contextual scenario that introduces the word/concept (e.g., "Your product manager stopped you in the hall and said we need to add **Agentic AI** to our dashboard.")';
      prompt += '\n- category: The broader theme or subject area (e.g., "AI", "Management", "Technology")';
      prompt += '\n- customInstructions: Always set to "What are the first 10 words you think of when you think of this word?"';
      prompt += '\n- school: Always set to "Business School"';
      prompt += '\n\nCreate scenarios that feel realistic and relevant to business/professional contexts. Use **bold** formatting around the key word/phrase in the detail field.';
    } else {
      prompt += '\n\nPlease format your response as a JSON array with this structure:';
      prompt += '\n[{"title": "Question text", "category": "Category", "detail": "Detailed context", "school": "School", "customInstructions": "Instructions"}]';
    }

    prompt += '\n\nIMPORTANT: Return ONLY the JSON array, no additional text.';

    console.log('🤖 Sending prompt to Claude...');
    const aiResponse = await invokeClaudeWithRetry(bedrockClient, InvokeModelCommand, prompt, 3000);
    console.log('✅ Received response from Claude');

    // Parse the JSON response with improved error handling
    let questions;
    try {
      console.log('🔍 Parsing AI response...');
      
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

      console.log('✅ Successfully parsed', questions.length, 'questions');
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('Raw response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON: ' + parseError.message);
    }

    // Add IDs and ensure proper structure
    const processedQuestions = questions.map(q => ({
      id: Date.now() + Math.random(),
      active: true,
      ...q
    }));

    console.log(`✅ Successfully generated ${processedQuestions.length} questions`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        questions: processedQuestions,
        message: `Generated ${processedQuestions.length} questions successfully`
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };

  } catch (error) {
    console.error('❌ AI generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to generate questions: ${error.message}` }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }
};
