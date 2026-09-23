/**
 * PUT /games/{gameId}/prompt — switch Workie's summary approach mid-session.
 *
 * The twin of PUT /games/{gameId}/persona (update-game-persona.js), for the
 * select beside it on the results stage. Same next-round rule:
 * get-ai-summary.js reads `metadata.PromptId` (sessionPromptId: session beats
 * set beats the game-type default) when it generates, so a summary already on
 * screen keeps the approach it was written with. Regenerating the current one
 * is the separate Redo control (`?generateNew=true`).
 *
 * WHY THIS IS NOT PUT /games/{gameId}. The stage select was first wired there,
 * to update-game.js, which is the PRE-START edit route: it refuses any session
 * whose STATE is not `CREATED` with 400 "Game cannot be edited". The select
 * only renders on a results stage, so every switch failed. update-game.js keeps
 * that rule, and keeps its own `promptId` for a session not yet started; a
 * live one is switched here.
 *
 * ⚠️ A narrow UpdateCommand on ONE attribute, never a Put — see the header of
 * update-game-persona.js for what a whole-item write destroyed.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { callerMayDriveSession, ORG, PLATFORM, promptsMetadataPk } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const CORS = { 'Access-Control-Allow-Origin': '*' };
const reply = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: CORS
});

/**
 * The libraries this session's summary can read, most specific first — the
 * order get-ai-summary.js:promptLibrariesFor reads them in. A prompt found
 * nowhere here is one the summary would never load, so it is refused rather
 * than stored; that includes another organisation's prompt.
 */
const promptLibrariesFor = (orgId) => (
  orgId ? [promptsMetadataPk(ORG, orgId), promptsMetadataPk(PLATFORM)] : [promptsMetadataPk(PLATFORM)]
);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    if (!gameId) return reply(400, { error: 'gameId is required' });

    // WHOSE ROOM IS THIS? The same question, and the same 404 rather than 403,
    // as update-game-persona.js — see tenant.callerMayDriveSession.
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return reply(404, { error: 'Game not found', gameId });
    }

    // '' / null / omitted all mean "go back to the default": the set's own
    // promptId, else the format's standard prompt. Not "leave it as it was".
    const raw = body.promptId;
    const promptId = raw === undefined || raw === null ? '' : String(raw).trim();
    const clearing = promptId === '';

    if (!clearing) {
      // Reject a bad id at the boundary rather than writing it.
      // resolvePromptTemplate() still degrades gracefully for a prompt retired
      // *after* it was picked — this only stops garbage going in.
      const orgId = String((ownerRead.Item && ownerRead.Item.orgId) || '').trim();
      let prompt = null;
      for (const pk of promptLibrariesFor(orgId)) {
        const hit = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: pk, SK: `AIPROMPT#${promptId}` }
        }));
        if (hit.Item) { prompt = hit.Item; break; }
      }
      if (!prompt) {
        return reply(404, { error: 'Unknown prompt', promptId });
      }
      if (prompt.status === 'inactive') {
        return reply(400, { error: 'Prompt is inactive', promptId });
      }
      // The stage picker never offers one (GameHostPage filters them out); a
      // generation prompt writes questions, not a round summary.
      if (prompt.promptType === 'generation') {
        return reply(400, { error: 'Prompt does not write summaries', promptId });
      }
    }

    const params = clearing
      ? {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
          UpdateExpression: 'REMOVE PromptId',
          // Without this an Update on a missing key CREATES the item — a
          // METADATA row with nothing but a prompt on it.
          ConditionExpression: 'attribute_exists(PK)'
        }
      : {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
          UpdateExpression: 'SET PromptId = :promptId',
          ExpressionAttributeValues: { ':promptId': promptId },
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

    console.log(`🧭 Game ${gameId} summary approach ${clearing ? 'cleared' : `set to ${promptId}`} — applies from the next question`);

    return reply(200, {
      gameId,
      promptId: clearing ? null : promptId,
      appliesTo: 'next-question',
      message: clearing
        ? 'Workie will follow the set, or the standard way, from the next question.'
        : 'Workie will use this approach from the next question. Use Redo to rewrite the one on screen.'
    });
  } catch (error) {
    console.error('❌ Failed to update game prompt:', error);
    return reply(500, { error: 'Failed to update prompt', details: error.message });
  }
};
