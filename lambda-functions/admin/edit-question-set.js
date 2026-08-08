const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Canonical engagement type ids, mirroring src/src/config/gameTypes.js.
 *
 * The lambda bundle cannot import the frontend ESM module, so the list is
 * duplicated here deliberately. Keep the two in sync.
 */
const GAME_TYPE_IDS = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];
const GAME_TYPE_ALIASES = {
  callandanswer: 'call-and-answer',
  call_and_answer: 'call-and-answer',
  calland: 'call-and-answer',
  quiz: 'trivia',
  polls: 'poll'
};

/** Canonical id for any spelling, or null when the value is not a known type. */
function normalizeGameType(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (GAME_TYPE_IDS.includes(key)) return key;
  if (GAME_TYPE_ALIASES[key]) return GAME_TYPE_ALIASES[key];
  return null;
}

/**
 * Every optional attribute the editor can write.
 *
 * All of them are aliased through ExpressionAttributeNames — `name` is a
 * DynamoDB reserved word and the rest cost nothing to alias, so there is one
 * rule instead of a per-field judgement call.
 */
const OPTIONAL_FIELDS = [
  'description',
  'customInstruction',
  'aiContextInstruction',
  'promptId',
  'roundNoun',
  'personaId'
];

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const body = JSON.parse(event.body || '{}');
    const { name } = body;

    console.log(`Editing question set ${setId}`);

    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    if (!name || !name.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Update the question set metadata.
    //
    // `updatedAt` is lower-case to match every other writer (upload-questions.js,
    // toggle-question-set.js) and the reader in get-question-sets.js. This used
    // to write `UpdatedAt`, so an edit never moved the timestamp the list shows
    // and the owner got no feedback that a save had landed.
    const updateParams = {
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` },
      UpdateExpression: 'SET #name = :name, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':name': name.trim(),
        ':updatedAt': new Date().toISOString()
      }
    };

    // Clear-vs-skip semantics.
    //
    // The guard is `!== undefined`, NOT `!== null`. A key the caller omitted is
    // left untouched; a key present with '' (or null) is deliberately cleared and
    // written as an empty string. The old `!== null` guard made "blank this
    // field" a silent no-op — the old value simply reappeared on refresh — and
    // made it impossible to detach a promptId through the UI at all.
    //
    // null is coerced to '' rather than skipped: a caller that sends an explicit
    // null means "no value", which is exactly what an empty string records.
    // Downstream readers (get-ai-summary.js:800-841) test truthiness, so '' and
    // "attribute absent" behave identically at runtime.
    const applied = {};
    for (const field of OPTIONAL_FIELDS) {
      if (!(field in body) || body[field] === undefined) continue;
      const value = body[field] === null ? '' : String(body[field]).trim();
      updateParams.UpdateExpression += `, #${field} = :${field}`;
      updateParams.ExpressionAttributeNames[`#${field}`] = field;
      updateParams.ExpressionAttributeValues[`:${field}`] = value;
      applied[field] = value;
    }

    // engagementType is validated rather than free-form: a typo here silently
    // changes which phases the game runs and which default prompt resolves.
    if ('engagementType' in body && body.engagementType !== undefined && body.engagementType !== null) {
      const normalized = normalizeGameType(body.engagementType);
      if (!normalized) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Unknown engagement type "${body.engagementType}". Expected one of: ${GAME_TYPE_IDS.join(', ')}`
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      updateParams.UpdateExpression += ', #engagementType = :engagementType';
      updateParams.ExpressionAttributeNames['#engagementType'] = 'engagementType';
      updateParams.ExpressionAttributeValues[':engagementType'] = normalized;
      applied.engagementType = normalized;
    }

    await db.send(new UpdateCommand(updateParams));

    console.log(`✏️ Updated question set "${setId}" with name: ${name}`, applied);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Question set "${name}" updated successfully`,
        setId: setId,
        name: name,
        // Echoed back so the UI can state exactly what landed instead of
        // showing a generic "saved" that looks identical to a failed save.
        updated: applied
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Edit question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to edit question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
