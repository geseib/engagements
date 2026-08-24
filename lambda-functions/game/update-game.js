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
 *   - categoryIds IS accepted (see buildHostMasks) — the enabled SUBSET within
 *     the pinned set is mask state, not derived state.
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
 * THE MIRROR, AND IT MOVED. The duplicate index row carrying Title and
 * Visibility is now PK='ORG#{org}#GAMES' SK='GAME#{id}' — the global 'GAMES'
 * partition holds only the four-digit code reservation, `{orgId, ttl}`, and
 * nothing a list reads. An edit that mirrors onto the OLD key would write into
 * the reservation row: the session lists would stay stale AND the code registry
 * would grow attributes it must never carry. The owning org comes from
 * METADATA.orgId, not from the caller.
 *
 * Auth: the template route carries the Cognito authorizer, and
 * authorizer.js:191 already requires hosts/admins for PUT on a games path.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveSetPartition } = require('./set-version');
const { gamesIndexPk, callerMayDriveSession } = require('./tenant');
const { encryptValue } = require('./tenant-crypto');

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
  'eventTitle', 'engagementInfo', 'aiContext', 'personaId', 'visibility', 'anonymousUntilReveal',
  'categoryIds'
];

/**
 * Rebuild the three HostMask strings from a list of selected categories.
 *
 * THE SUBSET IS EDITABLE; THE SET IS NOT. The pinned-fields note above refuses
 * `questionSetId` because the create path derives rows from it (ORDER shuffles,
 * STATE#CATS, version pins) that an edit cannot honestly rebuild. WHICH of that
 * set's categories are enabled is a different kind of fact: it lives entirely
 * in the HostMask bits that toggle-category.js already flips mid-session, and
 * in METADATA.SelectedCategories. Nothing derived depends on it — the ORDER
 * rows exist for every category regardless — so editing it before start is the
 * same act as toggling it after, done in one write instead of N.
 *
 * Reported as: *"the edit doesnt allow chaging the categories or even see the
 * categories."*
 *
 * THE CONVENTION IS CREATE'S, EXACTLY (schema-compliant-manager.js:145-200):
 * categories in SK order, bit position = index + 1, and a selection may name a
 * category by ID or by NAME — both spellings are live in stored sessions, so
 * accepting only one would silently deselect half of history.
 */
