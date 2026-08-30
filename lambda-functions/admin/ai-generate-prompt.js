const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { normalizeGameType, isKnownGameType, GAME_TYPE_IDS } = require('./shared/game-types');
const {
  describeVariablesForPrompt,
  describeAuthoringRules,
  assertNoBracketDirections,
} = require('./shared/template-variable-usage');

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

/**
 * One ask, with the Sonnet fallback the wand has always had. Lifted out of the
 * handler because the bracket gate below may need to ask twice, and a retry
 * that skipped the fallback would be a different, weaker call than the first.
 */
async function askModel(promptText) {
  console.log('🤖 BEDROCK: Calling Claude Haiku 4.5 via inference profile...');
  const invoke = async (modelId) => {
    const response = await bedrockClient.send(new InvokeModelCommand({
      modelId,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [{ role: 'user', content: promptText }]
      })
    }));
    return JSON.parse(new TextDecoder().decode(response.body));
  };

  const haikuProfileArn = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
  try {
    console.log('🤖 BEDROCK: Prompt length:', promptText.length);
    const body = await invoke(haikuProfileArn);
    console.log('✅ Successfully called Claude Haiku 4.5 via inference profile');
    return body;
  } catch (primaryError) {
    console.error('❌ Error with Claude Haiku 4.5:', primaryError);
    console.log('🔄 BEDROCK: Trying Claude Sonnet 4.6 as fallback...');
    try {
      const sonnetProfileArn = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-6`;
      const body = await invoke(sonnetProfileArn);
      console.log('✅ Successfully called Claude Sonnet 4.6 as fallback');
      return body;
    } catch (fallbackError) {
      console.error('❌ Both models failed:', fallbackError);
      throw new Error(`All Bedrock models failed. Primary: ${primaryError.message}, Fallback: ${fallbackError.message}`);
    }
  }
}

/*
  THE FALLBACKS HAD THE BUG THEY EXIST TO SURVIVE.

  Both of these are used when the model's reply cannot be read — and the second
  one shipped `[Specific action based on insights]`, `[Follow-up strategy]` and
  `[Measurement approach]`. So the path taken when the AI fails handed the admin
  a prompt the save gate refuses, in code, every time, with no model involved.
  They also reached for {totalParticipants} and {topVotedAnswers}, both of which
  the catalogue warns are not what their names suggest.

  Rewritten to obey the same rules the model is now given: no brackets, each
  variable alone under a label, and the honest spelling of each count.
*/
const FALLBACK_OUTPUT_FORMAT = `## Summary
{finalResults}

## What the room said
{responsesText}

## Discussion Questions
1. What patterns emerge from the responses above?
2. How do these insights align with our strategic objectives?
3. What should the team do differently next time?

## Recommended Next Steps
Name three actions the responses actually support, one sentence each.`;

/**
 * Read the model's reply, tolerating the two ways it goes wrong: prose wrapped
 * around the JSON, and no JSON at all.
 */
function parseGeneratedContent(responseBody, category, categoryContext) {
  try {
    const content = responseBody.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);

    const instructionsMatch = content.match(/(?:instructions|Instructions)[":\s]+([\s\S]*?)(?=(?:outputFormat|Output Format|$))/i);
    const outputFormatMatch = content.match(/(?:outputFormat|Output Format)[":\s]+([\s\S]*?)$/i);
    return {
      instructions: instructionsMatch
        ? instructionsMatch[1].trim().replace(/^["']|["']$/g, '')
        : `Expert analysis focused on ${categoryContext}`,
      outputFormat: outputFormatMatch
        ? outputFormatMatch[1].trim().replace(/^["']|["']$/g, '')
        : FALLBACK_OUTPUT_FORMAT,
    };
  } catch (parseError) {
    console.error('Error parsing Claude response:', parseError);
    return {
      instructions: `You are a ${category} specialist and strategic consultant. Analyse the `
        + `responses with deep expertise in ${categoryContext}. Provide thoughtful, actionable `
        + 'insights that help teams improve performance and achieve strategic objectives.',
      outputFormat: FALLBACK_OUTPUT_FORMAT,
    };
  }
}

/**
 * The bracket gate, run on the way OUT.
 *
 * The rules in the prompt are instructions to a model and a model may ignore
 * them; this is the same function the SAVE path calls, so what it accepts here
 * is exactly what will be accepted there. Returns the violation message, or
 * null when the reply is clean.
 *
 * Worth being blunt about why this exists: without it the wand's answer looks
 * finished, the admin reads it, edits it, presses Save — and only then is told
 * the prompt was never allowed. Catching it here costs one extra model call and
 * saves all of that.
 */
function bracketViolation(generated) {
  try {
    assertNoBracketDirections({
      instructions: generated.instructions,
      outputFormat: generated.outputFormat,
    });
    return null;
  } catch (err) {
    return err.message;
  }
}

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

RULES THE SAVE GATE ENFORCES — a prompt that breaks one of these is REJECTED or
misbehaves silently in front of a room. They are not style preferences:

${describeAuthoringRules()}

EXAMPLE OF A CORRECT outputFormat — labels in prose, each variable alone on its
line, no square brackets anywhere:

**What the room said**
{responsesText}

**How the vote fell**
{voteTally}

**The through-line**
Two or three sentences naming the ideas that recur, in the voice above.

ENHANCEMENT REQUIREMENTS:
1. PRESERVE the admin's original intent and purpose - do not change the core direction
2. If instructions exist, enhance them with more detail, specificity, and expertise
3. If output format exists, improve its structure, following the rules and example above
4. If sections are missing, create them based on the description and category context
5. Add specific expertise and domain knowledge relevant to ${category}
6. Where the output should carry data, use a variable from the exhaustive list above —
   on its own line under a label, never inside a sentence, and never twice
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

    // ONE ASK, AND POSSIBLY A SECOND — see askModel and the bracket gate below.
    let responseBody = await askModel(aiPrompt);
    if (!responseBody) {
      throw new Error('No response received from Bedrock');
    }

    let generatedContent = parseGeneratedContent(responseBody, category, categoryContext);

    /*
      ONE RETRY, THEN AN HONEST REFUSAL.

      Square brackets are the one BLOCKING gate: the save path throws on them,
      so a reply carrying them is a prompt the admin cannot keep no matter what
      they do to it. Quoting the offending span back is what makes the retry
      worth having — a generic scolding gets the same answer again.

      Two calls is the budget. A model that will not comply twice is not going
      to comply on the fifth ask, and an admin waiting on a spinner is owed an
      answer rather than a loop.
    */
    let violation = bracketViolation(generatedContent);
    if (violation) {
      console.warn('⚠️ Wand returned bracket directions — asking once more:', violation);
      const retryPrompt = `${aiPrompt}

YOUR PREVIOUS ANSWER WAS REJECTED. It contained square-bracket placeholders,
which nothing substitutes — the model receives them as literal text and answers
them. This is the rejection, verbatim:

${violation}

Rewrite BOTH sections with no square brackets anywhere. Where data belongs, use
a {variable} from the exhaustive list above, on its own line under a label.
Where the bracket was an instruction to yourself, write it out as a sentence.`;
      generatedContent = parseGeneratedContent(await askModel(retryPrompt), category, categoryContext);
      violation = bracketViolation(generatedContent);
    }
    if (violation) {
      console.error('❌ Wand could not produce a saveable prompt:', violation);
      return {
        statusCode: 422,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({
          success: false,
          error: 'The generator produced square-bracket placeholders twice, and the save gate '
            + 'refuses those — nothing fills them, so the model would answer them in front of '
            + 'the room. Nothing has been changed. Try again, or write the section by hand.',
          detail: violation
        })
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