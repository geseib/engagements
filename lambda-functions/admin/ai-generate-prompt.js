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
    const aiPrompt = `You are an expert AI prompt engineer specializing in creating effective prompts for analyzing engagement activities and team interactions.

TASK: Generate a professional AI prompt for ${gameType} activities in the ${category} category.

CONTEXT:
- Game Type: ${gameType}
- Category: ${category} (focused on ${categoryContext})
- Purpose: ${description || 'Analyzing team responses and providing strategic insights'}
- Current Instructions: ${currentInstructions || 'None provided'}
- Current Output Format: ${currentOutputFormat || 'None provided'}

AVAILABLE TEMPLATE VARIABLES:
${availableVariables.map(variable => `{${variable}}`).join(', ')}

REQUIREMENTS:
1. Generate BOTH "instructions" and "outputFormat" sections
2. Instructions should define the AI's role, expertise, and analysis approach
3. Output format should use markdown structure with clear sections
4. Include relevant template variables from the available list
5. Make it specific to ${gameType} activities and ${category} scenarios
6. Focus on actionable insights and strategic thinking
7. Maintain professional tone suitable for business contexts

EXAMPLE STRUCTURE:
Instructions: "You are a [specific role] expert specializing in [domain expertise]..."
Output Format: "## Summary\\n[analysis]\\n\\n## Discussion Questions\\n1. [question]\\n\\n## Next Steps\\n1. [action]"

Generate a comprehensive prompt that will produce high-quality analysis for ${category} scenarios in ${gameType} activities.

RESPONSE FORMAT (return as JSON):
{
  "instructions": "Your generated instructions here",
  "outputFormat": "Your generated output format here"
}`;

    // Call Claude via Bedrock
    const modelId = 'anthropic.claude-3-haiku-20240307-v1:0';
    const request = {
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: aiPrompt
          }
        ]
      })
    };

    console.log('🤖 Calling Claude via Bedrock...');
    const response = await bedrockClient.send(new InvokeModelCommand(request));
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    console.log('📝 Claude response:', responseBody);

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