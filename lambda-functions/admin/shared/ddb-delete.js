/**
 * Safe bulk-delete helpers for the single-table design.
 *
 * Two things DynamoDB does that hand-rolled delete loops in this repo kept
 * getting wrong, and which only show up on large or busy tables:
 *
 *   1. A Query response is capped at 1 MB. Past that you get a LastEvaluatedKey
 *      and MUST issue another Query. A single un-paginated Query silently
 *      returns a prefix of the partition, so a "delete" leaves the tail behind
 *      as orphan rows.
 *   2. A BatchWriteItem can partially succeed. The rejected requests come back
 *      in UnprocessedItems (throttling, hot partition, request-size limits) and
 *      MUST be resubmitted. Discarding the response drops those deletes without
 *      any error.
 *
 * Neither is rare enough to ignore: the biggest live question set is 160 rows.
 */

const { QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

// DynamoDB hard limit — BatchWriteItem rejects more than 25 requests.
const BATCH_LIMIT = 25;
// Total attempts per chunk (1 initial + 5 retries) before we give up loudly.
const MAX_BATCH_ATTEMPTS = 6;
// Overridable so tests do not pay the backoff in wall-clock time.
const RETRY_BASE_MS = Number(process.env.DELETE_RETRY_BASE_MS || 50);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Collect the PK/SK of every row in one partition, following LastEvaluatedKey
 * to the end. Projects to keys only: smaller pages, fewer round trips, and the
 * keys are all a delete needs.
 *
 * @returns {Promise<{keys: Array<{PK: string, SK: string}>, pages: number}>}
 */
async function collectPartitionKeys(db, tableName, partitionKey) {
  const keys = [];
  let exclusiveStartKey;
  let pages = 0;

  do {
    const res = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :setpk',
      ExpressionAttributeValues: { ':setpk': partitionKey },
      ProjectionExpression: 'PK, SK',
      ExclusiveStartKey: exclusiveStartKey,
    }));

    for (const item of res.Items || []) keys.push({ PK: item.PK, SK: item.SK });
    exclusiveStartKey = res.LastEvaluatedKey;
    pages += 1;
  } while (exclusiveStartKey);

  return { keys, pages };
}

/**
 * Delete the given keys in chunks of 25, resubmitting UnprocessedItems with
 * bounded exponential backoff.
 *
 * Throws if any item is still unprocessed after MAX_BATCH_ATTEMPTS. The thrown
 * error carries `deleted` (confirmed deletes so far) and `remaining` (the keys
 * that survived) so the caller can report the true partial state, not a guess.
 *
 * @returns {Promise<number>} count of CONFIRMED deletes
 */
async function batchDeleteKeys(db, tableName, keys) {
  let deleted = 0;

  for (let i = 0; i < keys.length; i += BATCH_LIMIT) {
    const chunk = keys.slice(i, i + BATCH_LIMIT);
    let pending = chunk.map((Key) => ({ DeleteRequest: { Key } }));
    let attempt = 0;

    while (pending.length > 0) {
      const res = await db.send(new BatchWriteCommand({
        RequestItems: { [tableName]: pending },
      }));

      const unprocessed = (res && res.UnprocessedItems && res.UnprocessedItems[tableName]) || [];
      // Only count what DynamoDB actually accepted.
      deleted += pending.length - unprocessed.length;

      if (unprocessed.length === 0) break;

      attempt += 1;
      if (attempt >= MAX_BATCH_ATTEMPTS) {
        const remaining = unprocessed.map((r) => r.DeleteRequest.Key);
        const err = new Error(
          `${remaining.length} item(s) still unprocessed after ${attempt} attempts ` +
          `(first: ${remaining[0].PK}/${remaining[0].SK})`
        );
        err.deleted = deleted;
        err.remaining = remaining;
        throw err;
      }

      // Exponential backoff with a little jitter, per the DynamoDB guidance.
      const backoff = RETRY_BASE_MS * (2 ** (attempt - 1));
      await sleep(backoff + Math.floor(Math.random() * RETRY_BASE_MS));
      console.log(`↻ Retrying ${unprocessed.length} unprocessed delete(s), attempt ${attempt + 1}`);

      pending = unprocessed;
    }
  }

  return deleted;
}

module.exports = {
  BATCH_LIMIT,
  MAX_BATCH_ATTEMPTS,
  collectPartitionKeys,
  batchDeleteKeys,
};
