const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

// Template variable definitions for AI generation context
const TEMPLATE_VARIABLES = {
  callandanswer: [
    'questionTitle', 'questionDetail', 'questionCategory', 'eventTitle', 'sessionContext',
    'totalParticipants', 'responseCount', 'responsesText', 'playerAnswers', 'voteCount',
    'voteTally', 'topVotedAnswers', 'consensusLevel', 'winnerInfo', 'finalResults',
    'leaderboard', 'cumulativeScores', 'participationRate', 'sessionDuration'
  ],
  trivia: [
    'questionTitle', 'question', 'triviaChoices', 'correctAnswer', 'answerDetails',
    'difficulty', 'questionCategory', 'eventTitle', 'totalParticipants', 'responseCount',
    'triviaResponses', 'correctCount', 'triviaCorrectness', 'playerRankings',
    'leaderboard', 'cumulativeScores', 'sessionDuration'
  ],
  wavelength: [
    'questionTitle', 'questionDetail', 'questionCategory', 'eventTitle', 'sessionContext',
    'totalParticipants', 'responseCount', 'playerResponses', 'responsesText', 'wordFrequency',
    'commonWords', 'uniqueWords', 'wordStats', 'conceptualThemes', 'finalResults',
    'participationRate', 'sessionDuration', 'customInstructions'
  ],
  polls: [
    'questionTitle', 'questionDetail', 'pollOptions', 'questionCategory', 'eventTitle',
    'totalParticipants', 'responseCount', 'playerAnswers', 'uniqueAnswers',
    'answerCategories', 'finalResults', 'participationRate', 'sessionDuration'
  ]
};

const CATEGORY_CONTEXTS = {
  'lessons-learned': 'analyzing team experiences and extracting strategic insights for future application',
  'problem-solving': 'evaluating solution approaches and building comprehensive frameworks for complex challenges',
  'amazon-principles': 'applying Amazon Leadership Principles in practical business situations and leadership development',
  'interview-prep': 'providing feedback on interview responses using STAR method and behavioral competencies',
  'team-building': 'fostering collaboration, communication, and team effectiveness',
  'opinions': 'synthesizing diverse viewpoints and finding common ground while respecting different perspectives',
  'custom': 'providing flexible analysis that adapts to the specific scenario and business context'
};

