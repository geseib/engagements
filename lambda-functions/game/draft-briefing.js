/**
 * POST /games/briefing/draft — Workie writes a briefing from a document's text.
 *
 * docs/design/session-setup-redesign RATIONALE §c "From file to text", step 3.
 * The create dialog reads the host's PDF, Word or text file through
 * POST /admin/parse-document and sends the TEXT here. This asks Haiku 4.5 (the
 * model the round summaries use) for a short factual summary — numbers,
 * problems, goals, roles in place of names — and returns it, with a count of
 * names removed, for the host to read and edit before anything is stored.
 *
 * STATELESS. It has no table: the document's text passes through and is
 * dropped. Only the summary the host signs off is ever stored, and only by
 * create (POST /games) or Save (PUT /games/{id}), as METADATA.Briefing.
 *
 * NOTHING ABOUT THE DOCUMENT IS LOGGED — not its text, not the draft, not the
 * file name (which is not even sent to the model: "layoffs-v3.pdf" can say
 * more than the contents). Sizes and outcomes only.
 *
 * Auth: the template route carries the Cognito authorizer, and authorizer.js
 * answers ['hosts','admins'] for a POST on a games path.
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const {
  SOURCE_TEXT_CAP, SOURCE_TEXT_SLACK, buildDraftPrompt, parseDraftReply,
} = require('./briefing');

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

const CORS = { 'Access-Control-Allow-Origin': '*' };
const reply = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: CORS });

const COULD_NOT_WRITE = 'The document was read, but Workie couldn\'t write the briefing. Try again, or write the key points yourself.';

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return reply(400, { error: 'The request body is not JSON' });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return reply(400, { error: 'text is required: the document\'s extracted text' });
  if (text.length > SOURCE_TEXT_CAP + SOURCE_TEXT_SLACK) {
    return reply(400, { error: 'The document text is over 50,000 characters. parse-document keeps the first 50,000; send that.' });
  }

  const prompt = buildDraftPrompt({ text, truncated: body.truncated === true });
  const modelId = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
  const invoke = () => bedrock.send(new InvokeModelCommand({
    modelId,
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      // ~1,500 characters is ~400 tokens; the rest is headroom for the JSON.
      max_tokens: 900,
      // A summary of facts, not prose: low temperature keeps numbers as written.
      temperature: 0.2,
      messages: [
        { role: 'user', content: prompt },
        // Prefilled, so the reply is the JSON object and nothing before it.
        { role: 'assistant', content: '{' },
      ],
    }),
  }));

  let completion;
  try {
    let response;
    try {
      response = await invoke();
    } catch (e) {
      if (e.name !== 'ThrottlingException') throw e;
      console.log('⏳ draft-briefing: throttled — retrying once');
      response = await invoke();
    }
    const decoded = JSON.parse(new TextDecoder().decode(response.body));
    completion = `{${decoded.content[0].text}`;
    console.log(`🧾 draft-briefing: ${text.length} chars in, ${completion.length} chars back, stop_reason ${decoded.stop_reason || 'not given'}`);
  } catch (e) {
    console.error(`❌ draft-briefing: the model call failed (${e.name || 'Error'})`);
    return reply(502, { error: COULD_NOT_WRITE });
  }

  try {
    const { briefing, namesRemoved } = parseDraftReply(completion);
    return reply(200, { briefing, namesRemoved, chars: text.length });
  } catch (e) {
    console.error(`❌ draft-briefing: unusable reply (${e.message})`);
    return reply(502, { error: COULD_NOT_WRITE });
  }
};
