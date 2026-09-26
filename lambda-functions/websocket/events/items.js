/**
 * AN EVENT'S AGENDA ITEMS. docs/design/agenda-redesign/02, 02b, 03.
 *
 *   POST   /events/{code}/items            add one, at a position
 *   DELETE /events/{code}/items/{itemId}   remove one that has not started
 *   PUT    /events/{code}/items            reorder: { order: [itemId, …] }
 *   PUT    /events/{code}/items/{itemId}   edit: title, description, minutes,
 *                                          and "Use vN" for an engagement
 *
 * Every route opens the event through event-store.openEvent: another
 * organisation's event, an unknown code and a malformed one are the same 404.
 *
 * ── THE CAPS ARE HELD BY THE WRITE, NOT BY A READ ─────────────────────────
 * 16 items, 8 of them engagements, breaks uncounted (agenda-rules.js). The
 * builder disables what cannot be added and says why, and this route checks
 * METADATA's counts first so a refusal carries the builder's own sentence.
 * Neither can stop two hosts adding the ninth engagement at the same moment
 * (02-builder: "so two hosts editing at once cannot slip past it"). So the
 * item's Put rides in ONE transaction with the METADATA counters' update,
 * conditioned `ItemCount < 16` (and `EngagementCount < 8` for an engagement),
 * and the loser's whole transaction is cancelled: none of it lands.
 *
 * ── ORDER IS A FIELD ──────────────────────────────────────────────────────
 * RATIONALE §c: "a reorder rewrites numbers, never keys". Every row carries
 * `Order`, 1..n. An insert renumbers the rows after it in the same transaction
 * as the Put, each update conditioned on the number it read, so a concurrent
 * change cancels the lot rather than leaving two rows with one number.
 *
 * ── ONLY A PLANNED ITEM CHANGES ───────────────────────────────────────────
 * An item is born `planned` (decision 11: nothing is active before the host
 * starts it on the day). Starting, pausing and ending belong to roadmap M3,
 * and none of them is here. Every edit and removal here is conditioned on
 * `State = planned`, so an item that has started cannot be changed under the
 * room.
 *
 * ── A RACE AGAINST update-event.js's DATE MOVE ────────────────────────────
 * update-event.js rewrites every row's `ttl` in one transaction when an
 * event's date changes, built from a read of the agenda taken before that
 * transaction commits. An item added here between that read and that commit
 * would otherwise carry the ttl this route read at ITS OWN start — stale the
 * instant the date move lands. So the item's Put and the METADATA counters'
 * Update both ride the SAME transaction as a `ttl = :ttlWas` condition,
 * `:ttlWas` the event's ttl as this request read it: if a date move commits
 * first, that condition fails, the whole add cancels, and the caller sees the
 * same AGENDA_CHANGED 409 a lost cap race gets. The opposite ordering — an
 * add landing between update-event's read of the items and ITS commit — is
 * update-event's own condition to hold (its METADATA Update, when the date
 * moves, also checks ItemCount/EngagementCount/BreakCount against what it
 * read at its own start); together the two conditions mean a date move and an
 * add can never both land with one row on the old clock. See
 * tests/event-caps.js §6 for the add-loses-the-race half and
 * tests/event-update.js for the date-move-loses-the-race half.
 */
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { encryptItem } = require('../tenant-crypto');
const { getSetMetadata, knownVersions, toVersion } = require('../set-version');
const rules = require('./agenda-rules');
const { json, notFound, readBody, trace, methodOf } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const PLANNED = 'planned';
const NOT_PLANNED = 'This item has started, so it cannot be changed here.';

const countsOf = (meta) => ({
  items: Number(meta.ItemCount) || 0,
  engagements: Number(meta.EngagementCount) || 0,
  breaks: Number(meta.BreakCount) || 0,
});
const newItemId = () => `it_${crypto.randomBytes(4).toString('hex')}`;

/** Where a new item goes: its 0-based index in the whole agenda, breaks included. */
function clampPosition(value, length) {
  const n = Number(value);
  if (!Number.isInteger(n)) return length;
  return Math.max(0, Math.min(length, n));
}

/**
 * THE COUNTERS, moved in the same transaction as the row they count. With
 * `capFor`, the update also carries the cap that `type` must still be under,
 * so a race lost between this route's read and its write cancels the write.
 *
 * `ttlWas`, given only when adding, ties the same Update to the event's ttl
 * as this request read it — see the file header's note on the date-move race.
 * A removal touches no row that carries a fresh ttl, so it carries no such
 * condition.
 */
