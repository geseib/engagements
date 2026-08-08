/**
 * Question-set VERSIONING — the single place that decides which DynamoDB
 * partition a set's questions and categories are read from.
 *
 * See docs/superpowers/specs/2026-08-08-question-set-versioning-design.md.
 *
 *   PK = SETS              SK = SET#<setId>            set metadata (unchanged)
 *   PK = SET#<setId>#v<n>  SK = QUESTION#<cat>#<num>   questions, per version
 *   PK = SET#<setId>#v<n>  SK = CATEGORY#<cat>         categories, per version
 *   PK = SET#<setId>       SK = QUESTION#… / CATEGORY# LEGACY, pre-versioning
 *
 * RESOLUTION ORDER — every runtime read goes through resolveSetPartition():
 *
 *   1. the game's pinned QuestionSetVersion   -> SET#<setId>#v<n>
 *   2. the set's activeVersion                -> SET#<setId>#v<n>
 *   3. legacy                                 -> SET#<setId>
 *
 * Step 3 is NOT optional and must not be removed until every environment has
 * been migrated AND the legacy rows swept. Every set that exists today, and
 * every game created before this change, has no version anywhere; they must
 * keep playing with no migration run at all.
 *
 * The pin wins over activeVersion because that is the entire point of the
 * design: replacing a set writes a NEW version and flips activeVersion, and a
 * game already in progress must keep reading the questions it started on. The
 * one exception is a pin whose version has since been deleted (delete warns
 * rather than blocks, so this is reachable) — a game with a dangling pin falls
 * through to activeVersion instead of reading an empty partition and ending
 * itself with "no more questions".
 *
 * DUPLICATED — Lambda bundles are per-directory (CodeUri: lambda-functions/game,
 * .../websocket, .../admin), so a module cannot be shared across them. Keep all
 * three byte-identical apart from the "(this file)" marker:
 *   - lambda-functions/admin/shared/set-version.js   (this file)
 *   - lambda-functions/game/set-version.js
 *   - lambda-functions/websocket/set-version.js
 */

const { GetCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

// DynamoDB hard limit — BatchWriteItem rejects more than 25 requests.
const BATCH_LIMIT = 25;
// Total attempts per chunk (1 initial + 5 retries) before giving up loudly.
const MAX_BATCH_ATTEMPTS = 6;
const RETRY_BASE_MS = Number(process.env.BATCH_RETRY_BASE_MS || 50);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A usable version number, or null for anything that is not a positive integer.
 * Deliberately strict: "", null, undefined, 0, "abc" and 1.5 all mean "no
 * version", which is what makes the legacy fallback fire.
 */
function toVersion(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** `SET#<id>#v<n>`, or the legacy `SET#<id>` when there is no version. */
function setPartition(setId, version) {
  const n = toVersion(version);
  return n ? `SET#${setId}#v${n}` : `SET#${setId}`;
}

/** The metadata row key. Metadata never moves — only content is versioned. */
const setMetadataKey = (setId) => ({ PK: 'SETS', SK: `SET#${setId}` });

/** The `versions[]` array, always an array. */
function versionList(meta) {
  return Array.isArray(meta && meta.versions) ? meta.versions : [];
}

/** Every version number recorded in `versions[]`, ascending. */
function knownVersions(meta) {
  return versionList(meta)
    .map((v) => toVersion(v && v.version))
    .filter((n) => n !== null)
    .sort((a, b) => a - b);
}

/**
 * The version number a new import should write to.
 *
 * Max of activeVersion and every recorded version, plus one — so a version that
 * was deleted is never reused, and a re-import after a delete cannot collide
 * with a game still pinned to the old number.
 */
function nextVersion(meta) {
  const candidates = knownVersions(meta);
  const active = toVersion(meta && meta.activeVersion);
  if (active) candidates.push(active);
  return candidates.length ? Math.max(...candidates) + 1 : 1;
}

/**
 * Resolve from metadata the caller already has, so a handler that reads the
 * SETS row for other reasons does not read it twice.
 *
 * @returns {{setId, pk, version, source}} `source` is one of
 *          'pinned' | 'active' | 'legacy' | 'pinned-missing'
 */
function resolvePartitionFromMeta(setId, meta, pinnedVersion) {
  const pinned = toVersion(pinnedVersion);
  const active = toVersion(meta && meta.activeVersion);

  if (pinned) {
    const known = knownVersions(meta);
    // Trust the pin when metadata is unreadable or does not track versions yet:
    // an unmigrated set with an explicitly pinned game is not a case we want to
    // silently rewrite.
    if (!meta || known.length === 0 || known.includes(pinned)) {
      return { setId, pk: setPartition(setId, pinned), version: pinned, source: 'pinned' };
    }
    // The pinned version has been deleted. Fall through rather than serve an
    // empty partition, and say so in `source` so the log names the cause.
    if (active) {
      return { setId, pk: setPartition(setId, active), version: active, source: 'pinned-missing' };
    }
    return { setId, pk: setPartition(setId, null), version: null, source: 'pinned-missing' };
  }

  if (active) {
    return { setId, pk: setPartition(setId, active), version: active, source: 'active' };
  }

  return { setId, pk: setPartition(setId, null), version: null, source: 'legacy' };
}

/** Read the SETS metadata row. Returns undefined when the set does not exist. */
async function getSetMetadata(db, tableName, setId) {
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: setMetadataKey(setId),
  }));
  return res && res.Item;
}

