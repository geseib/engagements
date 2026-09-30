/**
 * AN EVENT'S ROWS — their keys, how they are read, and what a response says
 * about them (docs/design/agenda-redesign/40-data-model.html).
 *
 *   PK: GAMES             SK: GAME#<code>    the code (code-reservation.js)
 *   PK: ORG#<org>#EVENTS  SK: EVENT#<code>   the org's list row
 *   PK: EVENT#<code>      SK: METADATA       the event
 *   PK: EVENT#<code>      SK: ITEM#<id>      one agenda item each
 *   PK: EVENT#<code>      SK: ATTENDEE#<id>  one per join (events M2,
 *                                            attendee-store.js)
 *
 * The partition keys come from tenant.js; the sort keys are spelled here and
 * nowhere else. Title, Place and each item's Title and Description are sealed
 * (tenant-crypto.js, entities `event` and `item`); every reader decrypts.
 */
const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { eventPk, callerMayManageEvent, ORG } = require('../tenant');
const { decryptItem, isEnvelope } = require('../tenant-crypto');
const { getSetMetadata, toVersion, versionList, knownVersions } = require('../set-version');
const { callerSub } = require('./event-http');
const { clampPage } = require('./agenda-rules');
const { deckIdOf } = require('./deck-store');

const META_SK = 'METADATA';
const INDEX_PREFIX = 'EVENT#';
const ITEM_PREFIX = 'ITEM#';
const ATTENDEE_PREFIX = 'ATTENDEE#';
const CODE = /^\d{4}$/;
const ITEM_ID = /^it_[0-9a-f]{8}$/;

const indexSk = (code) => `${INDEX_PREFIX}${code}`;

/** The code a METADATA row (PK=EVENT#<code>) or a list row (SK=EVENT#<code>) is about. */
function codeOf(row) {
  const pk = String((row && row.PK) || '');
  if (pk.startsWith(INDEX_PREFIX)) return pk.slice(INDEX_PREFIX.length);
  return String((row && row.SK) || '').replace(/^EVENT#/, '');
}

/**
 * An event as a response names it, from a DECRYPTED METADATA or list row.
 * The list row carries no report default and no engagement or break counts,
 * so those appear only for METADATA.
 */
function projectEvent(row) {
  const r = row || {};
  const out = {
    code: codeOf(r),
    title: typeof r.Title === 'string' ? r.Title : '',
    place: typeof r.Place === 'string' ? r.Place : '',
    startsAt: r.StartsAt || '',
    timeZone: r.TimeZone || '',
    access: r.Access || 'open',
    state: r.State || 'SCHEDULED',
    itemCount: Number(r.ItemCount) || 0,
    // "N joined" (events M2): joins, not people — a "Not you?" re-join is a
    // second row and counts again. A count only; never a name.
    attendeeCount: Number(r.AttendeeCount) || 0,
  };
  if (r.SK === META_SK) {
    // THE DAY AS IT RUNS (events M3, run.js): the one live item, if any, and
    // when the host ended the event.
    out.liveItemId = typeof r.LiveItem === 'string' ? r.LiveItem : '';
    out.endedAt = r.EndedAt || null;
    out.engagementCount = Number(r.EngagementCount) || 0;
    out.breakCount = Number(r.BreakCount) || 0;
    out.attendeeReports = r.AttendeeReports || 'full';
    out.createdAt = r.CreatedAt || null;
    out.updatedAt = r.UpdatedAt || null;
  }
  return out;
}

const itemSk = (itemId) => `${ITEM_PREFIX}${itemId}`;
const attendeeSk = (attendeeId) => `${ATTENDEE_PREFIX}${attendeeId}`;
const itemIdOf = (row) => String((row && row.SK) || '').replace(/^ITEM#/, '');
const isCode = (code) => CODE.test(String(code || ''));
const isItemId = (itemId) => ITEM_ID.test(String(itemId || ''));

/**
 * Every row of one partition (optionally one SK prefix), following
 * LastEvaluatedKey to the end. A Query stops at 1 MB, and a one-page read of
 * an organisation's list goes blind the day it grows
 * (tests/event-host-reads.js pages it).
 */
async function queryAll(db, tableName, pk, prefix = '', { consistent = false } = {}) {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: prefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
      ExpressionAttributeValues: prefix ? { ':pk': pk, ':sk': prefix } : { ':pk': pk },
      ...(consistent ? { ConsistentRead: true } : {}),
      ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
    }));
    rows.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

/** An event's METADATA row, strongly consistent, or null. */
async function readMeta(db, tableName, code) {
  if (!isCode(code)) return null;
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: eventPk(code), SK: META_SK },
    ConsistentRead: true,
  }));
  return (res && res.Item) || null;
}

