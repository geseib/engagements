/**
 * AN ATTENDEE — somebody who joined an open event by typing a name once, and
 * the token that says so afterwards (events M2,
 * docs/superpowers/plans/2026-09-27-events-m2-attendees-join.md).
 *
 *   PK: EVENT#<code>   SK: ATTENDEE#<attendeeId>   (event-store.attendeeSk)
 *     AttendeeName  the name typed — sealed (tenant-crypto `attendee`)
 *     TokenHash     SHA-256 of the whole token, base64url. Never the token.
 *     JoinedAt      ISO time
 *     orgId         the event's organisation: whose key seals the name
 *     ttl           the event's own `ttl`, so the row goes when the event does
 *
 * ── AN OPAQUE TOKEN, NOT A SIGNED ONE ─────────────────────────────────────
 * The token is `<attendeeId>.<secret>`: `at_` and 16 hex digits, a dot, and
 * 32 random bytes as base64url (256 bits). The browser keeps it and sends it
 * back whole; nothing in it is a claim anybody reads. The server keeps only
 * its SHA-256, on the attendee's own row, so a leaked table row does not let
 * anybody in, and nothing new has to be provisioned: no signing secret, no
 * KMS key, no resource — the host-ticket argument (game/host-tickets.js),
 * reused. A plain hash is enough here where a report passkey needs scrypt
 * (game/report-passkey.js): a passkey is 50 bits a person can type, and this
 * is 256 bits nobody types.
 *
 * The id in front is what makes the lookup one GetItem. It is not secret: it
 * names a row, and the row opens only for the whole token.
 *
 * ── IT EXPIRES WITH THE EVENT ─────────────────────────────────────────────
 * The row carries the event's `ttl`; update-event.js moves it when the date
 * moves (restampAttendees). A row past its `ttl` is refused here even while
 * DynamoDB has not yet deleted it — deletion is lazy, up to ~48h late.
 */
const crypto = require('crypto');
const {
  GetCommand, PutCommand, UpdateCommand, DeleteCommand, BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { eventPk } = require('../tenant');
const { encryptItem, decryptItem } = require('../tenant-crypto');
const {
  attendeeSk, META_SK, ATTENDEE_PREFIX, queryAll,
} = require('./event-store');

const ATTENDEE_ID = /^at_[0-9a-f]{16}$/;
const TOKEN = /^(at_[0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/;
const MINT_TRIES = 3;

const newAttendeeId = () => `at_${crypto.randomBytes(8).toString('hex')}`;

/** SHA-256 of the whole token, base64url: what the row stores. */
const hashToken = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('base64url');

/** A fresh identity: `{ attendeeId, token, tokenHash }`. */
function mintToken(attendeeId = newAttendeeId()) {
  const token = `${attendeeId}.${crypto.randomBytes(32).toString('base64url')}`;
  return { attendeeId, token, tokenHash: hashToken(token) };
}

/** `{ attendeeId }` from a well-formed token, else null. */
function parseToken(token) {
  const m = TOKEN.exec(String(token || ''));
  return m ? { attendeeId: m[1] } : null;
}

/** Does `token` hash to `storedHash`? Compared in constant time. */
function tokenMatches(token, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash) return false;
  const actual = Buffer.from(hashToken(token));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * The bearer token on a request, or ''. HTTP API lower-cases header names;
 * the capitalised spelling is read too for a test or a proxy that does not.
 * Never logged (tests/event-attendees.js reads every log line for it).
 */
function bearerOf(request) {
  const headers = (request && request.headers) || {};
  const raw = String(headers.authorization || headers.Authorization || '').trim();
  const m = /^Bearer\s+(\S+)$/i.exec(raw);
  return m ? m[1] : '';
}

/**
 * REFUSED FOR A MOMENT, NOT REFUSED. A host's agenda write is a transaction
 * that holds METADATA while it runs, and a standard write to a held item fails
 * with TransactionConflictException; a room joining at once can also outrun
 * the partition's write rate. Both mean "again, shortly" — the lesson
 * game/survey-retry.js records for a room answering together. A failed
 * condition is never busy.
 */
const BUSY_ERRORS = Object.freeze([
  'TransactionConflictException', 'ThrottlingException', 'ProvisionedThroughputExceededException', 'RequestLimitExceeded',
]);
const isBusy = (error) => Boolean(error && BUSY_ERRORS.includes(error.name));
/** Five tries, jittered waits under a doubling ceiling: 25, 50, 100, 200 ms. Mutable for a test. */
const busyBudget = { tries: 5, baseMs: 25, capMs: 400 };

function pause(attempt) {
  const ceiling = Math.min(busyBudget.capMs, busyBudget.baseMs * (2 ** (attempt - 1)));
  return new Promise((resolve) => { setTimeout(resolve, Math.ceil(ceiling / 2 + Math.random() * (ceiling / 2))); });
}

async function retryWhenBusy(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isBusy(error) || attempt >= busyBudget.tries) throw error;
      await pause(attempt);
    }
  }
}

/** Past its ttl, or carrying none. A reader never treats presence as "alive". */
const isExpired = (row, nowSeconds) => !(Number(row && row.ttl) > nowSeconds);

/**
 * Write a new attendee row for `name` under the event `meta` describes, and
 * return `{ attendeeId, token, row }` — `row` in plaintext, `token` the only
 * copy there will ever be. The Put is conditioned on the key being new; a
 * collision (64 random bits, so in practice never) draws a fresh id.
 */
