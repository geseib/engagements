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

async function publishSnapshot(db, tableName, snapshot, { review = {}, sourceOrgName = '', promptDropped = false } = {}) {
  const source = setRef(snapshot.source);
  const pubRef = setRef({ scope: tenant.PUBLIC, orgId: '', setId: publicSetIdFor(source.orgId, source.setId) });
  const version = toVersion(snapshot.version);
  const now = new Date().toISOString();

  const existingRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(pubRef) }));
  const existing = existingRes.Item;
  const publicVersion = (toVersion(existing && existing.activeVersion) || 0) + 1;
  const targetPk = setPartition(pubRef, publicVersion);

  const copies = [...(snapshot.categories || []), ...(snapshot.questions || [])]
    .filter((row) => row && row.SK && row.SK !== 'REVIEW' && row.SK !== 'PUBLISHED')
    .map((row) => ({ ...row, PK: targetPk }));
  if (!copies.some((row) => String(row.SK).startsWith('QUESTION#'))) {
    throw new Error('publish-set: the snapshot holds no questions');
  }
  await batchPutItems(db, tableName, copies);

  const hash = snapshot.contentHash || contentHash(snapshot);
  // The public version's own review record: the verdict on exactly these rows.
  await writeReview(db, tableName, pubRef, publicVersion, {
    status: STATUS.PASSED,
    findings: Array.isArray(review.findings) ? review.findings : [],
    note: review.note || 'published',
    contentHash: hash,
  });

  const questionCount = copies.filter((row) => String(row.SK).startsWith('QUESTION#')).length;
  const versions = Array.isArray(existing && existing.versions) ? [...existing.versions] : [];
  versions.push({ version: publicVersion, createdAt: now, questionCount });

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
    publishedAt: now,
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
  // The org's own PUBLISHED markers that point at this listing.
  const srcRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(source) }));
  const srcVersions = Array.isArray(srcRes.Item && srcRes.Item.versions) ? srcRes.Item.versions : [];
  for (const entry of srcVersions) {
    const k = publishedKey(source, entry.version);
    const row = (await db.send(new GetCommand({ TableName: tableName, Key: k }))).Item; // eslint-disable-line no-await-in-loop
    if (row && row.publicSetId === pubRef.setId) keys.push(k);
  }
  await batchDeleteKeys(db, tableName, keys);
  return { removed: keys.length };
}

module.exports = { publicSetIdFor, platformPromptExists, publishSnapshot, unpublishSet };
