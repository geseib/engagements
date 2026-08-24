/**
 * ORGANISATION LIFECYCLE — the parts every /orgs handler shares.
 *
 * Nine tiny Lambdas hang off this file (create-org, get-org, list-my-orgs,
 * list-members, invite-member, accept-invite, revoke-invite,
 * change-member-role, remove-member). Everything they have in common — how a
 * caller is identified, how a membership is proved, how an id is minted, how a
 * row is shaped — lives here so that nine handlers cannot drift into nine
 * different answers to the same question.
 *
 * ── THE ROWS, AND WHY EACH ONE EXISTS ──────────────────────────────────────
 *
 *   PK: ORGS          SK: ORG#{orgId}   platform index — name, plan, status, type
 *   PK: ORG#{orgId}   SK: METADATA      the organisation itself
 *   PK: ORG#{orgId}   SK: MEMBER#{sub}  role, email, displayName, joinedAt
 *   PK: ORG#{orgId}   SK: INVITE#{tok}  email, role, invitedBy, expiresAt, ttl
 *   PK: USER#{sub}    SK: ORG#{orgId}   the REVERSE index the authorizer reads
 *   PK: USER#{sub}    SK: PROFILE       gains defaultOrgId, personalOrgId
 *
 * The MEMBER row and the USER reverse row carry the same fact twice, on
 * purpose. DynamoDB cannot answer "which orgs does this user belong to?" from
 * the ORG partition without a scan, and cannot answer "who is in this org?"
 * from the USER partition at all. Both questions are asked on every request —
 * the first by `auth/authorizer.js` on the hot path, the second by the Team
 * screen — so both get a partition. The price is that the two must be written
 * and deleted TOGETHER, which is why every handler that touches membership
 * uses TransactWriteCommand and never a bare Put.
 *
 * ── orgId IS MINTED, NEVER DERIVED ─────────────────────────────────────────
 *
 * `admin/upload-questions.js:298` builds a setId by lower-casing a title and
 * stripping non-alphanumerics, so two teams naming a set "Team Retro" both
 * produce `teamretro` and the second write silently destroys the first. An
 * orgId derived from an organisation's name would reproduce that bug one level
 * up, where it destroys not a question set but an entire tenant's partition.
 * So `mintOrgId()` returns random bytes and nothing else, and the create
 * transaction still guards the write with `attribute_not_exists` — 22 base58
 * characters is ~129 bits, a collision is not going to happen, and the
 * condition costs nothing and turns "will not" into "cannot".
 *
 * ── FAIL CLOSED, EVERY TIME ────────────────────────────────────────────────
 *
 * A missing authorizer context, an unparseable body, an orgId that is not the
 * one the caller is acting for, a role string nobody recognises: all of them
 * DENY. There is no branch in this file that treats absent information as
 * permission. See `authorizeOrg` for the two independent checks, and why one
 * would not be enough.
 */

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

// `../../shared/tenant` — the admin bundle's copy. CodeUri for these handlers
// is `lambda-functions/admin/`, exactly as it is for manage-users.js, so this
// resolves inside the bundle. Do NOT reach into game/ or websocket/: those
// copies are byte-identical (tests/tenant-keys.js section 8 pins that) but they
// are not packaged with this code.
const tenant = require('../../shared/tenant');

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const db = DynamoDBDocumentClient.from(dynamoClient);

/** Read at CALL time, not at module load. A handler test sets TABLE_NAME after
 *  requiring the module in some harnesses; capturing it in a const at load
 *  turns that ordering into an undefined TableName and a confusing SDK error. */
function tableName() {
  return process.env.TABLE_NAME;
}

// ── HTTP ───────────────────────────────────────────────────────────────────
// Same headers as manage-users.js. Kept literal rather than imported so a
// change to one handler's CORS cannot silently change every route's.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function fail(statusCode, message) {
  return json(statusCode, { error: message });
}

/**
 * A preflight carries no credentials and MUST NOT be refused. Every handler
 * answers OPTIONS before it looks at authorisation — see the comment at
 * manage-users.js:243 for the incident that fixed the ordering there.
 */
