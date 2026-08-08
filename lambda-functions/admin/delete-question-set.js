const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { collectPartitionKeys, batchDeleteKeys } = require('./shared/ddb-delete');

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

    const setName = metaRes.Item.name || metaRes.Item.Name;

    // 1. Enumerate the whole SET# partition. Paginated: a Query caps out at
    //    1 MB, and the largest live set is 160 questions.
    const { keys, pages } = await collectPartitionKeys(db, tableName, `SET#${setId}`);
    console.log(`Found ${keys.length} content row(s) for set ${setId} across ${pages} query page(s)`);

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
        partial: true,
        itemsDeleted: partial ? error.deleted : undefined,
        remaining: partial ? error.remaining.length : undefined,
        hint: `Question set "${setId}" was not fully deleted and is still listed. Retry the delete.`
      }),
      headers
    };
  }
};
