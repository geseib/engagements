/**
 * PUT /games/{gameId}/persona — switch Workie's voice mid-session.
 *
 * The switch applies to the NEXT question: get-ai-summary.js reads
 * `metadata.PersonaId` when it generates, so a summary already on screen keeps
 * the voice it was written in. Regenerating the current one is the separate
 * Redo control (`?generateNew=true`).
 *
 * ⚠️ This is deliberately a narrow UpdateCommand and NOT a revival of
 * `websocket/save-game-context.js`, which `Put`s a whole METADATA item seeded
 * from the CONTEXT record. That Put would silently destroy ScoringConfig,
 * Details, Visibility, AccessCode, Started and LastPlayedAt — every attribute
 * it does not happen to know about. Touch one attribute, leave the rest alone.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const CORS = { 'Access-Control-Allow-Origin': '*' };
const reply = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: CORS
});

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    if (!gameId) return reply(400, { error: 'gameId is required' });

    // '' / null / omitted all mean "go back to the default", which is the
    // adaptive inferred voice — not "leave it as it was". The set's own
    // persona, if it has one, takes over again at that point.
    const raw = body.personaId;
    const personaId = raw === undefined || raw === null ? '' : String(raw).trim();
    const clearing = personaId === '';

    if (!clearing) {
      // Reject an unknown id at the boundary rather than writing a dangling
      // reference. resolvePersona() still degrades gracefully for a persona
      // retired *after* it was picked — this only stops garbage going in.
      const persona = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'AIPROMPTS', SK: `PERSONA#${personaId}` }
      }));
      if (!persona.Item) {
        return reply(404, { error: 'Unknown persona', personaId });
      }
      if (persona.Item.status === 'inactive') {
        return reply(400, { error: 'Persona is inactive', personaId });
      }
    }

    const params = clearing
      ? {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
          UpdateExpression: 'REMOVE PersonaId',
          // Without this an Update on a missing key CREATES the item — a
          // METADATA row with nothing but a persona on it.
          ConditionExpression: 'attribute_exists(PK)'
        }
      : {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
          UpdateExpression: 'SET PersonaId = :personaId',
          ExpressionAttributeValues: { ':personaId': personaId },
          ConditionExpression: 'attribute_exists(PK)'
        };

    try {
      await db.send(new UpdateCommand(params));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return reply(404, { error: 'Game not found', gameId });
      }
      throw err;
    }

    console.log(`🎭 Game ${gameId} persona ${clearing ? 'cleared' : `set to ${personaId}`} — applies from the next question`);

    return reply(200, {
      gameId,
      personaId: clearing ? null : personaId,
      appliesTo: 'next-question',
      message: clearing
        ? 'Workie will adapt its voice to the session from the next question.'
        : `Workie will use this voice from the next question. Use Redo to rewrite the one on screen.`
    });
  } catch (error) {
    console.error('❌ Failed to update game persona:', error);
    return reply(500, { error: 'Failed to update persona', details: error.message });
  }
};
