const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const {
  resolvePartitionFromMeta, toVersion, knownVersions, setMetadataKey, readableSetRefs,
} = require('./set-version');
const { ORG } = require('./tenant');
const { decryptItem, isEnvelope } = require('./tenant-crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Getting active question sets for game creation...');

    // EVERY LIBRARY THIS HOST MAY SEE — their org's, the platform's, the public
    // one — merged. `readableSetRefs` is the authority (tenant.js); platform is
    // in it for every account, so the shared library a host has always picked
    // from is still there and was not copied anywhere to make that true.
    //
    // One metadata Query per scope, concurrently. Different partitions cannot be
    // read in one Query, so three round trips is the floor; awaiting them in
    // sequence would just be three times the latency for no fewer reads.
    const scopeRefs = readableSetRefs(event, '');
    const perScope = await Promise.all(scopeRefs.map(async (ref) => {
      // Every page: the shared libraries grow with every organisation, and a
      // Query stops at 1 MB. tests/library-reads-paged.js.
      const res = { Items: [] };
      let ExclusiveStartKey;
      do {
        const page = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': setMetadataKey(ref).PK },
          ExclusiveStartKey,
        }));
        res.Items.push(...((page && page.Items) || []));
        ExclusiveStartKey = page && page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      // Decrypted per scope, because the org is a property of the partition
      // this Query named and one `ref` covers every row it returned. Platform
      // and public rows were never encrypted — there is no org to key them to
      // — so they are left exactly as they came back. An org set written before
      // this change is still plaintext and passes straight through
      // (`decryptValue` only unwraps envelopes), which is the whole migration.
      const items = (res && res.Items) || [];
      if (ref.scope !== ORG || !ref.orgId) return items.map((item) => ({ item, ref }));
      const decrypted = [];
      for (const item of items) {
        /*
          ONE UNREADABLE ROW MUST NOT EMPTY THE PICKER. Identical guard, and
          identical reason, to admin/get-question-sets.js: decryptItem throws on
          the first field it cannot read, and an unguarded throw here escapes
          into the Promise.all above, which rejects the whole handler. That took
          out the host's ENTIRE choice of sets — their org's readable ones, the
          Engage library and the public one — over one torn row in a partition
          two of those three do not even live in.
        */
        try {
          decrypted.push({ item: await decryptItem(ref.orgId, 'set', item), ref });
        } catch (e) {
          console.warn(`⚠️ Could not decrypt set row ${item.SK} for org ${ref.orgId}: ${e.message}`);
          // Envelopes out, a flag in. Never the ciphertext, never a guess — see
          // the projection below for why 'Unknown Set' is not an option here.
          const degraded = { ...item, decryptFailed: true };
          for (const f of Object.keys(degraded)) {
            if (isEnvelope(degraded[f])) degraded[f] = null;
          }
          decrypted.push({ item: degraded, ref });
        }
      }
      return decrypted;
    }));

    // ── THE N+1, AND WHAT WAS ACTUALLY DONE ABOUT IT ────────────────────────
    //
    // Every set needs its CATEGORY# rows, and those live in that set's own
    // content partition (`SET#<id>#v<n>`) — a different partition per set. There
    // is no DynamoDB call that reads a prefix from many partitions at once:
    // Query is single-partition by definition and BatchGetItem takes whole keys,
    // not `begins_with`. So the N reads are inherent to the single-table design
    // and cannot be batched away without denormalising the category list onto
    // the metadata row (a real option, and a schema change owned by nobody in
    // this pass — the write side spans upload, replace, promote and delete).
    //
    // What WAS fixed is the shape of the N: this loop used to be sequential
    // `await` inside `for`, so latency was N round trips and scoping would have
    // made it 3N. It is now one concurrent batch — still N reads, but one round
    // trip's worth of wall clock, and adding scopes no longer multiplies it.
    const withCategories = await Promise.all(
      perScope.flat()
        .filter(({ item }) => item.active !== false) // active true or undefined
        .map(async ({ item, ref }) => {
          const setId = item.SK.replace('SET#', '');
          // No game exists yet at picker time, so there is no pin: this is the
          // set's activeVersion, falling through to the legacy partition for a
          // set that has never been versioned. The REF carries the scope, so a
          // set in an org partition resolves to that org's content partition.
          const resolved = resolvePartitionFromMeta({ ...ref, setId }, item, null);
          const categoriesRes = await db.send(new QueryCommand({
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: { ':pk': resolved.pk, ':sk': 'CATEGORY#' }
          }));
          return { item, ref, setId, resolved, categoryItems: (categoriesRes && categoriesRes.Items) || [] };
        })
    );

    const activeSets = [];
    for (const { item, resolved, setId, categoryItems } of withCategories) {
      const categories = categoryItems.map(cat => ({
        name: cat.Name,
        description: cat.Description || '',
        count: cat.QuestionCount || 10
      }));

      activeSets.push({
        id: setId,
        // THE OTHER HALF OF THE REFERENCE. The host picks a set here and the
        // session pins it; `teamretro` alone names one set per library, so
        // the pair has to survive the round trip or the session would later
        // read whichever library it happened to hit first.
        scope: resolved.scope,
        orgId: resolved.orgId || null,
        /*
          A SET NOBODY NAMED AND A SET NOBODY CAN READ ARE DIFFERENT STATES.
          `item.name || 'Unknown Set'` says the first about the second: it hands
          the host a plausible, wrong, unfalsifiable label for a set whose
          content is unreadable, and one they cannot tell from a genuinely
          untitled row. On a degraded row the fields stay null and
          `decryptFailed` carries the reason, so the picker can name the real
          state and refuse to offer it.
        */
        name: item.decryptFailed ? null : (item.name || 'Unknown Set'),
        description: item.decryptFailed ? null : (item.description || ''),
        totalQuestions: item.questionCount || 0,
        categoryCount: item.categoryCount || categories.length,
        customInstruction: item.customInstruction || null,
        aiContextInstruction: item.aiContextInstruction || null,
        // The admin projection has carried these for a while; the game-side
        // picker was missing them, so the host/player surfaces could not badge
        // an art set, name its persona, or show which summary prompt it uses.
        promptId: item.promptId || null,
        personaId: item.personaId || null,
        // The set's DIRECTION, so "Add questions" from the host's dialog can
        // start the scenario builder on the set's own kind rather than the
        // default. The admin projection already carries both.
        roundKind: item.roundKind || '',
        roundKindBrief: item.roundKindBrief || '',
        roundNoun: item.roundNoun || null,
        // The shelf and the author's own words, carried so both list routes
        // describe the same set — NOT because anything here reads them yet.
        // Nothing on the host surface does: its picker shows a set's name,
        // format, question count and whether it is on the host's quickstart
        // shelf, and carries no topic filter and no tag anywhere in it. (The
        // library filter and the browse that DO read these two are the admin
        // console's, on admin/get-question-sets.js.)
        //
        // The three fields directly above are why they are projected anyway:
        // they were missing from this route while the admin one carried them,
        // and the cost was host and player surfaces that could not badge an
        // art set or name its persona until somebody noticed the two shapes
        // had diverged. Raw, and '' / [] for the sets that predate the field:
        // an unfiled set is offered here exactly as it always was.
        topic: item.topic || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        hasImages: item.hasImages === true,
        // The version a game created from this set right now would pin to.
        // null on an unmigrated set, which reads its legacy partition.
        activeVersion: toVersion(item.activeVersion),
        availableVersions: knownVersions(item),
        active: true,
        categories: categories,
        engagementType: item.engagementType || 'call-and-answer',
        // Present only when true — absent means the row decrypted, which is
        // every row in a healthy library.
        ...(item.decryptFailed ? { decryptFailed: true } : {})
      });
    }
    
    console.log(`Found ${activeSets.length} active question sets`);
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ sets: activeSets }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET'
      }
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
