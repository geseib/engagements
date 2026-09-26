/**
 * AN EVENT'S ROWS — their keys, how they are read, and what a response says
 * about them (docs/design/agenda-redesign/40-data-model.html).
 *
 *   PK: GAMES             SK: GAME#<code>    the code (code-reservation.js)
 *   PK: ORG#<org>#EVENTS  SK: EVENT#<code>   the org's list row
 *   PK: EVENT#<code>      SK: METADATA       the event
 *   PK: EVENT#<code>      SK: ITEM#<id>      one agenda item each
 *
 * The partition keys come from tenant.js; the sort keys are spelled here and
 * nowhere else. Title, Place and each item's Title and Description are sealed
 * (tenant-crypto.js, entities `event` and `item`); every reader decrypts.
 */
const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { eventPk, callerMayManageEvent, ORG } = require('../tenant');
const { decryptItem } = require('../tenant-crypto');
const { getSetMetadata, toVersion } = require('../set-version');

const META_SK = 'METADATA';
const INDEX_PREFIX = 'EVENT#';
const ITEM_PREFIX = 'ITEM#';
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
  };
  if (r.SK === META_SK) {
    out.engagementCount = Number(r.EngagementCount) || 0;
    out.breakCount = Number(r.BreakCount) || 0;
    out.attendeeReports = r.AttendeeReports || 'full';
    out.createdAt = r.CreatedAt || null;
    out.updatedAt = r.UpdatedAt || null;
  }
  return out;
}

const itemSk = (itemId) => `${ITEM_PREFIX}${itemId}`;
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
 */
async function openEvent(db, tableName, request, code) {
  const meta = await readMeta(db, tableName, code);
  if (!meta) return null;
  return callerMayManageEvent(request, meta) ? meta : null;
}

const decryptEvent = (orgId, row) => decryptItem(orgId, 'event', row);
const decryptItemRow = (orgId, row) => decryptItem(orgId, 'item', row);

/** An agenda item as a response names it, from a DECRYPTED row. */
function projectItem(row) {
  const r = row || {};
  const out = {
    itemId: itemIdOf(r),
    order: Number(r.Order) || 0,
    type: r.Type || '',
    title: typeof r.Title === 'string' ? r.Title : '',
    description: typeof r.Description === 'string' ? r.Description : '',
    minutes: Number(r.Minutes) || 0,
    state: r.State || 'planned',
  };
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
 * What the builder says about an item's set: its name, its question count,
 * the version it would play today, or that it is gone. A set is read in the
 * one library its SetRef names — an org set only ever in the event's own
 * organisation — and never searched for.
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
  if (!row) return { missing: true, name: null, questionCount: 0, latestVersion: null };
  let name = typeof row.name === 'string' ? row.name : null;
  if (ref.scope === ORG && ref.orgId) {
    try {
      const plain = await decryptItem(ref.orgId, 'set', { name: row.name });
      name = typeof plain.name === 'string' ? plain.name : null;
    } catch (error) {
      name = null;
    }
  }
  return { missing: false, name, questionCount: Number(row.questionCount) || 0, latestVersion: toVersion(row.activeVersion) };
}

/**
 * Every write that loses a race answers with this sentence, and nothing of it
 * landed: each is one TransactWrite, all or nothing.
 */
const AGENDA_CHANGED = 'The event changed while you were saving. Nothing was saved; reload it and try again.';

/** A cancelled TransactWrite: a condition failed, or another write held a row. */
const isCancelled = (error) => Boolean(error && error.name === 'TransactionCanceledException');

module.exports = {
  META_SK, INDEX_PREFIX, ITEM_PREFIX, AGENDA_CHANGED,
  indexSk, itemSk, itemIdOf, codeOf, isCode, isItemId, isCancelled,
  queryAll, readMeta, readItems, sortItems, openEvent,
  decryptEvent, decryptItemRow, projectEvent, projectItem, describeSet,
};
