/**
 * THE AUDIT LOG — who changed what, on whose organisation, and why.
 *
 * The owner, 2026-10-04: "make sure that any action by an Engage admin on a
 * team or user is logged, and available [to see], with who did it."
 *
 * One log, in one place per organisation. A ledger that already records its
 * own actor (the billing adjustments, the plan-request decision, the review
 * log) keeps doing so; the entry here is written as well, so a team admin has
 * one table to read instead of four.
 *
 * ── THE CONTRACT (fixed: another work stream writes through it) ────────────
 *
 *   recordAudit(db, { orgId, action, actor: { sub, email, name, role },
 *                     target: { type, id, title }, reason, detail })
 *
 *   PK  ORG#<orgId>#AUDIT        SK  <ISO timestamp>#<8 random hex>
 *   At, OrgId, Action, Actor (map), Target (map: Type, Id),
 *   Title and Reason SEALED under the org's key (tenant-crypto), Detail.
 *
 *   - It THROWS when the write fails. Callers write the entry BEFORE the
 *     action and let a throw refuse the action: an action with no record is
 *     the one outcome this file exists to prevent.
 *   - `role` is one of ROLES. `action` is dotted (`user.approve`).
 *   - `detail` is ids and counts only, never words somebody typed. Anything
 *     else is dropped rather than refused — a caller's stray field should not
 *     cost the action, and dropping it keeps text out of a plaintext column.
 *   - KEPT FOR ONE YEAR (owner, 2026-10-04). Every row written here carries
 *     `ttl` = the entry's time + RETENTION_DAYS, in epoch seconds, on the
 *     table's TTL attribute — the org row, the staff index row and a holding
 *     row alike, and a holding row keeps its own ttl when it is adopted.
 *
 * ── THREE PLACES A ROW CAN LAND ────────────────────────────────────────────
 *
 *   1. ORG#<orgId>#AUDIT — the organisation's own log. Always, when there is
 *      an organisation. An action on a PERSON goes under their personal space.
 *   2. PLATFORM#AUDIT — every entry whose actor is Engage staff, written as
 *      well, so staff can read "what did staff do" across the platform without
 *      walking every organisation. Same SK, same sealed fields (each row names
 *      its OrgId, which is the key it opens with).
 *   3. USER#<sub>#AUDIT — an action on a person who has NO personal space yet.
 *      Spaces are made lazily (orgs/shared/personal-org.js), so approving a
 *      pending account always lands here. There is no key to seal with, so
 *      Title and Reason are stored as written and the row says `Sealed: false`.
 *      `adoptPendingAudit` moves these into the space, sealed, the moment the
 *      space is created — and the person then sees who approved them.
 *
 *   An action with neither an organisation nor a person (a discount code) is
 *   staff-only and lands in PLATFORM#AUDIT alone. Only staff may write one.
 *
 * ── AN ORGANISATION WITH NO KEY ────────────────────────────────────────────
 *
 * tenant-crypto throws for an org whose METADATA carries no wrapped key. Every
 * other encrypted write for that org fails the same way, but a staff action on
 * it — suspending it, say — must still be possible and still be recorded. So
 * that ONE failure stores the two fields as written, `Sealed: false`, and says
 * so in the log. Any other crypto failure (KMS refused, wrong key) is a real
 * fault and throws, which refuses the action.
 *
 * ── AND WHAT HAPPENS AFTER ─────────────────────────────────────────────────
 *
 * The entry records the ATTEMPT, because it is written first. When the action
 * then fails, `markAuditOutcome` stamps `Outcome` on the row(s) so the log does
 * not claim a change that never happened. Best effort: a failure to stamp is
 * logged, never thrown — the action's own error is the one the caller needs.
 *
 * DUPLICATED, BYTE FOR BYTE, like tenant.js: lambda-functions/admin/shared/,
 * lambda-functions/game/ and lambda-functions/websocket/ each carry this file,
 * because Lambda bundles are per-directory. tests/audit-log.js fails the build
 * if the copies drift.
 */
