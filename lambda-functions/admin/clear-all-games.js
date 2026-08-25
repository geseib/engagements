const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { batchDeleteKeys } = require('./shared/ddb-delete');
const {
  GAMES_RESERVATION_PK, gamesIndexPk, callerOrgId,
} = require('./shared/tenant');

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
 * `GAMES` reservation so the code returns to the pool. A Query is
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

/** Every key in one partition, paginated. */
async function partitionKeys(pk) {
  const keys = [];
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: 'PK, SK',
      ExclusiveStartKey,
    }));
    for (const item of res.Items || []) keys.push({ PK: item.PK, SK: item.SK });
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
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

  console.log(`🗑️ Clearing sessions for ${orgId}`);

  try {
    // The org's own index tells us which sessions are its own. Nothing else can.
    const indexRows = await partitionKeys(gamesIndexPk(orgId));
    const gameIds = indexRows
      .map((k) => String(k.SK || '').replace(/^GAME#/, ''))
      .filter(Boolean);

    const keys = [...indexRows];

    for (const gameId of gameIds) {
      // The session's own partition — players, answers, votes, state, results.
      // eslint-disable-next-line no-await-in-loop
      keys.push(...await partitionKeys(`GAME#${gameId}`));
      /* And the four-digit reservation, so the code goes back into a pool of
         only 10,000. Leaving these behind is how the space leaks. */
      keys.push({ PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` });
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