/** Agenda order: `Order`, then the row key, so equal numbers still sort the same way twice. */
function sortItems(rows) {
  return (rows || []).slice().sort((a, b) => (Number(a.Order) || 0) - (Number(b.Order) || 0)
    || String(a.SK).localeCompare(String(b.SK)));
}

/** Every ITEM row of an event, in agenda order. */
async function readItems(db, tableName, code) {
  return sortItems(await queryAll(db, tableName, eventPk(code), ITEM_PREFIX, { consistent: true }));
}

/**
 * THE HOST ROUTES' DOOR. The event's METADATA row when this caller may act on
 * it, else null — for a malformed code, an unknown one and somebody else's
 * alike, so the caller answers every case with the same 404.
 *
 * NO IDENTITY, NO READ (final review M5). The caller's user id is asked for
 * before anything touches the table: a request with none is refused at no
 * cost, and tenant.callerMayManageEvent — which reads groups and
 * organisations, not the user id — is never the only thing standing between
 * an anonymous request and an event. Every host route carries the Cognito
 * authorizer, which always supplies the id; this is what holds if one ever
 * does not (tests/event-routes-authorization.js counts the table calls).
 */
async function openEvent(db, tableName, request, code) {
  if (!callerSub(request)) return null;
  const meta = await readMeta(db, tableName, code);
  if (!meta) return null;
  return callerMayManageEvent(request, meta) ? meta : null;
}

const decryptEvent = (orgId, row) => decryptItem(orgId, 'event', row);
const decryptItemRow = (orgId, row) => decryptItem(orgId, 'item', row);

/**
 * ONE UNREADABLE ITEM MUST NOT SINK A WHOLE AGENDA (final review M4; the
 * lesson get-events.js and get-question-sets.js record). The row decrypted,
 * or — when its words cannot be opened — the row with blank words and
 * `decryptFailed: true`, so the builder can say so and still offer Remove,
 * and the public agenda keeps the item's place and length with no words.
 * Logged by its key and the reason alone: never the ciphertext, never a word
 * of the plaintext (tenant-crypto's message names the entity, field and org).
 */
async function openItemRow(orgId, row, label) {
  try {
    return await decryptItemRow(orgId, row);
  } catch (error) {
    console.warn(`⚠️ ${label}: could not decrypt ${row && row.SK} of ${row && row.PK} for ${orgId}: ${error && error.message}`);
    return { ...row, Title: '', Description: '', LedBy: '', Settings: null, DeckName: '', decryptFailed: true };
  }
}

/** An agenda item as a response names it, from a DECRYPTED row. */
function projectItem(row) {
  const r = row || {};
  const out = {
    itemId: itemIdOf(r),
    order: Number(r.Order) || 0,
    type: r.Type || '',
    title: typeof r.Title === 'string' ? r.Title : '',
    description: typeof r.Description === 'string' ? r.Description : '',
    // Who leads it (events M1b); '' for a break and for nobody named.
    ledBy: typeof r.LedBy === 'string' ? r.LedBy : '',
    minutes: Number(r.Minutes) || 0,
    state: r.State || 'planned',
  };
  if (r.decryptFailed) out.decryptFailed = true;
  // ON THE DAY (events M3, run.js): the item's session once it has one, when
  // it started and ended, and — for a live break — when the room is back.
  if (r.GameId) out.gameId = String(r.GameId);
  if (r.StartedAt) out.startedAt = r.StartedAt;
  // When it last went live, a first start or a resume (run.js start): the
  // board suggests what follows the most recent one (EventStage `plan`).
  if (r.LiveAt) out.liveAt = r.LiveAt;
  if (r.EndedAt) out.endedAt = r.EndedAt;
  if (r.EndsAt) out.endsAt = r.EndsAt;
  // An engagement's session options (events M1b), decrypted. Never an
  // envelope: a row that could not be opened carries none (openItemRow).
  if (r.Settings && typeof r.Settings === 'object' && !Array.isArray(r.Settings) && !isEnvelope(r.Settings)) {
    out.settings = r.Settings;
  }
  // A PRESENTATION'S SLIDES (27 Sep 2026, deck-store.js): the file's name as
  // the host chose it (sealed with the item's words, so never an envelope
  // here), its size and page count, and the page the stage is on. Never the
  // storage key: a deck is read only through a URL the deck routes sign.
  if (r.Deck && typeof r.Deck === 'object') {
    const pages = Number(r.Deck.pages) || 0;
    out.deck = {
      id: deckIdOf(r.Deck.key),
      name: typeof r.DeckName === 'string' ? r.DeckName : '',
      pages,
      bytes: Number(r.Deck.bytes) || 0,
    };
    out.deckPage = clampPage(r.DeckPage, pages);
  }
  if (r.SetRef && typeof r.SetRef === 'object') {
    out.setRef = {
      scope: r.SetRef.scope || 'platform',
      orgId: r.SetRef.orgId || '',
      setId: r.SetRef.setId || '',
      version: r.SetRef.version === undefined ? null : r.SetRef.version,
    };
  }
  return out;
}