function handlePreflight() {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
      'Access-Control-Allow-Headers':
        'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Max-Age': '86400',
    },
    body: '',
  };
}

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// ── Who is calling ─────────────────────────────────────────────────────────
/**
 * The caller's Cognito sub.
 *
 * This API's `CognitoAuthorizer` is a CUSTOM Lambda authorizer despite the
 * name (payload 2.0, simple response), so its context lands at
 * `.authorizer.lambda` as `{ userId, username, email, groups, ... }` — NOT at
 * `.jwt.claims`. `shared/require-admin.js` documents the eighteen tests that
 * once passed against a shape this API has never produced. The JWT shapes are
 * accepted after it only so that a route later moved onto a native JWT
 * authorizer does not lock everyone out.
 *
 * Blank means anonymous, and an anonymous caller owns nothing.
 */
function callerSub(event) {
  const a = event?.requestContext?.authorizer || {};
  const claims = a.jwt?.claims || a.claims || {};
  return clean(a.lambda?.userId ?? a.lambda?.sub ?? claims.sub ?? '');
}

/**
 * The caller's email, lower-cased.
 *
 * Lower-cased because it is COMPARED — accept-invite refuses an invitation
 * addressed to somebody else, and `Amara@x.example` and `amara@x.example` are
 * the same mailbox. Comparing raw would let a mixed-case invite be
 * un-acceptable by the person it was sent to, which reads as "the link is
 * broken" and produces a support thread rather than a bug report.
 */
function callerEmail(event) {
  const a = event?.requestContext?.authorizer || {};
  const claims = a.jwt?.claims || a.claims || {};
  return clean(a.lambda?.email ?? claims.email ?? '').toLowerCase();
}

/** The caller's display name, best effort. Never load-bearing. */
function callerName(event) {
  const a = event?.requestContext?.authorizer || {};
  const claims = a.jwt?.claims || a.claims || {};
  return clean(a.lambda?.name ?? a.lambda?.username ?? claims.name ?? '');
}

// ── Ids and tokens ─────────────────────────────────────────────────────────
/**
 * base58: base62 minus 0, O, I and l. An orgId appears in support tickets, in
 * logs and (inside an invite token) in a URL somebody may retype. The four
 * characters removed are the four that cannot be told apart in most fonts.
 */
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * `n` random base58 characters, WITHOUT modulo bias.
 *
 * `randomBytes(1)[0] % 58` is the obvious version and it is skewed: 256 is not
 * a multiple of 58, so the first 24 characters of the alphabet come up
 * fractionally more often. It would not be exploitable here, but rejection
 * sampling is three extra lines and removes the argument entirely.
 */
function randomBase58(n) {
  const LIMIT = 256 - (256 % BASE58.length); // 232 — bytes at or above this are discarded
  let out = '';
  while (out.length < n) {
    for (const byte of crypto.randomBytes(n * 2)) {
      if (byte >= LIMIT) continue;
      out += BASE58[byte % BASE58.length];
      if (out.length === n) break;
    }
  }
  return out;
}

const ORG_ID_RE = /^org_[1-9A-HJ-NP-Za-km-z]{22}$/;

/** A brand-new organisation id. Opaque, random, and NOT the name — see header. */
function mintOrgId() {
  return `org_${randomBase58(22)}`;
}

function isOrgId(v) {
  return ORG_ID_RE.test(clean(v));
}

/**
 * An invitation token that NAMES ITS OWN PARTITION.
 *
 * The invite row lives at `PK=ORG#{orgId}`, and the accept route is
 * `POST /invites/{token}/accept` — the accepting user does not know the orgId
 * yet and there is no secondary index on this table that could find a row by
 * token alone. A bare random token would therefore be unlookupable without
 * either a full-table scan or a new GSI.
 *
 * So the token carries the partition in front of the secret:
 *
 *     org_7kQ…2v.9mFxK…            <orgId> '.' <32 random base58 chars>
 *
 * The secret half is what makes it unguessable; the orgId half is public
 * information the moment the invitation email is opened, and revealing it
 * grants nothing — every route still checks membership. `parseInviteToken`
 * validates BOTH halves against a strict pattern before either is allowed
 * anywhere near a key, so a hand-written token cannot build an arbitrary PK.
 */
function mintInviteToken(orgId) {
  return `${clean(orgId)}.${randomBase58(32)}`;
}