/**
 * THE runtime entry point. One metadata read, then the 1-2-3 above.
 *
 * @param pinnedVersion the game's `QuestionSetVersion`, or undefined/null when
 *        the game predates pinning (which is every game created so far).
 * @returns {Promise<{setId, pk, version, source, metadata}>}
 */
async function resolveSetPartition(db, tableName, setId, pinnedVersion) {
  const metadata = await getSetMetadata(db, tableName, setId);
  const resolved = resolvePartitionFromMeta(setId, metadata, pinnedVersion);
  console.log(`📚 set ${setId}: reading ${resolved.pk} (${resolved.source})`);
  return { ...resolved, metadata };
}

/**
 * Every item in one partition, following LastEvaluatedKey to the end.
 *
 * A Query response caps at 1 MB; a single un-paginated Query silently returns a
 * prefix of the partition, which is how a "copy" ends up short.
 */
async function queryPartition(db, tableName, partitionKey, skPrefix) {
  const items = [];
  let exclusiveStartKey;
  let pages = 0;

  do {
    const params = {
      TableName: tableName,
      KeyConditionExpression: skPrefix
        ? 'PK = :pk AND begins_with(SK, :sk)'
        : 'PK = :pk',
      ExpressionAttributeValues: skPrefix
        ? { ':pk': partitionKey, ':sk': skPrefix }
        : { ':pk': partitionKey },
      ExclusiveStartKey: exclusiveStartKey,
    };
    const res = await db.send(new QueryCommand(params));
    items.push(...((res && res.Items) || []));
    exclusiveStartKey = res && res.LastEvaluatedKey;
    pages += 1;
  } while (exclusiveStartKey);

  return { items, pages };
}

/**
 * Write items in chunks of 25, RESUBMITTING UnprocessedItems with bounded
 * exponential backoff.
 *
 * DynamoDB returns UnprocessedItems on partial throttling WITHOUT raising an
 * error. Dropping them loses rows, which is exactly how a large import ends up
 * silently short. Throws if anything is still pending after the retry budget.
 */
async function batchPutItems(db, tableName, items) {
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    let pending = items.slice(i, i + BATCH_LIMIT).map((Item) => ({ PutRequest: { Item } }));

    for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS && pending.length > 0; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      const res = await db.send(new BatchWriteCommand({
        RequestItems: { [tableName]: pending },
      }));
      pending = (res && res.UnprocessedItems && res.UnprocessedItems[tableName]) || [];
    }

    if (pending.length > 0) {
      throw new Error(`DynamoDB kept throttling ${pending.length} item(s) after ${MAX_BATCH_ATTEMPTS} attempts`);
    }
  }
}

/**
 * Copy every row of one set partition to another, rewriting only PK.
 *
 * Used by the migration script (legacy -> #v1) and by REPLACE when the target
 * set has never been migrated: the legacy content is snapshotted to #v1 first,
 * so the version the replace supersedes actually exists and rollback is a
 * promote rather than a restore.
 *
 * @returns {Promise<number>} rows copied
 */
async function copyPartition(db, tableName, fromPk, toPk) {
  const { items } = await queryPartition(db, tableName, fromPk);
  if (items.length === 0) return 0;
  const copies = items.map((item) => ({ ...item, PK: toPk }));
  await batchPutItems(db, tableName, copies);
  return copies.length;
}

/**
 * Every game pinned to a given version of a set, with whether it has ended.
 *
 * One paginated Query of the GAMES index partition, then one GetItem per
 * candidate for its STATE — the index row records Started/LastPlayedAt but not
 * ENDED, and "has this game finished" is the only question that matters here.
 * Candidates are already filtered to one set and one version, so this is a
 * handful of reads, not a table walk.
 *
 * Games with NO pin are deliberately not matched: they resolve through
 * activeVersion, so deleting a non-active version cannot affect them. (Deleting
 * the ACTIVE version is refused outright, which is what closes that gap.)
 */
async function findGamesPinnedToVersion(db, tableName, setId, version) {
  const n = toVersion(version);
  if (!n) return [];

  const { items } = await queryPartition(db, tableName, 'GAMES', 'GAME#');
  const candidates = items.filter((g) =>
    g.QuestionSetId === setId && toVersion(g.QuestionSetVersion) === n);

  const games = [];
  for (const g of candidates) {
    const gameId = String(g.SK).replace('GAME#', '');
    let state = 'UNKNOWN';
    try {
      const res = await db.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      }));
      // A GAMES row with no STATE row is a game whose session rows have already
      // expired via TTL — treat it as finished rather than warning about it.
      state = (res && res.Item && res.Item.State) || 'EXPIRED';
    } catch (e) {
      console.error(`⚠️ Could not read state for game ${gameId}: ${e.message}`);
    }
    games.push({
      gameId,
      title: g.Title || '',
      state,
      ended: state === 'ENDED' || state === 'EXPIRED',
    });
  }
  return games;
}

module.exports = {
  BATCH_LIMIT,
  findGamesPinnedToVersion,
  MAX_BATCH_ATTEMPTS,
  toVersion,
  setPartition,
  setMetadataKey,
  versionList,
  knownVersions,
  nextVersion,
  resolvePartitionFromMeta,
  resolveSetPartition,
  getSetMetadata,
  queryPartition,
  batchPutItems,
  copyPartition,
};
