/**
 * GET /reports — the saved reports an organisation can still find.
 *
 * The owner, 2026-09-21: "how does one find these reports, if the sessions
 * are cleared out." This reads the index rows save-report.js writes
 * (`ORG#<org>#REPORTS`), which outlive the session, and decrypts Title with
 * the org's key. An orgless caller reads the platform partition, which holds
 * pre-tenancy and orgless sessions' reports in plaintext.
 *
 * `sessionGone` is answered here rather than left to the download: a row
 * whose session still exists can be opened from the Sessions tab too; one
 * whose session has expired can be opened ONLY from here, and the list says
 * which is which instead of offering a dead link.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { callerOrgId, reportsIndexPk } = require('./tenant');
const { decryptItems } = require('./tenant-crypto');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  try {
    const orgId = callerOrgId(event);
    const pk = reportsIndexPk(orgId);
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ScanIndexForward: false,
    }));
    const rows = orgId
      ? await decryptItems(orgId, 'reportIndex', res.Items || [])
      : (res.Items || []);

    // Which sessions still exist — one BatchGet, 100 keys at a time.
    const gameIds = [...new Set(rows.map((r) => r.gameId).filter(Boolean))];
    const alive = new Set();
    for (let i = 0; i < gameIds.length; i += 100) {
      const keys = gameIds.slice(i, i + 100).map((id) => ({ PK: `GAME#${id}`, SK: 'METADATA' }));
      const got = await db.send(new BatchGetCommand({
        RequestItems: { [process.env.TABLE_NAME]: { Keys: keys, ProjectionExpression: 'PK' } },
      }));
      ((got.Responses || {})[process.env.TABLE_NAME] || [])
        .forEach((it) => alive.add(String(it.PK).replace('GAME#', '')));
    }

    const reports = rows.map((r) => ({
      id: r.SK,
      gameId: r.gameId,
      title: r.Title || '',
      s3Key: r.s3Key,
      permanent: !!r.permanent,
      savedAt: r.savedAt,
      expiresAt: r.expiresAt,
      sessionGone: !alive.has(r.gameId),
      // Relative, resolved by the console against its own API base (the same
      // rule save-report.js gives for its download URL).
      downloadUrl: `reports/download?key=${encodeURIComponent(r.s3Key)}`,
      // The two items a person with no account needs: the page link is built
      // by the console from gameId + s3Key, and this is the passkey. Only on
      // rows saved since passkeys were kept; an older report has none and is
      // shared by saving it again. The caller is a signed-in member of the
      // partition's own team, who can download the report outright anyway.
      passkey: r.passkey || null,
    }));

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reports, count: reports.length }),
    };
  } catch (error) {
    console.error('Get reports error:', error);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Could not list reports' }) };
  }
};