function counterUpdate(code, delta, now, capFor, ttlWas) {
  const conditions = ['attribute_exists(PK)'];
  const names = { '#ua': 'UpdatedAt', '#ic': 'ItemCount', '#ec': 'EngagementCount', '#bc': 'BreakCount' };
  const values = { ':di': delta.items, ':de': delta.engagements, ':db': delta.breaks, ':now': now };
  if (capFor === rules.BREAK) {
    conditions.push('#bc < :maxB');
    values[':maxB'] = rules.MAX_BREAKS;
  } else if (capFor) {
    conditions.push('#ic < :maxI');
    values[':maxI'] = rules.MAX_ITEMS;
    if (rules.isEngagement(capFor)) {
      conditions.push('#ec < :maxE');
      values[':maxE'] = rules.MAX_ENGAGEMENTS;
    }
  }
  if (ttlWas !== undefined) {
    conditions.push('#ttl = :ttlWas');
    names['#ttl'] = 'ttl';
    values[':ttlWas'] = ttlWas;
  }
  return {
    TableName: TABLE(),
    Key: { PK: tenant.eventPk(code), SK: S.META_SK },
    UpdateExpression: 'SET #ua = :now ADD #ic :di, #ec :de, #bc :db',
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/** The organisation's list shows each event's count of items; breaks are not items. */
function listCountUpdate(orgId, code, delta) {
  return {
    TableName: TABLE(),
    Key: { PK: tenant.eventsIndexPk(orgId), SK: S.indexSk(code) },
    UpdateExpression: 'ADD #ic :d',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: { '#ic': 'ItemCount' },
    ExpressionAttributeValues: { ':d': delta },
  };
}

/** Give one row a new place, only if it still holds the place this route read. */
function orderUpdate(row, order, now) {
  return {
    TableName: TABLE(),
    Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: 'SET #o = :n, #ua = :now',
    ConditionExpression: 'attribute_exists(SK) AND #o = :was',
    ExpressionAttributeNames: { '#o': 'Order', '#ua': 'UpdatedAt' },
    ExpressionAttributeValues: { ':n': order, ':was': Number(row.Order) || 0, ':now': now },
  };
}

/**
 * PIN THE SET an engagement plays: `{scope, orgId, setId, version}`.
 *
 * An ORG set is always the EVENT's organisation's. The `orgId` a browser
 * sends is never read, so no request can point an agenda at another team's
 * library — the set is looked for in exactly one partition and is absent,
 * not forbidden, anywhere else. The version is the one asked for if the set
 * has it, else the set's current one: pinned when added, and changed later
 * only by an explicit "Use vN" (PUT), never silently (RATIONALE §c).
 */
async function pinSet(meta, type, requested) {
  const scope = String((requested && requested.scope) || '').trim();
  const setId = String((requested && requested.setId) || '').trim();
  if (!setId || !tenant.SCOPES.includes(scope)) return { error: 'Choose a question set for this item.' };
  const ref = { scope, orgId: scope === tenant.ORG ? meta.orgId : '', setId };
  const row = await getSetMetadata(db, TABLE(), ref);
  if (!row) return { error: 'That question set is not in a library this event can use.' };
  if (row.active === false) return { error: 'That question set is switched off. Switch it on in Question sets first.' };
  const setType = rules.canonicalSetType(row.engagementType);
  if (setType !== type) {
    return { error: `That is a ${rules.TYPE_LABELS[setType] || 'different kind of'} set, and this item is ${rules.TYPE_LABELS[type]}.` };
  }
  const active = toVersion(row.activeVersion);
  let version = active;
  if (requested && requested.version !== undefined && requested.version !== null) {
    version = toVersion(requested.version);
    if (version === null || !(knownVersions(row).includes(version) || version === active)) {
      return { error: 'That version of the question set does not exist.' };
    }
  }
  return { setRef: { scope, orgId: ref.orgId, setId, version } };
}

async function readItem(code, itemId) {
  if (!S.isItemId(itemId)) return null;
  const res = await db.send(new GetCommand({
    TableName: TABLE(),
    Key: { PK: tenant.eventPk(code), SK: S.itemSk(itemId) },
    ConsistentRead: true,
  }));
  return (res && res.Item) || null;
}

// ── POST: add ───────────────────────────────────────────────────────────────
async function addItem(request, meta, code) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const type = String(body.type || '').trim();
  if (rules.COMING_SOON[type]) return json(400, { error: rules.COMING_SOON[type] });
  if (!rules.ADDABLE_TYPES.includes(type)) return json(400, { error: 'That is not a kind of agenda item.' });
  const fields = rules.checkItemFields(body, type);
  if (fields.error) return json(400, { error: fields.error });

  const capped = rules.capRefusal(countsOf(meta), type);
  if (capped) return json(409, { error: capped.message, cap: capped.cap });

  let setRef = null;
  if (rules.isEngagement(type)) {
    const pinned = await pinSet(meta, type, body.setRef);
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
  }

  const rows = await S.readItems(db, TABLE(), code);
  const position = clampPosition(body.position, rows.length);
  const now = new Date().toISOString();
  const itemId = newItemId();
  const plain = {
    PK: tenant.eventPk(code),
    SK: S.itemSk(itemId),
    Type: type,
    Order: position + 1,
    Minutes: fields.value.minutes,
    Title: fields.value.title,
    Description: fields.value.description,
    State: PLANNED,
    ...(setRef ? { SetRef: setRef } : {}),
    CreatedAt: now,
    UpdatedAt: now,
    ttl: meta.ttl,
  };
  const counted = rules.isCounted(type);
  const delta = { items: counted ? 1 : 0, engagements: rules.isEngagement(type) ? 1 : 0, breaks: counted ? 0 : 1 };
  const tx = [
    { Put: { TableName: TABLE(), Item: await encryptItem(meta.orgId, 'item', plain), ConditionExpression: 'attribute_not_exists(SK)' } },
    { Update: counterUpdate(code, delta, now, type, meta.ttl) },
  ];
  if (counted) tx.push({ Update: listCountUpdate(meta.orgId, code, 1) });
  [...rows.slice(0, position), null, ...rows.slice(position)].forEach((row, i) => {
    if (row && Number(row.Order) !== i + 1) tx.push({ Update: orderUpdate(row, i + 1, now) });
  });

  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (error) {
    if (!S.isCancelled(error)) throw error;
    // Lost a race. If it was the cap, say the cap's sentence — that is what
    // the other host's add has just made true. Otherwise it was the ttl
    // guard (a date move landed first, or the agenda moved under us some
    // other way): the generic "reload and try again" sentence.
    const fresh = await S.readMeta(db, TABLE(), code);
    if (!fresh) return notFound();
    const capNow = rules.capRefusal(countsOf(fresh), type);
    if (capNow) return json(409, { error: capNow.message, cap: capNow.cap });
    return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
  }
  return json(201, { item: S.projectItem(plain) });
}

// ── DELETE: remove ──────────────────────────────────────────────────────────
async function removeItem(meta, code, itemId) {
  const row = await readItem(code, itemId);
  if (!row) return notFound();
  if (row.State !== PLANNED) return json(409, { error: NOT_PLANNED, code: 'not_planned' });
  const counted = rules.isCounted(row.Type);
  const delta = { items: counted ? -1 : 0, engagements: rules.isEngagement(row.Type) ? -1 : 0, breaks: counted ? 0 : -1 };
  const now = new Date().toISOString();
  const tx = [
    {
      Delete: {
        TableName: TABLE(),
        Key: { PK: row.PK, SK: row.SK },
        ConditionExpression: 'attribute_exists(SK) AND #st = :planned',
        ExpressionAttributeNames: { '#st': 'State' },
        ExpressionAttributeValues: { ':planned': PLANNED },
      },
    },
    { Update: counterUpdate(code, delta, now, null) },
  ];
  if (counted) tx.push({ Update: listCountUpdate(meta.orgId, code, -1) });
  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (error) {
    if (!S.isCancelled(error)) throw error;
    return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
  }
  return json(200, { removed: itemId });
}

exports.handler = async (request) => {
  trace('event-items', request);
  const params = request.pathParameters || {};
  const code = String(params.code || '');
  const itemId = params.itemId === undefined ? null : String(params.itemId);
  const method = methodOf(request);
  try {
    const meta = await S.openEvent(db, TABLE(), request, code);
    if (!meta) return notFound();
    if (method === 'POST' && itemId === null) return await addItem(request, meta, code);
    if (method === 'DELETE' && itemId !== null) return await removeItem(meta, code, itemId);
    return json(404, { error: 'Endpoint not found' });
  } catch (error) {
    console.error('❌ event-items failed:', error && error.message);
    return json(500, { error: 'Could not change the agenda. Nothing was changed; try again.' });
  }
};
