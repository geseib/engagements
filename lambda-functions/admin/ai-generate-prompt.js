const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
// Haiku 4.5 / Sonnet 4.6 on Bedrock, or Haiku 5.5 / Sonnet 5.5 on the
// Anthropic API where the Engage switch is on (shared/claude-route.js).
const claudeRoute = require('./shared/claude-route');
const { normalizeGameType, isKnownGameType, GAME_TYPE_IDS } = require('./shared/game-types');
const { canAuthorPrompts, promptRefusalMessage } = require('./shared/prompt-access');
const { callerUserId } = require('./shared/question-set-access');
const {
  describeVariablesForPrompt,
  describeAuthoringRules,
  assertNoBracketDirections,
} = require('./shared/template-variable-usage');
const { variablesForGameType } = require('./shared/template-variables');

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

// The variable list used to live here, hardcoded and keyed `callandanswer` /
// `polls`, while AIPromptManager sends the canonical dashed ids. So for
// call-and-answer, poll and survey the lookup MISSED, `|| []` swallowed it, and
// the model was handed an empty "AVAILABLE TEMPLATE VARIABLES:" heading
// alongside an instruction to use the list — which is precisely why it invented
// them. Where the table did hit, its wavelength row named five variables that
// have never existed. It is gone; shared/template-variables.js is the list now.

// What each category's summaries are for, in plain words. The house style is
// short and grounded; these once read "comprehensive frameworks" and "deep
// expertise", and the model wrote prompts in that voice.
const CATEGORY_CONTEXTS = {
  'lessons-learned': 'what the team learned from what happened, and what to do differently',
  'problem-solving': 'which approaches the room proposed and how they compare',
  'amazon-principles': 'how the answers show Amazon Leadership Principles in practice',
  'interview-prep': 'feedback on interview answers, using the STAR method',
  'team-building': 'how the team works together and talks to each other',
  'opinions': 'where views differ and where they agree',
  'custom': 'what the room said about the question it was asked'
};
const DEFAULT_CATEGORY_CONTEXT = 'what the room said, and what it suggests doing next';

/**
 * THE EXAMPLE'S SECOND VARIABLE, FROM THIS GAME TYPE'S OWN CATALOGUE. The
 * example used to show {voteTally} for every type — a variable wavelength does
 * not have, and one a poll (which has no vote) reads as a ranking. The first
 * of these the catalogue lists for the type is used, with its label.
 */
const EXAMPLE_VARIABLES = {
  'call-and-answer': [['voteTally', 'How the vote fell']],
  trivia: [['triviaCorrectness', 'Who got it right']],
  poll: [['resultsSummary', 'How the room answered']],
  wavelength: [['commonWords', 'Words everyone used']],
  survey: [['surveyResults', 'What the survey found']],
};
function exampleVariableFor(gameType) {
  const known = new Set(variablesForGameType(gameType).map((v) => v.name));
  const found = (EXAMPLE_VARIABLES[gameType] || []).find(([name]) => known.has(name));
  return found || ['responseCount', 'How many answered'];
}

/** The answer budget. 2000 cut a long rewrite off mid-section; see askModel. */
const MAX_TOKENS = 8000;

/** A reply that ran out of budget — a cut-off prompt, never one to hand back. */
class TruncatedReplyError extends Error {
  constructor() {
    super('The AI\'s answer ran past its length limit before it finished, so nothing was changed. '
      + 'Try again, or shorten the current instructions first.');
    this.name = 'TruncatedReplyError';
    this.statusCode = 502;
  }
}

/**
 * One ask, with the Sonnet fallback the wand has always had. Lifted out of the
 * handler because the bracket gate below may need to ask twice, and a retry
 * that skipped the fallback would be a different, weaker call than the first.
 */
