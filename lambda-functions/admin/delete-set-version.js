const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { collectPartitionKeys, batchDeleteKeys } = require('./shared/ddb-delete');
const {
  findGamesPinnedToVersion,
  knownVersions,
  setPartition,
  toVersion,
  versionList,
  setMetadataKey,
} = require('./shared/set-version');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * DELETE /admin/question-sets/{setId}/versions/{version}
 *
 * Any version may be deleted, including a non-active one. That is what makes
 * versioning survivable: otherwise every replace accumulates a partition
 * forever and the table only grows.
 *
 * Two rules, and they are deliberately asymmetric (see the design doc):
 *
 *   - Deleting the ACTIVE version is REFUSED, 409. Promote another version
 *     first. There is no safe interpretation of "delete the thing every new
 *     game is about to read".
 *
 *   - Deleting a version a NON-ENDED game is pinned to WARNS and names the
 *     games. Replace is safe by construction, so delete is the only dangerous
 *     operation left, and the owner chose warn over block: an operator cleaning
 *     up old versions should not be blocked forever by one session somebody
 *     left open.
 *
 *     The warning is a PRE-FLIGHT: the first call deletes NOTHING and returns
 *     200 with `deleted: false`, the warning text and the game ids. The admin UI
 *     shows those ids in a confirm dialog and re-issues the same request with
 *     `?confirm=true`, which performs the delete. Warning after the fact would
 *     be no warning at all — the sessions would already be stranded.
 *
 * ORDER MATTERS, and it is the opposite of delete-question-set.js.
 *
 * versions[] is updated FIRST, then the content rows are deleted. If the delete
 * dies partway we are left with orphan rows that nothing references — retryable,
 * invisible, harmless. The other order would leave versions[] naming a version
 * whose rows are gone, and a game pinned to it would resolve to an EMPTY
 * partition and immediately end itself. (resolvePartitionFromMeta already
 * handles the dangling pin: a pin not present in versions[] falls through to
 * activeVersion, which is precisely why this order is the safe one.)
 */
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*' };
  const tableName = process.env.TABLE_NAME;
  const setId = event.pathParameters?.setId;
  const requested = event.pathParameters?.version;
  // `?confirm=true` is the operator having read the warning and re-submitted.
  const confirmed = String((event.queryStringParameters || {}).confirm ?? '')
    .toLowerCase() === 'true';

  try {
    if (!setId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Set ID is required' }), headers };
    }

    const version = toVersion(requested);
    if (version === null) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `"${requested}" is not a version number.` }),
        headers
      };
    }

    // WHICH LIBRARY, THEN WHO. `findSetForCaller` searches only the scopes this
    // caller may READ, so another organisation's set is ABSENT rather than
    // forbidden and this 404s on it. The row it returns carries its own scope
    // and `requireSetManager` reads it — platform sets are Engage staff's, org
    // sets are that org's, and being an Engage administrator grants nothing
    // inside an org. See shared/question-set-access.js.
    const found = await findSetForCaller(db, tableName, event, setId, requestedScope(event));
    const meta = found && found.item;
    if (!meta) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Question set not found' }), headers };
    }

    // 403 BEFORE anything is written. A version promote flips which questions
    // every future session of this set plays, and a version delete removes rows;
    // both are management of the set, gated by the same rule as editing it.
    const denied = requireSetManager(event, meta, 'delete a version of');
    if (denied) return denied;

    const activeVersion = toVersion(meta.activeVersion);
    const known = knownVersions(meta);

    if (!known.includes(version)) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: `Question set "${setId}" has no version ${version}.`,
          availableVersions: known,
          activeVersion
        }),
        headers
      };
    }

    // RULE 1 — never delete the active version.
    if (activeVersion === version) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: `Version ${version} is the active version of "${setId}". Promote another version first, then delete this one.`,
          activeVersion
        }),
        headers
      };
    }

    // RULE 2 — warn about live games pinned to it. Not a block: a second call
    // carrying ?confirm=true goes through.
    // The REF, not the id: an org's sessions are indexed in that org's own
    // partition, and a bare id would walk the pre-tenancy global index and find
    // nothing — reporting "no live games" for a version several rooms are
    // playing right now, which is the one answer this warning must not give.
    const pinned = await findGamesPinnedToVersion(db, tableName, found.ref, version);
    const live = pinned.filter((g) => !g.ended);

    if (live.length > 0 && !confirmed) {
      const warning = `${live.length} game(s) still in progress are pinned to version ${version}. `
        + `Deleting it drops them back to version ${activeVersion ?? 'the legacy content'} `
        + `for their remaining rounds. Re-send with ?confirm=true to delete anyway.`;
      console.log(`⚠️ Pre-flight: ${warning} (${live.map((g) => g.gameId).join(', ')})`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          deleted: false,
          requiresConfirmation: true,
          setId,
          version,
          activeVersion,
          warning,
          pinnedByGames: live.map((g) => g.gameId),
          pinnedGames: live
        }),
        headers
      };
    }

    // Drop the version from versions[] BEFORE removing its rows, so nothing can
    // resolve to a partition that is mid-delete. The condition makes the
    // "not the active version" check hold at write time too, closing the race
    // where a promote lands between the read above and this write.
    const remaining = versionList(meta).filter((v) => toVersion(v && v.version) !== version);

    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: setMetadataKey(found.ref),
      // Aliased throughout — see the note in upload-questions.js.
      UpdateExpression: 'SET #versions = :versions, #updatedAt = :now',
      ConditionExpression: 'attribute_not_exists(#activeVersion) OR #activeVersion <> :v',
      ExpressionAttributeNames: {
        '#versions': 'versions',
        '#updatedAt': 'updatedAt',
        '#activeVersion': 'activeVersion'
      },
      ExpressionAttributeValues: {
        ':versions': remaining,
        ':now': new Date().toISOString(),
        ':v': version
      }
    })).catch((e) => {
      if (e.name === 'ConditionalCheckFailedException') {
        const err = new Error(`Version ${version} became the active version while it was being deleted. Nothing was removed.`);
        err.statusCode = 409;
        throw err;
      }
      throw e;
    });

    // Now the content. Paginated enumeration + UnprocessedItems retry, the same
    // machinery delete-question-set.js uses, scoped to one version's partition.
    const partition = setPartition(found.ref, version);
    const { keys, pages } = await collectPartitionKeys(db, tableName, partition);
    const deleted = keys.length ? await batchDeleteKeys(db, tableName, keys) : 0;

    console.log(`🗑️ Deleted ${deleted} row(s) of ${partition} across ${pages} query page(s)`);

    const body = {
      deleted: true,
      setId,
      version,
      itemsDeleted: deleted,
      activeVersion,
      remainingVersions: remaining.map((v) => toVersion(v && v.version)).filter((n) => n !== null)
    };

    if (live.length > 0) {
      body.warning = `${live.length} game(s) still in progress were pinned to version ${version}. `
        + `They now fall back to version ${activeVersion ?? 'the legacy content'} for their remaining rounds.`;
      body.pinnedByGames = live.map((g) => g.gameId);
      body.pinnedGames = live;
      body.confirmed = true;
      console.log(`⚠️ ${body.warning} (${body.pinnedByGames.join(', ')})`);
    }

    return { statusCode: 200, body: JSON.stringify(body), headers };

  } catch (error) {
    console.error('Delete set version error:', error);

    if (error.statusCode === 409) {
      return { statusCode: 409, body: JSON.stringify({ error: error.message }), headers };
    }

    // batchDeleteKeys throws with `deleted`/`remaining` attached rather than
    // under-deleting in silence. The version is already out of versions[], so a
    // retry is safe: what is left is unreferenced rows.
    const partial = typeof error.deleted === 'number';
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `Failed to delete version: ${error.message}`,
        partial,
        itemsDeleted: partial ? error.deleted : undefined,
        remaining: partial ? error.remaining.length : undefined,
        hint: 'The version is no longer listed and nothing resolves to it. Retry to clear the remaining rows.'
      }),
      headers
    };
  }
};