const buildHostMasks = (allCategories, selectedIds) => {
  const masks = ['00000000', '00000000', '00000000'];
  const matched = new Set();

  allCategories.forEach((cat, i) => {
    const categoryId = String(cat.SK).replace('CATEGORY#', '');
    const categoryName = cat.CategoryName || cat.Name || '';
    const isSelected = selectedIds.includes(categoryId) || selectedIds.includes(categoryName);
    if (!isSelected) return;

    matched.add(categoryId);
    const which = Math.floor(i / 8);
    if (which > 2) return; // beyond 24 — the cap the picker already enforces
    const pos = i % 8;
    masks[which] = masks[which].substring(0, pos) + '1' + masks[which].substring(pos + 1);
  });

  return { masks, matched };
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    if (!gameId) return reply(400, { error: 'Game ID is required' });

    // Same gate as start-game.js:22-45 — the STATE row is the authority on
    // whether this session is still editable.
    // The owning org is fetched alongside the state gate: the mirror at the end
    // of this handler needs it, and a session that is not editable never gets
    // that far, so the two reads are the same round trip.
    const [gameState, gameMeta] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
        ProjectionExpression: 'orgId'
      })),
    ]);
    const ownerOrgId = (gameMeta.Item && gameMeta.Item.orgId) || '';

    if (!gameState.Item) {
      return reply(404, { error: 'Game not found' });
    }

    /* THE ORG WAS READ HERE ALL ALONG AND NEVER COMPARED TO THE CALLER. A host
       in another organisation renamed a live session through this route on dev
       — and the new title was written back encrypted under the VICTIM's key.
       404 rather than 403: see tenant.callerMayDriveSession. */
    if (!callerMayDriveSession(event, { orgId: ownerOrgId })) {
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
    // ── THE EDIT MUST NOT UN-ENCRYPT WHAT CREATE ENCRYPTED ──────────────────
    //
    // `Title`, `Details` and `AIContext` are ciphertext at rest on an org's
    // session (ENCRYPTED_FIELDS.session, written by
    // schema-compliant-manager.js). This handler overwrites those exact three
    // attributes, so without this every save would silently return them to
    // plaintext — the worst shape of this bug, because nothing misbehaves and
    // the row simply becomes readable again.
    //
    // Per VALUE rather than per item: `encryptItem` takes a row and there is
    // no row in an UpdateExpression. `applied` keeps the plaintext, because it
    // is echoed to the console so a host can see what landed.
    //
    // '' passes straight through (`encryptValue` skips blanks), so clearing
    // `engagementInfo` still records an empty string rather than noise.
    const store = async (value) => (ownerOrgId ? encryptValue(ownerOrgId, value) : value);

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
      values[':title'] = await store(title);
      sets.push('#title = :title');
      applied.eventTitle = title;
    }

    if ('engagementInfo' in body) {
      const details = body.engagementInfo === null ? '' : String(body.engagementInfo);
      names['#details'] = 'Details';
      values[':details'] = await store(details);
      sets.push('#details = :details');
      applied.engagementInfo = details;
    }

    if ('aiContext' in body) {
      const aiContext = body.aiContext === null ? '' : String(body.aiContext);
      names['#aiContext'] = 'AIContext';
      values[':aiContext'] = await store(aiContext);
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

    /*
      Categories are validated and staged HERE, written LAST (below, after the
      METADATA update succeeds) — the mask write targets a different item
      (STATE#CATS), and writing it first would leave the two disagreeing if the
      METADATA update then failed its condition check.
    */
    let stagedMasks = null;
    if ('categoryIds' in body) {
      if (!Array.isArray(body.categoryIds) || body.categoryIds.length === 0) {
        // No fallback-to-all here, deliberately. Create treats an empty
        // selection as "all categories" because the host never saw a picker;
        // an EDIT with an empty list is a host who deselected everything, and
        // a session with no reachable questions is not a thing to save.
        return reply(400, { error: 'categoryIds must name at least one category' });
      }

      const metadata = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      }));
      if (!metadata.Item) return reply(404, { error: 'Game not found' });

      const resolved = await resolveSetPartition(
        db, process.env.TABLE_NAME, metadata.Item.QuestionSetId,
        metadata.Item.QuestionSetVersion
      );
      const catQuery = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': resolved.pk, ':sk': 'CATEGORY#' }
      }));
      const allCategories = catQuery.Items || [];

      const { masks, matched } = buildHostMasks(allCategories, body.categoryIds);
      if (matched.size === 0) {
        // The whole list missed. A selection from a different set (or a stale
        // tab) must be refused out loud, not saved as "nothing enabled" — the
        // open-enum failure where every write succeeds and the session
        // quietly has no questions.
        return reply(400, {
          error: 'None of the given categoryIds exist in this session\'s question set'
        });
      }

      names['#selectedCategories'] = 'SelectedCategories';
      values[':selectedCategories'] = [...matched];
      sets.push('#selectedCategories = :selectedCategories');
      applied.categoryIds = [...matched];
      stagedMasks = masks;
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

    if (stagedMasks) {
      /*
        The masks land on STATE#CATS — the row toggle-category.js flips and
        every selector reads. attribute_exists guards the legacy session whose
        row predates the manager: refusing beats creating a bare item that
        carries masks but none of the counts its readers expect.
      */
      try {
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' },
          UpdateExpression: 'SET #m1 = :m1, #m2 = :m2, #m3 = :m3',
          ExpressionAttributeNames: {
            '#m1': 'HostMask1-8', '#m2': 'HostMask9-16', '#m3': 'HostMask17-24'
          },
          ExpressionAttributeValues: {
            ':m1': stagedMasks[0], ':m2': stagedMasks[1], ':m3': stagedMasks[2]
          },
          ConditionExpression: 'attribute_exists(PK)'
        }));
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return reply(409, {
            error: 'This session predates category state and its categories cannot be edited'
          });
        }
        throw err;
      }
    }

    // THE MIRROR. Title and Visibility are duplicated onto the OWNING ORG's
    // index row (schema-compliant-manager.js); an edit that skips this leaves
    // every session list showing the old values. A session with no owning org
    // has no index row at all, so there is nothing to mirror onto.
    if (ownerOrgId && ('eventTitle' in applied || 'visibility' in applied)) {
      const mirrorSets = [];
      const mirrorNames = {};
      const mirrorValues = {};
      if ('eventTitle' in applied) {
        mirrorNames['#title'] = 'Title';
        // The index row carries the SAME string, so it takes the same
        // treatment — one encrypted and one readable copy of a session title in
        // the same table is the inconsistency `session` exists to close.
        mirrorValues[':title'] = await store(applied.eventTitle);
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
          Key: { PK: gamesIndexPk(ownerOrgId), SK: `GAME#${gameId}` },
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
        console.warn(`⚠️ No session index row to mirror onto for game ${gameId} in org ${ownerOrgId}`);
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
