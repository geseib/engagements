const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const {
  resolvePersona, buildOutputContract, hasCustomOutputShape, describeOutputShape,
  buildContextBlock, buildHostDirective, resolveOutputSections, pickOpeningMove,
} = require('./personas');
const { normalizeGameType } = require('./game-types');
const { isUsableSummaryPrompt, summaryPromptDefect } = require('./prompt-shape');
const { extractVariableTokens } = require('./template-variables');
const { resolveSetPartition } = require('./set-version');
const { isHidden } = require('./anonymity');
const { consensusLabel } = require('./consensus');
// buildWavelengthProse lives in wavelength.js WITH the engine, not here.
// promptPreflight.test.js extracts "the hardcoded fallback" by slicing from
// this file's FIRST backtick character, so nothing above the real fallback
// template may contain one — not a template literal, not even a comment —
// or the preflight reads the sliced text's interpolations as unknown
// brace-tokens and goes red.
const { analyzeWavelength, buildWavelengthProse } = require('./wavelength');
const { ORG } = require('./tenant');
const { setMetadataKey } = require('./set-version');
const { decryptItem, decryptItems, encryptItem } = require('./tenant-crypto');

/**
 * Voice attribution carried out of generateAISummary() and onto the stored
 * AISummary item, so a report can say whose voice produced a section.
 *
 * `personaName` is null for the free-text and inferred levels — those have no
 * named persona, and inventing one ("Adaptive") here would put a label in the
 * data that nobody chose. `personaSource` tells a reader which level won.
 */
const personaAttribution = (persona) => ({
  personaName: (persona && persona.name) || null,
  personaId: (persona && persona.personaId) || null,
  personaSource: (persona && persona.source) || null
});

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * WHOSE SESSION IS THIS? — off the row, because this route is PUBLIC.
 *
 * GET /games/{gameId}/ai-summary is polled by every phone in the room and by
 * the projector, none of which carry an authorizer context, so the caller's org
 * is '' — and a blank orgId THROWS in tenant-crypto rather than defaulting to
 * something. The session's own METADATA row is the authority.
 *
 * A helper rather than one variable because the CACHED-SUMMARY branch returns
 * long before the handler reads game metadata for anything else, and that
 * branch has to decrypt too.
 *
 * NO BACKTICKS ANYWHERE IN THIS FILE ABOVE THE FALLBACK TEMPLATE — see the note
 * at the top. That is why this builds its keys with concatenation.
 */
const orgOf = (item) => (item && typeof item.orgId === 'string' ? item.orgId.trim() : '');
/**
 * THE SET METADATA KEY FOR THIS SESSION'S SET — scoped, never assumed.
 *
 * Both reads of this row used `PK: 'SETS'`, which since tenancy is the PLATFORM
 * library and nothing else. An organisation's own set lives at
 * `ORG#<org>#SETS`, so for every org session these found NOTHING and the
 * summary silently lost the set's custom instruction, its AI context, its
 * persona and its prompt — no error, just absent fields, and a Workie that
 * sounded like the default because the set's own voice was never read.
 *
 * `create-report.js:223` already carries this exact fix and its post-mortem.
 * These two call sites were missed. tests/set-versioning-flow.js now fails on
 * any hard-coded `PK: 'SETS'` in a runtime reader, so a third cannot hide.
 *
 * The scope comes from the SESSION ROW, not from the caller: this route serves
 * anonymous participants, and a caller-derived scope resolves to platform for
 * every one of them — which is the bug wearing a different hat.
 */
function sessionSetKey(metadata, setId) {
  const scope = metadata && metadata.QuestionSetScope;
  return setMetadataKey({
    scope,
    orgId: scope === ORG ? ((metadata && metadata.orgId) || '') : '',
    setId,
  });
}

async function sessionOrgId(gameId) {
  const res = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: 'GAME#' + gameId, SK: 'METADATA' },
    ProjectionExpression: 'orgId'
  }));
  return orgOf(res && res.Item);
}
const s3 = new S3Client({ region: 'us-east-1' });
const lambda = new LambdaClient({});
const apigateway = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_API_ENDPOINT });

// Broadcast a message to every connection in a game (copied from next-question.js,
// including inline 410-stale cleanup). Used by the async summary worker to deliver
// the legacy-shaped { type: 'aiSummaryReady' | 'aiSummaryError' } events the client handlers register under.
const broadcastToGame = async (gameId, message) => {
  try {
    const connectionsResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#'
      }
    }));

    const connections = connectionsResult.Items || [];
    console.log(`🔔 AI SUMMARY: broadcasting ${message.type} to ${connections.length} connections for game ${gameId}`);
    if (connections.length === 0) return;

    await Promise.all(connections.map(async (connection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message)
        }));
      } catch (error) {
        if (error.statusCode === 410 || error.name === 'GoneException' || error.$metadata?.httpStatusCode === 410 || error.$response?.statusCode === 410) {
          console.log(`🧹 AI SUMMARY: removing stale connection ${connection.ConnectionId}`);
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: connection.PK, SK: connection.SK }
          })).catch(() => {});
        } else {
          console.error(`❌ AI SUMMARY: failed to send to ${connection.ConnectionId}:`, error);
        }
      }
    }));
  } catch (error) {
    console.error('❌ AI SUMMARY: broadcast error:', error);
  }
};


// Turn a markdown list (numbered, dashed or starred) into trimmed strings.
// Falls back to non-empty, non-heading lines so an unformatted section still
// yields something rather than nothing.
const extractListItems = (text, limit) => {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  const bulleted = lines
    .filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l))
    .map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, '').trim())
    .filter(Boolean);
  if (bulleted.length) return bulleted.slice(0, limit);
  return lines.filter((l) => l.length > 0 && !l.startsWith('#')).slice(0, limit);
};

// Headings we treat as each canonical section. Structure is appended to every
// prompt by buildOutputContract(), so conforming responses are the norm — but a
// hand-written template or a drifting persona can still produce its own
// headings, and the panel must stay useful when that happens.
const SECTION_SYNONYMS = {
  summary: /^(summary|results?|overview|insights?|analysis|key\s*lessons?|key\s*takeaways?|takeaways?|themes?|common\s*themes?|dive\s*deep|game\s*status|challenge)\b/i,
  discussion: /^(discussion\s*(questions?|topics?|prompts?)|questions?\s*(to\s*discuss)?|talking\s*points?|prompts?)\b/i,
  nextSteps: /^(next\s*steps?|actions?|action\s*items?|recommendations?|strategic\s*recommendations?|implementation(\s*priority)?)\b/i,
};

