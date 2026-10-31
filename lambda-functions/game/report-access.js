/**
 * WHOSE SAVED REPORT IS THIS, ONCE THE SESSION HAS GONE?
 *
 * get-report.js and save-report.js authorise on the session's METADATA row,
 * which expires 7 days from the start (session-ttl.js). A saved or auto-built
 * report outlives it — its rows carry a 90-day ttl (create-report.js,
 * report-sweep.js) and its index row is in the org's REPORTS partition — so a
 * report the sweep built on day 6 could not be opened on day 8.
 *
 * This finds the session's index row (`REPORT#<game>` under the org's
 * REPORTS partition, save-report.js and report-sweep.js) among the partitions
 * the caller could own: their active org, every org they belong to, and the
 * platform's own (orgless sessions). The caller then asks the SAME question of
 * the row that they would have asked of METADATA — callerMayDriveSession —
 * because the row carries the session's `orgId`. So the access rule does not
 * change: a member of the owning team, as today.
 *
 * Reads only plaintext attributes (orgId, gameId, GameType, EventRef,
 * EventItem, CreatedBy); nothing is decrypted here.
 */
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const {
  callerOrgId, callerOrgIds, reportsIndexPk, REPORTS_PLATFORM_PK,
} = require('./tenant');

/** The index partitions this caller could hold a report in, own org first. */
function candidatePartitions(event) {
  const orgs = [callerOrgId(event), ...callerOrgIds(event)].filter(Boolean);
  return [...new Set([...orgs.map(reportsIndexPk), REPORTS_PLATFORM_PK])];
}

/**
 * The session's index row, or null. `begins_with` also matches the older
 * timestamped rows (`REPORT#<game>#<savedAt>`) and a longer game id with the
 * same prefix, hence the exact gameId filter.
 */
async function findReportIndexRow(db, { table, event, gameId }) {
  if (!gameId) return null;
  for (const pk of candidatePartitions(event)) {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': `REPORT#${gameId}` },
    }));
    const row = ((res && res.Items) || []).find((r) => String(r.gameId) === String(gameId));
    if (row) return row;
  }
  return null;
}

module.exports = { findReportIndexRow, candidatePartitions };
