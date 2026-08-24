const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { toVersion, versionList, setMetadataKey, readableSetRefs } = require('./shared/set-version');
const {
  canManageSet, isSetOwner, setOwnerId, setScopeOf, setOrgOf,
} = require('./shared/question-set-access');
const { isAdminCaller } = require('./shared/require-admin');
const { ORG } = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Getting question sets...');

    // EVERY LIBRARY THIS CALLER MAY SEE, MERGED — not one partition any more.
    //
    // `readableSetRefs` is the authority (set-version.js -> tenant.js): the
    // caller's own org, then the platform library, then public. Platform is in
    // that list for EVERYBODY with an account, which is the owner's explicit
    // requirement — the existing library stays available to every organisation
    // and does not have to be copied per customer.
    //
    // One Query per scope, run CONCURRENTLY: they hit different partitions, so
    // sequential awaits would just add latency. Three at most.
    //
    // `setMetadataKey(ref).PK` rather than a literal: nothing outside tenant.js
    // may spell a partition key, and a hand-built 'ORG#'+id+'#SETS' here is
    // exactly the drift that ends with two spellings of one partition.
    const refs = readableSetRefs(event, '');
    const perScope = await Promise.all(refs.map(async (ref) => {
      const res = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': setMetadataKey(ref).PK }
      }));
      // The row is stamped with its own scope (ownerStamp), EXCEPT on platform
      // rows where absence IS the stamp — so the ref that found it fills in
      // what the row does not say, and canManageSet still reads the row.
      // ── DECRYPT, PER SCOPE, BEFORE ANYTHING PROJECTS A FIELD ──────────────
      //
      // Done here rather than in the projection below because the org is a
      // property of the PARTITION this Query named, and one `ref` covers every
      // row it returned. Platform and public rows are left alone: they were
      // never encrypted (upload-questions.js says why), and `decryptValue`
      // would pass their plaintext through regardless — but calling it would
      // demand an orgId there is none of.
      //
      // A set written before this change is still plaintext in an org's own
      // partition, and passes through untouched. That is the migration: no
      // backfill, both forms coexisting in one Query result.
      const items = (res && res.Items) || [];
      if (ref.scope !== ORG || !ref.orgId) return items.map((item) => ({ item, ref }));
      const decrypted = [];
      for (const item of items) {
        decrypted.push({ item: await decryptItem(ref.orgId, 'set', item), ref });
      }
      return decrypted;
    }));
    const found = perScope.flat();

    // Hosts read this list too now — it is the only projection that carries
    // ownership, and the host surface needs it to know which rows it may offer
    // controls on. Computed once, outside the loop, because the answer is the
    // same for every row.
    const callerIsAdmin = isAdminCaller(event);

    const questionSets = found.map(({ item, ref }) => ({
      id: item.SK.replace('SET#', ''),
      // THE OTHER HALF OF THE REFERENCE. A setId is a slug of the title, so
      // `teamretro` names one set per library and the client must round-trip
      // the pair — creating a session, opening the editor, asking for the
      // questions — or it will address whichever library it happens to hit
      // first. Projected on every row, never inferred by the client.
      scope: setScopeOf(item) || ref.scope,
      orgId: setOrgOf(item) || ref.orgId || null,
      name: item.name,
      description: item.description,
      customInstruction: item.customInstruction,
      aiContextInstruction: item.aiContextInstruction,
      promptId: item.promptId,
      // Per-set persona override. Without this projection the admin form always
      // reads back `undefined` and silently drops whatever was written.
      personaId: item.personaId,
      // Per-set round-label override ("Lesson 3" on a genuine lessons set while
      // the default stays "Round"). Resolved for display by resolveRoundNoun().
      roundNoun: item.roundNoun,
      // THE SET'S DIRECTION — what the room is asked to DO with each item, as
      // distinct from the topic it is about. Projected RAW, not resolved to
      // `produce`: the editor has to be able to tell "the author chose Produce"
      // from "nobody has ever been asked", because its save payload is a diff
      // and a resolved default would make every open-and-save write a value
      // that was never chosen. Readers apply the default themselves
      // (config/roundKinds.js resolveRoundKind).
      roundKind: item.roundKind || '',
      roundKindBrief: item.roundKindBrief || '',
      engagementType: item.engagementType,
      questionCount: item.questionCount || 0,
      totalQuestions: item.questionCount || 0, // Add for frontend compatibility
      categoryCount: item.categoryCount || 0,
      active: item.active !== false,
      quickstart: item.Quickstart || false, // Add quickstart field
      createdAt: item.createdAt,
      // edit-question-set.js used to write `UpdatedAt` while this read
      // `updatedAt`, so an edit never moved the date. Both writers now agree on
      // the lower-case spelling; the fallback keeps rows written before the fix
      // showing a date instead of nothing.
      updatedAt: item.updatedAt || item.UpdatedAt,
      isAIGenerated: item.isAIGenerated || false,
      hasImages: item.hasImages === true,
      // OWNERSHIP.
      //
      // Both fields answer the SCOPED question now: canManage is false for an
      // org's set when the caller is Engage staff who are not in that org, which
      // is the deliberate capability loss documented in question-set-access.js.
      //
      // `canManage` is the server's answer to "may THIS caller edit or delete
      // THIS set", computed by the same function the edit and delete handlers
      // enforce with (shared/question-set-access.js). The console renders
      // controls from it, so a button can never appear for an action the
      // handler would refuse — and, just as importantly, the handler refuses
      // regardless of what the console rendered.
      //
      // `createdByName` is a display string and is NEVER authorised against;
      // `createdBy` is the Cognito sub the rule actually uses. It is projected
      // only for admins: an opaque sub is of no use to a host and the roster of
      // who authored what is not a host's business. `mine` gives the host
      // surface everything it needs without it.
      canManage: canManageSet(event, item),
      // "I created this", which is NOT the same question as canManage: an admin
      // can manage every set and authored almost none of them, and the host
      // surface wants to show a host their own shelf rather than everything
      // they happen to have rights over.
      mine: isSetOwner(event, item),
      createdByName: item.createdByName || null,
      ...(callerIsAdmin ? { createdBy: setOwnerId(item) || null } : {}),
      // Versioning. `activeVersion` is null for a set that has never been
      // versioned — its content is still in the legacy `SET#<id>` partition and
      // it plays perfectly well from there — so the UI must treat null as "not
      // versioned yet", not as an error. `versions` is likewise [] until the
      // set is first replaced or migrated.
      activeVersion: toVersion(item.activeVersion),
      versions: versionList(item)
        .map((v) => ({
          version: toVersion(v && v.version),
          createdAt: (v && v.createdAt) || null,
          questionCount: (v && v.questionCount) || 0,
          categoryCount: (v && v.categoryCount) || 0,
          sourceFile: (v && v.sourceFile) || '',
          note: (v && v.note) || ''
        }))
        .filter((v) => v.version !== null)
        .sort((a, b) => a.version - b.version)
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ questionSets }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Get question sets error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get question sets: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