// Parse Claude's response into { summaryText, discussionQuestions, nextSteps }.
// Tolerant by design: any heading level, any bullet style, and — critically —
// prose that appears before the first recognised heading is treated as the
// summary rather than discarded.
//
// `options.customShape` says the prompt declared its own headings (see
// personas.js). None of the canonical Summary/Discussion/Next Steps headings
// are expected in that case, so "no Summary section" is normal rather than a
// parse failure, and the whole document — headings and all — becomes the
// summary. `markdownResponse` is the primary render path in GameHostPage and
// the report, so a custom shape displays exactly as written either way; this
// only makes sure the structured fallback fields are never empty.
const parseAIResponse = (aiResponse, options = {}) => {
  const raw = String(aiResponse || '');
  const customShape = options.customShape === true;
  console.log('🔍 PARSING: Full AI response length:', raw.length);
  console.log('🔍 PARSING: First 300 chars:', raw.substring(0, 300));
  if (customShape) console.log('🔍 PARSING: prompt declares its own output shape');

  const lines = raw.split('\n');
  // Lines with a leading document title (an H1 that is not a section) removed —
  // the shape that broke game 7971, and the one thing we strip in either mode.
  const bodyLines = [];

  // Walk the document once, splitting it at every heading. `preamble` collects
  // body text that appears before any heading — the case that used to be thrown
  // away, leaving the panel with a single sentence.
  const sections = []; // { kind: 'summary'|'discussion'|'nextSteps'|null, title, body[] }
  const preamble = [];
  let current = null;
  let sawHeading = false;

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s*(.+?)\s*#*\s*$/);
    if (heading) {
      const title = heading[2].replace(/[*_`]/g, '').trim();
      // A lone H1 at the top is a document title ("# Strategic Engagement
      // Summary"), not a section — skip it rather than let it swallow the body.
      const isTitleOnly = !sawHeading && heading[1] === '#' && !Object.values(SECTION_SYNONYMS).some((re) => re.test(title));
      sawHeading = true;
      if (isTitleOnly) { current = null; continue; }
      bodyLines.push(line);

      let kind = null;
      for (const [k, re] of Object.entries(SECTION_SYNONYMS)) {
        if (re.test(title)) { kind = k; break; }
      }
      current = { kind, title, body: [] };
      sections.push(current);
      continue;
    }
    (current ? current.body : preamble).push(line);
    bodyLines.push(line);
  }

  const bodyOf = (kind) => {
    const found = sections.filter((s) => s.kind === kind);
    return found.length ? found.map((s) => s.body.join('\n')).join('\n').trim() : '';
  };

  let summaryText = bodyOf('summary');
  const discussionQuestions = extractListItems(bodyOf('discussion'), 5);
  const nextSteps = extractListItems(bodyOf('nextSteps'), 5);

  if (customShape) {
    // The prompt owns the shape, so there is no "summary section" to isolate —
    // the whole reply IS the summary. Keep its headings: this string is what a
    // report or a markdown-less client renders, and stripping them would run
    // five distinct sections together into one wall of prose.
    const body = bodyLines.join('\n').trim();
    summaryText = body || raw.trim();
  } else {
    // Summary fallback. Previously this took the first line over 20 chars, which
    // is what made summaries "thin" whenever the model titled its own sections.
    // Prefer, in order: prose before the first heading, then any unrecognised
    // section's body, then the whole response.
    if (summaryText.length < 40) {
      const preambleText = preamble.join('\n').trim();
      const unlabelled = sections.filter((s) => s.kind === null).map((s) => s.body.join('\n').trim()).filter(Boolean);
      const candidate = [preambleText, ...unlabelled].find((t) => t && t.length >= 40);
      if (candidate) {
        console.log('⚠️ PARSING: no Summary heading — using leading prose instead');
        summaryText = candidate;
      } else if (!summaryText) {
        summaryText = raw.trim();
      }
    }

    // Strip any stray heading lines that survived inside the summary body.
    summaryText = summaryText.split('\n').filter((l) => !/^\s{0,3}#{1,6}\s/.test(l)).join('\n').trim();
  }

  console.log(`🔍 PARSING: summary ${summaryText.length} chars, ${discussionQuestions.length} questions, ${nextSteps.length} next steps`);

  return {
    summaryText,
    discussionQuestions,
    nextSteps,
    // Always keep the model's own markdown so the panel can render the full
    // response even when the structured fields are sparse.
    markdownResponse: raw,
  };
};

// Exported for tests/ai-response-parsing.js
exports.parseAIResponse = parseAIResponse;

// Fetch AI prompt from S3
const fetchPromptFromS3 = async (promptId) => {
  try {
    console.log(`📄 Fetching prompt ${promptId} from S3...`);
    
    // First get the prompt record from DynamoDB to get the correct S3 key
    const dbResult = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` }
    }));
    
    if (!dbResult.Item) {
      console.error(`❌ Prompt ${promptId} not found in DynamoDB`);
      return null;
    }
    
    const promptRecord = dbResult.Item;
    const s3Key = promptRecord.s3Key;
    
    if (!s3Key) {
      console.error(`❌ No S3 key found in prompt record for ${promptId}`);
      return null;
    }
    
    console.log(`📄 Using S3 Key from DB record: ${s3Key}`);
    
    const response = await s3.send(new GetObjectCommand({
      Bucket: process.env.AI_PROMPTS_BUCKET,
      Key: s3Key
    }));
    
    const promptData = JSON.parse(await response.Body.transformToString());
    console.log(`✅ Successfully fetched prompt: ${promptData.name || 'Unknown'}`);
    
    return promptData;
  } catch (error) {
    console.error(`❌ Error fetching prompt ${promptId}:`, error);
    
    // Try to get the DynamoDB record as final fallback
    try {
      const dbResult = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` }
      }));
      
      if (dbResult.Item) {
        console.log(`✅ Using DynamoDB record as fallback for prompt ${promptId}`);
        return dbResult.Item;
      }
    } catch (dbError) {
      console.error(`❌ DynamoDB fallback also failed:`, dbError);
    }
    
    // Final fallback: use the original hardcoded prompt for 'lessons-learned'
    if (promptId === 'lessons-learned') {
      console.log(`📄 Using hardcoded fallback for lessons-learned prompt`);
      return {
        id: 'lessons-learned',
        name: 'Lessons Learned - Strategic Insights',
        category: 'callandanswer',
        template: `You are reading back one round of {sessionContext} to the room that just played it. You are speaking, not writing a report.

The team wrote answers and then ranked them, and the ranking is their collective judgement. Your job is to say what they chose, why that choice is interesting, and what somebody should do about it.

RULES.
1. Every claim comes from the material at the end. If it is not there, do not say it.
2. Do not use a number you cannot copy from that material. Never write a percentage, a fraction or a share of the team.
3. Ground every insight in a specific response and quote its words. Do not paraphrase a response into strategy language until it says nothing.
4. If the top responses pull in different directions, name the trade-off and leave it open rather than merging them.
5. Keep it short. This is read aloud to the people who wrote the responses.

What belongs in each section:
- The summary section: two or three sentences on the themes running through the top-ranked responses, why the team prioritised those, and what that reveals about how this team thinks.
- The discussion section: two or three questions — why the team chose this direction, what tension a comparison of the top responses exposes, and what the next level of thinking looks like. Each one names the response it comes from.
- The next-steps section: three or four concrete actions. Build the first on the top-ranked response, integrate the others after it, and make the last one a way to tell whether any of it worked.

WHAT YOU HAVE BEEN GIVEN, and it is all you have:

- The question the team answered: {questionTitle}
- Its category: {questionCategory}
- Any framing the question author added: {questionDetail}
- How many people responded: {responseCount}
- What the vote put on top: {winnerInfo}
- How much the team agreed: {consensusLevel}
- How the leading responses split across first, second and third place: {votingBreakdown}
- Every response, ranked by the team's vote: {responsesText}
{contextSections}{contextInstructions}`,
        description: 'Strategic insights and actionable next steps based on team responses'
      };
    }
    
    return null;
  }
};

/**
 * Preferred category per game type, used as the first tie-break when more than
 * one prompt claims `isDefault`. One default per game type is now enforced on
 * write (admin/create-ai-prompt.js, admin/update-ai-prompt.js), but live data
 * predates that, so resolution here must still be DETERMINISTIC — the old code
 * ended with "for polls or other types, just take the first one", i.e. whatever
 * order DynamoDB happened to return, which could change between two runs of the
 * same game.
 */
const PREFERRED_DEFAULT_CATEGORY = {
  'call-and-answer': 'lessons-learned',
  trivia: 'general',
  poll: 'general',
  wavelength: 'general',
  survey: 'general',
};

// Find default prompt ID for a given game type
const findDefaultPromptId = async (gameType) => {
  const canonical = normalizeGameType(gameType);
  try {
    console.log(`🔍 Finding default prompt for game type: ${gameType} → ${canonical}`);

    // Rows exist under BOTH spellings (`callandanswer` from the analysis
    // manager, `call-and-answer` from the generation editor). Scan on PK alone
    // and match in JS so either spelling resolves.
    const scanResult = await db.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'PK = :pk AND isDefault = :isDefault',
      ExpressionAttributeValues: {
        ':pk': 'AIPROMPTS',
        ':isDefault': true
      }
    }));

    const candidates = (scanResult.Items || []).filter(item =>
      item.promptId && normalizeGameType(item.gameType) === canonical);

    if (candidates.length > 0) {
      if (candidates.length > 1) {
        console.warn(`⚠️ ${candidates.length} prompts claim isDefault for ${canonical} ` +
          `(${candidates.map(c => c.promptId).join(', ')}) — resolving deterministically. ` +
          `Run scripts/cull-ai-prompts.js to leave exactly one.`);
      }

      // Deterministic ordering: preferred category, then a usable summary shape,
      // then oldest-created, then promptId. Never "whatever came back first".
      const preferred = PREFERRED_DEFAULT_CATEGORY[canonical];
      const rank = (item) => [
        item.category === preferred ? 0 : 1,
        item.basePrompt ? 1 : 0,          // generation-shaped prompts rank last
        String(item.createdAt || '9999'),
        String(item.promptId),
      ];
      const sorted = [...candidates].sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        for (let i = 0; i < ra.length; i++) {
          if (ra[i] < rb[i]) return -1;
          if (ra[i] > rb[i]) return 1;
        }
        return 0;
      });

      const defaultPrompt = sorted[0];
      console.log(`✅ Found default prompt: ${defaultPrompt.promptId} (${defaultPrompt.name}) for ${canonical}`);
      return defaultPrompt.promptId;
    }

    // Final fallback - return a hardcoded default based on game type
    const fallbackPrompt = canonical === 'trivia' ? 'trivia-basic' : 'lessons-learned';
    console.log(`⚠️ No default prompt found for ${gameType}, using hardcoded fallback: ${fallbackPrompt}`);
    return fallbackPrompt;

  } catch (error) {
    console.error(`❌ Error finding default prompt for ${gameType}:`, error);
    const fallbackPrompt = canonical === 'trivia' ? 'trivia-basic' : 'lessons-learned';
    return fallbackPrompt; // Fallback
  }
};

// Exported for tests/ai-prompt-defaults.js
exports.findDefaultPromptId = findDefaultPromptId;

/**
 * Resolve a usable prompt template, recovering from a dangling promptId.
 *
 * A question set can reference a prompt that no longer exists — prompt deletion
 * doesn't clean up the sets pointing at it (see admin-prompt-cleanup-plan.md).
 * Before this, `promptId` present-but-unresolvable skipped Bedrock entirely and
 * the caller emitted the data-driven fallback, because the "find the game-type
 * default" path only ran when promptId was absent. A set with NO prompt worked
 * while a set with a BROKEN one silently lost its AI summary — the opposite of
 * what you'd want.
 *
 * Returns { promptId, promptData, recoveredFrom?, recoveryReason? } or null when
 * genuinely nothing resolves, so the caller can still use its data-driven
 * fallback.
 *
 * Two distinct failures both land in `recoveredFrom`, and telling them apart is
 * the whole point of `recoveryReason`:
 *
 *   'missing'  — the referenced prompt no longer exists (deleted, or expired
 *                under the old `ttl` stamp).
 *   'unusable' — the prompt EXISTS but is generation-shaped
 *                (basePrompt/contextTemplate, authored in
 *                AIGenerationPromptEditor) and the summary engine cannot run
 *                it. This is the "I added an Art prompt and nothing changed"
 *                report: the fallback fired silently and looked like a no-op.
 */
const resolvePromptTemplate = async (promptId, gameType) => {
  let recoveryReason;
  let unusableDefect;

  if (promptId) {
    const promptData = await fetchPromptFromS3(promptId);
    if (isUsableSummaryPrompt(promptData)) return { promptId, promptData };

    if (!promptData) {
      recoveryReason = 'missing';
      console.warn(`⚠️ Prompt ${promptId} is referenced but could not be loaded — falling back to the ${gameType} default`);
    } else {
      recoveryReason = 'unusable';
      unusableDefect = summaryPromptDefect(promptData);
      console.error(
        `❌ Prompt ${promptId} ("${promptData.name || 'unnamed'}") EXISTS but cannot drive a summary: ` +
        `${summaryPromptDefect(promptData)}. Fields present: ${Object.keys(promptData).join(', ')}. ` +
        `Falling back to the ${gameType} default — the attached prompt is having NO effect.`
      );
    }
  }

  const defaultId = await findDefaultPromptId(gameType);
  if (defaultId && defaultId !== promptId) {
    const promptData = await fetchPromptFromS3(defaultId);
    if (isUsableSummaryPrompt(promptData)) {
      return promptId
        ? { promptId: defaultId, promptData, recoveredFrom: promptId, recoveryReason, unusableDefect }
        : { promptId: defaultId, promptData };
    }
  }

  console.error(`❌ No usable prompt template for gameType=${gameType} (tried ${promptId || 'none'}, default ${defaultId})`);
  return null;
};

// Exported for tests/ai-prompt-resolution.js
exports.resolvePromptTemplate = resolvePromptTemplate;
// Exported so admin surfaces can grey out prompts that cannot serve as summary
// prompts, instead of letting someone attach one and watch nothing happen.
exports.isUsableSummaryPrompt = isUsableSummaryPrompt;
exports.summaryPromptDefect = summaryPromptDefect;

exports.handler = async (event) => {
  // Async worker mode: the HTTP path fires an InvocationType:'Event' self-invoke
  // with __workerMode set, so the full generation runs off the API Gateway 30s
  // ceiling. In worker mode we skip the cache/HTTP-return branches, generate,
  // persist, and broadcast the result over WebSocket.
  const workerMode = event.__workerMode === true;
  try {
    let gameId, questionId, generateNew, debug, promptDebug;
    if (workerMode) {
      ({ gameId, questionId, debug, promptDebug } = event); // questionId === targetQuestionId
      generateNew = 'true';
      console.log(`🛠️ AI SUMMARY WORKER: generating for game ${gameId}, question ${questionId}`);
    } else {
      ({ gameId } = event.pathParameters || {});
      const queryParams = event.queryStringParameters || {};
      ({ questionId, generateNew, debug, promptDebug } = queryParams);
    }

    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🤖 Getting AI summary for game ${gameId}, questionId: ${questionId || 'current'}`);

    // Get game state first
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    if (!gameState.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    let targetQuestionId = questionId;
    
    // If no specific question ID provided, get current question from game state
    if (!targetQuestionId) {
      targetQuestionId = gameState.Item.CurrentQuestionId;
      
      if (!targetQuestionId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'No current question',
            message: 'No question is currently active'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    // Extract the question number from questionId (e.g., "002" from questionId or from current state)
    let paddedQuestionNumber = targetQuestionId;
    
    // If questionId looks like a sequential number, use it directly
    if (/^\d{3}$/.test(targetQuestionId)) {
      paddedQuestionNumber = targetQuestionId;
    } else {
      // Try to extract from current state if it's in RESULTS#002 format
      const currentState = gameState.Item.State;
      if (currentState && currentState.includes('#')) {
        const stateMatch = currentState.match(/#(\d+)/);
        if (stateMatch) {
          paddedQuestionNumber = stateMatch[1];
        }
      }
    }
    
    console.log(`🔍 Using question number ${paddedQuestionNumber} for lookups`);
    
    // Check if AI summary already exists (unless generateNew is true)
    if (!generateNew) {
      const existingSummary = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { 
          PK: `GAME#${gameId}`, 
          SK: `QUESTION#${paddedQuestionNumber}#AISummary` 
        }
      }));

      if (existingSummary.Item) {
        console.log(`✅ Returning existing AI summary for ${gameId}: ${targetQuestionId}`);

        // THE CACHED READ IS A READ, and it is the one most likely to be
        // forgotten: it returns before the handler touches game metadata for
        // any other reason, so it needs its own org lookup. `DebugInfo` in
        // particular carries the FULL PROMPT, which embeds every participant's
        // answer verbatim — the most content-dense attribute in the table.
        const summaryOrgId = await sessionOrgId(gameId);
        const cached = summaryOrgId
          ? await decryptItem(summaryOrgId, 'aiSummary', existingSummary.Item)
          : existingSummary.Item;
        existingSummary.Item = cached;

        const responseData = {
          gameId: gameId,
          questionId: targetQuestionId,
          summary: existingSummary.Item.Summary || existingSummary.Item.SummaryText,
          summaryText: existingSummary.Item.SummaryText || existingSummary.Item.Summary,
          discussionQuestions: existingSummary.Item.DiscussionQuestions || [],
          nextSteps: existingSummary.Item.NextSteps || [],
          markdownResponse: existingSummary.Item.MarkdownResponse || null,
          personaName: existingSummary.Item.PersonaName || null,
          personaSource: existingSummary.Item.PersonaSource || null,
          generatedAt: existingSummary.Item.GeneratedAt,
          fromCache: true
        };
        
        // Add debug information if debug mode is enabled
        if (debug === 'true' && existingSummary.Item.DebugInfo) {
          responseData.debugPrompt = existingSummary.Item.DebugInfo.fullPrompt || 'Debug info not available';
          responseData.debugProvenance = existingSummary.Item.DebugInfo.promptProvenance || null;
        }
        
        // Add prompt debug information if prompt debug mode is enabled
        if (promptDebug === 'true' && existingSummary.Item.DebugInfo) {
          responseData.templateVariables = existingSummary.Item.DebugInfo.templateVariables || {};
          responseData.promptTemplate = existingSummary.Item.DebugInfo.promptTemplate || '';
          responseData.promptName = existingSummary.Item.DebugInfo.promptName || '';
          responseData.promptSource = existingSummary.Item.DebugInfo.promptSource || '';
        }
        
        return {
          statusCode: 200,
          body: JSON.stringify(responseData),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    // ===== HTTP dispatcher (never generates inline) =====
    // The HTTP path must return fast — generation happens only in the worker.
    if (!workerMode) {
      if (!generateNew) {
        // Cache miss (non-generateNew, no item): tell the client it's not ready
        // yet. The client already treats 404 as "not ready" and will fire generateNew.
        console.log(`ℹ️ AI SUMMARY: cache miss for ${gameId}:${paddedQuestionNumber} — returning 404 (not generating inline)`);
        return {
          statusCode: 404,
          body: JSON.stringify({ status: 'not_ready', gameId, questionId: targetQuestionId }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      // generateNew=true: fire-and-forget self-invoke, return 202 immediately.
      console.log(`🚀 AI SUMMARY: dispatching async generation worker for ${gameId}:${targetQuestionId}`);
      await lambda.send(new InvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME, // auto-set by Lambda runtime
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          __workerMode: true,
          gameId,
          questionId: targetQuestionId,
          paddedQuestionNumber,
          debug,
          promptDebug
        }))
      }));
      return {
        statusCode: 202,
        body: JSON.stringify({ status: 'generating', gameId, questionId: targetQuestionId }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game metadata for AI context and scoring configuration
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Extract scoring configuration and game type early since they're used in vote processing
    const gameType = gameMetadata.Item.GameType || 'call-and-answer';
    const scoringConfig = gameMetadata.Item.ScoringConfig || {
      firstPlacePoints: 3,
      secondPlacePoints: 2,
      thirdPlacePoints: 1,
      participationPoints: 0
    };

    console.log(`🔍 DEBUG: Getting question for AI Summary - gameId: ${gameId}, paddedQuestionNumber: ${paddedQuestionNumber}`);
    
    // Use the same question retrieval logic as get-results.js
    let question = null;
    let questionSetId = null;
    let questionSetVersion = null;
    try {
      // Get question reference record (same as get-results.js)
      const questionRef = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${paddedQuestionNumber}#REF` }
      }));
      
      if (questionRef.Item) {
        const sourceQuestionId = questionRef.Item.SourceQuestionId;
        questionSetId = questionRef.Item.SetId;
        
        console.log(`📋 Found question reference: ${sourceQuestionId} from set ${questionSetId}`);
        
        // Read the VERSION this round was served from (the REF row records it),
        // falling through to activeVersion and then the legacy partition.
        // AnswerDetails — the reveal — lives on the question row, so reading the
        // wrong version would narrate the wrong answer at RESULTS.
        questionSetVersion = questionRef.Item.SetVersion;
        const resolvedSet = await resolveSetPartition(
          db, process.env.TABLE_NAME, questionSetId, questionSetVersion
        );

        // Get the actual question from the question set (same as get-results.js)
        const questionResponse = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: {
            PK: resolvedSet.pk,
            SK: sourceQuestionId
          }
        }));
        question = questionResponse.Item;
        console.log(`📋 Question data fetched from question set:`, question ? 'Success' : 'Not found');
      } else {
        console.log(`❌ Question reference not found: QUESTION#${paddedQuestionNumber}#REF`);
      }
    } catch (error) {
      console.error(`❌ Error fetching question data:`, error);
    }
    
    console.log(`📋 Question query result:`, question ? 'Found' : 'Not found');
    if (question) {
      console.log('🔍 RAW QUESTION DATA FIELDS:', Object.keys(question));
      console.log('🔍 RAW QUESTION DATA SAMPLE:', {
        correctAnswer: question.correctAnswer,
        CorrectAnswer: question.CorrectAnswer,
        optionA: question.optionA,
        OptionA: question.OptionA,
        answerDetails: question.answerDetails,
        AnswerDetails: question.AnswerDetails
      });
    }

    // If question not found in set, create a fallback question object
    if (!question) {
      console.log(`⚠️ Question not found, using fallback`);
      question = {
        title: `Question ${paddedQuestionNumber}`,
        questionDetail: 'Question details not available',
        category: 'General',
        Title: `Question ${paddedQuestionNumber}`,
        Detail: 'Question details not available',
        Category: 'General'
      };
    }
    
    // Use questionSetId from game metadata as fallback if not found in reference
    if (!questionSetId) {
      questionSetId = gameMetadata.Item.QuestionSetId;
      console.log(`📋 Using fallback questionSetId from game metadata: ${questionSetId}`);
    }
    
    // Normalize field names for consistency (trivia uses lowercase, others use titlecase)
    if (question) {
      question.title = question.title || question.Title;
      question.questionDetail = question.questionDetail || question.Detail || question.detail;
      question.category = question.category || question.Category;
      
      // Normalize trivia-specific fields
      question.correctAnswer = question.correctAnswer || question.CorrectAnswer;
      question.correctAnswers = question.correctAnswers || question.CorrectAnswers;
      question.optionA = question.optionA || question.OptionA;
      question.optionB = question.optionB || question.OptionB;
      question.optionC = question.optionC || question.OptionC;
      question.optionD = question.optionD || question.OptionD;
      question.optionE = question.optionE || question.OptionE;
      question.optionF = question.optionF || question.OptionF;
      question.answerDetails = question.answerDetails || question.AnswerDetails;
      
      console.log('🔧 AFTER NORMALIZATION:');
      console.log('  question.correctAnswer:', question.correctAnswer);
      console.log('  question.optionA:', question.optionA);
      console.log('  question.optionB:', question.optionB);
    }

    // Use the sequential question number for answers lookup (already calculated above)
    
    // Get answers for this question using sequential question number
    const answersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionNumber}#ANSWER#`
      }
    }));

    // Get vote tallies for results calculation (using same logic as get-results.js)
    const votesQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionNumber}#VOTE#`
      }
    }));

    // ── PLAINTEXT INTO THE PROMPT ────────────────────────────────────────────
    //
    // Everything below feeds a Bedrock prompt built from the room's own words,
    // so an envelope here does not fail loudly — it produces a summary of
    // base64. The org is the SESSION's, read off the metadata row above (this
    // route is public; see sessionOrgId).
    const summaryOrgId = orgOf(gameMetadata.Item);
    const votes = summaryOrgId
      ? await decryptItems(summaryOrgId, 'vote', votesQuery.Items || [])
      : (votesQuery.Items || []);
    const answers = summaryOrgId
      ? await decryptItems(summaryOrgId, 'answer', answersQuery.Items || [])
      : (answersQuery.Items || []);
    
    // Get stored results data if available (contains wavelength commonWords)
    const storedResultsQuery = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { 
        PK: `GAME#${gameId}`, 
        SK: `QUESTION#${paddedQuestionNumber}#RESULTS` 
      }
    }));
    
    const storedResults = storedResultsQuery.Item || null;
    console.log(`📊 Found ${answers.length} answers, ${votes.length} votes, stored results: ${storedResults ? 'YES' : 'NO'} for question ${paddedQuestionNumber}`);
    
    if (answers.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No answers found for this question.' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Calculate vote tallies (using exact same logic as get-results.js)
    const voteTallies = {};
    const answerScores = {};

    // Initialize scores for each answer (by index, matching get-results.js)
    answers.forEach((answer, index) => {
      answerScores[index] = 0;
      voteTallies[index] = {
        answerText: answer.Answer,
        playerName: answer.PlayerName,
        firstPlace: 0,
        secondPlace: 0,
        thirdPlace: 0,
        totalScore: 0
      };
    });

    // Process each vote (exact logic from get-results.js) - skip for trivia and wavelength games
    if (votes && votes.length > 0 && gameType !== 'trivia' && gameType !== 'wavelength') {
      votes.forEach(vote => {
        const voteData = vote.Votes; // e.g., {"0": 1, "1": 2, "2": 3}
        
        Object.entries(voteData).forEach(([answerIndex, rank]) => {
          const idx = parseInt(answerIndex);
          const position = parseInt(rank);
          
          if (voteTallies[idx]) {
            // Award points using configurable scoring system
            let points = 0;
            if (position === 1) {
              voteTallies[idx].firstPlace++;
              points = scoringConfig.firstPlacePoints;
            } else if (position === 2) {
              voteTallies[idx].secondPlace++;
              points = scoringConfig.secondPlacePoints;
            } else if (position === 3) {
              voteTallies[idx].thirdPlace++;
              points = scoringConfig.thirdPlacePoints;
            }
            
            voteTallies[idx].totalScore += points;
            answerScores[idx] += points;
          }
        });
      });
    } else if (gameType === 'trivia') {
      // For trivia games, use actual points earned by players (from get-results.js trivia processing)
      answers.forEach((answer, index) => {
        // Use actual points earned from the answer record
        const pointsEarned = answer.PointsEarned || answer.pointsEarned || 0;
        const isCorrect = answer.IsCorrect || answer.isCorrect || false;
        
        voteTallies[index].totalScore = pointsEarned;
        answerScores[index] = pointsEarned;
        voteTallies[index].isCorrect = isCorrect;
        voteTallies[index].basePoints = answer.BasePoints || answer.basePoints || 0;
        voteTallies[index].speedBonus = answer.SpeedBonus || answer.speedBonus || 0;
        voteTallies[index].responseTime = answer.ResponseTimeMs || answer.responseTimeMs || 0;
        
        console.log(`🔍 AI TRIVIA DEBUG - Player ${voteTallies[index].playerName}: points=${pointsEarned}, correct=${isCorrect}, base=${voteTallies[index].basePoints}, bonus=${voteTallies[index].speedBonus}`);
      });
    } else if (gameType === 'wavelength') {
      // For wavelength games, everyone gets the same team score (number of
      // common words found).
      //
      // This line used to read a bare `commonWords`, which is declared nowhere
      // in this handler — only inside generateAISummary, a separate function
      // with no closure over it. Reading an undeclared identifier is a
      // ReferenceError, so EVERY wavelength round that reached this branch
      // crashed the summary (500 on the HTTP path, a rethrow-and-retry loop in
      // worker mode). Nothing here ever computed the word analysis, so the
      // only place the count can honestly come from is the stored
      // QUESTION#nnn#RESULTS record fetched above.
      //
      // When that record is absent or carries no word analysis the count is
      // genuinely unknown at this point: the team score falls back to 0 (the
      // same value the original expression's own `: 0` branch produced) and
      // says so in the log rather than inventing a figure. The prompt's
      // wavelength variables are unaffected — generateAISummary recomputes the
      // word analysis from the answers for itself further down.
      const storedCommonWords = storedResults && storedResults.wordAnalysis
        ? storedResults.wordAnalysis.commonWords
        : null;
      const teamScore = Array.isArray(storedCommonWords) ? storedCommonWords.length : 0;
      if (!Array.isArray(storedCommonWords)) {
        console.warn(
          `⚠️ WAVELENGTH: no stored word analysis at QUESTION#${paddedQuestionNumber}#RESULTS — ` +
          `team score reported as 0 rather than guessed`
        );
      }

      answers.forEach((answer, index) => {
        voteTallies[index].totalScore = teamScore;
        voteTallies[index].teamScore = teamScore;
        voteTallies[index].wordsSubmitted = (answer.Answer || answer.answer || '').split(',').filter(w => w.trim()).length;
        answerScores[index] = teamScore;
        
        console.log(`🌊 AI WAVELENGTH DEBUG - Player ${voteTallies[index].playerName}: team score=${teamScore}, words submitted=${voteTallies[index].wordsSubmitted}`);
      });
    }

    // Find winners (highest score) - using same logic as get-results.js
    const maxScore = Math.max(...Object.values(answerScores));
    const winners = [];
    
    Object.entries(answerScores).forEach(([index, score]) => {
      if (score === maxScore && voteTallies[index]) {
        winners.push({
          playerName: voteTallies[index].playerName,
          answerText: voteTallies[index].answerText,
          score: score
        });
      }
    });

    const results = {
      voteTallies: voteTallies,
      winners: winners,
      totalVotes: votes ? votes.length : 0,
      maxScore: maxScore
    };

    const metadata = gameMetadata.Item;

    // Whether this round's answers may be attributed. Loaded once, here,
    // and threaded through to generateAISummary — both the deterministic
    // fallback template AND the model prompt itself must not name an
    // unrevealed author, and the round record is what settles that (per
    // round, not per game — a host may reveal round 1 and still be mid-round
    // on round 2).
    const roundRecord = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `ROUND#${paddedQuestionNumber}` }
    }));
    const hidden = isHidden(metadata, roundRecord.Item);

    // Fetch question set details for AI context and custom instructions
    let customInstruction = null;
    let questionSetAiContext = null;
    let setPersonaId = null;
    let promptId = null;
    let promptProvenance = {
      source: 'fallback',
      details: 'Using hardcoded fallback prompt',
      hierarchy: []
    };
    
    if (questionSetId) {
      try {
        const setResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: sessionSetKey(metadata, questionSetId),
        }));
        
        if (setResult.Item) {
          if (setResult.Item.customInstruction) {
            customInstruction = setResult.Item.customInstruction;
            console.log('📋 Found custom instruction for AI prompt:', customInstruction);
            promptProvenance.hierarchy.push({
              type: 'customInstruction',
              source: 'question_set',
              value: customInstruction
            });
          }
          if (setResult.Item.aiContextInstruction) {
            questionSetAiContext = setResult.Item.aiContextInstruction;
            console.log('🎯 Found question set AI context:', questionSetAiContext);
            promptProvenance.hierarchy.push({
              type: 'aiContext',
              source: 'question_set',
              value: questionSetAiContext
            });
          }
          if (setResult.Item.personaId) {
            setPersonaId = setResult.Item.personaId;
            console.log('🎭 Found question set persona:', setPersonaId);
          }
          if (setResult.Item.promptId) {
            promptId = setResult.Item.promptId;
            console.log('🎨 Found custom prompt ID:', promptId);
            promptProvenance = {
              source: 'question_set',
              details: `Custom prompt "${promptId}" attached to question set "${setResult.Item.SetName || questionSetId}"`,
              promptId: promptId,
              promptName: setResult.Item.promptName || promptId,
              hierarchy: promptProvenance.hierarchy
            };
          }
        }
      } catch (fetchError) {
        console.log('⚠️ Could not fetch question set context:', fetchError.message);
      }
    }
    
    // Default prompt ID if none specified - find default prompt for the game type
    if (!promptId) {
      promptId = await findDefaultPromptId(metadata.GameType || 'call-and-answer');
      console.log(`📌 Using default prompt ID: ${promptId}`);
      
      // Check if this is a default for the category or just the game type
      try {
        const defaultPromptInfo = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` }
        }));
        
        if (defaultPromptInfo.Item) {
          const hasCategory = defaultPromptInfo.Item.category && defaultPromptInfo.Item.category !== metadata.GameType;
          promptProvenance = {
            source: hasCategory ? 'default_category' : 'default_game_type',
            details: hasCategory 
              ? `Default prompt for ${metadata.GameType} games with "${defaultPromptInfo.Item.category}" category`
              : `Default prompt for ${metadata.GameType} games`,
            promptId: promptId,
            promptName: defaultPromptInfo.Item.name || promptId,
            gameType: metadata.GameType,
            category: defaultPromptInfo.Item.category,
            hierarchy: promptProvenance.hierarchy
          };
        }
      } catch (error) {
        console.log('⚠️ Could not fetch default prompt info:', error.message);
        promptProvenance = {
          source: 'default_game_type',
          details: `Default prompt for ${metadata.GameType} games (details unavailable)`,
          promptId: promptId,
          gameType: metadata.GameType,
          hierarchy: promptProvenance.hierarchy
        };
      }
    }

    // Prepare data for AI
    const aiData = {
      // The scoped key for this session's set, resolved once here where the
      // session row is in scope. generateAISummary reads the same row again for
      // the report context and cannot derive it — it is handed `gameId` and a
      // set id, neither of which says which library.
      setKey: sessionSetKey(metadata, questionSetId),
      eventTitle: metadata.EventTitle || metadata.Title || 'Engagement Event',
      gameType: metadata.GameType || 'call-and-answer',
      /*
        TWO FIELDS, TWO SLOTS. This read was `AIContext || EngagementInfo` —
        one slot, so a host who filled in the AI instructions ERASED their own
        event details from the prompt. Half of the reported "none of these
        seem to contribute"; the other half was the persona chain discarding
        both (see personas.js).
      */
      gameAiContext: metadata.AIContext || '',
      eventDetails: metadata.EngagementInfo || metadata.Details || '',
      questionSetAiContext: questionSetAiContext,
      customInstruction: customInstruction,
      promptId: promptId,
      // Voice selection. The host pick lives on the game so a mid-game switch
      // takes effect from the next question; the set-level one is authored once.
      hostPersonaId: metadata.PersonaId || metadata.personaId || null,
      setPersonaId: setPersonaId,
      promptProvenance: promptProvenance,
      debugMode: debug === 'true',
      questionId: targetQuestionId,
      question: question, // Pass the normalized question object with all fields
      answers: answers.map(answer => ({
        playerName: answer.PlayerName,
        answer: answer.Answer
      })),
      results: {
        voteTallies: results.voteTallies,
        winners: results.winners,
        totalVotes: results.totalVotes,
        // maxScore is NOT optional. This literal is the only thing
        // generateAISummary ever sees as `results`, and consensusLabel reads
        // maxScore off it to decide whether anybody voted at all. Omitting it
        // made every round — including a round where one answer took 21 of 48
        // points — report "No votes cast - nothing was ranked" into the live
        // prompt. Before that it silently killed the 'Strong consensus' branch,
        // because `score > (undefined * 0.8)` is `score > NaN`, which is false.
        maxScore: results.maxScore
      },
      votes: votes || [],
      gameId: gameId,
      questionSetId: questionSetId,
      paddedQuestionNumber: paddedQuestionNumber,
      scoringConfig: scoringConfig,
      hidden: hidden,
      // Fixes a latent bug found while covering this task's wavelength fix:
      // generateAISummary's wavelength branch already read `storedResults`
      // (line ~1830 below) without it ever being passed in — a plain
      // ReferenceError on every wavelength game that reaches that branch,
      // unrelated to anonymity. Wiring it through is the minimum needed to
      // make that branch (and this task's redaction inside it) reachable at
      // all, let alone testable.
      storedResults: storedResults
    };

    // Generate AI summary
    const summaryData = await generateAISummary(aiData);

    // generateAISummary returns an HTTP-shaped error object when the prompt
    // template is unavailable. Don't persist/broadcast that as a real summary.
    if (summaryData && summaryData.statusCode) {
      if (workerMode) {
        throw new Error('AI prompt template not available');
      }
      return {
        ...summaryData,
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Store the enhanced AI summary in DynamoDB (keeping same storage key)
    const now = new Date().toISOString();
    const dbItem = {
      PK: `GAME#${gameId}`,
      SK: `QUESTION#${paddedQuestionNumber}#AISummary`,
      GameId: gameId,
      QuestionId: targetQuestionId,
      Summary: summaryData.summary, // For backwards compatibility
      SummaryText: summaryData.summaryText,
      DiscussionQuestions: summaryData.discussionQuestions,
      NextSteps: summaryData.nextSteps,
      FullResponse: summaryData.fullResponse,
      MarkdownResponse: summaryData.markdownResponse,
      // Voice attribution. `PersonaName` is the display field the report reads;
      // it is null when no named persona won (free-text context, or the
      // adaptive inferred default). `PersonaSource` records which precedence
      // level supplied the voice.
      PersonaName: summaryData.personaName || null,
      PersonaId: summaryData.personaId || null,
      PersonaSource: summaryData.personaSource || null,
      GeneratedAt: now,
      ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
    };
    
    // Store debug information if available
    if (summaryData.debugInfo) {
      dbItem.DebugInfo = summaryData.debugInfo;
    }
    
    // ── THE SUMMARY GOES BACK IN ENCRYPTED ───────────────────────────────────
    //
    // Summary/SummaryText/DiscussionQuestions/NextSteps/FullResponse/
    // MarkdownResponse are the AI's account of what the room said, and
    // `DebugInfo` embeds the participants' answers verbatim inside the prompt.
    // PersonaName/PersonaId/PersonaSource stay plaintext: they are platform
    // configuration, not content, and a report reads them as labels.
    //
    // Same session org as the reads above, so the cached-read branch at the top
    // of this handler unwraps exactly what this wrote.
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: summaryOrgId ? await encryptItem(summaryOrgId, 'aiSummary', dbItem) : dbItem
    }));

    console.log(`✅ Enhanced AI summary generated and stored for ${gameId}: ${targetQuestionId}`);

    // Worker mode: notify all clients over WebSocket that the summary is ready.
    // Broadcast the legacy-shaped { type: 'aiSummaryReady' } — the client handlers
    // register under message.type, so do NOT wrap it as a hostMessage.
    if (workerMode) {
      await broadcastToGame(gameId, { type: 'aiSummaryReady', gameId, questionId: targetQuestionId });
      return { ok: true, gameId, questionId: targetQuestionId };
    }

    const responseData = {
      gameId: gameId,
      questionId: targetQuestionId,
      summary: summaryData.summary,
      summaryText: summaryData.summaryText,
      discussionQuestions: summaryData.discussionQuestions,
      nextSteps: summaryData.nextSteps,
      markdownResponse: summaryData.markdownResponse,
      personaName: summaryData.personaName || null,
      personaSource: summaryData.personaSource || null,
      generatedAt: now,
      fromCache: false
    };
    
    // Add debug information if debug mode is enabled
    if (debug === 'true' && summaryData.debugInfo) {
      responseData.debugPrompt = summaryData.debugInfo.fullPrompt;
      responseData.debugProvenance = summaryData.debugInfo.promptProvenance;
    }
    
    // Add prompt debug information if prompt debug mode is enabled
    if (promptDebug === 'true' && summaryData.debugInfo) {
      responseData.templateVariables = summaryData.debugInfo.templateVariables || {};
      responseData.promptTemplate = summaryData.debugInfo.promptTemplate || '';
      responseData.promptName = summaryData.debugInfo.promptName || '';
      responseData.promptSource = summaryData.debugInfo.promptSource || '';
    }

    return {
      statusCode: 200,
      body: JSON.stringify(responseData),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get AI summary error:', error);
    // Worker mode: tell clients generation failed so the spinner can't hang, then
    // rethrow so the Event invoke's automatic retries kick in (the Put is an
    // idempotent overwrite, so retries are safe).
    if (workerMode) {
      const failedQuestionId = event.questionId;
      await broadcastToGame(event.gameId, {
        type: 'aiSummaryError',
        gameId: event.gameId,
        questionId: failedQuestionId,
        message: error.message
      }).catch(() => {});
      throw error;
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to generate AI summary: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

/**
 * The deterministic fallback summary.
 *
 * Exported so the anonymity branch can be tested without invoking Bedrock. This
 * template — not the model — is what named and quoted the top contributor on
 * every single round before anonymity existed.
 *
 * `hidden` must fall back to an unattributed form. The Field Notes beat is
 * ordered after the reveal, so in the normal flow attribution is already
 * public by the time this renders — but a host may press Next Round without
 * ever revealing, and the promise made to the room has to survive that.
 */
function buildFallbackSummary({ totalParticipants, votesCast, top, gameType, question, hidden }) {
  const isTrivia = gameType === 'trivia';
  const qText = typeof question === 'string' ? question
    : (question && (question.title || question.Title || question.questionDetail || question.Detail)) || '';
  const parts = [`${totalParticipants} ${totalParticipants === 1 ? 'response was' : 'responses were'} submitted${qText ? ` on "${qText}"` : ''}.`];
  if (votesCast > 0) parts.push(`${votesCast} vote${votesCast === 1 ? '' : 's'} cast.`);

  if (top && top.answer) {
    const support = `earned the most support (${top.score} point${top.score === 1 ? '' : 's'}${top.votes ? `: ${top.votes}` : ''})`;
    if (hidden) {
      // No name, and no verbatim quote either — on a small round a distinctive
      // phrase identifies its author as surely as the name would.
      parts.push(`The most-supported response ${support}.`);
    } else if (top.playerName) {
      parts.push(`${top.playerName}'s answer${isTrivia ? '' : `, "${top.answer}",`} ${support}.`);
    }
  } else if (totalParticipants > 0) {
    parts.push('The group shared a range of perspectives.');
  }
  return parts.join(' ');
}

exports.buildFallbackSummary = buildFallbackSummary;

// Exported for the same reason as buildFallbackSummary: it lets the anonymity
// redaction inside this function (below) be exercised directly, without a full
// exports.handler round trip.
//
// It used to be the ONLY way to reach the wavelength branch at all: the outer
// handler's own vote-tally pass referenced a `commonWords` that was declared
// nowhere in its scope, so every wavelength round died there with a
// ReferenceError before generateAISummary was ever called. That is fixed (see
// the `gameType === 'wavelength'` branch above, and section 2 of
// tests/session-report-honesty.js, which drives it through exports.handler),
// so the direct call is now a convenience rather than a workaround.
exports.generateAISummary = generateAISummary;

async function generateAISummary({ setKey, eventTitle, gameType, gameAiContext, eventDetails, questionSetAiContext, customInstruction, promptId, promptProvenance, debugMode, questionId, question, answers, results, votes, gameId, questionSetId, paddedQuestionNumber, scoringConfig, hostPersonaId, setPersonaId, hidden, storedResults }) {
  // ANONYMITY: while hidden, nothing that ties this round's answer to its
  // author may reach the model — not just the deterministic fallback below.
  // The model's OWN generated summary is built from the template variables
  // this function assembles, so leaving real names in `answers` or
  // `results` would just let the LLM write "Ada's answer..." straight back
  // into the Field Notes panel.
  //
  // `answers` and `results.voteTallies`/`results.winners` are the two places
  // this round's authorship enters this function (both ultimately sourced
  // from the same ANSWER# records get-answers.js and start-vote.js already
  // redact for their own payloads). Swap the name for a placeholder in both,
  // once, here — the dozen prompt-section builders below then keep working
  // unmodified instead of each having to special-case anonymity.
  //
  // A flat, repeated placeholder (not a numbered "Participant 1",
  // "Participant 2", ...) is deliberate: a stable per-participant anonymous
  // identity is the stable-answerId feature, out of scope for this task —
  // this only has to stop the model being TOLD who wrote what. Substituting
  // rather than deleting the field also matters here, unlike the "omit, not
  // null" contract in anonymity.js's own redactAnswer(): these values feed
  // English prose (`"${a.playerName}'s answer..."`), where an omitted field
  // renders as the literal string "undefined", not a safely absent key.
  const AUTHOR_PLACEHOLDER = 'a participant';
  if (hidden) {
    answers = answers.map((a) => ({ ...a, playerName: AUTHOR_PLACEHOLDER, PlayerName: AUTHOR_PLACEHOLDER }));
    results = {
      ...results,
      voteTallies: Object.fromEntries(
        Object.entries(results.voteTallies || {}).map(([idx, data]) => [idx, { ...data, playerName: AUTHOR_PLACEHOLDER }])
      ),
      winners: (results.winners || []).map((w) => ({ ...w, playerName: AUTHOR_PLACEHOLDER })),
    };
  }

  // Prepare the context for AI
  const totalParticipants = answers.length;
  const winners = results.winners || [];
  const voteTallies = results.voteTallies || {};

  // Get top 3 answers based on vote tallies (by index like get-results.js)
  const sortedAnswers = Object.entries(voteTallies)
    .sort(([,a], [,b]) => b.totalScore - a.totalScore)
    .slice(0, 3);

  const topAnswers = sortedAnswers.map(([index, voteData]) => {
    return {
      playerName: voteData.playerName,
      answer: voteData.answerText,
      score: voteData.totalScore,
      votes: `${voteData.firstPlace} first, ${voteData.secondPlace} second, ${voteData.thirdPlace} third`
    };
  });

  // Data-driven fallback summary — reflects answer count, votes cast, and the
  // top-supported response. Used whenever the prompt template OR the model is
  // unavailable, so Workie never renders a blank summary.
  const buildFallback = () => {
    const votesCast = (results && results.totalVotes) || 0;
    const top = topAnswers[0];
    const summaryText = buildFallbackSummary({ totalParticipants, votesCast, top, gameType, question, hidden });
    // Same standard as buildFallbackSummary above: while hidden, no verbatim
    // quote either — a distinctive phrase can out an author on a small round
    // just as surely as a name would, and this renders into the same
    // markdownResponse under "### Discussion topics".
    const discussionQuestions = [
      'What stood out to you in the responses?',
      top && top.answer
        ? (hidden
            ? 'What made the most-supported response resonate with the group?'
            : `What made "${top.answer}" resonate with the group?`)
        : 'Where did the group agree or differ most?'
    ];
    const nextSteps = ['Pick one takeaway from this question to apply to your own work this week.'];
    const markdownResponse =
      `## ${eventTitle || 'Question'} — Summary\n\n${summaryText}\n\n` +
      `### Discussion topics\n${discussionQuestions.map(d => `- ${d}`).join('\n')}\n\n` +
      `### Next steps\n${nextSteps.map(s => `- ${s}`).join('\n')}`;
    return { summary: summaryText, summaryText, discussionQuestions, nextSteps, fullResponse: summaryText, markdownResponse, model: 'fallback' };
  };

  // Fetch the prompt template, recovering to the game-type default if the set
  // points at a prompt that has since been deleted.
  const resolved = await resolvePromptTemplate(promptId, gameType || 'call-and-answer');

  if (!resolved) {
    console.warn('⚠️ Prompt template unavailable — returning data-driven fallback summary');
    return buildFallback();
  }

  const promptData = resolved.promptData;
  if (resolved.recoveredFrom) {
    const why = resolved.recoveryReason === 'unusable'
      ? `exists but is not a usable summary prompt (${resolved.unusableDefect || 'wrong format — likely a generation prompt'})`
      : 'no longer exists';
    console.warn(`♻️ Recovered from prompt ${resolved.recoveredFrom} (${why}) → using default ${resolved.promptId}`);
    promptId = resolved.promptId;
    if (promptProvenance) {
      promptProvenance.recoveredFrom = resolved.recoveredFrom;
      promptProvenance.recoveryReason = resolved.recoveryReason || 'missing';
      // Say WHY in the debug panel. "Nothing changed" was previously
      // indistinguishable from "working as configured".
      promptProvenance.details = `${promptProvenance.details || ''} (referenced prompt "${resolved.recoveredFrom}" ${why}; used the ${gameType} default instead)`.trim();
    }
  }

  console.log(`📝 Using prompt template: ${promptData.name}`);

  // Decide whose voice Workie speaks in. Precedence and the fall-through
  // behaviour live in ./personas.js; a dangling or inactive personaId degrades
  // to the next level rather than dead-ending.
  const persona = await resolvePersona({
    hostPersonaId,
    setPersonaId,
    questionSetAiContext,
    gameAiContext,
    templateInstructions: promptData.instructions,
    loadPersona: async (personaId) => {
      const res = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'AIPROMPTS', SK: `PERSONA#${personaId}` },
      }));
      return res.Item || null;
    },
  });

  // Use custom instruction if available, otherwise default context
  const sessionContext = customInstruction ||
    'an "Engagements" strategic thinking session where participants apply lessons to their work context';
  
  // Build context sections for the AI prompt
  const contextSections = [];
  if (eventDetails) {
    contextSections.push(`ABOUT THIS SESSION: ${eventDetails}`);
  }
  if (gameAiContext) {
    contextSections.push(`SESSION BACKGROUND: ${gameAiContext}`);
  }
  if (questionSetAiContext) {
    contextSections.push(`QUESTION SET CONTEXT: ${questionSetAiContext}`);
  }
  if (customInstruction) {
    contextSections.push(`PARTICIPANT INSTRUCTIONS: "${customInstruction}"`);
  }

  // Create a more comprehensive answer list for the prompt
  console.log('🔍 DEBUG: AI Summary - answers structure:', answers.length > 0 ? answers[0] : 'No answers');
  console.log('🔍 DEBUG: AI Summary - voteTallies structure:', voteTallies);
  
  const rankedAnswers = answers.map((answer, idx) => {
    const voteData = voteTallies[idx] || { totalScore: 0 };
    const playerName = answer.playerName || answer.PlayerName;
    const answerText = answer.answer || answer.Answer;
    
    console.log(`🔍 DEBUG: AI Summary - Answer ${idx}: player="${playerName}", answer="${answerText}", score=${voteData.totalScore}`);
    
    return {
      player: playerName,
      answer: answerText,
      score: voteData.totalScore
    };
  }).sort((a, b) => b.score - a.score);

  // Build responses text with proper tie handling and game-type specific point formatting
  let currentRank = 1;
  const responsesText = rankedAnswers.map((answer, idx) => {
    // Handle ties: if current score is different from previous, update rank
    if (idx > 0 && answer.score !== rankedAnswers[idx - 1].score) {
      currentRank = idx + 1;
    }
    
    const rank = currentRank === 1 ? '🥇 1st Place' : 
               currentRank === 2 ? '🥈 2nd Place' : 
               currentRank === 3 ? '🥉 3rd Place' : 
               `${currentRank}th Place`;
    
    // Use appropriate point terminology based on game type
    const pointsLabel = gameType === 'trivia' ? 'points' : 'vote points';
    return `${rank}: ${answer.player} - "${answer.answer}" (${answer.score} ${pointsLabel})`;
  }).join('\n\n');
  
  // Get question set metadata for additional context
  let questionSetName = 'Question Set';
  let questionSetDescription = '';
  let categoryCount = 0;
  let totalQuestionsInSet = 0;
  
  try {
    // Try the current metadata structure first (SET#{id} / METADATA)
    const setMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `SET#${questionSetId}`, SK: 'METADATA' }
    }));
    
    if (setMetadata.Item && setMetadata.Item.metadata) {
      questionSetName = setMetadata.Item.metadata.name || questionSetName;
      questionSetDescription = setMetadata.Item.metadata.description || '';
      categoryCount = setMetadata.Item.metadata.categoryCount || 0;
      console.log(`📚 Found question set metadata: ${questionSetName} - ${questionSetDescription}`);
    } else {
      // Fallback to old structure
      const oldSetMetadata = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        // Handed down from the caller — see the note on sessionSetKey. NO
        // FALLBACK: the one caller always passes it, and a default of
        // `PK: 'SETS'` here would be the platform-only read this fix removed,
        // reinstated as a hedge and silent for exactly the sessions that need
        // it most.
        Key: setKey,
      }));
      
      if (oldSetMetadata.Item) {
        questionSetName = oldSetMetadata.Item.SetName || questionSetName;
        questionSetDescription = oldSetMetadata.Item.Description || '';
        console.log(`📚 Found question set metadata (old structure): ${questionSetName} - ${questionSetDescription}`);
      }
    }
    
    // Count questions in the set. This is prompt CONTEXT ("question 3 of 20"),
    // not the round's content, so it resolves without a pin: the set's
    // activeVersion, falling back to the legacy partition.
    const resolvedSet = await resolveSetPartition(db, process.env.TABLE_NAME, questionSetId, null);
    const allQuestions = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': resolvedSet.pk,
        ':sk': 'QUESTION#'  // Questions are stored with SK pattern: QUESTION#{categoryId}#{questionNumber}
      }
    }));
    
    totalQuestionsInSet = allQuestions.Items?.length || 0;
    const categories = new Set(allQuestions.Items?.map(q => q.Category).filter(c => c));
    categoryCount = categories.size;
  } catch (error) {
    console.log('⚠️ Could not fetch question set metadata:', error.message);
  }
  
  // Get current scores and leaderboard
  let leaderboard = [];
  let totalScores = '';
  let averageScore = 0;
  
  try {
    // Query for player score records using efficient SK pattern
    const scoresQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':skPrefix': 'PLAYER#'
      }
    }));
    
    // Filter for score records only (SK contains '#SCORE')
    const scoreRecords = scoresQuery.Items?.filter(item => item.SK && item.SK.includes('#SCORE')) || [];
    
    if (scoreRecords.length > 0) {
      console.log(`📊 Found ${scoreRecords.length} player score records`);
      const playerScores = scoreRecords.map(scoreRecord => ({
        name: scoreRecord.PlayerName,
        score: scoreRecord.score || 0  // Note: lowercase 'score' based on get-results.js
      })).sort((a, b) => b.score - a.score);

      // ANONYMITY: cumulative standings are attribution by arithmetic — the
      // same leak `standingsVisible` exists to prevent on the host screen. A
      // name-and-score list handed to the model while the round is hidden puts
      // "Ada leads with 12 points" straight into the summary the room reads,
      // and into the ?debug=true prompt echo any caller can request.
      //
      // The leaderboard is emptied rather than placeholdered: unlike an answer
      // row, a ranking of "a participant, a participant" says nothing, and an
      // empty template variable is what every other absent-data path here
      // already produces. averageScore survives — it names nobody.
      if (hidden) {
        console.log('🔒 Round is unrevealed — withholding the leaderboard from the prompt');
      } else {
        leaderboard = playerScores;
        totalScores = playerScores.slice(0, 5).map((p, idx) =>
          `${idx + 1}. ${p.name}: ${p.score} pts`
        ).join(', ');
      }

      if (playerScores.length > 0) {
        const totalSum = playerScores.reduce((sum, p) => sum + p.score, 0);
        averageScore = Math.round(totalSum / playerScores.length);
      }
      
      console.log(`📊 Total game scores - Top 5: ${totalScores}`);
      console.log(`📊 Average score: ${averageScore}`);
    } else {
      console.log('⚠️ No player score records found');
      totalScores = '';  // Empty string when no scores exist (will show as empty in template)
    }
  } catch (error) {
    console.log('⚠️ Could not fetch player scores:', error.message);
  }
  
  // Get player names and active participants
  const playerNames = answers.map(a => a.PlayerName || a.playerName).filter((v, i, a) => a.indexOf(v) === i);
  const activeParticipants = (votes && votes.length > 0) ? votes.length : answers.length; // For trivia, use answer count instead of votes
  
  // Format voting data (trivia games don't have votes)
  const voteData = (votes && votes.length > 0) ? 
    votes.map(v => `${v.PlayerName || 'Player'} voted`).join(', ') : 
    'No voting for trivia questions';

  // NO PARTICIPATION PERCENTAGE IS COMPUTED HERE ANY MORE — deliberately.
  //
  // `votingParticipation` used to be activeParticipants / totalParticipants,
  // and `participationRate` (further down) used to be
  // `${answers.length / totalParticipants}% answered, ${activeParticipants /
  // totalParticipants}% voted`. But `totalParticipants` is `answers.length`
  // (:1250) and `activeParticipants` collapses to `answers.length` whenever a
  // round has no votes (:1505) — so the "answered" half was 100% by
  // construction on every round ever summarised, and the "voted" half was
  // 100% too for trivia and wavelength. Neither figure had the room's size
  // anywhere in its denominator; there was no rate of people in either one.
  //
  // These are not internal diagnostics. They were interpolated straight into
  // the Bedrock prompt, so the model was told the room's participation was
  // total, every time — and hosts read the resulting summary out loud.
  //
  // Both template variables stay declared (below) and resolve to an empty
  // string, matching every other absent-data path in this function. They
  // cannot simply be deleted: template-variables.js advertises them to prompt
  // authors, and a token with no key renders as literal `{participationRate}`
  // on a projector. Restoring a real figure means finding a real denominator
  // — the session roster, not this round's answer count.

  // Determine voting pattern
  let votingPattern = 'Diverse opinions';
  if (gameType === 'trivia') {
    votingPattern = 'Trivia scoring - no voting';
  } else if (gameType === 'wavelength') {
    votingPattern = 'Wavelength word association - team scoring';
  } else if (votes && votes.length > 0) {
    if (winners.length === 1 && winners[0].score > (results.totalVotes * 2)) {
      votingPattern = 'Clear consensus';
    } else if (winners.length > 1) {
      votingPattern = 'Split decision';
    }
  }
  
  // Build results string (vote tally for call-and-answer, score tally for trivia)
  const resultsString = gameType === 'trivia' ? 
    sortedAnswers.slice(0, 5).map(([idx, data], rank) => 
      `${rank + 1}. ${data.playerName}: ${data.answerText} - ${data.totalScore} points ${data.isCorrect ? '(Correct)' : '(Incorrect)'}`
    ).join(', ') :
    sortedAnswers.slice(0, 5).map(([idx, data], rank) => 
      `${rank + 1}. ${data.answerText} (${data.totalScore} vote points)`
    ).join(', ');
  
  // Format top answers (different for trivia vs voting)
  const topAnswers_formatted = gameType === 'trivia' ?
    topAnswers.map(a => 
      `${a.playerName}: ${a.answer} - ${a.score} points`
    ).join(', ') :
    topAnswers.map(a => 
      `${a.playerName}: ${a.score} vote points`
    ).join(', ');
  
  // Initialize wavelength variables early to avoid undefined errors
  let commonWords = [];        // the LANDED tier: on every submitter's list
  let connectionScore = 0;     // legacy template variable, re-derived as landed ÷ distinct
  let totalUniqueWords = 0;
  let wavelengthSubmitters = 0; // THE denominator — submitters, never the room
  let wavelengthNearMiss = [];

  // Calculate consensus level. See lambda-functions/game/consensus.js — the
  // previous inline version compared maxScore against itself, a tautology that
  // never actually fired because maxScore was not passed in at all (it is now,
  // at :1056 — dropping it again turns tests/ai-consensus-label.js red).
  // `let`, not `const`: the wavelength branch recomputes this at :2005, once
  // connectionScore has actually been derived. Up here it is still 0 (declared
  // at :1598, populated at :1904/:1985), so wavelength's value from this call is
  // provisional and always overwritten. Every other game type takes it as final.
  let consensusLevel = consensusLabel({
    gameType,
    sortedAnswers,
    maxScore: results.maxScore,
    landedCount: commonWords.length,
    submitterCount: wavelengthSubmitters,
  });

  // Format final results (different for trivia vs voting)
  const finalResults = gameType === 'trivia' ?
    sortedAnswers.slice(0, 3).map(([idx, data], rank) => {
      const emoji = rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉';
      return `${emoji} ${data.playerName}: ${data.answerText} (${data.totalScore} points, ${data.isCorrect ? 'Correct' : 'Incorrect'})`;
    }).join(', ') :
    sortedAnswers.slice(0, 3).map(([idx, data], rank) => {
      const emoji = rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉';
      return `${emoji} ${data.answerText} (${data.totalScore} votes)`;
    }).join(', ');
  
  // Winner info (different format for trivia vs voting)
  const winnerInfo = winners.length > 0 ? 
    gameType === 'trivia' ?
      `Winner: ${winners[0].playerName} with "${winners[0].answerText}" (${winners[0].score} points)` :
      `Winner: ${winners[0].playerName} with "${winners[0].answerText}" (${winners[0].score} vote points)` : 
    'No clear winner';
  
  // Results summary (different for trivia vs wavelength vs voting) - wavelength will be updated later
  let resultsSummary = '';
  if (gameType === 'trivia') {
    resultsSummary = winners.length === 1 ? 
      `Clear winner with ${winners[0].score} points` :
      winners.length > 1 ? 
      `${winners.length}-way tie for first place with ${winners[0].score} points each` :
      'No correct answers';
  } else if (gameType === 'wavelength') {
    // Provisional — the wavelength branch below overwrites this once the real
    // analysis is in hand. Kept in the new vocabulary so a future refactor
    // that drops the overwrite cannot resurrect the connection-rate claim.
    resultsSummary = `${commonWords.length} words were on every list (all ${wavelengthSubmitters} who answered)`;
  } else {
    resultsSummary = winners.length === 1 ? 
      `Clear winner with ${Math.round((winners[0].score / (results.totalVotes * 3)) * 100)}% of possible vote points` :
      winners.length > 1 ? 
      `${winners.length}-way tie for first place` :
      'No votes recorded';
  }
  
  // (participationRate was computed here. See the note above `votingPattern`.)

  // Get unique answers
  const uniqueAnswers = [...new Set(answers.map(a => a.Answer || a.answer))];
  const uniqueAnswersText = uniqueAnswers.slice(0, 5).join(', ');
  
  // Group answers by theme (simple grouping)
  const answerCategories = uniqueAnswers.length < 5 ? 
    `${uniqueAnswers.length} unique responses` :
    `${uniqueAnswers.length} unique responses across various themes`;
  
  // Player rankings - proper ordinal formatting
  const getOrdinal = (n) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  
  const playerRankings = leaderboard.slice(0, 3).map((p, idx) => 
    `${getOrdinal(idx + 1)}: ${p.name} (${p.score} pts)`
  ).join(', ');
  
  // Top performers
  const topPerformers = leaderboard.length > 0 ?
    `${leaderboard[0].name} leads with ${leaderboard[0].score} points` :
    '';
  
  // Round scores (for current question only - not cumulative)
  const roundScores = sortedAnswers.slice(0, 3).map(([idx, data]) => 
    `${data.playerName}: +${data.totalScore} pts`
  ).join(', ') || 'No scores this round';
  
  // Score changes - show points earned this round
  const scoreChanges = gameType === 'trivia' ? 
    (sortedAnswers.length > 0 ? 
      sortedAnswers.map(([idx, data]) => 
        `${data.playerName}: +${data.totalScore} pts ${data.isCorrect ? '(Correct)' : '(Incorrect)'}`
      ).join(', ') : 'No points earned this round') :
    (sortedAnswers.length > 0 ? 
      sortedAnswers.slice(0, 3).map(([idx, data]) => 
        `${data.playerName}: +${data.totalScore} vote pts`
      ).join(', ') : 'No vote points this round');
  
  // Current round/question number
  const currentRound = `Question ${parseInt(paddedQuestionNumber)}`;
  
  // Session duration - calculate from game metadata if available
  let sessionDuration = 'Current session';
  try {
    if (metadata.CreatedAt) {
      const gameStart = new Date(metadata.CreatedAt);
      const now = new Date();
      const durationMs = now - gameStart;
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      sessionDuration = minutes > 0 ? `${minutes} minutes, ${seconds} seconds` : `${seconds} seconds`;
    }
  } catch (error) {
    console.log('⚠️ Could not calculate session duration:', error.message);
  }
  
  // Scoring system explanation
  const scoringSystem = `1st place: ${scoringConfig.firstPlacePoints} pts, 2nd place: ${scoringConfig.secondPlacePoints} pts, 3rd place: ${scoringConfig.thirdPlacePoints} pt`;
  
  // Voting breakdown
  const votingBreakdown = sortedAnswers.slice(0, 3).map(([idx, data]) => 
    `${data.answerText}: ${data.firstPlace} first-place, ${data.secondPlace} second-place, ${data.thirdPlace} third-place votes`
  ).join('; ');
  
  // Format trivia/poll/wavelength specific variables
  let triviaChoices = '';
  let pollOptions = '';
  let correctAnswer = '';
  let triviaResponses = '';
  let triviaCorrectness = '';
  let correctCount = 0; // Initialize correctCount for all game types
  let correctAnswers = [];
  
  console.log('🎯 BEFORE GAME TYPE PROCESSING:');
  console.log('  gameType:', gameType);
  console.log('  question exists:', !!question);
  if (question) {
    console.log('  🔍 ALL QUESTION FIELDS:', Object.keys(question));
    console.log('  question.correctAnswer value:', JSON.stringify(question.correctAnswer));
    console.log('  question.optionA value:', JSON.stringify(question.optionA));
    console.log('  question.optionB value:', JSON.stringify(question.optionB));
    console.log('  question.optionC value:', JSON.stringify(question.optionC));
    console.log('  question.optionD value:', JSON.stringify(question.optionD));
    console.log('  typeof correctAnswer:', typeof question.correctAnswer);
    console.log('  typeof optionA:', typeof question.optionA);
  }
  
  // Wavelength-specific variables (already initialized above)
  let wavelengthTopic = '';
  let wavelengthWords = '';
  let wordAnalysis = '';
  
  // Check if this is a trivia or poll game
  console.log('🎮 GAME TYPE CHECK: gameType=', gameType, 'question exists=', !!question);
  if (gameType === 'trivia' && question) {
    console.log('📋 ENTERING TRIVIA PROCESSING BLOCK');
    console.log('🔍 QUESTION OBJECT IN TRIVIA BLOCK:');
    console.log('  correctAnswer:', question.correctAnswer);
    console.log('  optionA:', question.optionA);
    console.log('  optionB:', question.optionB);
    console.log('  All fields:', Object.keys(question));
    // Format trivia choices with better formatting
    const options = [];
    if (question.optionA) options.push(`A) ${question.optionA}`);
    if (question.optionB) options.push(`B) ${question.optionB}`);
    if (question.optionC) options.push(`C) ${question.optionC}`);
    if (question.optionD) options.push(`D) ${question.optionD}`);
    if (question.optionE) options.push(`E) ${question.optionE}`);
    if (question.optionF) options.push(`F) ${question.optionF}`);
    triviaChoices = options.join(', ');
    
    console.log('🔍 TRIVIA CHOICES DEBUG:', triviaChoices);
    
    // Get correct answer(s) with improved extraction (use normalized field only)
    let correctAnswerValue = question.correctAnswer;
    
    if (correctAnswerValue) {
      // If it's an option ID (like OptionA), convert to actual text
      if (correctAnswerValue.startsWith('Option')) {
        const optionLetter = correctAnswerValue.replace('Option', '');
        const optionField = `option${optionLetter}`;
        const optionText = question[optionField];
        if (optionText) {
          correctAnswer = `The correct answer is ${optionLetter}: ${optionText}`;
        } else {
          correctAnswer = `The correct answer is ${optionLetter}`;
        }
        console.log(`🔍 CORRECT ANSWER DEBUG: Converted ${correctAnswerValue} to "${correctAnswer}"`);
      } else {
        correctAnswer = correctAnswerValue;
        console.log(`🔍 CORRECT ANSWER DEBUG: Using direct value "${correctAnswer}"`);
      }
    } else if (question.correctAnswers && Array.isArray(question.correctAnswers)) {
      // Handle multiple correct answers
      correctAnswer = question.correctAnswers.map(ans => {
        if (ans.startsWith('Option')) {
          const optionLetter = ans.replace('Option', '');
          const optionField = `option${optionLetter}`;
          return question[optionField] || ans;
        }
        return ans;
      }).join(', ');
      console.log(`🔍 CORRECT ANSWER DEBUG: Multiple answers converted to "${correctAnswer}"`);
    } else {
      console.log('🔍 CORRECT ANSWER DEBUG: No correct answer found in question object');
    }
    
    // Calculate trivia response distribution
    const responseDistribution = {};
    
    answers.forEach(answer => {
      const playerAnswer = answer.Answer || answer.answer;
      responseDistribution[playerAnswer] = (responseDistribution[playerAnswer] || 0) + 1;
      
      // Check if answer is correct using normalized fields only
      const correctAnswerValue = question.correctAnswer;
      const correctAnswersArray = question.correctAnswers;
      
      // Handle OptionA format conversion to actual text
      let actualCorrectAnswer = correctAnswerValue;
      if (correctAnswerValue && correctAnswerValue.startsWith('Option')) {
        const optionLetter = correctAnswerValue.replace('Option', '');
        const optionField = `option${optionLetter}`;
        actualCorrectAnswer = question[optionField] || correctAnswerValue;
      }
      
      // Check if player's answer is correct (handle both letter and full text matching)
      let isCorrect = false;
      if (correctAnswersArray && correctAnswersArray.includes(playerAnswer)) {
        isCorrect = true;
      } else if (correctAnswerValue) {
        if (correctAnswerValue.startsWith('Option')) {
          // For OptionA format, compare the letter (A, B, C, D)
          const correctLetter = correctAnswerValue.replace('Option', '');
          isCorrect = playerAnswer === correctLetter;
        } else {
          // Direct comparison for non-Option format
          isCorrect = playerAnswer === correctAnswerValue || playerAnswer === actualCorrectAnswer;
        }
      }
      
      console.log(`🔍 CORRECTNESS CHECK: Player "${answer.PlayerName || answer.playerName}" answered "${playerAnswer}", correct="${correctAnswerValue}", isCorrect=${isCorrect}`);
      
      if (isCorrect) {
        correctCount++;
        correctAnswers.push({
          playerName: answer.PlayerName || answer.playerName,
          answer: playerAnswer
        });
      }
    });
    
    // Format response distribution
    triviaResponses = Object.entries(responseDistribution)
      .map(([option, count]) => `${option}: ${count} players`)
      .join(', ');
    
    // Calculate correctness percentage
    if (totalParticipants > 0) {
      const correctPercentage = Math.round((correctCount / totalParticipants) * 100);
      triviaCorrectness = `${correctCount} of ${totalParticipants} players correct (${correctPercentage}%)`;
    }
    
    console.log('🔍 TRIVIA PROCESSING COMPLETE:');
    console.log('  gameType:', gameType);
    console.log('  question exists:', !!question);
    console.log('  question.correctAnswer:', question.correctAnswer);
    console.log('  question.optionA:', question.optionA);
    console.log('  question.optionB:', question.optionB);
    console.log('  question.optionC:', question.optionC);
    console.log('  question.optionD:', question.optionD);
    console.log('  question.answerDetails:', question.answerDetails);
    console.log('  triviaChoices:', triviaChoices);
    console.log('  correctAnswer:', correctAnswer);
    console.log('  correctCount:', correctCount);
    console.log('  triviaResponses:', triviaResponses);
    console.log('  triviaCorrectness:', triviaCorrectness);
  } else if ((gameType === 'polls' || gameType === 'poll') && question) {
    // Format poll options
    const options = [];
    if (question.optionA) options.push(`Option 1: ${question.optionA}`);
    if (question.optionB) options.push(`Option 2: ${question.optionB}`);
    if (question.optionC) options.push(`Option 3: ${question.optionC}`);
    if (question.optionD) options.push(`Option 4: ${question.optionD}`);
    if (question.optionE) options.push(`Option 5: ${question.optionE}`);
    pollOptions = options.join(', ');
    
    // For polls, there's no correct answer, just distribution
    const responseDistribution = {};
    answers.forEach(answer => {
      const playerAnswer = answer.Answer || answer.answer;
      responseDistribution[playerAnswer] = (responseDistribution[playerAnswer] || 0) + 1;
    });
    
    // Format as a distribution
    triviaResponses = Object.entries(responseDistribution)
      .map(([option, count]) => `${option}: ${count} votes`)
      .join(', ');
  } else if (gameType === 'wavelength') {
    // Handle wavelength word analysis
    console.log('🌊 Processing wavelength data for AI summary');
    
    // Get the topic/prompt from the question
    wavelengthTopic = question.title || question.topic || 'Word Association';
    
    // Use stored results data if available. Since the convergence rework this
    // carries the UNANIMITY analysis (commonWords = on every submitter's list,
    // clustered when the worker ran) — the stored round is the round's answer
    // and must not be second-guessed here.
    if (storedResults && storedResults.wordAnalysis && storedResults.wordAnalysis.commonWords) {
      console.log('✅ Using stored wavelength results data for AI summary');

      commonWords = storedResults.wordAnalysis.commonWords;
      totalUniqueWords = storedResults.wordAnalysis.totalUniqueWords || 0;
      wavelengthSubmitters = storedResults.wordAnalysis.submitterCount
        || storedResults.wordAnalysis.totalAnswers
        || answers.length;
      wavelengthNearMiss = storedResults.wordAnalysis.nearMiss || [];
      // Legacy template variable: the share of distinct words that landed.
      connectionScore = totalUniqueWords > 0
        ? Math.round((commonWords.length / totalUniqueWords) * 100)
        : 0;

      // Extract player word lists from stored data. This reads a separately
      // persisted QUESTION#...#RESULTS record — it is NOT part of the
      // `answers`/`results` parameters redacted at the top of this function,
      // so real names here must be scrubbed again, on their own, or they
      // reach the model (and, via debug=true, any caller) untouched.
      //
      // An array of entries, not an object keyed by player name: keying by
      // name means every redacted row collides on the same placeholder key
      // and silently overwrites the one before it, so only the last
      // participant's words would survive into wavelengthWords below. An
      // array keeps every participant's words without needing a stable
      // per-participant identity (that would be the stable-answerId feature,
      // out of scope here) — the placeholder can simply repeat.
      const playerWordEntries = [];
      // The stored round names this list `answers` (get-results.js writes it);
      // `playerAnswers` was the field this branch always read and NO writer
      // ever produced, so wavelengthWords was silently empty on every stored
      // round. Both names accepted so neither era of stored rows goes blank.
      const storedPlayerAnswers = storedResults.playerAnswers || storedResults.answers;
      if (storedPlayerAnswers) {
        storedPlayerAnswers.forEach(playerAnswer => {
          const rawName = playerAnswer.playerName || playerAnswer.PlayerName;
          const playerName = hidden ? AUTHOR_PLACEHOLDER : rawName;
          const answerText = playerAnswer.answer || playerAnswer.Answer || '';
          const words = answerText.split(',')
            .map(w => w.trim().toLowerCase())
            .filter(w => w.length > 0);
          playerWordEntries.push({ playerName, words });
        });
      }

      // Format wavelength data for AI
      wavelengthWords = playerWordEntries
        .map(({ playerName, words }) => `${playerName}: [${words.join(', ')}]`)
        .join('; ');
      
      wordAnalysis = buildWavelengthProse(commonWords, wavelengthNearMiss, totalUniqueWords, wavelengthSubmitters);

      console.log('🌊 Using stored wavelength analysis:', {
        commonWordsCount: commonWords.length,
        totalUniqueWords,
        submitterCount: wavelengthSubmitters,
        matching: storedResults.wordAnalysis.matching || 'legacy'
      });

    } else {
      console.log('⚠️ No stored results found, calculating wavelength data from scratch');

      // Fallback: exact-match unanimity via the SAME engine the results
      // handler uses (lambda-functions/game/wavelength.js), so the two paths
      // cannot drift back apart — this branch used to keep its own count>1
      // rule, which was the game the convergence spec retired. `answers` was
      // already redacted to the shared placeholder at the top of this
      // function when hidden, so `playerName` below is safe as-is — but an
      // array of entries, not an object keyed by player name: keying by name
      // collapses every redacted row onto the same placeholder key and drops
      // every participant but the last from wavelengthWords.
      const playerWordEntries = answers.map(answer => ({
        playerName: answer.PlayerName || answer.playerName,
        words: (answer.Answer || answer.answer || '').split(',')
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length > 0),
      }));

      const analysis = analyzeWavelength(
        playerWordEntries.map(({ playerName, words }) => ({ player: playerName, words }))
      );
      commonWords = analysis.commonWords;
      wavelengthNearMiss = analysis.nearMiss;
      totalUniqueWords = analysis.totalUniqueWords;
      wavelengthSubmitters = analysis.submitterCount;
      connectionScore = totalUniqueWords > 0
        ? Math.round((commonWords.length / totalUniqueWords) * 100)
        : 0;

      // Format wavelength data for AI
      wavelengthWords = playerWordEntries
        .map(({ playerName, words }) => `${playerName}: [${words.join(', ')}]`)
        .join('; ');

      wordAnalysis = buildWavelengthProse(commonWords, wavelengthNearMiss, totalUniqueWords, wavelengthSubmitters);

      console.log('🌊 Fallback wavelength analysis complete:', {
        topic: wavelengthTopic,
        commonWordsCount: commonWords.length,
        totalUniqueWords: totalUniqueWords,
        submitterCount: wavelengthSubmitters
      });
    }

    // Update wavelength-specific summary variables now that we have the real
    // values. The claim carries its denominator — "11 words" is defensible
    // only next to "all 12 who answered" — and no bare connection-rate
    // percentage goes into a live prompt.
    resultsSummary = `${commonWords.length} of ${totalUniqueWords} distinct words were on every list (all ${wavelengthSubmitters} who answered)`;
    consensusLevel = consensusLabel({
      gameType,
      landedCount: commonWords.length,
      submitterCount: wavelengthSubmitters,
    });
  }
  
  // Player answers formatted
  const playerAnswers = answers.map(a => 
    `${a.PlayerName || a.playerName}: "${a.Answer || a.answer}"`
  ).join(', ');
  
  // Prepare all template variables (comprehensive set)
  const templateVars = {
    // SET INFO
    questionSetName: questionSetName,
    questionSetDescription: questionSetDescription,
    categoryCount: categoryCount,
    totalQuestions: totalQuestionsInSet,
    sessionContext: sessionContext,
    
    // GAME INFO
    eventTitle: eventTitle,
    gameType: gameType,
    gameId: gameId,
    sessionDuration: sessionDuration,
    currentRound: currentRound,
    totalScores: totalScores,
    gameContext: eventTitle, // Alias for backward compatibility
    
    // PLAYER INFO
    totalParticipants: totalParticipants,
    totalPlayers: totalParticipants, // Trivia template uses totalPlayers
    activeParticipants: activeParticipants,
    playerNames: playerNames.join(', '),
    playerRankings: playerRankings,
    topPerformers: topPerformers,
    
    // QUESTION INFO
    question: question.title || question.questionDetail || 'Question not available', // Trivia template uses {question}
    questionTitle: question.title || 'Question not available',
    questionDetail: question.questionDetail || question.detail || 'No additional context provided',
    questionCategory: question.category || 'General',
    questionContext: question.questionDetail || question.detail || '',
    questionNumber: currentRound,
    /*
      WHAT WAS ASKED, as one labelled block.
      -------------------------------------
      Every prompt in this product opens by restating the question, and until
      now that took two variables and two hand-written labels:

          Question: {questionTitle}
          Detail:   {questionDetail}

      A prompt that wrote only the first silently dropped the context the
      question depends on, and nothing said so. This composite is the owner's
      own `{questioninfo}` — the single line his model of a prompt opens with.

      The detail line is omitted rather than printed empty when the question
      carries none: "Detail: No additional context provided" is a sentence the
      model reads as a fact about the round, and it is not one. `questionDetail`
      keeps its own placeholder, because a prompt that names that variable
      explicitly has asked for the field and should see what is in it.
    */
    questionInfo: [
      `Question: ${question.title || question.questionDetail || 'Question not available'}`,
      (question.questionDetail || question.detail)
        ? `Detail: ${question.questionDetail || question.detail}`
        : null,
    ].filter(Boolean).join('\n'),
    triviaChoices: triviaChoices || (() => {
      // Fallback if trivia processing didn't run
      if (question && gameType === 'trivia') {
        const opts = [];
        if (question.optionA) opts.push(`A) ${question.optionA}`);
        if (question.optionB) opts.push(`B) ${question.optionB}`);
        if (question.optionC) opts.push(`C) ${question.optionC}`);
        if (question.optionD) opts.push(`D) ${question.optionD}`);
        if (question.optionE) opts.push(`E) ${question.optionE}`);
        if (question.optionF) opts.push(`F) ${question.optionF}`);
        console.log('⚠️ FALLBACK: Building triviaChoices in template vars');
        return opts.join(', ');
      }
      return '';
    })(),
    pollOptions: pollOptions,
    correctAnswer: correctAnswer || (() => {
      // Fallback if trivia processing didn't run
      if (question && gameType === 'trivia' && question.correctAnswer) {
        const correctAnswerValue = question.correctAnswer;
        if (correctAnswerValue.startsWith('Option')) {
          const optionLetter = correctAnswerValue.replace('Option', '');
          const optionField = `option${optionLetter}`;
          const optionText = question[optionField];
          console.log('⚠️ FALLBACK: Building correctAnswer in template vars');
          return optionText ? `The correct answer is ${optionLetter}: ${optionText}` : `The correct answer is ${optionLetter}`;
        }
        return correctAnswerValue;
      }
      return '';
    })(),
    answerDetails: question.answerDetails || 'No explanation provided',
    difficulty: question.difficulty || 'medium',
    questionExplanation: question.answerDetails || question.detail || '',
    /*
      THE SAME FIELD UNDER THE NAME IT IS ACTUALLY USED FOR.

      `AnswerDetails` is stored for every engagement type
      (upload-questions.js:588-601) and is carried by NO player or host payload,
      so it is the one place a question author can put something the room must
      not see until they have answered — the real title of a painting, the
      outcome a case study actually had, why the answer was right.

      It kept being missed because the NAME says "trivia footnote". The art
      round's prompt promised a reveal in prose and never inserted a tag, and
      the room was told the real title would be revealed and then was not.

      An alias, deliberately, and not a rename: renaming would break every
      prompt already using {answerDetails} and every CSV column header, for a
      readability gain. Both names resolve to the same string, so a prompt may
      use whichever reads better in its sentence.

      EMPTY STRING, NOT 'No explanation provided', when there is nothing. The
      literal above is a trivia-era default that reads as prose inside a
      sentence built around a reveal — "the real title is No explanation
      provided". An empty tag leaves the sentence short, which is recoverable;
      a confident wrong sentence is not.
    */
    reveal: question.answerDetails || '',
    
    // ANSWERS
    playerAnswers: playerAnswers,
    playerResponses: playerAnswers, // Trivia template uses playerResponses
    responseCount: rankedAnswers.length,
    uniqueAnswers: uniqueAnswersText,
    answerCategories: answerCategories,
    triviaResponses: triviaResponses,
    responsesText: responsesText,
    correctCount: gameType === 'trivia' ? correctCount : 0, // For trivia templates
    
    // VOTES
    voteData: voteData,
    voteCount: votes ? votes.length : 0,
    // Empty on purpose — the percentage this used to carry was 100% by
    // construction and went straight to the model. See the note above
    // `votingPattern`.
    votingParticipation: '',
    votingPattern: votingPattern,
    
    // VOTE TALLY / RESULTS
    voteTally: resultsString,
    topVotedAnswers: topAnswers_formatted,
    votingBreakdown: votingBreakdown,
    consensusLevel: consensusLevel,
    
    // RESULTS
    finalResults: finalResults,
    winnerInfo: winnerInfo,
    resultsSummary: resultsSummary,
    // Empty on purpose — same reason as votingParticipation above.
    participationRate: '',
    triviaCorrectness: triviaCorrectness,
    
    // SCORES
    roundScores: roundScores,
    cumulativeScores: totalScores,
    scoreChanges: scoreChanges,
    leaderboard: leaderboard.slice(0, 5).map((p, idx) => 
      `${getOrdinal(idx + 1)}: ${p.name} (${p.score} pts)`
    ).join(', '),
    scoringSystem: scoringSystem,
    averageScore: `${averageScore} points`,
    
    // WAVELENGTH SPECIFIC
    wavelengthTopic: wavelengthTopic,
    wavelengthWords: wavelengthWords,
    commonWords: commonWords.map(w => w.word).join(', '),
    commonWordsCount: commonWords.length,
    totalUniqueWords: totalUniqueWords,
    connectionScore: `${connectionScore}%`,
    wordAnalysis: wordAnalysis,
    teamScore: commonWords.length, // Team-based scoring for wavelength
    
    // CONTEXT (backward compatibility)
    contextSections: contextSections.length > 0 ? ('\nCONTEXT INFORMATION:\n' + contextSections.join('\n') + '\n') : '',
    contextInstructions: contextSections.length > 0 ? 
      '\n\nIMPORTANT: Please tailor your analysis based on the provided context information above. Consider the specific background, goals, and instructions relevant to this session.' : 
      ''
  };
  
  // Build the final prompt in three layers: VOICE (persona) → the template's
  // own content framing → STRUCTURE (system contract).
  //
  // Order matters. Voice goes first because it establishes identity; the format
  // contract goes LAST because a model weights the most recent formatting
  // instruction most heavily, and the legacy templates carry their own
  // conflicting "Output Format" sections we need to override.
  let templateBody;
  if (promptData.template) {
    templateBody = promptData.template;              // legacy single-field prompt
  } else if (promptData.instructions && promptData.outputFormat) {
    templateBody = promptData.instructions + '\n\n' + promptData.outputFormat;
  } else {
    console.error('❌ Invalid prompt structure - missing required fields');
    throw new Error('Prompt must have either template OR both instructions and outputFormat');
  }

  console.log(`🎭 PERSONA: using ${persona.source}${persona.name ? ` (${persona.name})` : ''}${persona.inferred ? ' — adaptive' : ''}`);

  // Structure is prompt-owned but system-validated: a prompt that declares a
  // well-formed `outputSections` gets that shape, anything else (absent, or
  // malformed) gets the default Summary/Discussion/Next Steps triad. See
  // personas.js — this is what lets an art round talk about the winning title
  // and reveal the real one instead of inventing "next steps" for a painting.
  const customShape = hasCustomOutputShape(promptData);
  console.log(`🧱 OUTPUT SHAPE: ${describeOutputShape(promptData)}${customShape ? ' (declared by prompt)' : ' (system default)'}`);

  /*
    THE CONTEXT LAYER, GUARANTEED. Until now the host's context reached the
    prompt only through the {contextSections} template variable — present in
    the built-in default template and absent from most authored and imported
    prompts, where the context silently vanished. Reported as: "you can
    specify extra info about the event/session and instructions for the AI...
    none of these seem to contribute to the AI workie's response, and they
    always should."

    So: a template that places {contextSections} keeps placing it (its author
    chose where); any other template gets the block injected here, after the
    voice and before the template body. One door or the other is always open,
    and which one is not the host's problem.
  */
  const contextBlock = buildContextBlock({
    eventDetails,
    // A context that BECAME the voice (see the chain in personas.js) is
    // already the loudest thing in the prompt; repeating it here as a labeled
    // line would make the model weigh it twice. Everything that did NOT
    // become the voice travels.
    hostInstructions: persona.source === 'game_context' ? '' : gameAiContext,
    questionSetContext: persona.source === 'question_set_context' ? '' : questionSetAiContext,
  });
  const templateCarriesContext = templateBody.includes('{contextSections}');
  const contextLayer = (!templateCarriesContext && contextBlock)
    ? `${contextBlock}\n\n`
    : '';

  /*
    THE HOST'S REQUIRED ADDITIONS, AFTER THE CONTRACT — games 1935 and 4567,
    in that order. Delivery was never the problem (the context layer above
    carries the same facts); POSITION was, twice. First the instructions sat
    only at the top and lost to the template's rule mass (1935). Then a
    directive between the template and the contract lost to the contract's
    own "supersedes any instruction that appeared earlier" opener (4567 —
    CloudWatch shows the directive in the prompt and the model ignoring it).
    The measured fix is this order: the additions come LAST, as part of the
    format block's own requirements. personas.js:buildHostDirective carries
    the experiment log.
  */
  const hostDirective = buildHostDirective({
    hostInstructions: gameAiContext,
    eventDetails,
  });
  const hostLayer = hostDirective ? `\n\n${hostDirective}` : '';

  /*
    ONE OPENING MOVE PER ROUND — the anti-template device (personas.js:
    OPENING_MOVES carries the argument). Drawn here, at generation time, so
    every round gets a different way into its first section and a Redo gets a
    fresh one; without it the model settles into a single compliant opener
    ("We asked one question...") and repeats it every round, which reads as
    machinery.
  */
  const openingMove = pickOpeningMove();
  console.log(`🎬 OPENING MOVE: ${openingMove}`);

  let prompt = `VOICE:\n${persona.voice}\n\n${contextLayer}${templateBody}\n\n${buildOutputContract(promptData, { openingMove })}${hostLayer}`;

  // Debug: Log key trivia variables
  if (gameType === 'trivia') {
    console.log('🔍 TRIVIA DEBUG - Template variables:');
    console.log('  question:', templateVars.question);
    console.log('  questionTitle:', templateVars.questionTitle);
    console.log('  questionDetail:', templateVars.questionDetail);
    console.log('  correctAnswer:', templateVars.correctAnswer);
    console.log('  correctCount:', templateVars.correctCount);
    console.log('  totalPlayers:', templateVars.totalPlayers);
    console.log('  triviaChoices:', templateVars.triviaChoices);
    console.log('  triviaResponses:', templateVars.triviaResponses);
    console.log('  triviaCorrectness:', templateVars.triviaCorrectness);
    console.log('  playerResponses:', templateVars.playerResponses);
    console.log('  scoreChanges:', templateVars.scoreChanges);
    console.log('  cumulativeScores:', templateVars.cumulativeScores);
    console.log('  responsesText:', templateVars.responsesText);
    
    console.log('🔍 TRIVIA DEBUG - Question object:');
    console.log('  question.title:', question.title);
    console.log('  question.correctAnswer:', question.correctAnswer);
    console.log('  question.optionA:', question.optionA);
    console.log('  question.optionB:', question.optionB);
    console.log('  question.optionC:', question.optionC);
    console.log('  question.optionD:', question.optionD);
    
    console.log('🔍 TRIVIA DEBUG - Raw values:');
    console.log('  triviaChoices raw:', triviaChoices);
    console.log('  correctAnswer raw:', correctAnswer);
    console.log('  scoreChanges raw:', scoreChanges);
  } else if (gameType === 'wavelength') {
    console.log('🌊 WAVELENGTH DEBUG - Template variables:');
    console.log('  wavelengthTopic:', templateVars.wavelengthTopic);
    console.log('  wavelengthWords:', templateVars.wavelengthWords);
    console.log('  commonWords:', templateVars.commonWords);
    console.log('  commonWordsCount:', templateVars.commonWordsCount);
    console.log('  totalUniqueWords:', templateVars.totalUniqueWords);
    console.log('  connectionScore:', templateVars.connectionScore);
    console.log('  wordAnalysis:', templateVars.wordAnalysis);
    console.log('  teamScore:', templateVars.teamScore);
  }
  
  for (const [key, value] of Object.entries(templateVars)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    prompt = prompt.replace(regex, value);
  }

  // Anything still brace-wrapped after that loop is a variable nothing can
  // fill; it goes to the model verbatim and lands on a projector as literal
  // `{braces}`. That has always happened silently. It still happens — rewriting
  // live prompts at runtime would be a behaviour change, and a prompt written
  // years ago is not this code's to edit — but it is no longer invisible: it is
  // logged, and it is in debugInfo where ?debug=true can show an operator
  // exactly which token failed.
  const unresolvedVariables = extractVariableTokens(prompt);
  if (unresolvedVariables.length > 0) {
    console.warn(
      `⚠️ UNRESOLVED TEMPLATE VARIABLES (sent to the model, and shown, as literal text): ` +
      unresolvedVariables.map((n) => `{${n}}`).join(', '));
  }

  console.log('🤖 FULL AI PROMPT CONSTRUCTED:');
  console.log('=====================================');
  console.log(prompt);
  console.log('=====================================');

  // Prepare debug information
  const debugInfo = {
    promptProvenance: promptProvenance,
    fullPrompt: prompt,
    templateVariables: templateVars,
    unresolvedVariables,
    promptTemplate: promptData.template || (promptData.instructions + '\n\n' + promptData.outputFormat),
    promptInstructions: promptData.instructions,
    promptOutputFormat: promptData.outputFormat,
    promptFormat: promptData.template ? 'legacy' : 'structured',
    outputShape: describeOutputShape(promptData),
    outputShapeSource: customShape ? 'prompt' : 'system-default',
    promptName: promptData.name,
    promptSource: promptProvenance.source
  };

  // Haiku 4.5 is the single fast model in the hot path. It finishes in ~3–8s,
  // makes a throttle retry cheap, and keeps us well under any latency budget.
  // No second slow model is chained — failures go straight to the static fallback.
  const haikuModelId = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
  console.log('🤖 BEDROCK: Calling Claude Haiku 4.5 (primary)…', haikuModelId);
  console.log('🤖 BEDROCK: Prompt length:', prompt.length);

  /*
    THE REPLY IS PREFILLED WITH ITS OWN FIRST HEADING. The completion then
    begins INSIDE the content — no "Here's a summary…" preamble, no invented
    document title (the shape that broke game 7971), and the parser's anchor
    is guaranteed mechanically instead of by instruction. Verified live
    against this exact model before shipping: the completion continues
    "\n\nThe room…", never contaminating the heading line. The prefill must
    not end in whitespace — Bedrock rejects a trailing-space assistant turn —
    so the newline arrives from the completion, and the two are concatenated
    verbatim below before parsing or storing.
  */
  const firstHeading = resolveOutputSections(promptData)[0].heading;
  const prefill = `## ${firstHeading}`;

  const invokeHaiku = async () => bedrock.send(new InvokeModelCommand({
    modelId: haikuModelId,
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,     // content is ~600–1000 tok; caps tail latency (bump to 1536 only if stop_reason:"max_tokens")
      // 0.7, up from 0.5. Every fact the reply may state is IN the prompt and
      // fenced by the material-only rules, so temperature buys phrasing
      // variety, not hallucination risk — and 0.5 flattened exactly the
      // "real, vivid, natural" quality the owner asked this pass to restore.
      temperature: 0.7,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: prefill }
      ]
    })
  }));

  try {
    let response;
    try {
      response = await invokeHaiku();
    } catch (e) {
      if (e.name === 'ThrottlingException') {
        console.log('⏳ BEDROCK: throttled — retrying Haiku 4.5 once');
        response = await invokeHaiku(); // one retry, SAME fast model
      } else {
        throw e;
      }
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    // Prefill + completion IS the reply — the model wrote everything after the
    // heading, and everything downstream (the parser, the stored markdown, the
    // projector) must see the whole document, heading included.
    const aiResponse = (prefill + responseBody.content[0].text).trim();

    console.log('✅ CLAUDE SUCCESS: Real AI response received');
    console.log('📝 AI Response preview:', aiResponse.substring(0, 200) + '...');

    // Parse the structured response
    const parsed = parseAIResponse(aiResponse, { customShape });

    // Return structured data for storage
    const result = {
      summary: parsed.summaryText,
      summaryText: parsed.summaryText, // For backwards compatibility
      discussionQuestions: parsed.discussionQuestions,
      nextSteps: parsed.nextSteps,
      fullResponse: aiResponse,
      markdownResponse: parsed.markdownResponse,   // present on every success path
      model: 'claude-haiku-4-5',                    // correct label (was mislabeled 'claude-3.5-*')
      // Whose voice this section is in. Persisted onto the AISummary item so a
      // report generated weeks later can attribute it — by then the game's
      // PersonaId may have been switched again, or the persona edited.
      ...personaAttribution(persona)
    };

    // Include debug information if in debug mode
    if (debugMode) {
      result.debugInfo = debugInfo;
    }

    return result;

  } catch (error) {
    console.error('🚨 BEDROCK ERROR (Haiku 4.5):', error.name, error.message);

    // Data-driven fallback — never chain a second slow model, never return blank.
    console.log(`🚨 BEDROCK FINAL FALLBACK: data-driven summary for ${totalParticipants} participants`);
    const fallbackResult = { ...buildFallback(), ...personaAttribution(persona) };
    if (debugMode) fallbackResult.debugInfo = debugInfo;
    return fallbackResult;
  }
}