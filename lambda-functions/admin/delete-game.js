const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { collectPartitionKeys, batchDeleteKeys } = require('./shared/ddb-delete');
const {
  GAMES_RESERVATION_PK, gamesIndexPk, isPlatformAdmin, callerOrgId, callerOrgIds,
  deleteRole, deleteRefusal, cleanDeleteReason, deleteActor,
} = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');
const { recordAudit } = require('./shared/audit-log');
const { callerUserId } = require('./shared/question-set-access');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  /*
    THIS USED TO PRINT THE WHOLE EVENT — every header, the bearer JWT in
    Authorization among them, and any body. Trace the request, not quote it
    (tests/lambda-event-not-logged.js).
  */
  console.log('Delete game request', JSON.stringify({
    method: event.requestContext?.http?.method,
    path: event.requestContext?.http?.path,
    gameId: event.pathParameters?.gameId || null,
    sub: callerUserId(event) || null,
  }));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const gameId = event.pathParameters?.gameId;
    
    if (!gameId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Game ID is required'
        })
      };
    }

    console.log(`Deleting game: ${gameId}`);

    /*
      WHICH ORG OWNED IT — asked BEFORE anything is deleted, because both places
      that answer are about to be destroyed.

      A session now has TWO rows outside its own partition: the global
      reservation `GAMES / GAME#{id}`, which is what makes the four-digit code
      unavailable, and the owning org's index row `ORG#{org}#GAMES / GAME#{id}`,
      which is what a host's list reads. Deleting one and not the other is the
      leak this lookup exists to prevent: miss the reservation and the code is
      burnt for 90 days out of a space of 9,000; miss the index row and a deleted
      session goes on being listed and offered.

      The reservation carries `orgId` for exactly this. METADATA is the fallback
      for a reservation row that predates the attribute.
    */
    const reservation = await db.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` }
    }));
    /*
      AN EVENT'S CODE IS NOT A SESSION'S TO RELEASE. Events reserve their code
      in this same registry (websocket/code-reservation.js, `Kind: 'event'`),
      and without this check the route would delete that reservation for
      anyone who typed the event's code — leaving an event nobody can join.
      Events have their own routes; here the code names no session.
    */
    if (reservation.Item && reservation.Item.Kind === 'event') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'No session has that code.' })
      };
    }
    const metadata = await db.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId, EventRef, CreatedBy, GameType, Title'
    }));
    const meta = metadata.Item || null;
    if (!meta && !reservation.Item) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'No session has that code.' }) };
    }
    const orgId = (meta && meta.orgId) || (reservation.Item && reservation.Item.orgId) || '';

    /*
      WHO MAY DELETE IT (the owner, 2026-10-04): the host who created it, an
      owner or admin of its organisation, or Engage staff giving a reason —
      and whoever it is, an audit entry is written first (tenant.deleteRole,
      audit-log.js). This route checked NOTHING before: any host could clear
      any organisation's session by its four digits.

      A caller outside the owning organisation who is not staff gets the
      unknown code's 404, as every session route answers a rival (tenant.js
      callerMayDriveSession): a 403 would confirm the code is somebody's. A
      member without the role gets 403 and the sentence. A session with no
      organisation has no team whose log could hold the entry, so it is not
      deleted here; it expires on its own (90 days unstarted, 7 from start).
    */
    if (!orgId) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          success: false,
          code: 'no_organisation',
          error: 'This session belongs to no organisation, so there is no team log to record its delete. It expires on its own.'
        })
      };
    }
    const member = callerOrgId(event) === orgId || callerOrgIds(event).includes(orgId);
    if (!member && !isPlatformAdmin(event)) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'No session has that code.' }) };
    }
    let body = {};
    try { body = JSON.parse(event.body || '{}') || {}; } catch (e) { body = {}; }
    const reason = cleanDeleteReason(body.reason);
    const role = deleteRole(event, { orgId, createdBy: meta && meta.CreatedBy });
    const refused = deleteRefusal(role, reason);
    if (refused) {
      return { statusCode: refused.status, headers, body: JSON.stringify({ success: false, code: refused.code, error: refused.error }) };
    }

    /*
      AN EVENT ITEM'S SESSION BELONGS TO ITS EVENT (2026-10-04). It is listed
      under its event, not on its own, and the event's agenda points at it;
      deleting it here would leave an item naming a session that is gone
      while the event still runs. The event's own delete
      (DELETE /events/{code}) takes its item sessions with it, so that is the
      way, and the answer says so.
    */
    if (meta && meta.EventRef) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          success: false,
          code: 'event_item',
          eventCode: String(meta.EventRef),
          error: `This session is part of event ${meta.EventRef}. Delete the event instead; its sessions go with it.`
        })
      };
    }

    // THE AUDIT ENTRY, BEFORE ANYTHING IS DELETED. No entry, no delete.
    let title = '';
    if (meta && meta.Title) {
      try {
        const plain = await decryptItem(orgId, 'session', { Title: meta.Title });
        title = typeof plain.Title === 'string' ? plain.Title : '';
      } catch (e) {
        console.warn(`⚠️ delete-game: could not read the title of ${gameId} for the audit entry`);
      }
    }
    const isBuild = Boolean(meta && meta.GameType === 'build');
    try {
      await recordAudit(db, {
        orgId,
        action: isBuild ? 'buildroom.delete' : 'session.delete',
        actor: deleteActor(event, role),
        target: { type: isBuild ? 'buildroom' : 'session', id: gameId, title },
        reason: role === 'platform-admin' ? reason : '',
        detail: { gameType: (meta && meta.GameType) || 'unknown' },
      });
    } catch (error) {
      console.error(`❌ delete-game: the audit entry for ${gameId} could not be written; nothing was deleted:`, error && error.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Could not record who is deleting this session, so nothing was deleted. Try again.' })
      };
    }

    // First, get all items related to this game.
    // Paginated: a Query response caps at 1 MB, and a long game accumulates a
    // row per player and per response. An un-paginated Query would delete only
    // the first page and orphan the rest in the GAME# partition.
    console.log('Querying all game data...');
    const { keys, pages } = await collectPartitionKeys(db, TABLE_NAME, `GAME#${gameId}`);

    console.log(`Found ${keys.length} items to delete for game ${gameId} across ${pages} query page(s)`);

    // Delete in chunks of 25, resubmitting anything DynamoDB hands back as
    // UnprocessedItems. Throws (=> 500) rather than under-delete silently.
    const deletedCount = keys.length ? await batchDeleteKeys(db, TABLE_NAME, keys) : 0;

    // Only once the content rows are confirmed gone do we drop the pointer rows
    // — a partial failure must leave the game still listed and re-deletable,
    // never an invisible orphan partition.
    //
    // ORDER MATTERS BETWEEN THE TWO. The org index row goes first, so the
    // session stops being listed before its code is handed back; releasing the
    // code first would let a new session claim that code while the old one was
    // still on somebody's screen.
    let pointerRowsDeleted = 0;

    if (orgId) {
      console.log(`Removing game from the ${orgId} session index...`);
      await db.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: gamesIndexPk(orgId), SK: `GAME#${gameId}` }
      }));
      pointerRowsDeleted += 1;
    }

    console.log('Releasing the game code reservation...');
    // BELT AND SUSPENDERS: the read above already refuses an event's code with
    // its own 404 before anything is touched. This condition says the same
    // thing at the write, so a reordering of this handler, or a race that
    // slips an event's Kind onto the row after that read, still cannot make
    // this route release a code it does not own — it would throw
    // ConditionalCheckFailedException instead (tests/event-code-reservation.js).
    await db.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` },
      ConditionExpression: 'attribute_not_exists(Kind)'
    }));
    pointerRowsDeleted += 1;

    console.log(`✅ Successfully deleted game ${gameId} and all related data`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Game ${gameId} deleted successfully`,
        itemsDeleted: deletedCount + pointerRowsDeleted
      })
    };

  } catch (error) {
    console.error('Error deleting game:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to delete game',
        details: error.message,
        // The game is still listed and still owns whatever rows survived, so a
        // retry is safe and is the expected next step.
        partial: true,
        itemsDeleted: typeof error.deleted === 'number' ? error.deleted : undefined,
        remaining: typeof error.deleted === 'number' ? error.remaining.length : undefined
      })
    };
  }
};