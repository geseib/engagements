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
 * Every content row is duplicated into the organisation's own partition and the
 * two are independent from that moment. This is the same conclusion
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
 *
 * ── EXCEPT THE TWO FIELDS THAT ARE POINTERS INTO A LIBRARY ─────────────────
 *
 * `promptId` (how each round is summed up) and `personaId` (the voice) are not
 * content. They are references, and a reference is only worth copying where it
 * can still be followed. An id naming a Workie in the SOURCE team's library
 * names nothing this organisation may read, so spreading it here produced a set
 * that was born broken — the picker showed a value, the set claimed to bring
 * its own summary approach, and `get-ai-summary.js` quietly used the game-type
 * default instead. Both are resolved against the DESTINATION's libraries below
 * and dropped when they resolve to nothing.
 *
 * `promptDropped` is deleted outright. `shared/publish-set.js` writes it on a
 * PUBLIC row to record that the publishing org's own Workie did not go public
 * with it (D5) — a fact about that publish, of that version, by that team. On a
 * copy it describes a publish that has never happened, and it is not inert:
 * `get-question-sets.js` projects it on every row it lists, org rows included.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  setRef, setMetadataKey, resolvePartitionFromMeta, setPartition, FIRST_VERSION,
  queryPartition, batchPutItems, toVersion,
} = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { ownerStamp } = require('./shared/question-set-access');
const { resolvePromptRef, resolvePersonaRef } = require('./shared/workie-refs');
const { encryptItem, decryptItem } = require('./shared/tenant-crypto');
const { LIFECYCLE_SKS } = require('./shared/archive-snapshot');
const { readAllowance } = require('./shared/usage');
const { upgradeRequired, UPGRADE_REQUIRED_STATUS } = require('./shared/pricing');
const { planLimitResolve } = require('./shared/plan-limit');

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

    /*
      A COPY IS A NEW STORED SET, SO IT MEETS THE SAME ALLOWANCE AN UPLOAD DOES.
      This handler wrote a sixth set into a free organisation that
      upload-questions.js would have refused — the copy was the way round the
      limit. Checked before the source is read, so a refusal reads and writes
      nothing. `readAllowance` fails OPEN (usage.js): a blip never blocks a copy.
    */
    const allowance = await readAllowance(orgId);
    if (allowance.mustUpgradeForSet) {
      console.log(`🚧 ${orgId} is at its stored-set allowance (${allowance.setsUsed}/${allowance.setsIncluded}) — refusing a COPY`);
      return json(UPGRADE_REQUIRED_STATUS, {
        ...upgradeRequired('sets', allowance),
        resolve: await planLimitResolve(event, allowance),
      });
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
    const targetPk = setPartition({ scope: tenant.ORG, orgId, setId: newSetId }, FIRST_VERSION);
    const now = new Date().toISOString();

    /*
      WHAT THIS ORGANISATION CAN ACTUALLY FOLLOW, decided before anything is
      written. `orgId` here is the DESTINATION's — `resolvePromptRef` reads its
      own library first and the platform library second, which is the order
      `get-ai-summary.js` will follow when the copy is played, so the id stored
      is the id that will really be used. Checking the platform library alone
      would drop one this team can read; checking the source's would keep one it
      cannot. Personas are platform-global, so the same id is the same voice
      everywhere — it still has to exist and still has to have something to say.

      A copy is a mechanical duplication, not a builder choosing a value, so an
      unusable id is DROPPED rather than refused: the set arrives and falls back
      to the game-type default, which is what it would have done anyway. The
      difference is that it no longer claims otherwise.
    */
    const { promptId, personaId, promptDropped, ...carried } = meta; // eslint-disable-line no-unused-vars
    const prompt = await resolvePromptRef(db, TABLE(), promptId, { orgId });
    const persona = await resolvePersonaRef(db, TABLE(), personaId);
    if (promptId && !prompt.ok) console.log(`copy: leaving prompt ${promptId} behind (${prompt.reason})`);
    if (personaId && !persona.ok) console.log(`copy: leaving voice ${personaId} behind (${persona.reason})`);

    /* Question rows are encrypted for the destination; category rows are not,
       matching what an org's own sets look like. Anything else is copied as-is
       so a future row type is carried rather than dropped.

       EXCEPT THE REVIEW AND PUBLISHED ROWS, which are not content. Each public
       version carries its own REVIEW row, and a verdict on the library's copy
       says nothing about this one. PUBLISHED says where the SOURCE version was
       shared. A backup leaves both out for the same reason
       (shared/archive-snapshot.js).

       This filter is not made redundant by the copy now landing at v1 rather
       than in the unversioned partition. Dropping it would put the library's
       verdict at the copy's OWN v1 review key, which is worse: a publish that
       names no version resolves through activeVersion straight onto it. */
    const copies = [];
    for (const row of rows) {
      if (LIFECYCLE_SKS.includes(String(row.SK))) continue;
      const moved = { ...row, PK: targetPk };
      copies.push(String(row.SK || '').startsWith('QUESTION#')
        ? await encryptItem(orgId, 'question', moved)
        : moved);
    }
    await batchPutItems(db, TABLE(), copies);

    const metadata = await encryptItem(orgId, 'set', {
      /* `carried` is `meta` minus the two pointers and the publish marker; see
         the header. Nothing re-adds `promptDropped` — a copy that loses its
         Workie has not published anything, and minting a marker here would put
         a second author on a field publish-set.js owns. */
      ...carried,
      ...setMetadataKey({ scope: tenant.ORG, orgId, setId: newSetId }),
      name,
      /* Re-attached only where the destination can follow them. The resolved
         value is empty in two different ways — null when the source named
         nothing, absent when it named something this org cannot read — and an
         unset field is the right outcome of both, so one test serves for both. */
      ...(prompt.prompt ? { promptId } : {}),
      ...(persona.persona ? { personaId } : {}),
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
      /* A copy starts at the beginning of its own version history — v1, holding
         the rows copied above. Carrying the source's `versions` would describe
         snapshots that live in a partition this organisation cannot read.

         It used to start UNVERSIONED, which left the copy in the one state the
         per-version review record cannot address: `reviewKey(copy, null)`. */
      activeVersion: FIRST_VERSION,
      versions: [{
        version: FIRST_VERSION,
        createdAt: now,
        questionCount: copies.filter((r) => String(r.SK || '').startsWith('QUESTION#')).length,
        categoryCount: copies.filter((r) => String(r.SK || '').startsWith('CATEGORY#')).length,
        sourceFile: '',
        note: `copied from ${scope}:${setId}`,
      }],
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
