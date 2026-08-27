/**
 * SHARING A SET PUBLICLY, AND TAKING IT BACK.
 *
 *   POST   /admin/question-sets/{setId}/publish   { version }
 *   DELETE /admin/question-sets/{setId}/publish
 *
 * `docs/design/tenancy-redesign/05-share-review.html`: "Anyone using Engage will
 * be able to find this set, read every question in it, and copy it into their
 * own team."
 *
 * ── THIS IS NOT `copy-question-set.js` REVERSED ───────────────────────────
 *
 * The design said it was. Agent review found four differences, and every one of
 * them is a way to ship something that looks correct:
 *
 * 1. THE COPY DESTROYS VERSION HISTORY — `activeVersion: null, versions: []`,
 *    landing in the unversioned legacy partition. Publish does the opposite: a
 *    public set HAS versions, because re-sharing adds one and each public
 *    version carries its own review record.
 *
 * 2. THE COPY RENAMES ON COLLISION (`freeSetId`: `teamretro` -> `teamretro2`).
 *    Fatal here. A re-share must land on the SAME public set as a new version,
 *    or "the library keeps serving v2 until somebody deliberately shares again"
 *    is unimplementable and every share spawns an orphan. The public id is
 *    DERIVED from `{orgId, setId}` and is therefore stable.
 *
 * 3. THE COPY REFUSES AN ORG SOURCE. This one takes nothing else.
 *
 * 4. ENCRYPTION RUNS THE OTHER WAY. Org content is ciphertext; public content
 *    must be plaintext or the shared library is unreadable — the same argument
 *    `upload-questions.js` makes for not encrypting it in the first place. So
 *    this DECRYPTS on the way out, and getting that backwards produces a public
 *    set full of base64 that still passes a row-count check.
 *
 * ── THE GATE ──────────────────────────────────────────────────────────────
 *
 * Only a version whose review PASSED may be published, and `mayPublish` tests
 * for that one value rather than listing blockers, so a status added later is
 * refused by default. `escalated` BLOCKS: `11-moderation.html` is a queue of
 * sets "waiting for a person", not a notification that publishing went ahead.
 *
 * ── WHO ───────────────────────────────────────────────────────────────────
 *
 * An org ADMIN or OWNER. Copying a shared set INTO your team is any member's
 * call because it affects only that team; publishing OUT of it puts your
 * organisation's material in front of everyone, which is not.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const {
  setMetadataKey, setPartition, resolvePartitionFromMeta, toVersion,
  queryPartition, batchPutItems, setRef,
} = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');
const { readReview, mayPublish, publishedKey, STATUS } = require('./shared/set-review');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });

/**
 * The public id for one org's set, and it is DERIVED so that it is STABLE.
 *
 * A re-share has to find the row the last share wrote. A random or
 * collision-suffixed id cannot, which is exactly the trap `freeSetId` would
 * have set. Prefixing with the org keeps two organisations' `teamretro` apart
 * inside the one public partition without either of them being renamed.
 */
const publicSetId = (orgId, setId) => `${String(orgId).replace(/[^a-zA-Z0-9]/g, '')}-${setId}`;

exports.handler = async (event) => {
  const method = String(event?.requestContext?.http?.method || 'POST').toUpperCase();
  const setId = String(event?.pathParameters?.setId || '').trim();
  if (!setId) return fail(400, 'Which set?');

  const orgId = tenant.callerOrgId(event);
  if (!orgId) return fail(400, 'Choose an organisation before sharing a question set.');

  // Publishing puts your organisation's material in front of everyone. Copying
  // one IN is a member's call; this is not.
  if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
    return fail(403, 'Only an owner or admin of this organisation can share a set publicly.');
  }

  const source = setRef({ scope: tenant.ORG, orgId, setId });
  const pubRef = setRef({ scope: tenant.PUBLIC, orgId: '', setId: publicSetId(orgId, setId) });

  try {
    if (method === 'DELETE') return await unpublish(source, pubRef);
    return await share(event, source, pubRef, orgId, setId);
  } catch (error) {
    console.error('publish error:', error);
    return fail(500, `Could not share that set: ${error.message}`);
  }
};

