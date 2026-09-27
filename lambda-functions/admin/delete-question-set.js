const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
// The sweep itself — every version partition, the orphans past the highest,
// and the index row LAST — lives in shared/set-delete.js, because a set held
// for the public library is removed by the same sweep once the library accepts
// it (shared/public-hold.js). One ordering, two callers.
const { deleteSetRows } = require('./shared/set-delete');

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

    // Get set metadata first to check if it exists.
    // WHICH LIBRARY, THEN WHO. `findSetForCaller` searches only the scopes this
    // caller may READ — their own org, then platform, then public — so a set in
    // another organisation is ABSENT rather than forbidden and this route 404s
    // on it exactly as it would on a set that never existed. Whether org B has a
    // `teamretro` is not a fact org A gets to establish from a status code.
    //
    // The row that comes back carries its own scope, and `requireSetManager`
    // reads it: platform sets are Engage staff's, org sets are that org's, and
    // being an Engage administrator grants nothing inside an org. See
    // shared/question-set-access.js.
    const found = await findSetForCaller(db, tableName, event, setId, requestedScope(event));
    const metaRes = { Item: found && found.item };

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

    // Every content partition this set owns — the legacy `SET#<id>` one plus
    // one `SET#<id>#v<n>` per version, swept by number so a partition orphaned
    // by a replace that failed before the activeVersion flip is collected too —
    // then, only once all of that is gone, the index row. Paginated, chunked in
    // 25s, retried, and it throws rather than under-delete. See
    // shared/set-delete.js; `found.ref` is the row that was actually read, so an
    // org's partitions are the ones swept and never the platform library's.
    const { itemsDeleted } = await deleteSetRows(db, tableName, found.ref, metaRes.Item);
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
