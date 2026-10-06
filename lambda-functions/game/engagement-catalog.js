/**
 * AN ORGANISATION'S EVENTS, AS THE SESSION LISTS SEE THEM (2026-10-04).
 *
 * The owner: "why are these not treated as other types of engagements that i
 * can see listed in sessions, and reports, etc." — and, decided the same day,
 * an event is ONE row in every list of sessions, labelled Event with its item
 * count; opening it shows its agenda items, each linking to that item's own
 * session and report; and an item's session is never listed a second time.
 *
 * GET /games (get-games-list.js) and GET /reports (get-reports.js) both ask
 * this file the same two questions:
 *   - what events does this organisation have, with their items, and
 *   - which session belongs to which event item.
 *
 * WHY A COPY OF THE EVENT READER AND NOT A REQUIRE. The event code lives in
 * lambda-functions/websocket/events/, and a Lambda is bundled from its own
 * folder only (scripts/ci/bundle-lambdas.js resolves inside it). So this reads
 * the same rows the same way event-store.js does — the list row
 * `ORG#<org>#EVENTS / EVENT#<code>`, then `EVENT#<code>` METADATA and its
 * `ITEM#` rows — with the keys from tenant.js (byte-identical in every bundle)
 * and decrypts with tenant-crypto's `event` and `item` entities, as every
 * event reader must.
 *
 * Every read is PAGED (a Query past 1 MB silently stops; see
 * tests/helpers/paged-table.js), and ONE unreadable event or item never empties
 * the list: its words come back blank with `decryptFailed: true`.
 *
 * SWITCHED OFF, NOTHING. While EVENTS_ENABLED is not `on` for the tier, this
 * reads nothing and answers no events — the lists are then exactly as they
 * were, and the create flow offers no Event.
 */
const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { eventsIndexPk, eventPk } = require('./tenant');
const { decryptItem } = require('./tenant-crypto');

const eventsEnabled = () => String(process.env.EVENTS_ENABLED || '').trim().toLowerCase() === 'on';

const CODE = /^\d{4}$/;
const ITEM_PREFIX = 'ITEM#';

/** Every row of one partition (optionally one SK prefix), following LastEvaluatedKey. */
async function queryAll(db, tableName, pk, prefix = '') {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: prefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
      ExpressionAttributeValues: prefix ? { ':pk': pk, ':sk': prefix } : { ':pk': pk },
      ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
    }));
    rows.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

async function openRow(orgId, entity, row, blank) {
  try {
    return await decryptItem(orgId, entity, row);
  } catch (error) {
    console.warn(`⚠️ engagement-catalog: could not decrypt ${row && row.SK} of ${row && row.PK}: ${error && error.message}`);
    return { ...row, ...blank, decryptFailed: true };
  }
}

/** An agenda item as a list shows it: its kind, words, state and session. */
function projectItem(row) {
  const r = row || {};
  const out = {
    itemId: String(r.SK || '').replace(/^ITEM#/, ''),
    order: Number(r.Order) || 0,
    type: r.Type || '',
    title: typeof r.Title === 'string' ? r.Title : '',
    minutes: Number(r.Minutes) || 0,
    state: r.State || 'planned',
    gameId: r.GameId ? String(r.GameId) : null,
    startedAt: r.StartedAt || null,
    endedAt: r.EndedAt || null,
  };
  if (r.decryptFailed) out.decryptFailed = true;
  return out;
}

/**
 * The organisation's events, each with its items in agenda order. `[]` while
 * the switch is off. Throws only when the organisation's list itself cannot be
 * read; a single event that cannot be read is returned with what is known.
 */
async function readOrgEvents(db, tableName, orgId) {
  if (!eventsEnabled() || !orgId) return [];
  const listRows = await queryAll(db, tableName, eventsIndexPk(orgId), 'EVENT#');
  const events = [];
  for (const listRow of listRows) {
    const code = String(listRow.SK || '').replace(/^EVENT#/, '');
    if (!CODE.test(code)) continue;
    let meta = null;
    let itemRows = [];
    try {
      const got = await db.send(new GetCommand({ TableName: tableName, Key: { PK: eventPk(code), SK: 'METADATA' } }));
      meta = (got && got.Item) || null;
      itemRows = await queryAll(db, tableName, eventPk(code), ITEM_PREFIX);
    } catch (error) {
      console.warn(`⚠️ engagement-catalog: could not read EVENT#${code}: ${error && error.message}`);
    }
    const plain = await openRow(orgId, 'event', meta || listRow, { Title: '', Place: '' });
    const items = [];
    for (const row of itemRows) {
      items.push(projectItem(await openRow(orgId, 'item', row, {
        Title: '', Description: '', LedBy: '', Settings: null, DeckName: '',
      })));
    }
    items.sort((a, b) => (a.order - b.order) || a.itemId.localeCompare(b.itemId));
    const event = {
      code,
      title: typeof plain.Title === 'string' ? plain.Title : '',
      place: typeof plain.Place === 'string' ? plain.Place : '',
      startsAt: plain.StartsAt || listRow.StartsAt || '',
      timeZone: plain.TimeZone || listRow.TimeZone || '',
      state: plain.State || listRow.State || 'SCHEDULED',
      createdAt: (meta && meta.CreatedAt) || null,
      // Who may delete it as its host (tenant.deleteRole).
      createdBy: (meta && meta.CreatedBy) || '',
      endedAt: (meta && meta.EndedAt) || null,
      itemCount: Number(plain.ItemCount) || items.length,
      attendeeCount: Number(plain.AttendeeCount) || 0,
      items,
    };
    if (plain.decryptFailed) event.decryptFailed = true;
    events.push(event);
  }
  return events;
}

/** Has anything of this event happened yet? */
function eventHasRun(event) {
  return Boolean(event) && (event.state === 'LIVE' || event.state === 'ENDED'
    || (event.items || []).some((item) => item.state && item.state !== 'planned'));
}

/** gameId → `{ code, itemId }` for every session an event item names. */
function itemSessionIndex(events) {
  const out = new Map();
  for (const event of events || []) {
    for (const item of event.items || []) {
      if (item.gameId) out.set(String(item.gameId), { code: event.code, itemId: item.itemId });
    }
  }
  return out;
}

module.exports = {
  eventsEnabled, readOrgEvents, eventHasRun, itemSessionIndex, queryAll, projectItem,
};