async function share(event, source, pubRef, orgId, setId) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }

  const metaRes = await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }));
  const meta = metaRes.Item;
  if (!meta) return fail(404, 'That set is not one of yours.');

  const resolved = resolvePartitionFromMeta(source, meta, toVersion(body.version));
  const version = resolved.version;

  // THE GATE. Read from the version's own row — see shared/set-review.js for
  // why it is a row and not a field on `versions[]`.
  const review = await readReview(db, TABLE(), source, version);
  if (!mayPublish(review)) {
    return json(409, {
      error: review.status === STATUS.ESCALATED
        ? 'This version is with a person at Engage. You will hear back either way.'
        : 'This version has not passed the content check yet.',
      status: review.status,
      findings: review.findings || [],
    });
  }

  const { items: rows } = await queryPartition(db, TABLE(), resolved.pk);
  if (!rows.length) return fail(409, 'That version has no questions to share.');

  // Where the public copy is now, so a re-share ADDS a version instead of
  // overwriting one other teams may already be reading.
  const existingRes = await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(pubRef) }));
  const existing = existingRes.Item;
  const publicVersion = (toVersion(existing && existing.activeVersion) || 0) + 1;
  const targetPk = setPartition(pubRef, publicVersion);
  const now = new Date().toISOString();

  /*
    DECRYPTED ON THE WAY OUT. The org's rows are ciphertext; the public library
    is plaintext by design, because encrypting content every organisation reads
    to one organisation's key makes it unreadable. Getting this backwards
    produces a public set full of base64 that still passes a row count.
  */
  const copies = [];
  for (const row of rows) {
    const plain = String(row.SK || '').startsWith('QUESTION#')
      ? await decryptItem(orgId, 'question', row)   // eslint-disable-line no-await-in-loop
      : row;
    copies.push({ ...plain, PK: targetPk });
  }
  await batchPutItems(db, TABLE(), copies);

  const versions = Array.isArray(existing && existing.versions) ? [...existing.versions] : [];
  versions.push({ version: publicVersion, createdAt: now, questionCount: copies.length });

  const publicMeta = {
    // `...meta` carries the set's own Workie — promptId and personaId — which
    // is what "if you copy it to public it knows about the workie" asks for.
    // Named here as well so a later tidy-up into a whitelist cannot drop them.
    ...meta,
    ...setMetadataKey(pubRef),
    scope: tenant.PUBLIC,
    orgId: '',
    promptId: meta.promptId,
    personaId: meta.personaId,
    activeVersion: publicVersion,
    versions,
    active: true,
    /* Never inherited: a published set is not one of Engage's quickstarts. */
    Quickstart: false,
    /* WHERE IT CAME FROM. The library shows who published it, and the org can
       be told when its public copy is behind — the cost D1 was chosen with. */
    sourceOrgId: orgId,
    sourceSetId: setId,
    sourceVersion: version,
    publishedAt: now,
    updatedAt: now,
    ...(existing ? { createdAt: existing.createdAt } : { createdAt: now }),
  };
  await db.send(new PutCommand({ TableName: TABLE(), Item: publicMeta }));

  // Record on the SOURCE version where it went, so the org's version list can
  // say "v2 · public" without searching the public library for it.
  await db.send(new PutCommand({
    TableName: TABLE(),
    Item: {
      ...publishedKey(source, version),
      publicSetId: pubRef.setId,
      publicVersion,
      at: now,
    },
  }));

  console.log(`🌍 published ${orgId}/${setId} v${version} as public ${pubRef.setId} v${publicVersion}`);
  return json(201, {
    publicSetId: pubRef.setId,
    publicVersion,
    sourceVersion: version,
    rowsPublished: copies.length,
  });
}

/**
 * Take it out of the library.
 *
 * Copies other teams already made are UNTOUCHED and independent —
 * `copy-question-set.js` guarantees that and says so. Unpublishing withdraws
 * the listing, it does not reach into anybody's team.
 */
async function unpublish(source, pubRef) {
  const metaRes = await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(pubRef) }));
  const meta = metaRes.Item;
  if (!meta) return json(200, { removed: 0, note: 'That set is not in the public library.' });

  const versions = Array.isArray(meta.versions) ? meta.versions : [];
  let removed = 0;
  for (const entry of versions) {
    const pk = setPartition(pubRef, entry.version);
    const { items } = await queryPartition(db, TABLE(), pk);  // eslint-disable-line no-await-in-loop
    for (const row of items) {
      // eslint-disable-next-line no-await-in-loop
      await db.send(new DeleteCommand({ TableName: TABLE(), Key: { PK: row.PK, SK: row.SK } }));
      removed += 1;
    }
  }
  await db.send(new DeleteCommand({ TableName: TABLE(), Key: setMetadataKey(pubRef) }));

  console.log(`🌍 unpublished ${pubRef.setId} (${removed} rows)`);
  return json(200, { removed });
}
