/**
 * THE ONE PUBLISH ROUTINE — spec §5.1.
 *
 * Two callers: the check worker on `passed`, and the staff decision on
 * `approve` (Stage 2). Both publish FROM A SNAPSHOT — the plaintext rows the
 * check judged — so "the reviewed content is the published content" is a
 * property of the code path and not of a hash comparison. The hash still
 * travels, as a fact for the record.
 *
 * Everything publish-question-set.js said still holds: a public set HAS
 * versions (re-sharing adds one), the public id is DERIVED and stable, org
 * content is decrypted on the way out (the snapshot already is), and an org
 * Workie never comes along (D5).
 */
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./tenant');
const {
  setRef, setPartition, setMetadataKey, toVersion, batchPutItems,
} = require('./set-version');
const { writeReview, publishedKey, STATUS } = require('./set-review');
const { contentHash } = require('./publishable');
const { collectPartitionKeys, batchDeleteKeys } = require('./ddb-delete');

/** Letters and digits of the org id, then the set id: two orgs' `teamretro` stay apart, un-renamed. */
const publicSetIdFor = (orgId, setId) => `${String(orgId).replace(/[^a-zA-Z0-9]/g, '')}-${setId}`;

async function platformPromptExists(db, tableName, promptId) {
  const id = String(promptId || '').trim();
  if (!id) return false;
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: tenant.promptsMetadataPk(tenant.PLATFORM), SK: `AIPROMPT#${id}` },
  }));
  return Boolean(res && res.Item);
}

/**
 * `resume`: opt-in idempotency for Ruling R9 (moderation-decide.js resuming a
 * decision that crashed AFTER this already ran once). When true AND the
 * existing public metadata row records this EXACT publish -- same source
 * version, same content hash, same org/set -- the version already written is
 * reused rather than bumped, and no duplicate `versions[]` entry is pushed, so
 * a publish that died part-way converges instead of minting a second public
 * version for content that was already made live. Without `resume` (every
 * caller before Stage 2 Task 4, and the direct approve/reject path today)
 * behaviour is byte-for-byte unchanged: Stage 1's direct re-share deliberately
 * makes a NEW public version even for identical content (a second share is
 * supposed to land as version 2, not silently merge into version 1).
 */
async function publishSnapshot(db, tableName, snapshot, {
  review = {}, sourceOrgName = '', promptDropped = false, resume = false,
} = {}) {
  const source = setRef(snapshot.source);
  const pubRef = setRef({ scope: tenant.PUBLIC, orgId: '', setId: publicSetIdFor(source.orgId, source.setId) });
  const version = toVersion(snapshot.version);
  const now = new Date().toISOString();
  const hash = snapshot.contentHash || contentHash(snapshot);

  const existingRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(pubRef) }));
  const existing = existingRes.Item;
  const resuming = Boolean(resume && existing
    && toVersion(existing.sourceVersion) === version
    && existing.contentHash === hash
    && existing.sourceOrgId === source.orgId
    && existing.sourceSetId === source.setId);
  const publicVersion = resuming ? toVersion(existing.activeVersion) : (toVersion(existing && existing.activeVersion) || 0) + 1;
  const targetPk = setPartition(pubRef, publicVersion);

  const copies = [...(snapshot.categories || []), ...(snapshot.questions || [])]
    .filter((row) => row && row.SK && row.SK !== 'REVIEW' && row.SK !== 'PUBLISHED')
    .map((row) => ({ ...row, PK: targetPk }));
  if (!copies.some((row) => String(row.SK).startsWith('QUESTION#'))) {
    throw new Error('publish-set: the snapshot holds no questions');
  }
  await batchPutItems(db, tableName, copies);

  // The public version's own review record: the verdict on exactly these rows.
  await writeReview(db, tableName, pubRef, publicVersion, {
    status: STATUS.PASSED,
    findings: Array.isArray(review.findings) ? review.findings : [],
    note: review.note || 'published',
    contentHash: hash,
  });

  const questionCount = copies.filter((row) => String(row.SK).startsWith('QUESTION#')).length;
  const versions = Array.isArray(existing && existing.versions) ? [...existing.versions] : [];
  // Resuming converges onto a version already recorded here -- never push a
  // second entry for the same version number.
  if (!versions.some((v) => toVersion(v && v.version) === publicVersion)) {
    versions.push({ version: publicVersion, createdAt: now, questionCount });
  }

  const { share, promptId, ...meta } = snapshot.meta || {}; // eslint-disable-line no-unused-vars
  const publicMeta = {
    ...meta,
    scope: tenant.PUBLIC,
    orgId: '',
    ...(promptDropped ? { promptDropped: true } : { promptId }),
    personaId: meta.personaId,
    activeVersion: publicVersion,
    versions,
    active: true,
    Quickstart: false,
    sourceOrgId: source.orgId,
    sourceOrgName: sourceOrgName || (existing && existing.sourceOrgName) || '',
    sourceSetId: source.setId,
    sourceVersion: version,
    contentHash: hash,
    publishedAt: resuming ? (existing.publishedAt || now) : now,
    updatedAt: now,
    createdAt: (existing && existing.createdAt) || now,
    // Kept across re-shares; set by later stages.
    ...(existing && existing.sensitivity ? { sensitivity: existing.sensitivity } : {}),
    ...(existing && existing.reports ? { reports: existing.reports } : {}),
    // The keys come last: nothing above this line may relocate the row.
    ...setMetadataKey(pubRef),
  };
  if (publicMeta.promptId === undefined) delete publicMeta.promptId;
  await db.send(new PutCommand({ TableName: tableName, Item: publicMeta }));

  await db.send(new PutCommand({
    TableName: tableName,
    Item: {
      publicSetId: pubRef.setId,
      publicVersion,
      at: now,
      // The key comes last, same reason.
      ...publishedKey(source, version),
    },
  }));

  return { pubRef, publicSetId: pubRef.setId, publicVersion, rowsPublished: copies.length, questionCount };
}

