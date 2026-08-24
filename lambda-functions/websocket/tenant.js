/**
 * WHOSE ROW IS THIS? — the one place that answers it.
 *
 * Every partition key that carries content is built here, and every handler
 * that needs to know which organisation a caller is acting for reads it here.
 * Nothing else in the codebase may write a `'SETS'` or `'GAMES'` literal;
 * tests/no-global-partition-literals.js fails the build if one appears.
 *
 * ── THE THREE SCOPES, AND WHY THE FIRST ONE IS UNCHANGED ───────────────────
 *
 * A question set belongs to exactly one of three places:
 *
 *   PLATFORM  PK: SETS                 SK: SET#<id>     content: SET#<id>[#v<n>]
 *   ORG       PK: ORG#<org>#SETS       SK: SET#<id>     content: ORG#<org>#SET#<id>[#v<n>]
 *   PUBLIC    PK: PUBLIC#SETS          SK: SET#<id>     content: PUBLIC#SET#<id>[#v<n>]
 *
 * PLATFORM IS THE EXISTING KEYS, BYTE FOR BYTE, AND THAT IS THE WHOLE MIGRATION.
 * Every set that exists today lives at `PK='SETS'` / `SET#<id>`, and the owner's
 * decision is that all of it is central content managed by Engage and offered to
 * everybody. So the old partition is not migrated, renamed or copied — it simply
 * acquires a meaning it already had in practice. There is no backfill to run and
 * nothing to roll back.
 *
 * The same argument covers AI prompts and personas: `PK='AIPROMPTS'` is platform
 * configuration, available to every organisation, and this module does not touch
 * it. A prompt has no tenant.
 *
 * PUBLIC is not the same thing as PLATFORM and the two must not be merged. They
 * are both readable by everyone and that is where the similarity ends: platform
 * content is authored by Engage and curated, public content is authored by a
 * customer and has passed a safety review. They have different managers,
 * different provenance and different removal rules, so they get different
 * partitions and a reader that wants both asks for both.
 *
 * ── SLUG COLLISIONS STOP BEING A HAZARD ────────────────────────────────────
 *
 * `admin/upload-questions.js:298` derives a setId by lower-casing the title and
 * stripping non-alphanumerics, so two teams naming a set "Team Retro" both
 * produce `teamretro`. In one global partition the second write silently
 * clobbers the first. Scoping the partition fixes that by construction — each
 * org has its own id space — and preserves the current within-org behaviour,
 * where replacing your own same-named set is what you meant to do.
 *
 * It does mean a set reference is a PAIR, not an id: `{scope, orgId, setId}`.
 * A game therefore pins `QuestionSetScope` beside `QuestionSetId`, because
 * `teamretro` alone no longer names one partition.
 *
 * ── THE CALLER'S ORGANISATION ──────────────────────────────────────────────
 *
 * `auth/authorizer.js` resolves the caller's memberships and puts the active one
 * into the authorizer context, so handlers read it the same way they already
 * read `userId` — at `event.requestContext.authorizer.lambda`. The accessors
 * below mirror `admin/shared/question-set-access.js:91-96` exactly: same
 * fallback chain, and the same rule that a blank value means anonymous and an
 * anonymous caller owns nothing.
 *
 * READ THE HEADER OF require-admin.js BEFORE CHANGING THE SHAPES. This API's
 * `CognitoAuthorizer` is a CUSTOM Lambda authorizer despite the name (payload
 * 2.0, simple responses), so its context arrives at `.authorizer.lambda`, NOT
 * `.jwt.claims`. Eighteen tests once passed against a shape this API has never
 * produced.
 */

// ── Scopes ─────────────────────────────────────────────────────────────────
const PLATFORM = 'platform';
const ORG = 'org';
const PUBLIC = 'public';
const SCOPES = [PLATFORM, ORG, PUBLIC];

/** Org roles, most powerful first. Index IS the precedence — see roleAtLeast. */
const ORG_ROLES = ['owner', 'admin', 'member'];

/** The global 4-digit code registry. Codes must stay globally unique because a
 *  participant types one with no idea which organisation it belongs to. This
 *  partition holds ONLY the reservation — `{orgId, ttl}` — never a session brief.
 */
const GAMES_RESERVATION_PK = 'GAMES';

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The prefix every key in a scope carries. `''` for platform, deliberately:
 * that is what makes today's rows platform rows with no migration.
 *
 * Throws on an unknown scope rather than defaulting. A typo'd scope silently
 * defaulting to platform would publish an org's content to everybody, which is
 * the exact failure this module exists to prevent.
 */
function scopePrefix(scope, orgId) {
  if (scope === PLATFORM) return '';
  if (scope === PUBLIC) return 'PUBLIC#';
  if (scope === ORG) {
    const id = clean(orgId);
    if (!id) throw new Error('tenant: scope "org" requires an orgId');
    return `ORG#${id}#`;
  }
  throw new Error(`tenant: unknown scope ${JSON.stringify(scope)}`);
}

/** The partition holding a scope's set METADATA rows (SK = `SET#<id>`). */
function setsMetadataPk(scope, orgId) {
  return `${scopePrefix(scope, orgId)}SETS`;
}

/** The partition holding a scope's set CONTENT (categories and questions). */
function setContentPk(scope, orgId, setId, version) {
  const id = clean(setId);
  if (!id) throw new Error('tenant: setContentPk requires a setId');
  const n = Number(version);
  const suffix = Number.isFinite(n) && n > 0 ? `#v${n}` : '';
  return `${scopePrefix(scope, orgId)}SET#${id}${suffix}`;
}

