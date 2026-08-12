const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { collectPartitionKeys, batchDeleteKeys } = require('./shared/ddb-delete');
const { knownVersions, setPartition, toVersion } = require('./shared/set-version');
const { requireSetManager } = require('./shared/question-set-access');

// How far past the highest recorded version to sweep for orphans. A replace
// that died between writing `SET#<id>#v<n>` and flipping activeVersion leaves an
// unreferenced partition that appears in no versions[] entry; without this the
// set's index row would be deleted while those rows lived on forever, invisible.
// Each extra probe is one Query that returns nothing.
const ORPHAN_SWEEP_AHEAD = 5;

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * DELETE /admin/question-sets/{setId}
 *
 * A question set is stored across TWO partitions (see
 * docs/handoff/admin-prompt-cleanup-plan.md §C):
 *
 *   index/metadata : PK 'SETS'      SK 'SET#<id>'   <- what the admin list reads
 *   content        : PK 'SET#<id>'  SK 'QUESTION#…' / 'CATEGORY#…'
 *
 * DynamoDB gives us no transaction spanning an unbounded number of rows, so
 * this cannot be atomic. What it CAN be is safely ordered, and the ordering is
 * the whole point:
 *
 *   content rows first, index row last.
 *
 * If we die partway, the set still appears in the admin list and still owns
 * whatever content survived, so the operator simply presses delete again. The
 * previous implementation deleted the index row FIRST, so any failure left an
 * orphaned SET#<id> partition that nothing in the UI could see or reach — and
 * that upload-questions.js would later merge into a rebuilt set of the same
 * name, because its existence guard only checks the metadata row.
 */
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*' };
  const tableName = process.env.TABLE_NAME;
  const setId = event.pathParameters?.setId;

  try {
    console.log(`Deleting question set: ${setId}`);

    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers
      };
    }

    // Get set metadata first to check if it exists
    const metaRes = await db.send(new GetCommand({
      TableName: tableName,
      Key: { PK: 'SETS', SK: `SET#${setId}` }
    }));

    if (!metaRes.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Question set not found' }),
        headers
      };
    }

    // WHO OWNS IT. Hosts reach this route now (auth/authorizer.js's
    // HOST_ADMIN_ROUTES), so being signed in is not being allowed: a host may
    // delete only a set they created, an admin may delete any, and a set with no
    // recorded owner is admin-only. See shared/question-set-access.js.
    //
    // Placed after the existence check and BEFORE the first destructive call, so
    // a refused delete removes nothing — not one content row, not the index row.
    const denied = requireSetManager(event, metaRes.Item, 'delete');
    if (denied) return denied;

    const setName = metaRes.Item.name || metaRes.Item.Name;

    // 1. Enumerate EVERY content partition this set owns. Since versioning, one
    //    set spans the legacy `SET#<id>` partition plus one `SET#<id>#v<n>` per
    //    version, so deleting only the legacy one would strand every version.
    //
    //    Versions are swept by number rather than only from versions[], so a
    //    partition orphaned by a replace that failed before the activeVersion
    //    flip is collected too — it is in no versions[] entry and nothing else
    //    would ever find it.
    //
    //    Paginated: a Query caps out at 1 MB, and the largest live set is 160
    //    questions.
    const highestVersion = Math.max(
      0,
      toVersion(metaRes.Item.activeVersion) || 0,
      ...knownVersions(metaRes.Item)
    );

    const partitions = [setPartition(setId, null)];
    for (let v = 1; v <= highestVersion + ORPHAN_SWEEP_AHEAD; v++) {
      partitions.push(setPartition(setId, v));
    }

    const keys = [];
    let pages = 0;
    for (const partition of partitions) {
      const res = await collectPartitionKeys(db, tableName, partition);
      pages += res.pages;
      if (res.keys.length) {
        console.log(`  ${partition}: ${res.keys.length} row(s)`);
        keys.push(...res.keys);
      }
    }
    console.log(`Found ${keys.length} content row(s) for set ${setId} across ${partitions.length} partition(s), ${pages} query page(s)`);

    // 2. Delete the content, in chunks of 25, retrying UnprocessedItems.
    //    Throws if anything is still undeleted after the retry budget.
    const deletedContent = keys.length ? await batchDeleteKeys(db, tableName, keys) : 0;

    if (deletedContent !== keys.length) {
      // Defensive: batchDeleteKeys throws rather than under-delete, so this
      // should be unreachable. Never remove the index row on a mismatch.
      throw new Error(`Deleted ${deletedContent} of ${keys.length} content rows`);
    }

    // 3. Only now is it safe to drop the index row.
    await db.send(new DeleteCommand({
      TableName: tableName,
      Key: { PK: 'SETS', SK: `SET#${setId}` }
    }));

    const itemsDeleted = deletedContent + 1;
    console.log(`🗑️ Deleted question set "${setName}": ${itemsDeleted} items removed`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Question set "${setName}" deleted successfully`,
        itemsDeleted
      }),
      headers
    };

  } catch (error) {
    console.error('Delete question set error:', error);

    // The set is still listed and still owns its remaining rows — say so, so
    // the operator knows a retry is safe (and expected) rather than assuming
    // the data is in an unknown half-state.
    const partial = typeof error.deleted === 'number';
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `Failed to delete question set: ${error.message}`,
        partial,
        itemsDeleted: partial ? error.deleted : undefined,
        remaining: partial ? error.remaining.length : undefined,
        hint: `Question set "${setId}" was not fully deleted and is still listed. Retry the delete.`
      }),
      headers
    };
  }
};