async function askModel(promptText) {
  console.log('🤖 BEDROCK: Calling Claude Haiku 4.5 via inference profile...');
  const invoke = async (modelId) => {
    // The function gives up at 60s and may ask twice (the bracket gate).
    const response = await claudeRoute.send(bedrockClient, new InvokeModelCommand({
      modelId,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        messages: [{ role: 'user', content: promptText }]
      })
    }), { site: 'generate-prompt', timeoutMs: 15000 });
    const body = JSON.parse(new TextDecoder().decode(response.body));
    // THE CHECK THIS HELPER NEVER MADE: a reply cut off at the budget was
    // parsed as if whole, and half a prompt came back as the answer.
    if (body && body.stop_reason === 'max_tokens') throw new TruncatedReplyError();
    return body;
  };

  const haikuProfileArn = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
  try {
    console.log('🤖 BEDROCK: Prompt length:', promptText.length);
    const body = await invoke(haikuProfileArn);
    console.log('✅ Successfully called Claude Haiku 4.5 via inference profile');
    return body;
  } catch (primaryError) {
    // The fallback has the same budget, so a truncation is the answer, not a reason to ask again.
    if (primaryError instanceof TruncatedReplyError) throw primaryError;
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
 * Read the model's reply. It writes each half between its own tags — the
 * format ai-prompt-advisor.js uses for its rewrites, because a long prompt
 * escaped into a JSON string is one missed quote from unreadable. A JSON reply
 * is still read if the model sends one, and the old prose fallbacks remain.
 */
function betweenTags(text, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start < 0 || end < start + open.length) return undefined;
  return text.slice(start + open.length, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

function parseGeneratedContent(responseBody, category, categoryContext) {
  try {
    const content = responseBody.content[0].text;
    const tagged = { instructions: betweenTags(content, 'instructions'), outputFormat: betweenTags(content, 'outputFormat') };
    if (tagged.instructions !== undefined && tagged.outputFormat !== undefined) return tagged;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);

    const instructionsMatch = content.match(/(?:instructions|Instructions)[":\s]+([\s\S]*?)(?=(?:outputFormat|Output Format|$))/i);
    const outputFormatMatch = content.match(/(?:outputFormat|Output Format)[":\s]+([\s\S]*?)$/i);
    return {
      instructions: instructionsMatch
        ? instructionsMatch[1].trim().replace(/^["']|["']$/g, '')
        : `Summarise ${categoryContext}.`,
      outputFormat: outputFormatMatch
        ? outputFormatMatch[1].trim().replace(/^["']|["']$/g, '')
        : FALLBACK_OUTPUT_FORMAT,
    };
  } catch (parseError) {
    console.error('Error parsing Claude response:', parseError);
    return {
      instructions: `Read the room's answers and summarise ${categoryContext}. Use only what the `
        + 'answers say; name no number, person or fact they do not contain.',
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

// Exported for tests/ai-generate-prompt-format.js.
exports.parseGeneratedContent = parseGeneratedContent;
exports.exampleVariableFor = exampleVariableFor;
exports.TruncatedReplyError = TruncatedReplyError;

exports.handler = async (event) => {
  /*
    THIS USED TO PRINT THE WHOLE EVENT — every header, the bearer JWT in
    Authorization among them, and the body, which here is the prompt name,
    description and instructions being drafted. Trace the request, not quote
    it (tests/lambda-event-not-logged.js).
  */
  console.log('🪄 AI Generate Prompt', JSON.stringify({
    method: event.requestContext?.http?.method,
    path: event.requestContext?.http?.path,
    sub: callerUserId(event) || null,
  }));

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

    /*
      ENGAGE MODE ONLY — docs/superpowers/specs/2026-09-24-prompt-admin-engage-mode-design.md.
      The authorizer checks the group, not the mode, so this handler checks
      the mode itself. Drafting a prompt is authoring one, which only Engage staff do for now.
    */
    if (!canAuthorPrompts(event)) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({ error: promptRefusalMessage(event, null) })
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
    const categoryContext = CATEGORY_CONTEXTS[category] || DEFAULT_CATEGORY_CONTEXT;
    const [exampleVariable, exampleLabel] = exampleVariableFor(canonicalGameType);

    // Build the AI generation prompt
    const aiPrompt = `You write the prompts Engage uses to summarise a room's answers on screen.

TASK: Write or improve the two sections of a summary prompt for ${canonicalGameType} rounds in the ${category} category.

ADMIN PROVIDED CONTEXT:
- Prompt Name: ${promptName || 'Not provided'}
- Description: ${description || 'Not provided'}
- Game Type: ${canonicalGameType}
- Category: ${category} (focused on ${categoryContext})

EXISTING CONTENT:
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

**${exampleLabel}**
{${exampleVariable}}

**The through-line**
Two or three sentences naming the ideas that recur, in the voice above.

HOW TO WRITE IT:
1. Keep the admin's purpose and voice. Do not change what the prompt is for.
2. Where a section exists, make it clearer and shorter: cut repetition and words that do nothing.
3. Where a section is missing, write it from the description and category above.
4. Where the output should carry data, use a variable from the exhaustive list above —
   on its own line under a label, never inside a sentence, and never twice.
5. Plain words, short sentences. No hyperbole ("powerful", "comprehensive", "game-changing").
6. Never ask the summary for numbers, names or facts the round's data does not contain.

HOW TO REPLY. Not JSON. Write each section in full between its tags, exactly as it should be
saved — plain text, nothing escaped, no code fence. Nothing before the first tag and nothing
after the last:

<instructions>
The complete instructions section
</instructions>
<outputFormat>
The complete output-format section
</outputFormat>`;

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