/** An org's own session index. The reservation row stays global — see above. */
function gamesIndexPk(orgId) {
  const id = clean(orgId);
  if (!id) throw new Error('tenant: gamesIndexPk requires an orgId');
  return `ORG#${id}#GAMES`;
}

const orgPk = (orgId) => `ORG#${clean(orgId)}`;
const userPk = (sub) => `USER#${clean(sub)}`;
/** The platform's index of organisations. Carries no tenant content. */
const ORGS_INDEX_PK = 'ORGS';

// ── The caller ─────────────────────────────────────────────────────────────
function authCtx(event) {
  const authorizer = event?.requestContext?.authorizer || {};
  const claims = authorizer.jwt?.claims || authorizer.claims || {};
  return { lambda: authorizer.lambda || {}, claims };
}

/** The organisation this request is acting for, or '' when there is none. */
function callerOrgId(event) {
  const { lambda, claims } = authCtx(event);
  return clean(lambda.orgId ?? claims['custom:orgId'] ?? '');
}

/**
 * The caller's role IN that organisation, or '' — never a default.
 *
 * Falls back to the JWT claim for the same reason `callerOrgId` above does, and
 * `question-set-access.js:callerUserId` before it: a route later moved onto a
 * native JWT authorizer must not silently stop recognising its members. Without
 * the fallback that caller resolves to org `X` with role `''`, and `roleAtLeast`
 * refuses everything — a half-working identity, which is worse than none.
 */
function callerOrgRole(event) {
  const { lambda, claims } = authCtx(event);
  const role = clean(lambda.orgRole ?? claims['custom:orgRole'] ?? '').toLowerCase();
  return ORG_ROLES.includes(role) ? role : '';
}

/** Every organisation the caller belongs to. Comma-joined in the context, like
 *  `groups` — the authorizer cannot put an array in a Lambda authorizer context. */
function callerOrgIds(event) {
  const { lambda } = authCtx(event);
  const raw = lambda.orgIds;
  if (Array.isArray(raw)) return raw.map(clean).filter(Boolean);
  return clean(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Is this caller's role at least `min`? owner >= admin >= member. */
function roleAtLeast(role, min) {
  const a = ORG_ROLES.indexOf(clean(role).toLowerCase());
  const b = ORG_ROLES.indexOf(clean(min).toLowerCase());
  return a !== -1 && b !== -1 && a <= b;
}

// ── What a caller may see, and what they may change ────────────────────────
/**
 * The scopes whose sets this caller may LIST.
 *
 * Platform and public are readable by everyone with an account — that is what
 * makes the existing library available to every organisation, which is the
 * owner's requirement. The caller's own org is added when they have one.
 *
 * NOTE THAT PLATFORM ADMIN IS ABSENT HERE ON PURPOSE. Being Engage staff does
 * not add anybody else's org to this list; there is no scope value that means
 * "everyone's". Reading one org's content is a separate, granted, logged act.
 */
function readableScopes(event) {
  const scopes = [PLATFORM, PUBLIC];
  if (callerOrgId(event)) scopes.push(ORG);
  return scopes;
}

/**
 * May this caller create, edit or delete content in this scope?
 *
 *   platform  Engage staff only — this is the shared library every org sees.
 *   public    nobody directly. A public row is a COPY made by the publish flow;
 *             it is managed by changing the org row it came from.
 *   org       a member of that org, at or above `minRole` (default: member).
 *
 * Denies by default: an unknown scope, a blank org, a caller with no context.
 */
function canManageScope(event, scope, orgId, minRole = 'member') {
  if (scope === PLATFORM) return isPlatformAdmin(event);
  if (scope === PUBLIC) return false;
  if (scope !== ORG) return false;
  const want = clean(orgId);
  if (!want) return false;
  if (callerOrgId(event) !== want) return false;
  return roleAtLeast(callerOrgRole(event), minRole);
}

/**
 * Engage staff. Kept here rather than imported from require-admin.js because
 * `game/` and `websocket/` bundles do not carry that module — the group name is
 * the same one, and tenantGroupsParity.test pins the two parsers together.
 */
function callerGroups(event) {
  const { lambda, claims } = authCtx(event);
  const raw = lambda.groups ?? claims['cognito:groups'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(clean).filter(Boolean);
  if (typeof raw !== 'string') return [];
  return raw.replace(/^\[/, '').replace(/\]$/, '')
    .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function isPlatformAdmin(event) {
  return callerGroups(event).includes('admins');
}

// ── Guards, returning a response or null, like requireSetManager ────────────
function deny(message) {
  return {
    statusCode: 403,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

/** The caller must be acting for some organisation. */
function requireOrg(event) {
  if (callerOrgId(event)) return null;
  return deny('Choose an organisation before doing this.');
}

/** …and be an admin or owner of it. */
function requireOrgAdmin(event) {
  const orgId = callerOrgId(event);
  if (!orgId) return deny('Choose an organisation before doing this.');
  if (roleAtLeast(callerOrgRole(event), 'admin')) return null;
  return deny('Only an admin of this organisation can do this.');
}

/** The attributes to stamp on anything this caller creates inside an org. */
function tenantStamp(event) {
  const orgId = callerOrgId(event);
  return orgId ? { orgId } : {};
}

module.exports = {
  PLATFORM, ORG, PUBLIC, SCOPES, ORG_ROLES,
  GAMES_RESERVATION_PK, ORGS_INDEX_PK,
  scopePrefix, setsMetadataPk, setContentPk, gamesIndexPk, orgPk, userPk,
  callerOrgId, callerOrgRole, callerOrgIds, callerGroups, isPlatformAdmin,
  roleAtLeast, readableScopes, canManageScope,
  requireOrg, requireOrgAdmin, tenantStamp,
};
