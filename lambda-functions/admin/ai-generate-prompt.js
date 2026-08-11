const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { normalizeGameType, isKnownGameType, GAME_TYPE_IDS } = require('./shared/game-types');
const { describeVariablesForPrompt } = require('./shared/template-variable-usage');

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

// The variable list used to live here, hardcoded and keyed `callandanswer` /
// `polls`, while AIPromptManager sends the canonical dashed ids. So for
// call-and-answer, poll and survey the lookup MISSED, `|| []` swallowed it, and
// the model was handed an empty "AVAILABLE TEMPLATE VARIABLES:" heading
// alongside an instruction to use the list — which is precisely why it invented
// them. Where the table did hit, its wavelength row named five variables that
// have never existed. It is gone; shared/template-variables.js is the list now.

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
      const err = new Error('Game type is required');
      err.statusCode = 400;
      throw err;
    }

    // Fail LOUDLY on a type we have no variables for. The old `|| []` turned an
    // unrecognised type into an empty list and carried on, which is the failure
    // that reached the owner: the model is told to use the available variables
    // and there are none, so it makes some up.
    if (!isKnownGameType(gameType)) {
      const err = new Error(
        `Invalid gameType "${gameType}". Must be one of: ${GAME_TYPE_IDS.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
    const canonicalGameType = normalizeGameType(gameType);

    console.log(`🪄 Generating AI prompt for ${canonicalGameType}/${category}`);

    // Get relevant template variables for this game type, described so the
    // model knows what each one actually contains.
    const availableVariables = describeVariablesForPrompt(canonicalGameType);
    if (!availableVariables) {
      const err = new Error(
        `No template variables are catalogued for "${canonicalGameType}" — refusing to ask a ` +
        'model to write a prompt it cannot fill');
      err.statusCode = 500;
      throw err;
    }
    const categoryContext = CATEGORY_CONTEXTS[category] || 'providing comprehensive analysis and actionable insights';

    // Build the AI generation prompt
    const aiPrompt = `You are an expert AI prompt engineer specializing in enhancing and improving prompts for analyzing engagement activities and team interactions.

TASK: Enhance and improve the existing AI prompt sections for ${canonicalGameType} activities in the ${category} category.

ADMIN PROVIDED CONTEXT:
- Prompt Name: ${promptName || 'Not provided'}
- Description: ${description || 'Not provided'}
- Game Type: ${canonicalGameType}
- Category: ${category} (focused on ${categoryContext})

EXISTING CONTENT TO ENHANCE:
- Current Instructions: ${currentInstructions || 'None provided - please create from scratch'}
- Current Output Format: ${currentOutputFormat || 'None provided - please create from scratch'}

AVAILABLE TEMPLATE VARIABLES — this list is COMPLETE and EXHAUSTIVE for ${canonicalGameType}.
A {token} that is not listed here is substituted by nothing and appears on a
projector as literal braces, so the prompt will be REJECTED when it is saved.
Never invent one, and never adapt a name from another game type:

${availableVariables}

ENHANCEMENT REQUIREMENTS:
1. PRESERVE the admin's original intent and purpose - do not change the core direction
2. If instructions exist, enhance them with more detail, specificity, and expertise
3. If output format exists, improve structure and add relevant template variables
4. If sections are missing, create them based on the description and category context
5. Add specific expertise and domain knowledge relevant to ${category}
6. Include appropriate template variables, chosen ONLY from the exhaustive list above
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
    console.log('🤖 BEDROCK: Calling Claude Haiku 4.5 via inference profile...');
    
    let response;
    let responseBody;
    
    try {
      // Use Claude Haiku 4.5 inference profile ARN (cross-region)
      const haikuProfileArn = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
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
      console.log('✅ Successfully called Claude Haiku 4.5 via inference profile');
      console.log('📝 Claude response:', responseBody);
      
    } catch (primaryError) {
      console.error('❌ Error with Claude Haiku 4.5:', primaryError);
      
      // Fallback to Claude Sonnet 4.6 inference profile
      console.log('🔄 BEDROCK: Trying Claude Sonnet 4.6 as fallback...');
      
      try {
        const sonnetProfileArn = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-6`;
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
        console.log('✅ Successfully called Claude Sonnet 4.6 as fallback');
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
        gameType: canonicalGameType,
        category
      })
    };

  } catch (error) {
    console.error('❌ Error generating AI prompt:', error);
    return {
      // A rejected game type is the caller's mistake, not ours. Returning 500
      // for it is what let "no variables for this type" read as a transient
      // Bedrock hiccup.
      statusCode: error.statusCode || 500,
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