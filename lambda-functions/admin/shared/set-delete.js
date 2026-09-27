/**
 * DELETING A WHOLE QUESTION SET — every version, then the index row.
 *
 * Lifted out of `delete-question-set.js` unchanged, because a second caller
 * needs exactly the same sweep: a set held for the public library is removed
 * from its organisation once the library accepts a copy of it
 * (shared/public-hold.js). Two copies of this ordering would drift, and the half
 * that drifted would strand a version partition nothing in the UI can reach.
 *
 * A question set is stored across TWO kinds of partition (see
 * docs/handoff/admin-prompt-cleanup-plan.md §C):
 *
 *   index/metadata : PK '<scope>SETS'      SK 'SET#<id>'   <- what the list reads
 *   content        : PK '<scope>SET#<id>'  and one '<scope>SET#<id>#v<n>' per version
 *
 * DynamoDB gives us no transaction spanning an unbounded number of rows, so
 * this cannot be atomic. What it CAN be is safely ordered, and the ordering is
 * the whole point:
 *
 *   content rows first, index row last.
 *
 * If it dies partway, the set still appears in the list and still owns whatever
 * content survived, so the caller simply deletes again. Deleting the index row
 * FIRST would leave an orphaned partition that nothing could see or reach — and
 * that upload-questions.js would later merge into a rebuilt set of the same
 * name, because its existence guard only checks the metadata row.
 *
 * THE COUNTERS FOLLOW ON THEIR OWN. The metadata row's removal is a stream
 * record on `ORG#<org>#SETS`, and usage-stream.js re-counts the partition from
 * it — the same way it does for the ordinary delete route. Nothing here touches
 * a USAGE# row.
 */
const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { collectPartitionKeys, batchDeleteKeys } = require('./ddb-delete');
const { knownVersions, setPartition, setMetadataKey, toVersion } = require('./set-version');

// How far past the highest recorded version to sweep for orphans. A replace
// that died between writing `SET#<id>#v<n>` and flipping activeVersion leaves an
// unreferenced partition that appears in no versions[] entry; without this the
// set's index row would be deleted while those rows lived on forever, invisible.
// Each extra probe is one Query that returns nothing.
const ORPHAN_SWEEP_AHEAD = 5;

/**
 * Every content partition a set may own: the legacy unsuffixed one, every
 * recorded version, and ORPHAN_SWEEP_AHEAD past the highest.
 *
 * Built from the REF, so an org's content partitions are the ones swept — a
 * bare setId here would sweep the platform library's `SET#<id>` instead and
 * delete somebody else's questions.
 */
function setPartitions(ref, meta) {
  const highestVersion = Math.max(
    0,
    toVersion(meta && meta.activeVersion) || 0,
    ...knownVersions(meta),
  );
  const partitions = [setPartition(ref, null)];
  for (let v = 1; v <= highestVersion + ORPHAN_SWEEP_AHEAD; v++) {
    partitions.push(setPartition(ref, v));
  }
  return partitions;
}

/**
 * Delete one set: every content row across every partition, then its index row.
 *
 * Throws (with `.deleted` / `.remaining` from batchDeleteKeys) rather than
 * under-delete; the index row is never removed while a content row survives.
 *
 * @param {object} db         a DynamoDBDocumentClient (or a stub of one)
 * @param {string} tableName
 * @param {object} ref        { scope, orgId, setId } — the row that was READ
 * @param {object} meta       that row, for its versions
 * @returns {Promise<{ itemsDeleted: number, contentRows: number, partitions: number }>}
 */
async function deleteSetRows(db, tableName, ref, meta) {
  const partitions = setPartitions(ref, meta);

  // Paginated: a Query caps out at 1 MB, and the largest live set is 160
  // questions.
  const keys = [];
  let pages = 0;
  for (const partition of partitions) {
    const res = await collectPartitionKeys(db, tableName, partition); // eslint-disable-line no-await-in-loop
    pages += res.pages;
    if (res.keys.length) {
      console.log(`  ${partition}: ${res.keys.length} row(s)`);
      keys.push(...res.keys);
    }
  }
  console.log(`Found ${keys.length} content row(s) for set ${ref.setId} across ${partitions.length} partition(s), ${pages} query page(s)`);

  // Delete the content, in chunks of 25, retrying UnprocessedItems. Throws if
  // anything is still undeleted after the retry budget.
  const deletedContent = keys.length ? await batchDeleteKeys(db, tableName, keys) : 0;
  if (deletedContent !== keys.length) {
    // Defensive: batchDeleteKeys throws rather than under-delete, so this
    // should be unreachable. Never remove the index row on a mismatch.
    throw new Error(`Deleted ${deletedContent} of ${keys.length} content rows`);
  }

  // Only now is it safe to drop the index row.
  await db.send(new DeleteCommand({ TableName: tableName, Key: setMetadataKey(ref) }));
  return { itemsDeleted: deletedContent + 1, contentRows: deletedContent, partitions: partitions.length };
}

module.exports = { ORPHAN_SWEEP_AHEAD, setPartitions, deleteSetRows };
