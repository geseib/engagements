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
const { readOrgEvents, itemSessionIndex, eventHasRun } = require('./engagement-catalog');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  try {
    const orgId = callerOrgId(event);
    const pk = reportsIndexPk(orgId);
    // PAGED: a one-call Query stops at 1 MB.
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ScanIndexForward: false,
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }));
      items.push(...((page && page.Items) || []));
      ExclusiveStartKey = page && page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const rows = orgId
      ? await decryptItems(orgId, 'reportIndex', items)
      : items;

    /*
      EVENTS, ONE ROW EACH (2026-10-04). The organisation's events come back
      beside the reports: every event that has run, or that has a saved report
      under it, with its items and — per item — the id of its saved report, if
      it has one. A report row carries `eventRef` when it is an event item's,
      so the list files it under its event and never shows it twice. The event
      is found three ways, newest first: the row's own EventRef (saved since
      this change), the session's METADATA (still there), or the event item
      that names the session (the session has expired, the event has not).
      A failed event read costs the grouping, never the reports.
    */
    let orgEvents = [];
    try {
      orgEvents = orgId ? await readOrgEvents(db, process.env.TABLE_NAME, orgId) : [];
    } catch (error) {
      console.error('⚠️ events unavailable, returning reports only:', error.message);
    }
    const byItem = itemSessionIndex(orgEvents);

    // Which sessions still exist — one BatchGet, 100 keys at a time — and,
    // for a row saved before it carried them, the session's type and event.
    // Every event item's session is asked too, so the list can say which
    // item sessions are still there to open and save a report from.
    const gameIds = [...new Set([...rows.map((r) => r.gameId), ...byItem.keys()].filter(Boolean).map(String))];
    const alive = new Map();
    for (let i = 0; i < gameIds.length; i += 100) {
      const keys = gameIds.slice(i, i + 100).map((id) => ({ PK: `GAME#${id}`, SK: 'METADATA' }));
      const got = await db.send(new BatchGetCommand({
        RequestItems: {
          [process.env.TABLE_NAME]: { Keys: keys, ProjectionExpression: 'PK, GameType, EventRef, EventItem' },
        },
      }));
      ((got.Responses || {})[process.env.TABLE_NAME] || [])
        .forEach((it) => alive.set(String(it.PK).replace('GAME#', ''), it));
    }

    const reports = rows.map((r) => {
      const meta = alive.get(String(r.gameId)) || null;
      const named = byItem.get(String(r.gameId)) || null;
      const eventRef = r.EventRef || (meta && meta.EventRef) || (named && named.code) || null;
      const eventItem = r.EventItem || (meta && meta.EventItem) || (named && named.itemId) || null;
      return {
        id: r.SK,
        gameId: r.gameId,
        title: r.Title || '',
        // The session's format ('trivia', 'build', …), or null when neither
        // the row nor a surviving session says.
        gameType: r.GameType || (meta && meta.GameType) || null,
        ...(eventRef ? { eventRef: String(eventRef), eventItem: eventItem || '' } : {}),
        s3Key: r.s3Key,
        permanent: !!r.permanent,
        savedAt: r.savedAt,
        expiresAt: r.expiresAt,
        sessionGone: !meta,
        // Relative, resolved by the console against its own API base (the same
        // rule save-report.js gives for its download URL).
        downloadUrl: `reports/download?key=${encodeURIComponent(r.s3Key)}`,
        // The two items a person with no account needs: the page link is built
        // by the console from gameId + s3Key, and this is the passkey. Only on
        // rows saved since passkeys were kept; an older report has none and is
        // shared by saving it again. The caller is a signed-in member of the
        // partition's own team, who can download the report outright anyway.
        passkey: r.passkey || null,
      };
    });

    const reportOf = new Map(reports.map((r) => [String(r.gameId), r.id]));
    const withReports = new Set(reports.map((r) => r.eventRef).filter(Boolean));
    const events = orgEvents
      .filter((e) => eventHasRun(e) || withReports.has(e.code))
      .map((e) => ({
        kind: 'event',
        code: e.code,
        title: e.title,
        startsAt: e.startsAt,
        state: e.state,
        itemCount: e.itemCount,
        items: e.items.map((item) => ({
          itemId: item.itemId,
          type: item.type,
          title: item.title,
          state: item.state,
          gameId: item.gameId,
          reportId: item.gameId ? reportOf.get(String(item.gameId)) || null : null,
          sessionGone: Boolean(item.gameId) && !alive.has(String(item.gameId)),
          ...(item.decryptFailed ? { decryptFailed: true } : {}),
        })),
        ...(e.decryptFailed ? { decryptFailed: true } : {}),
      }));

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reports, events, count: reports.length }),
    };
  } catch (error) {
    console.error('Get reports error:', error);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Could not list reports' }) };
  }
};