const INVITE_TOKEN_RE = /^(org_[1-9A-HJ-NP-Za-km-z]{22})\.([1-9A-HJ-NP-Za-km-z]{24,64})$/;

/** @returns {{orgId: string, secret: string}|null} — null means "do not use". */
function parseInviteToken(token) {
  const m = INVITE_TOKEN_RE.exec(clean(token));
  return m ? { orgId: m[1], secret: m[2] } : null;
}

// ── Time ───────────────────────────────────────────────────────────────────
/** An invitation is good for a fortnight. Stated on 03-team.html, so changing
 *  it here alone makes the screen lie. */
const INVITE_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function inviteExpiry(nowMs = Date.now()) {
  const at = nowMs + INVITE_TTL_DAYS * DAY_MS;
  return {
    expiresAt: new Date(at).toISOString(),
    // DynamoDB TTL is EPOCH SECONDS, and a millisecond value here would set an
    // expiry in the year 57000 — the row would never be swept and the promise
    // "nothing is kept" would be quietly false.
    ttl: Math.floor(at / 1000),
  };
}

/**
 * Is this invitation past its expiry?
 *
 * THE TTL ATTRIBUTE IS NOT A GUARANTEE OF DELETION TIME. DynamoDB deletes
 * expired items "typically within 48 hours" and makes no promise at all — an
 * expired invite is readable, and acceptable, long after the screen says it
 * died. So the handler decides, and the TTL is only housekeeping.
 *
 * A row with no `expiresAt` at all counts as EXPIRED, not as immortal: an
 * invite whose shape we cannot read is one we refuse.
 */
function isExpired(invite, nowMs = Date.now()) {
  const t = Date.parse(invite?.expiresAt ?? '');
  return !Number.isFinite(t) || t <= nowMs;
}

/** Whole days left, rounded up, floored at 0. "expires in 3" — 03-team.html
 *  does the arithmetic for the reader rather than printing a send date. */
function daysUntilExpiry(invite, nowMs = Date.now()) {
  const t = Date.parse(invite?.expiresAt ?? '');
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - nowMs) / DAY_MS));
}

// ── Bodies ─────────────────────────────────────────────────────────────────
/**
 * @returns {object|null} — null means MALFORMED, `{}` means empty. The two are
 * different answers and a handler that conflates them turns a client bug into
 * a silent default.
 */
function parseBody(event) {
  const raw = event?.body;
  if (raw === undefined || raw === null || raw === '') return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── Reading the org partition ──────────────────────────────────────────────
/**
 * Every row in one partition under one SK prefix, following LastEvaluatedKey
 * to the end.
 *
 * The pagination is not optional. A Query response is capped at 1 MB and a
 * single un-paginated Query silently returns a PREFIX of the partition — the
 * same defect `shared/ddb-delete.js` was written to fix. Here it would under-
 * count owners, and under-counting owners is precisely how the last owner gets
 * demoted.
 */
async function queryPartition(pk, skPrefix) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
      ExclusiveStartKey,
    }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const memberSk = (sub) => `MEMBER#${clean(sub)}`;
const inviteSk = (token) => `INVITE#${clean(token)}`;
/** The reverse row's SK is `ORG#{orgId}` — the same string `tenant.orgPk`
 *  builds for the forward partition. One helper, so they cannot diverge. */
const userOrgSk = (orgId) => tenant.orgPk(orgId);

async function getOrgMetadata(orgId) {
  const res = await db.send(new GetCommand({
    TableName: tableName(),
    Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' },
  }));
  return res.Item || null;
}

async function getMembership(orgId, sub) {
  if (!clean(orgId) || !clean(sub)) return null;
  const res = await db.send(new GetCommand({
    TableName: tableName(),
    Key: { PK: tenant.orgPk(orgId), SK: memberSk(sub) },
  }));
  return res.Item || null;
}

/** One invitation, by the token that names its own partition. Returns null for
 *  a token that fails `parseInviteToken` — a malformed token must never build
 *  a key. */
async function getInvite(orgId, token) {
  if (!isOrgId(orgId) || !parseInviteToken(token)) return null;
  const res = await db.send(new GetCommand({
    TableName: tableName(),
    Key: { PK: tenant.orgPk(orgId), SK: inviteSk(token) },
  }));
  return res.Item || null;
}