const crypto = require('crypto');
const {
  PutCommand, QueryCommand, UpdateCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { encryptValue, decryptValue } = require('./tenant-crypto');

const TABLE = () => process.env.TABLE_NAME;

/** Who may appear as the actor. */
const ROLES = Object.freeze(['host', 'org-owner', 'org-admin', 'platform-admin']);
const PLATFORM_ROLE = 'platform-admin';

/** The staff-wide index. Carries sealed fields only, opened per row. */
const PLATFORM_AUDIT_PK = 'PLATFORM#AUDIT';

/** How long an entry is kept (owner, 2026-10-04: one year). */
const RETENTION_DAYS = 365;
const DAY_SECONDS = 24 * 60 * 60;

/** The epoch-seconds `ttl` for an entry written at `at` (a Date). */
function expiresAt(at) {
  return Math.floor(at.getTime() / 1000) + RETENTION_DAYS * DAY_SECONDS;
}

const ACTION_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SK_RE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z#[0-9a-f]{8}$/;
const TITLE_MAX = 300;
const REASON_MAX = 1000;
const DETAIL_KEYS_MAX = 16;
const DETAIL_STRING_MAX = 128;
const PAGE_DEFAULT = 25;
const PAGE_MAX = 100;

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

const orgAuditPk = (orgId) => `ORG#${clean(orgId)}#AUDIT`;
const userAuditPk = (sub) => `USER#${clean(sub)}#AUDIT`;

/** Ids and counts survive; prose and nested objects do not. */
function cleanDetail(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const out = {};
  const scalar = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'boolean' || v === null) return v;
    if (typeof v === 'string') return v.length <= DETAIL_STRING_MAX ? v : undefined;
    return undefined;
  };
  for (const [k, v] of Object.entries(detail).slice(0, DETAIL_KEYS_MAX)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue;
    if (Array.isArray(v)) {
      const arr = v.slice(0, 50).map(scalar).filter((x) => x !== undefined);
      out[k] = arr;
    } else {
      const s = scalar(v);
      if (s !== undefined) out[k] = s;
    }
  }
  return out;
}

/** Seal one value under an org's key, or keep it as written for a keyless org. */
async function seal(orgId, value) {
  try {
    return { value: await encryptValue(orgId, value), sealed: true };
  } catch (e) {
    if (/has no dataKeyCiphertext/.test(String(e && e.message))) {
      console.warn(`audit-log: org ${orgId} has no data key; storing the entry unsealed`);
      return { value, sealed: false };
    }
    throw e;
  }
}

