/**
 * DELETE /events/{code} — delete an event that has not started, with its
 * agenda, and give its code back (final review I1).
 *
 * NOT A LAMBDA OF ITS OWN. The stack sits near CloudFormation's 500-resource
 * limit, so this is a family file of the function behind PUT /events/{code}:
 * update-event.js's handler hands it every DELETE, the way items.js serves
 * four routes from one function. It needs nothing that function lacks (no
 * decrypt: nothing here reads a word of the event).
 *
 * Refused, in this order:
 *   - while EVENTS_ENABLED is off on this tier (404, as create-event.js);
 *   - by the host door (event-store.openEvent): no identity, another
 *     organisation's event, an unknown code and a malformed one are the one
 *     404;
 *   - when any item is not `planned` (409, a plain sentence). M1 starts
 *     nothing, but roadmap M3 will, and a live item must never be deleted out
 *     from under a room.
 *
 * ── ONE TRANSACTION, NOT ORDERED WRITES ───────────────────────────────────
 * Every row goes in ONE TransactWriteItems, all or nothing:
 *   1. every row under EVENT#<code> other than METADATA — the items, each
 *      conditioned `State = planned`, read with a paged Query (a one-call
 *      Query past 1 MB silently stops, and a delete built on it would free a
 *      code with the rest of the agenda still there);
 *   2. METADATA, conditioned on the ItemCount / EngagementCount / BreakCount
 *      and UpdatedAt this request read — so an add, a remove, a reorder or a
 *      rename landing between this read and this write cancels the delete,
 *      and no row it never saw is left behind;
 *   3. the organisation's list row (ORG#<org>#EVENTS);
 *   4. the code's reservation, conditioned `attribute_not_exists(PK) OR
 *      (Kind = event AND orgId = <this event's org>)` — so a session's code or
 *      another organisation's can never be released here, and a reservation
 *      DynamoDB has already reaped (the rows expire together, but deletion is
 *      lazy) does not strand the rest.
 * Ordered writes (items, METADATA, list, reservation last) would satisfy "the
 * code goes back last" only while nothing fails and nothing races: a failure
 * part-way leaves an event half-deleted, and an item added after the item
 * deletes but before the reservation's leaves a row under a freed code unless
 * the partition is read again and the whole thing retried. A transaction
 * makes "a reservation released while EVENT# rows remain" unrepresentable.
 * The cost is DynamoDB's 100-item limit: an agenda holds at most 16 counted
 * items and 16 breaks (agenda-rules.js), so 32 + METADATA + list + code is
 * 35. A partition that ever outgrows one transaction (roadmap M3 may add rows
 * under EVENT#) is refused whole rather than deleted in part.
 *
 * tests/event-delete.js drives each refusal, both races and the paging.
 */
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { json, notFound, trace, eventsEnabled } = require('./event-http');
const S = require('./event-store');

const PLANNED = 'planned';
const TRANSACTION_LIMIT = 100;
const NOT_PLANNED = 'This event has an item that has started, so it cannot be deleted.';
const CHANGED = 'The event changed while it was being deleted. Nothing was deleted; reload it and try again.';

/**
 * @param {object} db        a DynamoDB DocumentClient
 * @param {string} tableName
 * @param {object} request   the HTTP API request (payload 2.0)
 */
async function deleteEvent(db, tableName, request) {
  trace('delete-event', request);
  if (!eventsEnabled()) {
    return json(404, { error: 'Events are not switched on here yet.', code: 'events_disabled' });
  }
  const code = String((request.pathParameters || {}).code || '');
  try {
    const meta = await S.openEvent(db, tableName, request, code);
    if (!meta) return notFound();

    const rows = (await S.queryAll(db, tableName, tenant.eventPk(code), '', { consistent: true }))
      .filter((row) => row.SK !== S.META_SK);
    const items = rows.filter((row) => String(row.SK).startsWith(S.ITEM_PREFIX));
    if (items.some((row) => (row.State || PLANNED) !== PLANNED)) {
      return json(409, { error: NOT_PLANNED, code: 'not_planned' });
    }
    if (rows.length + 3 > TRANSACTION_LIMIT) {
      console.error(`❌ delete-event: EVENT#${code} holds ${rows.length} rows, more than one transaction can delete`);
      return json(500, { error: 'This event is too large to delete in one step. Nothing was deleted.' });
    }

    const tx = rows.map((row) => ({
      Delete: String(row.SK).startsWith(S.ITEM_PREFIX)
        ? {
          TableName: tableName,
          Key: { PK: row.PK, SK: row.SK },
          ConditionExpression: 'attribute_exists(SK) AND #st = :planned',
          ExpressionAttributeNames: { '#st': 'State' },
          ExpressionAttributeValues: { ':planned': PLANNED },
        }
        : { TableName: tableName, Key: { PK: row.PK, SK: row.SK }, ConditionExpression: 'attribute_exists(SK)' },
    }));

    const metaConditions = ['attribute_exists(PK)', '#ic = :ic', '#ec = :ec', '#bc = :bc'];
    const metaNames = { '#ic': 'ItemCount', '#ec': 'EngagementCount', '#bc': 'BreakCount', '#ua': 'UpdatedAt' };
    const metaValues = {
      ':ic': Number(meta.ItemCount) || 0,
      ':ec': Number(meta.EngagementCount) || 0,
      ':bc': Number(meta.BreakCount) || 0,
    };
    if (meta.UpdatedAt === undefined) {
      metaConditions.push('attribute_not_exists(#ua)');
    } else {
      metaConditions.push('#ua = :ua');
      metaValues[':ua'] = meta.UpdatedAt;
    }
    tx.push({
      Delete: {
        TableName: tableName,
        Key: { PK: tenant.eventPk(code), SK: S.META_SK },
        ConditionExpression: metaConditions.join(' AND '),
        ExpressionAttributeNames: metaNames,
        ExpressionAttributeValues: metaValues,
      },
    });
    tx.push({ Delete: { TableName: tableName, Key: { PK: tenant.eventsIndexPk(meta.orgId), SK: S.indexSk(code) } } });
    tx.push({
      Delete: {
        TableName: tableName,
        Key: { PK: tenant.GAMES_RESERVATION_PK, SK: `GAME#${code}` },
        ConditionExpression: 'attribute_not_exists(PK) OR (#k = :event AND #org = :org)',
        ExpressionAttributeNames: { '#k': 'Kind', '#org': 'orgId' },
        ExpressionAttributeValues: { ':event': 'event', ':org': meta.orgId },
      },
    });

    try {
      await db.send(new TransactWriteCommand({ TransactItems: tx }));
    } catch (error) {
      if (!S.isCancelled(error)) throw error;
      return json(409, { error: CHANGED, code: 'agenda_changed' });
    }
    console.log(`🗑️ delete-event: EVENT#${code} and ${items.length} item(s) deleted; the code is free`);
    return json(200, { deleted: code });
  } catch (error) {
    console.error('❌ delete-event failed:', error && error.message);
    return json(500, { error: 'Could not delete the event. Nothing was deleted; try again.' });
  }
}

module.exports = { deleteEvent, NOT_PLANNED };
