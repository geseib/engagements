/**
 * THE INBOX — one person's notifications, behind the bell in the console's top
 * line (components/NotificationsBell.jsx).
 *
 * The owner, 2026-10-21: "ONE general notifications icon (an inbox with a bell
 * and a count) in the app's top line. It covers question sets, the
 * organisation, requests to the user, and so on. Each notification in its
 * list, when clicked, takes the user where they need to go." No email.
 *
 * ── TWO KINDS OF ENTRY ──────────────────────────────────────────────────────
 *
 *   STORED   A row here, written by whatever produced it — today the AI
 *            generation worker (a draft is ready, partly ready, or failed).
 *            It has read/unread, a deep link and a ttl, and it is removed when
 *            the thing it points at is decided.
 *   LIVE     Computed on read from state that already exists elsewhere —
 *            invitations waiting for you, people waiting in a team you run,
 *            sets the content check sent back, Engage's own queues. There is
 *            nothing to store: the entry exists exactly while the thing does,
 *            and disappears when somebody deals with it (orgs/my-notifications.js).
 *
 * ── THE ROW ─────────────────────────────────────────────────────────────────
 *
 *   PK  USER#<sub>#NOTIFY        (tenant.notificationsPk)
 *   SK  NOTE#<key>               one row per THING, not per event: a draft has
 *                                one notification that is updated as it moves
 *                                (ready → reminder), so the inbox never lists
 *                                the same draft twice.
 *   kind, key, orgId, scope, link {...}, read, createdAt, updatedAt,
 *   expiresAt (what it points at runs out then), remindedAt, ttl,
 *   title + body SEALED under orgId when there is one (tenant-crypto
 *   `notification`), as written for Engage's library.
 *
 * TTL: the thing's own expiry when it has one (a draft's), otherwise
 * DEFAULT_TTL_DAYS. Readers filter `ttl <= now` because DynamoDB deletes late.
 *
 * WRITES NEVER FAIL THEIR CALLER. A notification is a courtesy about work that
 * already happened; a worker that generated twenty questions must not report a
 * failure because the inbox write did not land. Errors are logged and dropped.
 */