/**
 * What the builder says about an item's set: its name, the question count OF
 * THE PINNED VERSION, the version it would play today, or that it is gone. A
 * set is read in the one library its SetRef names — an org set only ever in
 * the event's own organisation — and never searched for.
 *
 * THE PIN IS LOOKED UP, NOT ASSUMED (final review M1). The row's own
 * `questionCount` is the ACTIVE version's; a row pinned to v2 of a set now at
 * v3 must say v2's count beside v2's name, since that is what the host weighs
 * when deciding whether to press "Use v3". The pin is found in versions[]
 * (set-version.versionList), the same record resolvePartitionFromMeta
 * reasons from, and read the same way:
 *   - found                        → that version's count;
 *   - the active version, or a set
 *     that records no versions yet → the set's own count (it trusts the pin);
 *   - no pin at all (unversioned)  → the set's own count;
 *   - anything else                → `pinnedMissing: true`, count 0: the
 *     version was deleted, and at run time the item would fall back to the
 *     active one (`pinned-missing`). The builder says so and offers "Use vN".
 * roadmap M3 carries the other half: delete-set-version.js should warn about
 * event items pinned to the version it deletes, as it does for sessions.
 */
async function describeSet(db, tableName, setRef) {
  if (!setRef || !setRef.setId) return null;
  const ref = { scope: setRef.scope, orgId: setRef.scope === ORG ? setRef.orgId : '', setId: setRef.setId };
  let row = null;
  try {
    row = await getSetMetadata(db, tableName, ref);
  } catch (error) {
    console.warn(`⚠️ event-store: could not read set ${ref.scope}/${ref.setId}: ${error && error.message}`);
  }
  if (!row) return { missing: true, name: null, questionCount: 0, latestVersion: null, pinnedMissing: false };
  let name = typeof row.name === 'string' ? row.name : null;
  if (ref.scope === ORG && ref.orgId) {
    try {
      const plain = await decryptItem(ref.orgId, 'set', { name: row.name });
      name = typeof plain.name === 'string' ? plain.name : null;
    } catch (error) {
      name = null;
    }
  }
  const latestVersion = toVersion(row.activeVersion);
  const pinned = toVersion(setRef.version);
  let questionCount = Number(row.questionCount) || 0;
  let pinnedMissing = false;
  if (pinned !== null) {
    const entry = versionList(row).find((v) => toVersion(v && v.version) === pinned);
    if (entry) {
      questionCount = Number(entry.questionCount) || 0;
    } else if (pinned !== latestVersion && knownVersions(row).length > 0) {
      pinnedMissing = true;
      questionCount = 0;
    }
  }
  return { missing: false, name, questionCount, latestVersion, pinnedMissing };
}

/**
 * THE HOST'S VIEW OF ONE EVENT — `{ event, items }`, what GET /events/{code}
 * answers and what every run action (run.js) answers with, so the builder,
 * the stage and the remote redraw from one shape. `meta` is the event's raw
 * METADATA row, already past openEvent.
 */
async function hostView(db, tableName, meta, code, label = 'get-event') {
  const event = projectEvent(await decryptEvent(meta.orgId, meta));
  const rows = await readItems(db, tableName, code);
  const items = [];
  for (const row of rows) {
    const item = projectItem(await openItemRow(meta.orgId, row, label));
    if (item.setRef) item.set = await describeSet(db, tableName, item.setRef);
    items.push(item);
  }
  return { event, items };
}

/**
 * Every write that loses a race answers with this sentence, and nothing of it
 * landed: each is one TransactWrite, all or nothing.
 */
const AGENDA_CHANGED = 'The event changed while you were saving. Nothing was saved; reload it and try again.';

/** A cancelled TransactWrite: a condition failed, or another write held a row. */
const isCancelled = (error) => Boolean(error && error.name === 'TransactionCanceledException');

module.exports = {
  META_SK, INDEX_PREFIX, ITEM_PREFIX, ATTENDEE_PREFIX, AGENDA_CHANGED,
  indexSk, itemSk, attendeeSk, itemIdOf, codeOf, isCode, isItemId, isCancelled,
  queryAll, readMeta, readItems, sortItems, openEvent,
  decryptEvent, decryptItemRow, openItemRow, projectEvent, projectItem, describeSet, hostView,
};
