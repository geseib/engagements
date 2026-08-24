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
 * ── SCOPE: THE SECOND HALF OF A SET REFERENCE ──────────────────────────────
 *
 * Those keys are the PLATFORM keys, and since multi-tenancy they are one scope
 * of three. `tenant.js` builds every partition; this module never concatenates
 * a prefix itself. The shapes above become, per scope:
 *
 *   platform  metadata PK 'SETS'              content PK 'SET#<id>[#v<n>]'
 *   org       metadata PK 'ORG#<org>#SETS'    content PK 'ORG#<org>#SET#<id>[#v<n>]'
 *   public    metadata PK 'PUBLIC#SETS'       content PK 'PUBLIC#SET#<id>[#v<n>]'
 *
 * The SORT key is `SET#<id>` in every scope — only the partition moves.
 *
 * SO A SET IS NAMED BY A PAIR, NOT AN ID: `{scope, orgId, setId}`. A setId is a
 * slug of the title (admin/upload-questions.js:298), so two organisations both
 * naming a set "Team Retro" produce the same `teamretro`; in one global
 * partition the second write silently clobbers the first. Every entry point
 * below therefore takes a `ref`, and `setRef()` normalises it.
 *
 * A BARE STRING IS ACCEPTED AND MEANS PLATFORM. That is not a convenience
 * default — it is the truth about today's rows, which all live at `PK='SETS'`
 * and are all platform content by the owner's decision. It also keeps the
 * pre-tenancy callers (and the migration scripts) reading exactly the rows they
 * read yesterday, which is what makes the migration empty. A caller that means
 * an org set must SAY so; nothing here infers one.
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
 *   - lambda-functions/admin/shared/set-version.js
 *   - lambda-functions/game/set-version.js      (this file)
 *   - lambda-functions/websocket/set-version.js
 */

const { GetCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./tenant');

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

/**
 * Normalise a set reference to `{scope, orgId, setId}`.
 *
 * Accepts either the pair or a bare setId string; a bare string is PLATFORM,
 * for the reason set out in the header. `scope: ''` on an object is likewise
 * platform — it is what a metadata row written before tenancy carries, and
 * those rows really are platform rows.
 *
 * Nothing is inferred from the caller here. This function is pure and is used
 * on both sides of the wire, including in tests; "which scope is this request
 * about" is answered by `readableSetRefs`/`findSetMetadata` below, which do
 * have an event to read.
 */
function setRef(ref) {
  if (ref && typeof ref === 'object') {
    return {
      scope: String(ref.scope ?? '').trim() || tenant.PLATFORM,
      orgId: String(ref.orgId ?? '').trim(),
      setId: String(ref.setId ?? '').trim(),
    };
  }
  return { scope: tenant.PLATFORM, orgId: '', setId: String(ref ?? '').trim() };
}

/**
 * The CONTENT partition: `SET#<id>#v<n>`, or the legacy `SET#<id>` when there
 * is no version — each prefixed by its scope. Delegated to tenant.js so there
 * is exactly one place that knows what a scope prefix looks like, and so a
 * typo'd scope throws here rather than quietly addressing the platform library.
 */
function setPartition(ref, version) {
  const { scope, orgId, setId } = setRef(ref);
  return tenant.setContentPk(scope, orgId, setId, toVersion(version));
}

/**
 * The metadata row key. Metadata never moves BETWEEN VERSIONS — only content is
 * versioned — but it does live in its scope's partition, and the SK is the same
 * `SET#<id>` in all three.
 */
function setMetadataKey(ref) {
  const { scope, orgId, setId } = setRef(ref);
  return { PK: tenant.setsMetadataPk(scope, orgId), SK: `SET#${setId}` };
}

/**
 * Every scope this caller may READ, as refs for one setId, MOST SPECIFIC FIRST.
 *
 * Order is org, then platform, then public, and it is load-bearing: an org that
 * makes its own "Team Retro" must get its own, not the platform one of the same
 * slug. Shadowing beats collision — the alternative is that adopting a name
 * Engage happens to have used makes your own set unreachable.
 *
 * `tenant.readableScopes` is the authority on which scopes are listed at all;
 * this only decides the order and attaches the caller's org id. Note that being
 * Engage staff adds nobody else's org, deliberately (see tenant.js).
 */
function readableSetRefs(event, setId) {
  const orgId = tenant.callerOrgId(event);
  const rank = { [tenant.ORG]: 0, [tenant.PLATFORM]: 1, [tenant.PUBLIC]: 2 };
  return tenant.readableScopes(event)
    .slice()
    .sort((a, b) => (rank[a] ?? 9) - (rank[b] ?? 9))
    .map((scope) => setRef({ scope, orgId: scope === tenant.ORG ? orgId : '', setId }));
}

/**
 * Find one set's metadata in the first readable scope that has it.
 *
 * This is how a handler that was handed only a setId — which is every existing
 * route, because the path is `/admin/question-sets/{setId}` — turns it back
 * into a pair. A caller that already knows the scope passes `requestedScope`
 * and gets exactly that one probe.
 *
 * IT IS ALSO THE READ GUARD. A scope the caller cannot read is never probed, so
 * another organisation's set is not "forbidden", it is ABSENT: the handler 404s
 * on it exactly as it would on a set that does not exist. That is the intended
 * answer — whether org B owns a set called `teamretro` is not a fact org A
 * should be able to establish.
 *
 * Costs at most three GetItems, and one when the scope is known.
 *
 * @returns {Promise<{ref, item}|null>}
 */
async function findSetMetadata(db, tableName, event, setId, requestedScope) {
  const wanted = String(requestedScope ?? '').trim();
  let refs = readableSetRefs(event, setId);
  if (wanted) refs = refs.filter((r) => r.scope === wanted);

  for (const ref of refs) {
    // scopePrefix throws on an org ref with no org id (an anonymous caller
    // cannot have one), which is a skip rather than a failure of the request.
    let key;
    try { key = setMetadataKey(ref); } catch { continue; }
    const res = await db.send(new GetCommand({ TableName: tableName, Key: key }));
    if (res && res.Item) return { ref, item: res.Item };
  }
  return null;
}

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
 * The four cases below are unchanged by tenancy — scope only decides WHICH
 * set's versions are being reasoned about, never which version wins.
 *
 * @returns {{setId, scope, orgId, pk, version, source}} `source` is one of
 *          'pinned' | 'active' | 'legacy' | 'pinned-missing'
 */
function resolvePartitionFromMeta(ref, meta, pinnedVersion) {
  const { scope, orgId, setId } = setRef(ref);
  const at = (v, source) => ({
    setId, scope, orgId, pk: setPartition({ scope, orgId, setId }, v), version: v, source,
  });
  const pinned = toVersion(pinnedVersion);
  const active = toVersion(meta && meta.activeVersion);

  if (pinned) {
    const known = knownVersions(meta);
    // Trust the pin when metadata is unreadable or does not track versions yet:
    // an unmigrated set with an explicitly pinned game is not a case we want to
    // silently rewrite.
    if (!meta || known.length === 0 || known.includes(pinned)) {
      return at(pinned, 'pinned');
    }
    // The pinned version has been deleted. Fall through rather than serve an
    // empty partition, and say so in `source` so the log names the cause.
    if (active) return at(active, 'pinned-missing');
    return at(null, 'pinned-missing');
  }

  if (active) return at(active, 'active');

  return at(null, 'legacy');
}

/**
 * Read one scope's metadata row. Returns undefined when the set does not exist
 * THERE — this takes a ref and probes exactly one partition, unlike
 * `findSetMetadata` above which searches the caller's readable scopes.
 */
async function getSetMetadata(db, tableName, ref) {
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: setMetadataKey(ref),
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
async function resolveSetPartition(db, tableName, ref, pinnedVersion) {
  const normalized = setRef(ref);
  const metadata = await getSetMetadata(db, tableName, normalized);
  const resolved = resolvePartitionFromMeta(normalized, metadata, pinnedVersion);
  console.log(`📚 set ${normalized.scope}/${normalized.setId}: reading ${resolved.pk} (${resolved.source})`);
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
async function findGamesPinnedToVersion(db, tableName, ref, version) {
  const n = toVersion(version);
  if (!n) return [];
  const { scope, orgId, setId } = setRef(ref);

  // WHICH SESSION INDEX TO WALK. An org's sessions are indexed in that org's own
  // partition; the global `GAMES` partition is the pre-tenancy index (and, since
  // tenancy, the 4-digit code reservation registry, which carries no set id and
  // therefore matches nothing here). An org-scoped set can only have been played
  // by that org, so walking one index is complete, not a shortcut.
  const indexPk = orgId ? tenant.gamesIndexPk(orgId) : tenant.GAMES_RESERVATION_PK;
  const { items } = await queryPartition(db, tableName, indexPk, 'GAME#');
  // A game pins the PAIR (QuestionSetScope beside QuestionSetId) since tenancy.
  // Rows with no scope recorded predate it and are platform rows, which is what
  // setRef() says an absent scope means everywhere else in this file.
  const candidates = items.filter((g) =>
    g.QuestionSetId === setId
    && (String(g.QuestionSetScope || '').trim() || tenant.PLATFORM) === scope
    && toVersion(g.QuestionSetVersion) === n);

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
  setRef,
  readableSetRefs,
  findSetMetadata,
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
