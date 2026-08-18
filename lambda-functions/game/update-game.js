/**
 * PUT /games/{gameId} — edit a session BEFORE it starts.
 *
 * The owner's ask was "edit a session before it starts", and the gate is
 * exactly start-game.js's predicate: the STATE row must exist and be
 * `State === 'CREATED'`. Once a session has started its setup is history —
 * players have joined against it — so a started session is refused with the
 * same 400 shape start-game uses for the mirror-image case.
 *
 * ⚠️ NARROW UpdateCommands ONLY, NEVER A Put. The header of
 * update-game-persona.js records the landmine: an earlier whole-item Put on
 * METADATA (websocket/save-game-context.js) silently destroyed ScoringConfig,
 * Details, Visibility, AccessCode, Started and LastPlayedAt — every attribute
 * it did not happen to know about. This handler touches exactly the attributes
 * the caller named and leaves the rest alone.
 *
 * THE WHITELIST, and what is deliberately NOT on it this round:
 *
 *   eventTitle          → Title            (mirrored onto the GAMES row)
 *   engagementInfo      → Details
 *   aiContext           → AIContext
 *   personaId           → PersonaId        ('' clears, matching PUT /persona)
 *   visibility          → Visibility       (mirrored onto the GAMES row)
 *   anonymousUntilReveal→ HostPreferences.anonymousUntilReveal (nested path)
 *
 *   - gameType / questionSetId: the create path pins derived rows to them —
 *     QuestionSetVersion on METADATA and the GAMES row, the CATEGORY#*#ORDER
 *     shuffles and STATE#CATS (schema-compliant-manager.js). Changing either
 *     here would leave every one of those rows describing a set the game no
 *     longer plays. Phase 2, if ever, must rebuild them all.
 *   - randomizeQuestions: pinned for the same reason — the per-category ORDER
 *     rows were shuffled (or not) at create time; flipping the flag afterwards
 *     would not reorder them.
 *   - accessCode: deliberately kept off. get-game.js:79-92 records that the
 *     code was REMOVED from the unauthenticated read path because it is the
 *     whole private-game control; the edit surface does not get to rotate it
 *     until there is a design for re-informing the players who already hold it.
 *
 * THE MIRROR. PK='GAMES' SK='GAME#{id}' is a duplicate index row carrying
 * Title and Visibility (schema-compliant-manager.js:44-64). An edit that
 * touches either must land there too or every session list goes stale.
 *
 * Auth: the template route carries the Cognito authorizer, and
 * authorizer.js:191 already requires hosts/admins for PUT on a games path.
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

const VISIBILITIES = ['public', 'private'];
const EDITABLE_FIELDS = [
  'eventTitle', 'engagementInfo', 'aiContext', 'personaId', 'visibility', 'anonymousUntilReveal'
];

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    if (!gameId) return reply(400, { error: 'Game ID is required' });

    // Same gate as start-game.js:22-45 — the STATE row is the authority on
    // whether this session is still editable.
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    if (!gameState.Item) {
      return reply(404, { error: 'Game not found' });
    }

    const currentState = gameState.Item.State;
    if (currentState !== 'CREATED') {
      return reply(400, {
        error: 'Game cannot be edited',
        message: `Game is in state '${currentState}'. Can only edit games in 'CREATED' state.`
      });
    }

    // Field-by-field builder in the style of admin/edit-question-set.js:
    // `'field' in body` so an omitted key is left untouched while a key present
    // with null/'' is a deliberate clear.
    const sets = [];
    const removes = [];
    const names = {};
    const values = {};
    const applied = {};

    if ('eventTitle' in body) {
      const title = body.eventTitle === null ? '' : String(body.eventTitle).trim();
      if (!title) {
        // The live host screen and every list row are named by the title;
        // a blank one is a session nothing can refer to.
        return reply(400, { error: 'eventTitle cannot be blank' });
      }
      names['#title'] = 'Title';
      values[':title'] = title;
      sets.push('#title = :title');
      applied.eventTitle = title;
    }

    if ('engagementInfo' in body) {
      const details = body.engagementInfo === null ? '' : String(body.engagementInfo);
      names['#details'] = 'Details';
      values[':details'] = details;
      sets.push('#details = :details');
      applied.engagementInfo = details;
    }

    if ('aiContext' in body) {
      const aiContext = body.aiContext === null ? '' : String(body.aiContext);
      names['#aiContext'] = 'AIContext';
      values[':aiContext'] = aiContext;
      sets.push('#aiContext = :aiContext');
      applied.aiContext = aiContext;
    }

    if ('personaId' in body) {
      // '' / null mean "adapt to the session", stored as an ABSENT attribute —
      // the same clear semantics as PUT /games/{gameId}/persona. No library
      // lookup here: the edit dialog only offers ids the picker fetched, and
      // resolvePersona() degrades gracefully for a dangling id anyway; the
      // dedicated persona route remains the validating mid-game switch.
      const personaId = body.personaId === null ? '' : String(body.personaId).trim();
      names['#personaId'] = 'PersonaId';
      if (personaId === '') {
        removes.push('#personaId');
        applied.personaId = null;
      } else {
        values[':personaId'] = personaId;
        sets.push('#personaId = :personaId');
        applied.personaId = personaId;
      }
    }

    if ('visibility' in body) {
      // Validated like engagementType in edit-question-set.js — a typo here
      // silently changes who can find the session.
      if (!VISIBILITIES.includes(body.visibility)) {
        return reply(400, {
          error: `Unknown visibility "${body.visibility}". Expected one of: ${VISIBILITIES.join(', ')}`
        });
      }
      names['#visibility'] = 'Visibility';
      values[':visibility'] = body.visibility;
      sets.push('#visibility = :visibility');
      applied.visibility = body.visibility;
    }

    if ('anonymousUntilReveal' in body) {
      // The anonymity gate reads only an explicit boolean false as "off"
      // (game/anonymity.js), so nothing but a boolean is accepted here.
      if (typeof body.anonymousUntilReveal !== 'boolean') {
        return reply(400, { error: 'anonymousUntilReveal must be a boolean' });
      }
      // Nested path — the flag lives INSIDE HostPreferences, beside
      // randomizeQuestions, which must survive the edit untouched. A top-level
      // AnonymousUntilReveal attribute would be read by nobody.
      names['#hostPreferences'] = 'HostPreferences';
      names['#anonymousUntilReveal'] = 'anonymousUntilReveal';
      values[':anonymousUntilReveal'] = body.anonymousUntilReveal;
      sets.push('#hostPreferences.#anonymousUntilReveal = :anonymousUntilReveal');
      applied.anonymousUntilReveal = body.anonymousUntilReveal;
    }

    if (sets.length === 0 && removes.length === 0) {
      return reply(400, {
        error: 'Nothing to update',
        message: `Editable fields: ${EDITABLE_FIELDS.join(', ')}`
      });
    }

    try {
      // A nested SET fails on a METADATA row that predates HostPreferences
      // ("document path does not exist"), so the map is ensured first. This is
      // a no-op for every row schema-compliant-manager.js has written since the
      // flag existed, and the condition doubles as the 404 guard — without it
      // an Update on a missing key CREATES the item.
      if ('anonymousUntilReveal' in applied) {
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #hostPreferences = if_not_exists(#hostPreferences, :emptyMap)',
          ExpressionAttributeNames: { '#hostPreferences': 'HostPreferences' },
          ExpressionAttributeValues: { ':emptyMap': {} },
          ConditionExpression: 'attribute_exists(PK)'
        }));
      }

      let updateExpression = '';
      if (sets.length) updateExpression += `SET ${sets.join(', ')}`;
      if (removes.length) updateExpression += `${sets.length ? ' ' : ''}REMOVE ${removes.join(', ')}`;

      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ConditionExpression: 'attribute_exists(PK)'
      }));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return reply(404, { error: 'Game not found', gameId });
      }
      throw err;
    }

    // THE MIRROR. Title and Visibility are duplicated onto the GAMES index row
    // (schema-compliant-manager.js:44-64); an edit that skips this leaves every
    // session list showing the old values.
    if ('eventTitle' in applied || 'visibility' in applied) {
      const mirrorSets = [];
      const mirrorNames = {};
      const mirrorValues = {};
      if ('eventTitle' in applied) {
        mirrorNames['#title'] = 'Title';
        mirrorValues[':title'] = applied.eventTitle;
        mirrorSets.push('#title = :title');
      }
      if ('visibility' in applied) {
        mirrorNames['#visibility'] = 'Visibility';
        mirrorValues[':visibility'] = applied.visibility;
        mirrorSets.push('#visibility = :visibility');
      }
      try {
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: 'GAMES', SK: `GAME#${gameId}` },
          UpdateExpression: `SET ${mirrorSets.join(', ')}`,
          ExpressionAttributeNames: mirrorNames,
          ExpressionAttributeValues: mirrorValues,
          // Without this, a missing index row would be CONJURED as a ghost
          // list entry carrying nothing but a title.
          ConditionExpression: 'attribute_exists(PK)'
        }));
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
        // The METADATA edit already landed; a missing index row (TTL skew) is
        // logged, not turned into a failure for a request that succeeded.
        console.warn(`⚠️ No GAMES index row to mirror onto for game ${gameId}`);
      }
    }

    console.log(`✏️ Game ${gameId} updated:`, Object.keys(applied).join(', '));

    return reply(200, {
      gameId,
      // Echoed back so the UI can state exactly what landed instead of a
      // generic "saved" that looks identical to a failed save.
      updated: applied,
      message: 'Session updated'
    });
  } catch (error) {
    console.error('❌ Failed to update game:', error);
    return reply(500, { error: `Failed to update game: ${error.message}` });
  }
};
