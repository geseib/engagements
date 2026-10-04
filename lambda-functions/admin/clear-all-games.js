const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { batchDeleteKeys } = require('./shared/ddb-delete');
const {
  GAMES_RESERVATION_PK, gamesIndexPk, callerOrgId,
  deleteRole, deleteRefusal, cleanDeleteReason, deleteActor,
} = require('./shared/tenant');
const { recordAudit } = require('./shared/audit-log');

/**
 * DELETE THIS ORGANISATION'S SESSIONS.
 *
 * ── WHAT THIS USED TO DO, AND WHY IT WAS DANGEROUS ─────────────────────────
 *
 * It SCANNED THE WHOLE TABLE and deleted every `GAME#*` partition, the global
 * `GAMES` reservation partition, and — through a `/^ORG#.+#GAMES$/` pattern —
 * EVERY ORGANISATION'S SESSION INDEX. It read no `orgId` anywhere.
 *
 * The control that fires it lives on the org Sessions screen
 * (components/SessionsPanel.jsx), underneath a list that IS org-scoped
 * (`get-games-list.js` queries `gamesIndexPk(orgId)`), behind a dialog reading
 * "Delete all 3 sessions? Everything below goes at once." So an Engage admin
 * standing in their own personal space, looking at three of their own rows,
 * would have destroyed every customer's sessions on the tier.
 *
 * The route is `admins`-only, and that is the only reason it was survivable.
 * "Only staff can trigger the cross-tenant data loss" is a smaller blast
 * radius, not a boundary.
 *
 * ── WHAT IT DOES NOW ───────────────────────────────────────────────────────
 *
 * Queries the caller's own `ORG#{orgId}#GAMES` index and deletes exactly those
 * sessions: the index rows, each `GAME#{id}` partition, and each four-digit
 * `GAMES` reservation so the code returns to the pool — except a reservation
 * that has since become an event's (`Kind: event`), which is kept. A Query is
 * single-partition by definition, so another tenant's rows are not filtered
 * out — they are unreachable, which is the property the rest of the tenancy
 * work rests on.
 *
 * NO ORG, NO DELETE. Falling back to "everything" when no organisation resolves
 * is exactly how a scoped delete turns back into a global one.
 */
const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org',
};

/** Every key in one partition, paginated (and an index row's EventRef, when asked). */
async function partitionKeys(pk, projection = 'PK, SK') {
  const keys = [];
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: projection,
      ExclusiveStartKey,
    }));
    for (const item of res.Items || []) {
      keys.push(item.EventRef ? { PK: item.PK, SK: item.SK, EventRef: item.EventRef } : { PK: item.PK, SK: item.SK });
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
}