async function listMembers(orgId) {
  return queryPartition(tenant.orgPk(orgId), 'MEMBER#');
}

async function listInvites(orgId) {
  return queryPartition(tenant.orgPk(orgId), 'INVITE#');
}

/** Owners, by the rows — never by a counter. A denormalised `ownerCount` on
 *  METADATA is one failed write away from letting the last owner be removed. */
function ownersOf(members) {
  return (members || []).filter((m) => clean(m.role).toLowerCase() === 'owner');
}

// ── Authorisation ──────────────────────────────────────────────────────────
/**
 * May this caller act on THIS organisation at THIS level?
 *
 * TWO INDEPENDENT CHECKS, AND BOTH MUST PASS.
 *
 *   1. The authorizer context (`tenant.canManageScope`). This proves the caller
 *      is acting FOR this organisation — `callerOrgId(event) === orgId` — which
 *      is the check that stops an admin of Northwind from administering
 *      Halcyon by editing the orgId in the URL. Nothing in the path is trusted.
 *
 *   2. The MEMBER row in the table. The context is minted at sign-in and can be
 *      minutes stale; a person removed from an org, or demoted from admin,
 *      still carries the old context in a live token. The row is the truth, and
 *      re-reading it costs one Get on a route nobody calls in a loop.
 *
 * Being Engage staff is NOT a bypass. `tenant.js` is explicit that there is no
 * scope value meaning "everyone's" and that platform admin adds nothing —
 * reading a customer's organisation is a separate, granted, logged act
 * (08-privacy.html), not a flag on this function.
 *
 * @returns {{denied: object}|{membership: object, org: object}}
 */
async function authorizeOrg(event, orgId, minRole = 'member') {
  if (!callerSub(event)) return { denied: fail(403, 'Sign in to do this.') };
  if (!isOrgId(orgId)) return { denied: fail(400, 'That is not an organisation id.') };

  // (1) the context
  if (!tenant.canManageScope(event, tenant.ORG, orgId, minRole)) {
    return {
      denied: fail(403, minRole === 'member'
        ? 'You are not a member of that organisation.'
        : 'Only an admin of this organisation can do this.'),
    };
  }

  // (2) the table
  const membership = await getMembership(orgId, callerSub(event));
  if (!membership) return { denied: fail(403, 'You are not a member of that organisation.') };
  if (!tenant.roleAtLeast(membership.role, minRole)) {
    return { denied: fail(403, 'Only an admin of this organisation can do this.') };
  }

  const org = await getOrgMetadata(orgId);
  if (!org) {
    // A membership pointing at an organisation that does not exist is a
    // half-deleted tenant, not an authorisation success.
    return { denied: fail(404, 'That organisation no longer exists.') };
  }
  return { membership, org };
}

