/**
 * TAKE A COPY OF A SET THIS ORGANISATION MAY READ BUT MAY NOT CHANGE.
 *
 * ── THE REQUIREMENT ────────────────────────────────────────────────────────
 *
 * "every org should get access to the basic default prompts and questions set
 *  from the system. as well as any public ones. org admins and host should be
 *  able to copy these and modify their creations and copies, but not the ones
 *  managed by the engage admin."
 *
 * Reading was already true — `readableScopes` gives every account PLATFORM and
 * PUBLIC — and so was the refusal: `canManageSet` returns false on a platform
 * set for anybody who is not Engage staff. What was missing was the middle
 * step. An org could see the shared library and had no way to make anything of
 * it, so the only honest answer to "can I tweak this?" was no.
 *
 * ── A COPY IS A COPY, NOT A REFERENCE ──────────────────────────────────────
 *
 * Every row is duplicated into the organisation's own partition and the two are
 * independent from that moment. This is the same conclusion
 * `question-set-management-reimagined.md` §5.2 reached about imports: if the
 * copy shared identity with its source, an Engage admin editing the platform
 * set would silently change what a customer had already reviewed and scheduled
 * a session around. `sourceSetId` and `sourceScope` record where it came from,
 * for provenance — they are not a link and nothing follows them.
 *
 * ── AND IT IS ENCRYPTED ON THE WAY IN ──────────────────────────────────────
 *
 * The source is plaintext, because platform and public content has no tenant to
 * key it to. The destination has one. So this is the one place in the product
 * where rows cross the encryption boundary in the safe direction, and the
 * question rows must be encrypted as they are written or the copy would sit in
 * an org partition in the clear — indistinguishable from an org's own set, and
 * excluded from the guarantee its owner was given. Category rows keep `Name` in
 * plaintext exactly as an org's own do: it carries the 24-bit mask ordering.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  setRef, setMetadataKey, resolvePartitionFromMeta, setPartition,
  queryPartition, batchPutItems, toVersion,
} = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { ownerStamp } = require('./shared/question-set-access');
const { encryptItem, decryptItem } = require('./shared/tenant-crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const TABLE = () => process.env.TABLE_NAME;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const json = (statusCode, body) => ({
  statusCode, body: JSON.stringify(body), headers: { ...cors, 'Content-Type': 'application/json' },
});
const fail = (statusCode, message) => json(statusCode, { error: message });

/** `80s Trivia (copy)` -> `80strividacopy`. The repo's one slug rule. */
const slugify = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A set id that is free in this organisation.
 *
 * Slugs collide by design — `setId` is a slug of the title — and within ONE
 * partition a collision is an overwrite, which for a copy would mean silently
 * destroying whatever the org already had under that name. So this checks, and
 * suffixes rather than clobbering.
 */
async function freeSetId(orgId, baseName) {
  const base = slugify(baseName) || 'set';
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? base : `${base}${n + 1}`;
    const res = await db.send(new GetCommand({
      TableName: TABLE(),
      Key: setMetadataKey({ scope: tenant.ORG, orgId, setId: candidate }),
    }));
    if (!res.Item) return candidate;
  }
  return `${base}${Date.now()}`;
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  try {
    const orgId = tenant.callerOrgId(event);
    if (!orgId) return fail(403, 'Choose an organisation to copy this into.');

    /*
      A MEMBER MAY COPY. Copying creates content in the org, which is what
      members are for; it is not an admin power. The refusal that matters is on
      the SOURCE (below) and it is about what may be read, not what may be
      written.
    */
    if (!tenant.canManageScope(event, tenant.ORG, orgId, 'member')) {
      return fail(403, 'You are not a member of this organisation.');
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (err) {
      return fail(400, 'That request body is not JSON.');
    }

    const setId = String(event?.pathParameters?.setId || '').trim();
    if (!setId) return fail(400, 'Which set?');

    /*
      THE SOURCE IS A PAIR, AND THE CLIENT HAS TO SAY WHICH. `teamretro` names
      one set per library, so a copy request carrying only an id would copy
      whichever library happened to be looked in first — and the libraries are
      exactly what this feature is about telling apart.
    */
    const scope = String(body.scope || tenant.PLATFORM);
    if (scope !== tenant.PLATFORM && scope !== tenant.PUBLIC) {
      return fail(400, 'Only the shared and public libraries are copied. Your own sets are already yours.');
    }

    const source = setRef({ scope, orgId: '', setId });
    const metaRes = await db.send(new GetCommand({
      TableName: TABLE(), Key: setMetadataKey(source),
    }));
    const meta = metaRes.Item;
    if (!meta) return fail(404, 'That set is not in the shared library.');

    const resolved = resolvePartitionFromMeta(source, meta, toVersion(body.version));
    const { items: rows } = await queryPartition(db, TABLE(), resolved.pk);
    if (!rows.length) return fail(409, 'That set has no questions to copy.');

    const name = `${meta.name || setId}`.slice(0, 120);
    const newSetId = await freeSetId(orgId, name);
    const targetPk = setPartition({ scope: tenant.ORG, orgId, setId: newSetId }, null);
    const now = new Date().toISOString();

    /* Question rows are encrypted for the destination; category rows are not,
       matching what an org's own sets look like. Anything else is copied as-is
       so a future row type is carried rather than dropped. */
    const copies = [];
    for (const row of rows) {
      const moved = { ...row, PK: targetPk };
      copies.push(String(row.SK || '').startsWith('QUESTION#')
        ? await encryptItem(orgId, 'question', moved)
        : moved);
    }
    await batchPutItems(db, TABLE(), copies);

    const metadata = await encryptItem(orgId, 'set', {
      ...meta,
      ...setMetadataKey({ scope: tenant.ORG, orgId, setId: newSetId }),
      name,
      /* WHERE IT CAME FROM, FOR PROVENANCE ONLY. Nothing follows these: the
         copy is independent, and an edit to the source must never reach it. */
      sourceSetId: setId,
      sourceScope: scope,
      copiedAt: now,
      createdAt: now,
      updatedAt: now,
      /* `ownerStamp` writes scope, orgId, createdBy and createdByName TOGETHER.
         Stamping them by hand is how a row ends up with an orgId and no scope,
         which `setScopeOf` treats as a half-written row precisely because that
         shape is the one a hand-rolled stamp produces. */
      ...ownerStamp(event, { scope: tenant.ORG, orgId, setId: newSetId }),
      /* A copy starts at the beginning of its own version history. Carrying the
         source's `versions` would describe snapshots that live in a partition
         this organisation cannot read. */
      activeVersion: null,
      versions: [],
      active: true,
      /* Never inherited: a copy of a published set is NOT published, and a copy
         of a quickstart is not one of Engage's quickstarts. */
      visibility: 'private',
      Quickstart: false,
    });
    await db.send(new PutCommand({ TableName: TABLE(), Item: metadata }));

    console.log(`copied ${scope}:${setId} -> ${orgId}:${newSetId} (${copies.length} rows)`);
    return json(201, {
      setId: newSetId,
      scope: tenant.ORG,
      orgId,
      name,
      rowsCopied: copies.length,
      sourceSetId: setId,
      sourceScope: scope,
    });
  } catch (error) {
    console.error('Copy question set error:', error);
    return fail(500, `Could not copy that set: ${error.message}`);
  }
};
