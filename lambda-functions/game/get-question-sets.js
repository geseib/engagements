const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const {
  resolvePartitionFromMeta, toVersion, knownVersions, setMetadataKey, readableSetRefs,
} = require('./set-version');
const { ORG } = require('./tenant');
const { decryptItem } = require('./tenant-crypto');

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
      const res = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': setMetadataKey(ref).PK }
      }));
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
        decrypted.push({ item: await decryptItem(ref.orgId, 'set', item), ref });
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
        name: item.name || 'Unknown Set',
        description: item.description || '',
        totalQuestions: item.questionCount || 0,
        categoryCount: item.categoryCount || categories.length,
        customInstruction: item.customInstruction || null,
        aiContextInstruction: item.aiContextInstruction || null,
        // The admin projection has carried these for a while; the game-side
        // picker was missing them, so the host/player surfaces could not badge
        // an art set, name its persona, or show which summary prompt it uses.
        promptId: item.promptId || null,
        personaId: item.personaId || null,
        roundNoun: item.roundNoun || null,
        hasImages: item.hasImages === true,
        // The version a game created from this set right now would pin to.
        // null on an unmigrated set, which reads its legacy partition.
        activeVersion: toVersion(item.activeVersion),
        availableVersions: knownVersions(item),
        active: true,
        categories: categories,
        engagementType: item.engagementType || 'call-and-answer'
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