function newSk(now) {
  return `${now.toISOString()}#${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Write one audit entry. THROWS when it cannot — see the header.
 *
 * @returns {Promise<{PK: string, SK: string, At: string, indexed: boolean}>}
 *   the key, for markAuditOutcome.
 */
async function recordAudit(db, {
  orgId, action, actor, target, reason, detail,
} = {}, { now = new Date() } = {}) {
  if (!db || typeof db.send !== 'function') throw new Error('audit-log: a DynamoDB client is required');
  const act = clean(action);
  if (!ACTION_RE.test(act)) throw new Error(`audit-log: action must be dotted, got ${JSON.stringify(action)}`);
  const role = clean(actor && actor.role);
  if (!ROLES.includes(role)) throw new Error(`audit-log: role must be one of ${ROLES.join(', ')}`);
  const sub = clean(actor && actor.sub);
  if (!sub) throw new Error('audit-log: the actor needs a sub');
  const targetType = clean(target && target.type);
  if (!targetType) throw new Error('audit-log: the target needs a type');

  const org = clean(orgId);
  const targetId = clean(String((target && target.id) ?? ''));
  const title = typeof (target && target.title) === 'string'
    ? target.title.trim().slice(0, TITLE_MAX)
    : ((target && target.title) || '');
  const why = clean(reason).slice(0, REASON_MAX);

  // Where the entry lives (see the header's three places).
  let pk;
  if (org) pk = orgAuditPk(org);
  else if (targetType === 'user' && targetId) pk = userAuditPk(targetId);
  else if (role === PLATFORM_ROLE) pk = '';
  else throw new Error('audit-log: an entry needs an organisation');

  const At = now.toISOString();
  const SK = newSk(now);
  const row = {
    PK: pk,
    SK,
    RecordType: 'AUDIT',
    At,
    OrgId: org,
    Action: act,
    Actor: {
      Sub: sub,
      Email: clean(actor.email).toLowerCase(),
      Name: clean(actor.name),
      Role: role,
    },
    Target: { Type: targetType, Id: targetId },
    Detail: cleanDetail(detail),
    ttl: expiresAt(now),
  };
  let sealed = true;
  if (title) {
    if (org) {
      const s = await seal(org, title);
      row.Title = s.value; sealed = sealed && s.sealed;
    } else {
      row.Title = title; sealed = false;
    }
  }
  if (why) {
    if (org) {
      const s = await seal(org, why);
      row.Reason = s.value; sealed = sealed && s.sealed;
    } else {
      row.Reason = why; sealed = false;
    }
  }
  if (!sealed) row.Sealed = false;
  if (!org && targetType === 'user') row.TargetUserSub = targetId;

  const indexed = role === PLATFORM_ROLE;
  if (pk) {
    await db.send(new PutCommand({ TableName: TABLE(), Item: row }));
  }
  if (indexed) {
    try {
      await db.send(new PutCommand({ TableName: TABLE(), Item: { ...row, PK: PLATFORM_AUDIT_PK } }));
    } catch (e) {
      // The index is half of one entry: without it the org row would stand
      // for an action that is about to be refused. Take it back, then throw.
      if (pk) {
        try { await db.send(new DeleteCommand({ TableName: TABLE(), Key: { PK: pk, SK } })); } catch (inner) {
          console.error(`audit-log: could not withdraw ${pk}/${SK}: ${inner.message}`);
        }
      }
      throw e;
    }
  }
  return { PK: pk || PLATFORM_AUDIT_PK, SK, At, indexed: indexed && Boolean(pk) };
}

/**
 * Say on the entry that the action it records did not go through.
 * Best effort: never throws.
 *
 * @param {object} ref  what recordAudit returned
 * @param {string} outcome  'failed' | 'refused'
 */
async function markAuditOutcome(db, ref, outcome = 'failed') {
  if (!ref || !ref.PK || !ref.SK) return;
  const keys = [{ PK: ref.PK, SK: ref.SK }];
  if (ref.indexed) keys.push({ PK: PLATFORM_AUDIT_PK, SK: ref.SK });
  for (const Key of keys) {
    try {
      await db.send(new UpdateCommand({
        TableName: TABLE(),
        Key,
        UpdateExpression: 'SET Outcome = :o',
        ExpressionAttributeValues: { ':o': clean(outcome) || 'failed' },
      }));
    } catch (e) {
      console.error(`audit-log: could not mark ${Key.PK}/${Key.SK} ${outcome}: ${e.message}`);
    }
  }
}

/* ------------------------------------------------------------- reading --- */

const encodeCursor = (sk) => Buffer.from(JSON.stringify({ sk }), 'utf8').toString('base64url');
function decodeCursor(cursor) {
  const raw = clean(cursor);
  if (!raw) return '';
  try {
    const { sk } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return SK_RE.test(String(sk)) ? String(sk) : null;
  } catch {
    return null;
  }
}

function pageSize(limit) {
  const n = Math.trunc(Number(limit));
  if (!Number.isFinite(n) || n < 1) return PAGE_DEFAULT;
  return Math.min(n, PAGE_MAX);
}

/** A row as the screens read it. Sealed fields must already be opened. */
function publicEntry(row) {
  const actor = row.Actor || {};
  const target = row.Target || {};
  return {
    id: row.SK,
    at: row.At || String(row.SK || '').split('#')[0],
    orgId: row.OrgId || '',
    action: row.Action || '',
    actor: {
      sub: actor.Sub || actor.sub || '',
      email: actor.Email || actor.email || '',
      name: actor.Name || actor.name || '',
      role: actor.Role || actor.role || '',
    },
    target: {
      type: target.Type || target.type || '',
      id: target.Id || target.id || '',
      title: typeof row.Title === 'string' ? row.Title : '',
    },
    reason: typeof row.Reason === 'string' ? row.Reason : '',
    detail: row.Detail || {},
    outcome: row.Outcome || '',
  };
}

async function openRow(row) {
  const org = clean(row.OrgId);
  const out = { ...row };
  for (const f of ['Title', 'Reason']) {
    if (!(f in out)) continue;
    if (!org) continue; // unsealed by construction
    try {
      out[f] = await decryptValue(org, out[f]);
    } catch (e) {
      throw new Error(`audit-log: cannot open ${f} on ${row.SK} for ${org}: ${e.message}`);
    }
  }
  return out;
}

async function readPartition(db, pk, { limit, cursor } = {}) {
  const start = decodeCursor(cursor);
  if (start === null) {
    const e = new Error('That page marker is not one this log gave out.');
    e.statusCode = 400;
    throw e;
  }
  const res = await db.send(new QueryCommand({
    TableName: TABLE(),
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': pk },
    ScanIndexForward: false,
    Limit: pageSize(limit),
    ...(start ? { ExclusiveStartKey: { PK: pk, SK: start } } : {}),
  }));
  const rows = (res && res.Items) || [];
  const entries = [];
  for (const row of rows) entries.push(publicEntry(await openRow(row)));
  const last = res && res.LastEvaluatedKey;
  return { entries, cursor: last && last.SK ? encodeCursor(last.SK) : '' };
}

/** One organisation's log, newest first, one page. */
function readAudit(db, { orgId, limit, cursor } = {}) {
  const org = clean(orgId);
  if (!org) throw new Error('audit-log: readAudit needs an orgId');
  return readPartition(db, orgAuditPk(org), { limit, cursor });
}

/** Everything Engage staff have done, newest first, one page. */
function readPlatformAudit(db, { limit, cursor } = {}) {
  return readPartition(db, PLATFORM_AUDIT_PK, { limit, cursor });
}

/* --------------------------------------------- a person's first space --- */

/**
 * Move a person's pre-space entries (USER#<sub>#AUDIT) into their new personal
 * space, sealed under its key, and remove the holding rows. Called once, when
 * the space is created. Pages every row. Throws on failure; the caller decides
 * whether that should cost the request (personal-org.js: it should not).
 *
 * @returns {Promise<number>} how many entries moved
 */
async function adoptPendingAudit(db, sub, orgId) {
  const who = clean(sub);
  const org = clean(orgId);
  if (!who || !org) return 0;
  const pk = userAuditPk(who);
  let moved = 0;
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ExclusiveStartKey,
    }));
    for (const row of (res && res.Items) || []) {
      const next = { ...row, PK: orgAuditPk(org), OrgId: org };
      delete next.Sealed;
      delete next.TargetUserSub;
      let sealed = true;
      for (const f of ['Title', 'Reason']) {
        if (!(f in next)) continue;
        const s = await seal(org, next[f]);
        next[f] = s.value; sealed = sealed && s.sealed;
      }
      if (!sealed) next.Sealed = false;
      await db.send(new PutCommand({ TableName: TABLE(), Item: next }));
      await db.send(new DeleteCommand({ TableName: TABLE(), Key: { PK: row.PK, SK: row.SK } }));
      moved += 1;
    }
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return moved;
}

/* ------------------------------------------------------------ the actor --- */

/**
 * The actor, from the custom authorizer's context
 * (event.requestContext.authorizer.lambda — see require-admin.js for why it is
 * not .jwt.claims). `name` is the person's own name when the token carried one.
 */
function actorFromEvent(event, role) {
  const a = (event && event.requestContext && event.requestContext.authorizer) || {};
  const lambda = a.lambda || {};
  const claims = (a.jwt && a.jwt.claims) || a.claims || {};
  return {
    sub: clean(lambda.userId ?? lambda.sub ?? claims.sub ?? ''),
    email: clean(lambda.email ?? claims.email ?? '').toLowerCase(),
    name: clean(lambda.name ?? claims.name ?? ''),
    role,
  };
}

/** An org role, as an audit role. Unknown means a plain host. */
function auditRoleForOrgRole(orgRole) {
  const r = clean(orgRole).toLowerCase();
  if (r === 'owner') return 'org-owner';
  if (r === 'admin') return 'org-admin';
  return 'host';
}

module.exports = {
  ROLES,
  RETENTION_DAYS,
  expiresAt,
  PLATFORM_AUDIT_PK,
  orgAuditPk,
  userAuditPk,
  recordAudit,
  markAuditOutcome,
  readAudit,
  readPlatformAudit,
  adoptPendingAudit,
  actorFromEvent,
  auditRoleForOrgRole,
  publicEntry,
  encodeCursor,
  decodeCursor,
};