// ── Shapes the screens read ────────────────────────────────────────────────
/** One row of the Members table on 03-team.html. */
function publicMember(row) {
  return {
    userId: row.userId || String(row.SK || '').replace(/^MEMBER#/, ''),
    email: row.email || '',
    displayName: row.displayName || '',
    role: clean(row.role).toLowerCase(),
    joinedAt: row.joinedAt || null,
  };
}

/** One row of the "Invited, not joined yet" table. `expired` and
 *  `daysUntilExpiry` are computed here so that every screen showing an
 *  invitation shows the same arithmetic. */
function publicInvite(row, nowMs = Date.now()) {
  return {
    token: row.token || String(row.SK || '').replace(/^INVITE#/, ''),
    email: row.email || '',
    role: clean(row.role).toLowerCase(),
    invitedBy: row.invitedBy || null,
    invitedByEmail: row.invitedByEmail || '',
    invitedAt: row.invitedAt || null,
    expiresAt: row.expiresAt || null,
    expired: isExpired(row, nowMs),
    daysUntilExpiry: daysUntilExpiry(row, nowMs),
  };
}

/** The organisation as the switcher and the Team screen want it. */
function publicOrg(org) {
  return {
    orgId: org.orgId,
    name: org.name,
    slug: org.slug || '',
    plan: org.plan || 'free',
    // PERSONAL OR TEAM. `01-org-switcher.html` already draws
    // "Amara Reyes · Personal", so the switcher needs to be told which entry is
    // the person's own home — it cannot infer it from the name, and inferring
    // it from a member count would mean a Query per row of a dropdown.
    type: orgType(org),
    seats: org.seats ?? null,
    status: org.status || 'active',
    createdAt: org.createdAt || null,
    createdBy: org.createdBy || null,
  };
}

// ── Personal organisations ─────────────────────────────────────────────────
/**
 * THE TWO KINDS, AND WHY THE DISTINCTION IS NOT "HOW MANY MEMBERS".
 *
 *   personal  the account's HOME. Provisioned automatically the first time an
 *             approved account asks for its organisations (shared/personal-org.js),
 *             never asked for, and never leavable or deletable — deleting the
 *             ACCOUNT is that operation. It flips to `team` the moment a second
 *             member joins, and never flips back.
 *   team      everything somebody deliberately created or was invited into.
 *
 * An organisation somebody typed a name for on `09-first-run.html` is a TEAM
 * from birth even while it has one member, because it was a deliberate act with
 * a name attached — and because the alternative makes every one-person
 * organisation undeletable, which turns a mis-typed name into a permanent
 * fixture of the switcher.
 *
 * ANYTHING UNRECOGNISED IS A TEAM, including absent. Every organisation that
 * existed before this attribute did was created by hand and is deletable, and
 * defaulting the other way would retroactively freeze all of them.
 */
const PERSONAL = 'personal';
const TEAM = 'team';
const ORG_TYPES = [PERSONAL, TEAM];

function orgType(org) {
  return clean(org && org.type).toLowerCase() === PERSONAL ? PERSONAL : TEAM;
}

function isPersonalOrg(org) {
  return orgType(org) === PERSONAL;
}

/**
 * Refuse an operation that would take somebody's home away — or `null`.
 *
 * REFUSED IN THE HANDLER, NOT IN THE UI. `03-team.html` hides the Leave button
 * on a personal organisation, and a hidden button is not a permission: the API
 * is reachable with curl, and the screen decided from a list that may be
 * seconds out of date. The same argument as the last-owner rule in
 * remove-member.js, and the same 409 — this is a state conflict, not a
 * permission problem, and drawing it as "you are not allowed" would send the
 * reader looking for somebody who could authorise it.
 *
 * @param {'leave'|'remove'|'delete'} action
 */
function personalOrgRefusal(org, action) {
  if (!isPersonalOrg(org)) return null;
  const what = action === 'delete'
    ? 'deleted'
    : 'left';
  return fail(409,
    `This is your personal organisation — your own sessions and question sets live in it, `
    + `so it cannot be ${what}. Deleting your account is the operation that removes it.`);
}

/**
 * A display slug. NOT AN IDENTITY, and never used to build a key — see the
 * header. It exists so a URL can read `/orgs/org_7kQ…/…?n=northwind-learning`
 * and a human can tell which tab is which. Two organisations may share one.
 */
function slugify(name) {
  return clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48);
}

/** Names are trimmed and bounded. Blank is refused rather than defaulted:
 *  an organisation called "" is unpickable in the switcher for ever. */
const NAME_MAX = 80;
function validateName(raw) {
  const name = clean(raw).replace(/\s+/g, ' ');
  if (!name) return { error: 'Give the organisation a name.' };
  if (name.length > NAME_MAX) return { error: `Keep the name under ${NAME_MAX} characters.` };
  return { name };
}

/** Roles that may be GRANTED through the API. `owner` is absent on purpose —
 *  see change-member-role.js for who may hand ownership over. */
const INVITABLE_ROLES = ['admin', 'member'];

module.exports = {
  db, tableName,
  CORS, json, fail, handlePreflight,
  clean,
  callerSub, callerEmail, callerName,
  BASE58, randomBase58, mintOrgId, isOrgId,
  mintInviteToken, parseInviteToken,
  INVITE_TTL_DAYS, inviteExpiry, isExpired, daysUntilExpiry,
  parseBody,
  queryPartition, memberSk, inviteSk, userOrgSk,
  getOrgMetadata, getMembership, getInvite, listMembers, listInvites, ownersOf,
  authorizeOrg,
  publicMember, publicInvite, publicOrg,
  PERSONAL, TEAM, ORG_TYPES, orgType, isPersonalOrg, personalOrgRefusal,
  slugify, validateName, NAME_MAX, INVITABLE_ROLES,
};