/** Is this code's reservation an event's? Read strongly: the answer decides a delete. */
async function isEventReservation(gameId) {
  const res = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` },
    ConsistentRead: true,
  }));
  return Boolean(res && res.Item && res.Item.Kind === 'event');
}

/** Does this session's METADATA say it is an event item's? */
async function isEventItemSession(gameId) {
  const res = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
    ProjectionExpression: 'EventRef',
    ConsistentRead: true,
  }));
  return Boolean(res && res.Item && res.Item.EventRef);
}

exports.handler = async (event) => {
  if (event?.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const orgId = callerOrgId(event);
  if (!orgId) {
    return {
      statusCode: 403,
      headers: cors,
      body: JSON.stringify({
        success: false,
        error: 'Choose an organisation first. This clears that organisation’s sessions.',
      }),
    };
  }

  /*
    WHO MAY (the owner, 2026-10-04): an owner or admin of this organisation,
    or Engage staff giving a reason. Nobody else — there is no host of "all
    the sessions". The route was staff-only before (the authorizer's default
    for /admin/*); it is now open to hosts so an org's own owner and admins can
    reach it, and this is the check that decides.
  */
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch (e) { body = {}; }
  const reason = cleanDeleteReason(body.reason);
  const role = deleteRole(event, { orgId });
  const refused = deleteRefusal(role, reason);
  if (refused) {
    const error = refused.code === 'not_allowed'
      ? 'Only an owner or admin of this organisation, or Engage staff giving a reason, can delete all its sessions.'
      : refused.error;
    return { statusCode: refused.status, headers: cors, body: JSON.stringify({ success: false, code: refused.code, error }) };
  }

  console.log(`🗑️ Clearing sessions for ${orgId}`);

  try {
    // The org's own index tells us which sessions are its own. Nothing else can.
    const allIndexRows = await partitionKeys(gamesIndexPk(orgId), 'PK, SK, EventRef');
    /*
      AN EVENT ITEM'S SESSION IS THE EVENT'S TO DELETE (2026-10-04). Every
      list files it under its event, and the event's agenda points at it; the
      console deletes events through their own route (DELETE /events/{code}),
      which takes their item sessions with them. So it is left out here,
      index row and all — found by the index row's EventRef (written since
      2026-10-04) or, for an older row, by its METADATA.
    */
    const indexRows = [];
    let eventItems = 0;
    for (const row of allIndexRows) {
      const gameId = String(row.SK || '').replace(/^GAME#/, '');
      // eslint-disable-next-line no-await-in-loop
      if (row.EventRef || (gameId && await isEventItemSession(gameId))) { eventItems += 1; continue; }
      indexRows.push({ PK: row.PK, SK: row.SK });
    }
    const gameIds = indexRows
      .map((k) => String(k.SK || '').replace(/^GAME#/, ''))
      .filter(Boolean);

    const keys = [...indexRows];

    for (const gameId of gameIds) {
      // The session's own partition — players, answers, votes, state, results.
      // eslint-disable-next-line no-await-in-loop
      keys.push(...await partitionKeys(`GAME#${gameId}`));
      /* And the four-digit reservation, so the code goes back into a pool of
         only 10,000. Leaving these behind is how the space leaks.

         NEVER AN EVENT'S (final review M7). This org's index row can outlive
         its session's partition and reservation by DynamoDB's lazy ~48h, and
         in that gap another organisation can draw the code for an EVENT.
         BatchWriteItem carries no condition, so the reservation is READ first
         and one marked `Kind: event` is left alone: releasing it would break
         that event's /join and every date move. */
      // eslint-disable-next-line no-await-in-loop
      if (await isEventReservation(gameId)) {
        console.warn(`⚠️ clear-all-games: GAME#${gameId} is now an event's code; its reservation is kept`);
        continue;
      }
      keys.push({ PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` });
    }

    // THE AUDIT ENTRY, BEFORE ANYTHING IS DELETED. No entry, no delete.
    try {
      await recordAudit(db, {
        orgId,
        action: 'sessions.delete-all',
        actor: deleteActor(event, role),
        target: { type: 'organisation', id: orgId, title: '' },
        reason: role === 'platform-admin' ? reason : '',
        detail: { sessions: gameIds.length, eventSessionsKept: eventItems },
      });
    } catch (error) {
      console.error(`❌ clear-all-games: the audit entry for ${orgId} could not be written; nothing was deleted:`, error && error.message);
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ success: false, error: 'Could not record who is deleting these sessions, so nothing was deleted. Try again.' }),
      };
    }

    const totalDeleted = await batchDeleteKeys(db, process.env.TABLE_NAME, keys);
    console.log(`✅ Deleted ${totalDeleted} rows across ${gameIds.length} sessions for ${orgId}`);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: true,
        message: `Deleted ${gameIds.length} session${gameIds.length === 1 ? '' : 's'}.`,
        sessionsDeleted: gameIds.length,
        itemsDeleted: totalDeleted,
        // Kept: sessions that belong to an event (delete the event instead).
        eventSessionsKept: eventItems,
        orgId,
      }),
    };
  } catch (error) {
    console.error('❌ Clear sessions error:', error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ success: false, error: 'Failed to clear sessions', details: error.message }),
    };
  }
};
