/**
 * DELETE /events/{code} — delete an event with its agenda, the sessions its
 * items ran, its attendees and its slides, and give its code back (final
 * review I1; widened 2026-10-04).
 *
 * ── AN EVENT THAT HAS RUN CAN BE DELETED, LIKE ANY SESSION ───────────────
 * Until 2026-10-04 this refused every event with an item that had ever
 * started, so once a day had run its event could only expire. The owner asked
 * for events to have the lifecycle every other engagement has, and a played
 * session can be deleted (POST /admin/clear-game). So the rule is now the one
 * that protects a room: refused while any item is LIVE or PAUSED (a room may
 * be in it); planned and done items go. Every item session goes with the
 * event — its partition, its list row and its code — but only once its own
 * METADATA proves it is THIS event's item (`EventRef`/`EventItem`): an item
 * session expires 7 days after it starts while the event is kept 90 days
 * after its day, and in that gap its code can be drawn again by somebody
 * else, whose session must never be touched here. Saved reports are kept:
 * they outlive sessions by rule (90 days or a year), and "keep for a year"
 * keeps only the reports (owner decision 10).
 *
 * NOT A LAMBDA OF ITS OWN. The stack sits near CloudFormation's 500-resource
 * limit, so this is a family file of the function behind PUT /events/{code}:
 * update-event.js's handler hands it every DELETE, the way items.js serves
 * four routes from one function. It needs nothing that function lacks (no
 * decrypt: nothing here reads a word of the event).
 *
 * Refused, in this order:
 *   - while EVENTS_ENABLED is off on this tier (404, as create-event.js);
 *   - by the delete door (delete-auth.openForDelete): no identity, an unknown
 *     or malformed code, and another organisation's event (unless the caller
 *     is Engage staff) are the one 404;
 *   - WHO (the owner, 2026-10-04): only the host who created it, an owner or
 *     admin of its organisation, or Engage staff giving a reason
 *     (tenant.deleteRole). A member in none of those roles: 403. Staff with no
 *     reason: 400 `reason_required`. Whoever deletes, an audit entry is
 *     written first (audit-log.js) and a failure there deletes nothing;
 *   - when any item is `live` or `paused` (409, a plain sentence): a live
 *     item must never be deleted out from under a room.
 *
 * ── ONE TRANSACTION, NOT ORDERED WRITES ───────────────────────────────────
 * Every row goes in ONE TransactWriteItems, all or nothing:
 *   1. every row under EVENT#<code> other than METADATA — the items, each
 *      conditioned on the state this request read (planned or done), read
 *      with a paged Query (a one-call
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
 * ATTENDEES ARE THE EXCEPTION (events M2). An event may have hundreds of
 * attendee rows, which one transaction cannot hold, so they are left out of it
 * and deleted straight after it commits (attendee-store.deleteAttendees). That
 * is safe in both directions: no join can land once METADATA is gone (a
 * join's count is conditioned on it), and code-reservation.js will not draw
 * this code again while ANY EVENT# row remains, so a sweep that fails part-way
 * leaves rows that expire with the event's ttl and hold the code until then —
 * never rows under somebody else's event.
 *
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
const { deleteAttendees } = require('./attendee-store');
const { discardEventSession } = require('./child-session');
const { removeObject } = require('./deck-store');
const {
  openForDelete, deleteGate, auditDelete, AUDIT_FAILED,
} = require('./delete-auth');

const PLANNED = 'planned';
const DONE = 'done';
const DELETABLE = new Set([PLANNED, DONE]);
const TRANSACTION_LIMIT = 100;
const RUNNING = 'This event has an item running. End it on the stage, then delete the event.';
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
    const meta = await openForDelete(db, tableName, request, code);
    if (!meta) return notFound();
    const gate = deleteGate(request, meta);
    if (gate.refused) return json(gate.refused.status, { error: gate.refused.error, code: gate.refused.code });

    const rows = (await S.queryAll(db, tableName, tenant.eventPk(code), '', { consistent: true }))
      .filter((row) => row.SK !== S.META_SK && !String(row.SK).startsWith(S.ATTENDEE_PREFIX));
    const items = rows.filter((row) => String(row.SK).startsWith(S.ITEM_PREFIX));
    if (items.some((row) => !DELETABLE.has(row.State || PLANNED))) {
      return json(409, { error: RUNNING, code: 'item_running' });
    }
    if (rows.length + 3 > TRANSACTION_LIMIT) {
      console.error(`❌ delete-event: EVENT#${code} holds ${rows.length} rows, more than one transaction can delete`);
      return json(500, { error: 'This event is too large to delete in one step. Nothing was deleted.' });
    }

    // THE AUDIT ENTRY, BEFORE ANYTHING IS DELETED. No entry, no delete. (A
    // delete that then loses a race leaves an entry for a delete that did not
    // happen; the entry records the attempt, and the agenda says the rest.)
    let title = '';
    try {
      title = (await S.decryptEvent(meta.orgId, { Title: meta.Title })).Title || '';
    } catch (error) {
      console.warn(`⚠️ delete-event: could not read EVENT#${code}'s title for the audit entry`);
    }
    try {
      await auditDelete(db, request, gate, {
        orgId: meta.orgId,
        action: 'event.delete',
        target: { type: 'event', id: code, title: typeof title === 'string' ? title : '' },
        detail: { items: items.length, sessions: items.filter((row) => row.GameId).length },
      });
    } catch (error) {
      console.error(`❌ delete-event: the audit entry for EVENT#${code} could not be written; nothing was deleted:`, error && error.message);
      return json(500, { error: AUDIT_FAILED });
    }

    const tx = rows.map((row) => ({
      Delete: String(row.SK).startsWith(S.ITEM_PREFIX)
        ? {
          TableName: tableName,
          Key: { PK: row.PK, SK: row.SK },
          // The state this request read, so an item that goes live between
          // the read and this write cancels the whole delete.
          ConditionExpression: row.State
            ? 'attribute_exists(SK) AND #st = :was'
            : 'attribute_exists(SK) AND attribute_not_exists(#st)',
          ExpressionAttributeNames: { '#st': 'State' },
          ...(row.State ? { ExpressionAttributeValues: { ':was': row.State } } : {}),
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
    // Every item's session goes with the event: a previewed one nobody could
    // join (run.js `prepare`), and one a room played. Each only when its own
    // METADATA says it is this event's item (see the header).
    let sessions = 0;
    for (const row of items) {
      if (row.GameId && await discardEventSession(db, tableName, {
        gameId: String(row.GameId), orgId: meta.orgId, code, itemId: S.itemIdOf(row),
      })) sessions += 1;
      // A presentation's slides go with it (deck-store.js): nothing else
      // points at them. Best effort, after the rows, like the sessions.
      if (row.Deck && row.Deck.key) await removeObject(row.Deck.key);
    }
    let attendees = 0;
    try {
      attendees = await deleteAttendees(db, tableName, code);
    } catch (error) {
      // The event is gone; what is left expires with its ttl and keeps the
      // code from being drawn until then (see the header).
      console.error(`❌ delete-event: EVENT#${code} is deleted but some attendee rows remain:`, error && error.message);
    }
    console.log(`🗑️ delete-event: EVENT#${code}, ${items.length} item(s), ${sessions} session(s) and ${attendees} attendee(s) deleted; the code is free`);
    return json(200, { deleted: code, sessions });
  } catch (error) {
    console.error('❌ delete-event failed:', error && error.message);
    return json(500, { error: 'Could not delete the event. Nothing was deleted; try again.' });
  }
}

module.exports = { deleteEvent, RUNNING };