const {
  PutCommand, QueryCommand, UpdateCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const tenant = require('./tenant');
const { encryptItem, decryptItem } = require('./tenant-crypto');

const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_TTL_DAYS = 30;
/** How close to its expiry a draft's notification turns into a reminder. */
const REMIND_DAYS_BEFORE = 5;
const LIST_MAX = 100;

const KINDS = Object.freeze({
  DRAFT_READY: 'draft.ready',
  DRAFT_PARTIAL: 'draft.partial',
  DRAFT_FAILED: 'draft.failed',
});

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const nowSeconds = (now = new Date()) => Math.floor(now.getTime() / 1000);
const TABLE = () => process.env.TABLE_NAME;

/** `draft#<id>` — what a key may look like. No spaces, no prose. */
function cleanKey(key) {
  const k = clean(key);
  if (!/^[a-z][a-z0-9-]*#[A-Za-z0-9_~.-]{1,80}$/.test(k)) throw new Error(`notifications: bad key ${JSON.stringify(key)}`);
  return k;
}

/** The deep link, kept to ids and a known type so no prose rides unsealed. */
function cleanLink(link) {
  if (!link || typeof link !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(link)) {
    if (!/^[a-zA-Z]{1,20}$/.test(k)) continue;
    if (typeof v === 'string' && /^[A-Za-z0-9_~#.:-]{0,128}$/.test(v)) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Write (or rewrite) the notification for one thing, unread.
 *
 * @param {object} n
 * @param {string} n.sub        whose inbox
 * @param {string} n.key        `draft#<draftId>` — one row per thing
 * @param {string} n.kind       one of KINDS
 * @param {string} [n.orgId]    the library it is about; '' for Engage's own
 * @param {string} [n.scope]    'org' | 'platform'
 * @param {string} n.title      a short line — sealed for an org
 * @param {string} [n.body]     a second line — sealed for an org
 * @param {object} [n.link]     ids only: `{ type:'draft', draftId, setId, orgId }`
 * @param {number} [n.expiresAt] epoch seconds the thing itself runs out
 * @returns {Promise<boolean>}  whether it landed
 */
async function notify(db, {
  sub, key, kind, orgId = '', scope = '', title, body = '', link = null, expiresAt = null,
} = {}, { now = new Date() } = {}) {
  try {
    const at = now.toISOString();
    const org = clean(orgId);
    const exp = Number.isFinite(expiresAt) ? Math.floor(expiresAt) : null;
    const content = { title: String(title || '').slice(0, 200), body: String(body || '').slice(0, 500) };
    const sealed = org ? await encryptItem(org, 'notification', content) : content;
    const item = {
      PK: tenant.notificationsPk(sub),
      SK: `NOTE#${cleanKey(key)}`,
      RecordType: 'NOTIFICATION',
      key: cleanKey(key),
      kind: clean(kind),
      orgId: org,
      scope: clean(scope) || (org ? tenant.ORG : tenant.PLATFORM),
      link: cleanLink(link),
      read: false,
      createdAt: at,
      updatedAt: at,
      ...(exp ? { expiresAt: exp } : {}),
      ttl: exp || (nowSeconds(now) + DEFAULT_TTL_DAYS * DAY_SECONDS),
      ...sealed,
    };
    await db.send(new PutCommand({ TableName: TABLE(), Item: item }));
    return true;
  } catch (error) {
    console.error(`⚠️ notifications: could not write ${key} for a user: ${error.message}`);
    return false;
  }
}

/** Remove the notification for a thing that has been decided. Never throws. */
async function resolve(db, sub, key) {
  try {
    if (!clean(sub)) return false;
    await db.send(new DeleteCommand({
      TableName: TABLE(),
      Key: { PK: tenant.notificationsPk(sub), SK: `NOTE#${cleanKey(key)}` },
    }));
    return true;
  } catch (error) {
    console.error(`⚠️ notifications: could not resolve ${key}: ${error.message}`);
    return false;
  }
}

/**
 * Every live stored row for this person, opened, newest first.
 *
 * THE REMINDER IS LAZY. A ready draft's notification carries the draft's own
 * expiry; when it is read within REMIND_DAYS_BEFORE of that and has not been
 * reminded yet, it turns unread again and says so. There is no scheduler to
 * pay for and no email to send (owner, 2026-10-21): the person sees the
 * reminder the next time they open the console, which is the only time they
 * could act on it anyway.
 */
async function listFor(db, sub, { now = new Date() } = {}) {
  const res = await db.send(new QueryCommand({
    TableName: TABLE(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.notificationsPk(sub), ':sk': 'NOTE#' },
    Limit: LIST_MAX,
  }));
  const t = nowSeconds(now);
  const rows = ((res && res.Items) || []).filter((r) => !(Number(r.ttl) && Number(r.ttl) <= t));
  const out = [];
  for (const row of rows) {
    let opened = row;
    if (row.orgId) {
      try { opened = await decryptItem(row.orgId, 'notification', row); } catch (error) {
        // A row whose key cannot be opened (an org removed since) is still a
        // thing to act on; it says so rather than vanishing.
        opened = { ...row, title: 'A notification from a team you no longer reach', body: '' };
      }
    }
    const expiring = row.kind === KINDS.DRAFT_READY || row.kind === KINDS.DRAFT_PARTIAL;
    const due = expiring && Number(row.expiresAt)
      && Number(row.expiresAt) - t <= REMIND_DAYS_BEFORE * DAY_SECONDS;
    if (due && !row.remindedAt) {
      try {
        await db.send(new UpdateCommand({
          TableName: TABLE(),
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: 'SET #reminded = :now, #read = :f, #updated = :now',
          ExpressionAttributeNames: { '#read': 'read', '#reminded': 'remindedAt', '#updated': 'updatedAt' },
          ExpressionAttributeValues: { ':now': now.toISOString(), ':f': false },
        }));
        opened = { ...opened, read: false, remindedAt: now.toISOString(), updatedAt: now.toISOString() };
      } catch (error) {
        console.error(`⚠️ notifications: could not mark a reminder: ${error.message}`);
      }
    }
    out.push(toWire(opened, t));
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** What the browser receives. No PK, no ttl, no sealed envelopes. */
function toWire(row, t = nowSeconds()) {
  const daysLeft = Number(row.expiresAt) ? Math.max(0, Math.ceil((Number(row.expiresAt) - t) / DAY_SECONDS)) : null;
  return {
    id: row.key,
    kind: row.kind,
    source: 'stored',
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : '',
    orgId: row.orgId || '',
    scope: row.scope || '',
    link: row.link || null,
    read: row.read === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    daysLeft,
    reminder: Boolean(row.remindedAt),
  };
}

async function markRead(db, sub, key, { now = new Date() } = {}) {
  await db.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { PK: tenant.notificationsPk(sub), SK: `NOTE#${cleanKey(key)}` },
    UpdateExpression: 'SET #read = :t, #readAt = :now',
    ConditionExpression: 'attribute_exists(SK)',
    ExpressionAttributeNames: { '#read': 'read', '#readAt': 'readAt' },
    ExpressionAttributeValues: { ':t': true, ':now': now.toISOString() },
  }));
}

async function markAllRead(db, sub, { now = new Date() } = {}) {
  const rows = await listFor(db, sub, { now });
  let n = 0;
  for (const row of rows) {
    if (row.read) continue;
    try { await markRead(db, sub, row.id, { now }); n += 1; } catch (error) { /* gone meanwhile */ }
  }
  return n;
}

module.exports = {
  KINDS,
  DEFAULT_TTL_DAYS,
  REMIND_DAYS_BEFORE,
  notify,
  resolve,
  listFor,
  markRead,
  markAllRead,
  toWire,
};