exports.handler = async (event) => {
  console.log('🪄 AI Generate Prompt - Event:', JSON.stringify(event, null, 2));

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
      gameType,
      category = 'general',
      currentInstructions = '',
      currentOutputFormat = '',
      promptName = '',
      description = ''
    } = JSON.parse(event.body);

    if (!gameType) {
      throw new Error('Game type is required');
    }

    console.log(`🪄 Generating AI prompt for ${gameType}/${category}`);

    // Get relevant template variables for this game type
    const availableVariables = TEMPLATE_VARIABLES[gameType] || [];
    const categoryContext = CATEGORY_CONTEXTS[category] || 'providing comprehensive analysis and actionable insights';

    // Build the AI generation prompt
    const aiPrompt = `You are an expert AI prompt engineer specializing in enhancing and improving prompts for analyzing engagement activities and team interactions.

TASK: Enhance and improve the existing AI prompt sections for ${gameType} activities in the ${category} category.

ADMIN PROVIDED CONTEXT:
- Prompt Name: ${promptName || 'Not provided'}
- Description: ${description || 'Not provided'}
- Game Type: ${gameType}
- Category: ${category} (focused on ${categoryContext})

EXISTING CONTENT TO ENHANCE:
- Current Instructions: ${currentInstructions || 'None provided - please create from scratch'}
- Current Output Format: ${currentOutputFormat || 'None provided - please create from scratch'}

AVAILABLE TEMPLATE VARIABLES:
${availableVariables.map(variable => `{${variable}}`).join(', ')}

ENHANCEMENT REQUIREMENTS:
1. PRESERVE the admin's original intent and purpose - do not change the core direction
2. If instructions exist, enhance them with more detail, specificity, and expertise
3. If output format exists, improve structure and add relevant template variables
4. If sections are missing, create them based on the description and category context
5. Add specific expertise and domain knowledge relevant to ${category}
6. Include appropriate template variables from the available list
7. Maintain professional tone suitable for business contexts
8. Focus on actionable insights and strategic thinking

ENHANCEMENT APPROACH:
- For existing content: Add detail, improve clarity, enhance with domain expertise
- For missing content: Create based on description and category focus
- Always respect the admin's vision while making it more effective

RESPONSE FORMAT (return as JSON):
{
  "instructions": "Enhanced/created instructions that preserve admin intent",
  "outputFormat": "Enhanced/created output format with better structure and template variables"
}`;

    // Call Claude via Bedrock using cross-region inference profiles (same as ai-summary)
    console.log('🤖 BEDROCK: Calling Claude 3.5 Haiku via inference profile...');
    
    let response;
    let responseBody;
    
    try {
      // Use Claude 3.5 Haiku inference profile ARN (cross-region)
      const haikuProfileArn = `arn:aws:bedrock:us-east-1:${process.env.AWS_ACCOUNT_ID || '239601476690'}:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0`;
      console.log('🤖 BEDROCK: Haiku Inference Profile ARN:', haikuProfileArn);
      console.log('🤖 BEDROCK: Prompt length:', aiPrompt.length);
      
      response = await bedrockClient.send(new InvokeModelCommand({
        modelId: haikuProfileArn,
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2000,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: aiPrompt
            }
          ]
        })
      }));
      
      responseBody = JSON.parse(new TextDecoder().decode(response.body));
      console.log('✅ Successfully called Claude 3.5 Haiku via inference profile');
      console.log('📝 Claude response:', responseBody);
      
    } catch (primaryError) {
      console.error('❌ Error with Claude 3.5 Haiku:', primaryError);
      
      // Fallback to Claude 3.5 Sonnet inference profile
      console.log('🔄 BEDROCK: Trying Claude 3.5 Sonnet as fallback...');
      
      try {
        const sonnetProfileArn = `arn:aws:bedrock:us-east-1:${process.env.AWS_ACCOUNT_ID || '239601476690'}:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0`;
        console.log('🤖 BEDROCK: Sonnet Inference Profile ARN:', sonnetProfileArn);
        
        response = await bedrockClient.send(new InvokeModelCommand({
          modelId: sonnetProfileArn,
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2000,
            temperature: 0.7,
            messages: [
              {
                role: 'user',
                content: aiPrompt
              }
            ]
          })
        }));
        
        responseBody = JSON.parse(new TextDecoder().decode(response.body));
        console.log('✅ Successfully called Claude 3.5 Sonnet as fallback');
        console.log('📝 Claude response:', responseBody);
        
      } catch (fallbackError) {
        console.error('❌ Both models failed:', fallbackError);
        throw new Error(`All Bedrock models failed. Primary: ${primaryError.message}, Fallback: ${fallbackError.message}`);
      }
    }
    
    if (!responseBody) {
      throw new Error('No response received from Bedrock');
    }

    let generatedContent;
    try {
      // Try to parse the content as JSON first
      const content = responseBody.content[0].text;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        generatedContent = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: extract sections manually
        const instructionsMatch = content.match(/(?:instructions|Instructions)[":\s]+([\s\S]*?)(?=(?:outputFormat|Output Format|$))/i);
        const outputFormatMatch = content.match(/(?:outputFormat|Output Format)[":\s]+([\s\S]*?)$/i);
        
        generatedContent = {
          instructions: instructionsMatch ? instructionsMatch[1].trim().replace(/^["']|["']$/g, '') : 'Expert analysis focused on ' + categoryContext,
          outputFormat: outputFormatMatch ? outputFormatMatch[1].trim().replace(/^["']|["']$/g, '') : '## Summary\n{finalResults}\n\n## Discussion Questions\n1. What patterns emerge from {responsesText}?\n2. How can these insights improve team performance?\n\n## Next Steps\n1. Apply key insights from {topVotedAnswers}\n2. Schedule follow-up discussion'
        };
      }
    } catch (parseError) {
      console.error('Error parsing Claude response:', parseError);
      // Provide fallback content
      generatedContent = {
        instructions: `You are a ${category} specialist and strategic consultant. Analyze ${gameType} responses with deep expertise in ${categoryContext}. Provide thoughtful, actionable insights that help teams improve performance and achieve strategic objectives.`,
        outputFormat: `## Summary\nAnalyze the key themes from {responsesText} in the context of {eventTitle}.\n\n## Strategic Insights\nBased on {responseCount} responses from {totalParticipants} participants:\n{finalResults}\n\n## Discussion Questions\n1. What patterns emerge from the top-voted responses?\n2. How do these insights align with our strategic objectives?\n3. What immediate actions should the team consider?\n\n## Recommended Next Steps\n1. [Specific action based on insights]\n2. [Follow-up strategy]\n3. [Measurement approach]`
      };
    }

    console.log('✅ Generated AI prompt successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        instructions: generatedContent.instructions,
        outputFormat: generatedContent.outputFormat,
        gameType,
        category
      })
    };

  } catch (error) {
    console.error('❌ Error generating AI prompt:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to generate AI prompt',
        message: error.message
      })
    };
  }
};