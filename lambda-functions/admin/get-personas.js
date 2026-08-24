/**
 * GET /admin/personas — the persona library.
 *
 * Personas live in the same partition as the AI prompts (PK='AIPROMPTS') but
 * under SK='PERSONA#<id>'. `get-ai-prompts.js` hard-filters
 * `begins_with(SK, 'AIPROMPT#')`, so personas are invisible to it — which is
 * why the handoff's claim that personas were "editable in the admin UI" was
 * false (D8). This handler is the read side that was missing.
 *
 * `gameTypes` has been stored on every persona since seeding and consulted by
 * nobody (D11). It is honoured here: `?gameType=trivia` returns the personas
 * that suit trivia plus the ones marked `['all']`.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { normalizeGameType, isKnownGameType } = require('./shared/game-types');

const tableName = process.env.TABLE_NAME;

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true }
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

/**
 * Does this persona suit the requested engagement type?
 *
 * `['all']` (the seed default) matches everything. A persona with no
 * `gameTypes` at all is treated as `['all']` rather than as "matches nothing" —
 * an omitted field must never make a persona disappear from the picker.
 * Comparison goes through normalizeGameType so a row stored as `callandanswer`
 * still matches a `call-and-answer` request; that vocabulary split is what made
 * every poll prompt filter return nothing.
 */
function personaMatchesGameType(persona, wanted) {
  if (!wanted) return true;
  const types = Array.isArray(persona.gameTypes) ? persona.gameTypes : [];
  if (types.length === 0) return true;
  if (types.some((t) => String(t).trim().toLowerCase() === 'all')) return true;
  // Only compare spellings we actually recognise. normalizeGameType falls back
  // to call-and-answer for junk, so an unrecognised entry would otherwise match
  // call-and-answer by accident.
  return types.some((t) => isKnownGameType(t) && normalizeGameType(t) === wanted);
}

/** A persona is offered unless it has been explicitly retired. */
const isActive = (persona) => persona.status !== 'inactive';

exports.handler = async (event) => {
  try {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return { statusCode: 200, headers: CORS, body: '' };
    }

    const queryParams = event.queryStringParameters || {};
    const gameTypeParam = queryParams.gameType;
    const includeInactive = queryParams.includeInactive === 'true';

    const wanted = gameTypeParam && gameTypeParam !== 'all'
      ? normalizeGameType(gameTypeParam)
      : null;

    console.log(`🎭 Fetching personas — gameType: ${gameTypeParam || '(any)'} → ${wanted || '(any)'}`);

    const response = await dynamodb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'AIPROMPTS', ':sk': 'PERSONA#' }
    }));

    const all = response.Items || [];
    console.log(`📊 Found ${all.length} persona records`);

    const personas = all
      .filter((p) => includeInactive || isActive(p))
      .filter((p) => personaMatchesGameType(p, wanted))
      .map((p) => ({
        // Synthesize the id from the SK when the attribute is missing, for the
        // same reason get-ai-prompts.js does: <option value={undefined}> makes
        // the browser fall back to the option's LABEL TEXT, which is how
        // garbage ended up written into a set's promptId.
        personaId: p.personaId || String(p.SK || '').replace(/^PERSONA#/, '') || undefined,
        name: p.name,
        tagline: p.tagline || '',
        icon: p.icon || 'UsersThree',
        gameTypes: Array.isArray(p.gameTypes) && p.gameTypes.length ? p.gameTypes : ['all'],
        isDefault: p.isDefault === true,
        sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : 500,
        status: p.status || 'active',
        // `voice` is the persona. It is long, and the picker never needs it —
        // only get-ai-summary.js reads it, straight from the table.
        voiceLength: typeof p.voice === 'string' ? p.voice.length : 0,
        updatedAt: p.updatedAt
      }))
      .filter((p) => p.personaId && p.name)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name)));

    console.log(`✅ Returning ${personas.length} personas`);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        personas,
        totalCount: personas.length,
        filters: { gameType: gameTypeParam || null, gameTypeNormalized: wanted }
      })
    };
  } catch (error) {
    console.error('❌ Error fetching personas:', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Failed to fetch personas', message: error.message })
    };
  }
};

// Exported for tests; the handler is the only production caller.
exports.personaMatchesGameType = personaMatchesGameType;