/** Take it out of the library: every public version partition, the public metadata row, and the source's PUBLISHED markers. */
async function unpublishSet(db, tableName, source, pubRef) {
  const metaRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(pubRef) }));
  const meta = metaRes.Item;
  if (!meta) return { removed: 0 };
  const keys = [];
  for (const entry of (Array.isArray(meta.versions) ? meta.versions : [])) {
    // collectPartitionKeys returns {keys, pages}, not a bare array.
    const { keys: partitionKeys } = await collectPartitionKeys(db, tableName, setPartition(pubRef, entry.version)); // eslint-disable-line no-await-in-loop
    keys.push(...partitionKeys);
  }
  keys.push(setMetadataKey(pubRef));
  /*
    The org's own PUBLISHED markers that point at this listing: every version the
    set still records, AND THE LEGACY UNSUFFIXED ONE.

    A set shared before versioning existed has no `versions` array at all — three
    of the four listings on dev came from one — so walking that array alone never
    offered `publishedKey(source, null)` as a candidate and the marker survived
    the listing it named. That orphan is not inert: appeal-question-set.js reads
    exactly this key to decide whether there is anything left to appeal, so a
    legacy author whose listing had been taken down was refused for ever, and
    told the library was still serving a set it had removed.

    `null` is added unconditionally rather than only for a set that looks legacy:
    a set that WAS legacy and has been versioned since can hold both, and the
    `publicSetId` check below is what decides in every case — a marker naming
    somebody else's listing is still left exactly where it is.
  */
  const srcRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(source) }));
  const srcVersions = Array.isArray(srcRes.Item && srcRes.Item.versions) ? srcRes.Item.versions : [];
  const markerVersions = [...new Set([...srcVersions.map((entry) => toVersion(entry && entry.version)), null])];
  for (const markerVersion of markerVersions) {
    const k = publishedKey(source, markerVersion);
    const row = (await db.send(new GetCommand({ TableName: tableName, Key: k }))).Item; // eslint-disable-line no-await-in-loop
    if (row && row.publicSetId === pubRef.setId) keys.push(k);
  }
  await batchDeleteKeys(db, tableName, keys);
  return { removed: keys.length };
}

module.exports = { publicSetIdFor, platformPromptExists, publishSnapshot, unpublishSet };