async function putAttendee(db, tableName, { code, meta, name, now = new Date() }) {
  for (let attempt = 1; ; attempt += 1) {
    const { attendeeId, token, tokenHash } = mintToken();
    const row = {
      PK: eventPk(code),
      SK: attendeeSk(attendeeId),
      AttendeeName: name,
      TokenHash: tokenHash,
      JoinedAt: now.toISOString(),
      orgId: meta.orgId,
      ttl: meta.ttl,
    };
    const item = await encryptItem(meta.orgId, 'attendee', row);
    try {
      await retryWhenBusy(() => db.send(new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(SK)',
      })));
      return { attendeeId, token, row };
    } catch (error) {
      if (error && error.name === 'ConditionalCheckFailedException' && attempt < MINT_TRIES) continue;
      throw error;
    }
  }
}

/** The raw (sealed) attendee row, strongly consistent, or null. */
async function readAttendee(db, tableName, code, attendeeId) {
  if (!ATTENDEE_ID.test(String(attendeeId || ''))) return null;
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: eventPk(code), SK: attendeeSk(attendeeId) },
    ConsistentRead: true,
  }));
  return (res && res.Item) || null;
}

/**
 * The attendee a token names under this event, decrypted, or null when the
 * token is malformed, names no row, does not match it, belongs to another
 * organisation's row, or has expired. `meta` is the event's METADATA row.
 * A row whose name cannot be opened THROWS: that is a fault to report, not a
 * stranger to turn away.
 */
async function openAttendee(db, tableName, { code, meta, token, nowSeconds }) {
  const parsed = parseToken(token);
  if (!parsed) return null;
  const row = await readAttendee(db, tableName, code, parsed.attendeeId);
  if (!row || row.orgId !== meta.orgId || isExpired(row, nowSeconds)) return null;
  if (!tokenMatches(token, row.TokenHash)) return null;
  return decryptItem(meta.orgId, 'attendee', row);
}

/**
 * ONE MORE JOIN ON THE EVENT'S COUNT — `AttendeeCount` on METADATA, an atomic
 * ADD, never a Scan and never a transaction. A standard write cannot cancel a
 * host's agenda transaction (only the reverse can happen, and that is busy,
 * retried above), so a room joining at once never makes the builder say "The
 * event changed while you were saving". Conditioned on METADATA existing:
 * an event deleted between the join's read and this write throws
 * ConditionalCheckFailedException, and the caller takes its row back.
 */
async function countJoin(db, tableName, code) {
  await retryWhenBusy(() => db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: eventPk(code), SK: META_SK },
    UpdateExpression: 'ADD #n :one',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: { '#n': 'AttendeeCount' },
    ExpressionAttributeValues: { ':one': 1 },
  })));
}

/** Take a join back: the row a failed count leaves behind. */
async function removeAttendee(db, tableName, code, attendeeId) {
  await retryWhenBusy(() => db.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: eventPk(code), SK: attendeeSk(attendeeId) },
  })));
}

/** Every attendee row of an event (sealed), read to its last page. */
const readAttendees = (db, tableName, code) => queryAll(db, tableName, eventPk(code), ATTENDEE_PREFIX, { consistent: true });

/**
 * AN EVENT'S ATTENDEES GO WITH IT — called by delete-event.js AFTER its
 * transaction has removed METADATA, never inside it: that transaction is
 * capped at DynamoDB's 100 items, and an event may have hundreds of
 * attendees. Nothing can join behind this read, because a join's count is
 * conditioned on METADATA and a join that loses takes its own row back. Until
 * this finishes the code cannot be drawn again: code-reservation.js skips a
 * code while ANY EVENT# row is there. BatchWrite, 25 keys a call, every
 * unprocessed key sent again. Returns how many rows it deleted.
 */
async function deleteAttendees(db, tableName, code) {
  const rows = await readAttendees(db, tableName, code);
  for (let i = 0; i < rows.length; i += 25) {
    let pending = rows.slice(i, i + 25).map((r) => ({ DeleteRequest: { Key: { PK: r.PK, SK: r.SK } } }));
    for (let attempt = 1; pending.length; attempt += 1) {
      const res = await retryWhenBusy(() => db.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } })));
      pending = ((res && res.UnprocessedItems) || {})[tableName] || [];
      if (!pending.length) break;
      if (attempt >= busyBudget.tries) throw new Error(`${pending.length} attendee row(s) of EVENT#${code} were not deleted`);
      await pause(attempt);
    }
  }
  return rows.length;
}

/**
 * A NEW DATE MOVES EVERY ATTENDEE'S EXPIRY — called by update-event.js AFTER
 * its transaction commits, for the same 100-item reason. Each row's `ttl`
 * becomes the event's new one; a row deleted meanwhile is skipped. Returns how
 * many rows it read.
 */
async function restampAttendees(db, tableName, code, ttl) {
  const rows = await readAttendees(db, tableName, code);
  for (const row of rows) {
    try {
      await retryWhenBusy(() => db.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: 'SET #ttl = :ttl',
        ConditionExpression: 'attribute_exists(SK)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':ttl': ttl },
      })));
    } catch (error) {
      if (!(error && error.name === 'ConditionalCheckFailedException')) throw error;
    }
  }
  return rows.length;
}

/** What a response says about an attendee: the name and when — never the id, the hash or the org. */
const projectAttendee = (row) => ({
  name: typeof (row && row.AttendeeName) === 'string' ? row.AttendeeName : '',
  joinedAt: (row && row.JoinedAt) || null,
});

module.exports = {
  ATTENDEE_ID, TOKEN,
  newAttendeeId, hashToken, mintToken, parseToken, tokenMatches, bearerOf, isExpired,
  BUSY_ERRORS, busyBudget, isBusy, retryWhenBusy,
  putAttendee, readAttendee, openAttendee, projectAttendee, countJoin, removeAttendee,
  readAttendees, deleteAttendees, restampAttendees,
};
