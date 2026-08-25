/**
 * WHO MAY CHANGE A QUESTION SET.
 *
 * The rule, in the owner's words: a host may create question sets, and may edit
 * or delete ONLY the ones they created; an admin may edit or delete any of them.
 * Multi-tenancy adds ONE term in front of that rule — WHICH LIBRARY THE SET IS
 * IN — and it is the term that decides first.
 *
 * ── THE SCOPE TERM, AND THE CAPABILITY THIS DELIBERATELY REMOVES ───────────
 *
 * A set lives in one of three libraries (tenant.js has the key shapes):
 *
 *   platform  the shared Engage library, readable by EVERY organisation.
 *             Manageable by Engage staff only.
 *   org       one customer's own library. Manageable by that customer.
 *   public    a customer set that has passed review and been copied out.
 *             Manageable by nobody here — you change the org row it came from.
 *
 * The scope is read OFF THE ROW (`item.scope`, `item.orgId`), not off the
 * request, so a caller cannot argue about which library their target is in.
 * A row with no `scope` attribute is a PLATFORM row: every set that exists
 * today is one, which is what makes the migration empty (tenant.js:17).
 *
 * BEING AN ENGAGE ADMINISTRATOR NO LONGER GRANTS ACCESS TO CONTENT. That is the
 * single most consequential line in this file and it is a deliberate LOSS of
 * capability, not an oversight. `isAdminCaller` used to short-circuit
 * `canManageSet` to true, so the `admins` group could edit and delete anything
 * in the table. In a single-tenant product that was housekeeping; the moment a
 * second customer's material is in the same table it is staff reading and
 * rewriting a customer's private content on no authority but their job title.
 * So the admins group now grants exactly one thing: management of the PLATFORM
 * library, via `tenant.canManageScope`. Reaching into an organisation is a
 * separate, granted, logged act and there is no scope value that means
 * "everyone's" — see the note on readableScopes in tenant.js.
 *
 * What staff KEEP: every platform set (which is every set that exists today),
 * the whole admin surface, and the ability to be added to an org as its admin.
 * What staff LOSE: silent edit/delete over customer content. If that is ever
 * needed it must arrive as an explicit support-access grant, not as a group
 * membership check hidden in an authorisation helper.
 *
 * `createdBy` survives underneath the scope term as WITHIN-ORG attribution:
 * inside one organisation, a member manages what they made and an org admin or
 * owner manages all of it. That is the owner's original sentence with "admin"
 * re-read as "admin OF THIS ORGANISATION", which is what it has to mean once
 * there is more than one.
 *
 * ── THE OWNERSHIP FIELD ────────────────────────────────────────────────────
 *
 * A SETS row (`PK='SETS'`, `SK='SET#<id>'`) carried no creator attribute at all
 * before this change — `get-question-sets.js` projects sixteen fields and none
 * of them names a person, and `upload-questions.js`'s `setMetadataItem` writes
 * `createdAt` but nobody to go with it. So one had to be added.
 *
 *   createdBy      the creator's Cognito `sub`
 *   createdByName  their username, for display only
 *
 * `sub` and not username/email. This pool is UserPoolV2 with MUTABLE email
 * attributes (that mutability is what fixed Google OAuth — see
 * docs/AUTHENTICATION_RECOVERY.md), and a Cognito username can be recreated
 * after a delete. An identifier that can change or be reissued is not an
 * identifier to hang a permission on: a host who changed their email would lose
 * their own sets, and a recycled username would silently inherit someone else's.
 * `sub` is immutable and unique for the life of the pool. `createdByName` is
 * carried alongside purely so a console can print a name without a Cognito
 * lookup, and NOTHING is ever authorised against it.
 *
 * ── THE SETS THAT ALREADY EXIST, WHICH IS THE REAL DECISION ────────────────
 *
 * Every set in dev, test and prod today predates this field, so every one of
 * them has `createdBy === undefined`. There are exactly three things an unowned
 * set can mean, and only one of them is both safe and true:
 *
 *   (a) nobody can touch it     — an outage. The 80s trivia set, the art sets
 *                                 and every live set become uneditable and
 *                                 undeletable, by anyone, forever.
 *   (b) everybody can touch it  — precisely the bug the owner is asking to fix,
 *                                 restated as a default. Every host would get
 *                                 edit and delete over every existing set.
 *   (c) ADMINS ONLY. <- this one.
 *
 * An unowned set is treated as house content: admins manage it, hosts do not.
 *
 * This is not a guess about the past, it is a fact about it. Until this change
 * every one of these routes was gated to the `admins` group by
 * `auth/authorizer.js`, so every existing set WAS created by an administrator.
 * "No owner recorded" and "an admin made it" describe the same rows. Reading
 * absence as admin-owned therefore preserves the status quo exactly: admins keep
 * everything they could do yesterday, and no host gains anything over content
 * they did not create.
 *
 * It also fails in the safe direction on both sides. For a host, absent
 * ownership denies. For an admin, the outcome is unchanged either way, because
 * an admin may manage every set by rule. There is no backfill migration to run
 * and none is needed; a set acquires an owner the first time one is created
 * through the new path, and the old rows are correct as they stand.
 *
 * ── WHERE THIS IS ENFORCED ─────────────────────────────────────────────────
 *
 * In the HANDLERS — edit-question-set.js, delete-question-set.js and
 * upload-questions.js's replace branch — not in the console. A hidden button is
 * not a permission: the host surface omits controls it cannot use, and the
 * handler still refuses a hand-made request that skips the surface entirely.
 *
 * ── THE SHAPE, WHICH IS THE PART THAT IS EASY TO GET WRONG AND WAS ─────────
 *
 * Read the header of `require-admin.js` and RESUME.md §1 before touching this.
 * `CognitoAuthorizer` is a CUSTOM LAMBDA authorizer despite the name (payload
 * 2.0, simple responses), so its context arrives at
 *
 *     event.requestContext.authorizer.lambda
 *
 * as `{ userId, username, email, groups: 'hosts,admins', status, role }` —
 * groups COMMA-JOINED into a string (`auth/authorizer.js:171-182`). It is NOT
 * `.jwt.claims`. Eighteen tests once passed against that non-existent shape
 * while the guard they covered would have 403'd every real administrator. Group
 * parsing is delegated to `require-admin.js` so there is one parser, not two.
 */
const { callerGroups, callerUsername } = require('./require-admin');
const tenant = require('./tenant');
const { setRef, findSetMetadata } = require('./set-version');

/**
 * The caller's stable Cognito subject id, or '' when there is none.
 *
 * `.authorizer.lambda.userId` is what this API produces (`authorizer.js` sets it
 * from `decoded.sub`). The JWT shapes are accepted as fallbacks for the same
 * reason require-admin.js accepts them: a route later moved onto a native JWT
 * authorizer must not silently stop recognising its owners.
 *
 * Never falls back to a username. A blank id is an anonymous caller, and an
 * anonymous caller owns nothing — see `isSetOwner`.
 */
function callerUserId(event) {
  const authorizer = event?.requestContext?.authorizer || {};
  const claims = authorizer.jwt?.claims || authorizer.claims || {};
  const raw = authorizer.lambda?.userId ?? claims.sub ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/** The `sub` recorded on a SETS row, or '' when the row predates ownership. */
function setOwnerId(setItem) {
  const raw = setItem?.createdBy;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Is this caller the recorded creator of this set?
 *
 * Both halves must be non-empty. An unowned row ('' owner) matches nobody, and
 * an anonymous caller ('' id) matches nothing — without those two guards
 * `'' === ''` would hand every legacy set to every unauthenticated request,
 * which is the exact failure mode this module exists to prevent.
 */
function isSetOwner(event, setItem) {
  const owner = setOwnerId(setItem);
  const caller = callerUserId(event);
  return owner !== '' && caller !== '' && owner === caller;
}

/**
 * The library a SETS row is in, as a `{scope, orgId, setId}` pair.
 *
 * An absent `scope` is PLATFORM, and an absent `orgId` with it is correct:
 * that is the shape of every row written before tenancy, and those rows really
 * are the platform library. Nothing is inferred from the request — the row
 * says where it lives.
 */
function setScopeOf(setItem) {
  const raw = setItem && setItem.scope;
  const declared = (typeof raw === 'string' && raw.trim()) || '';
  if (declared) return declared;

  // NO `scope` ATTRIBUTE. Absence normally means PLATFORM — that is what keeps
  // the ~41 rows that predate tenancy shape-identical to a newly created
  // platform row, and it is why the migration is nothing.
  //
  // BUT AN `orgId` WITHOUT A `scope` MUST NOT READ AS PLATFORM. That shape is
  // not a legacy row; it is a half-stamped one, and the only way to produce it
  // is a writer that recorded the organisation and forgot the scope. Reading it
  // as platform would publish one team's content to every other team, silently,
  // with no error anywhere — a fail-OPEN produced by a missing field.
  //
  // Falling back to `org` instead fails closed: the worst case is a set that
  // its own organisation can still reach and nobody else can. `ownerStamp`
  // writes both together, so this branch should be unreachable; it exists
  // because "should be unreachable" is exactly where this class of bug lives.
  const orgId = setItem && typeof setItem.orgId === 'string' && setItem.orgId.trim();
  return orgId ? tenant.ORG : tenant.PLATFORM;
}

function setOrgOf(setItem) {
  const raw = setItem && setItem.orgId;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** The full reference for a row, ready for setPartition/setMetadataKey. */
function setRefOf(setItem) {
  return setRef({
    scope: setScopeOf(setItem),
    orgId: setOrgOf(setItem),
    setId: String((setItem && setItem.SK) || '').replace('SET#', ''),
  });
}

/**
 * May this caller edit, replace or delete this set?
 *
 * TWO TERMS, SCOPE FIRST, AND THE FIRST ONE CAN ONLY DENY:
 *
 *   1. `tenant.canManageScope` — may this caller change anything at all in the
 *      library this row is in? Platform: Engage staff. Org: a member of THAT
 *      org. Public: nobody. An unknown scope, a blank org and a caller with no
 *      authorizer context all deny here.
 *   2. within an org, WHO in it — the creator, or an admin/owner of the org.
 *
 * Platform passes straight through on term 1 because term 1 already proved the
 * caller is Engage staff, and staff collectively own the shared library; the
 * ~41 existing platform sets have no recorded creator to test against anyway
 * (the reasoning about unowned rows below is unchanged, it has simply moved
 * behind the scope gate).
 *
 * Note what is NOT here: no branch grants a platform administrator anything in
 * an org scope. That is the point — see the header.
 */
function canManageSet(event, setItem) {
  const scope = setScopeOf(setItem);
  const orgId = setOrgOf(setItem);

  if (!tenant.canManageScope(event, scope, orgId)) return false;
  if (scope === tenant.PLATFORM) return true;

  // Org scope, and the caller is proved to be a member of this very org.
  if (isSetOwner(event, setItem)) return true;
  return tenant.canManageScope(event, scope, orgId, 'admin');
}

/**
 * The scope a NEW set should be created in.
 *
 * An acting organisation wins: a host who is signed in for an org is making
 * that org's content, which is the whole point of tenancy and is also what
 * makes slug collisions between customers harmless. Engage staff with no org
 * selected are maintaining the shared library, which is the only way platform
 * content gets authored at all.
 *
 * A caller who is neither gets `null`, and the handler must refuse rather than
 * pick something: silently writing an org's material into the platform library
 * would publish it to every customer, which is the exact failure tenant.js
 * exists to prevent.
 *
 * An explicitly requested scope is honoured only if the caller may manage it,
 * so `?scope=platform` from an org host is a denial, not an escalation.
 */
function createSetRef(event, setId, requestedScope) {
  const wanted = String(requestedScope ?? '').trim();
  const orgId = tenant.callerOrgId(event);

  // THE INTERNAL-INVOCATION SEAM, and it is a seam rather than a hole.
  //
  // NO GROUPS AND NO ORG IS NOT A LOGGED-IN PERSON. `auth/authorizer.js:171-182`
  // puts `groups` into the context of EVERY request it lets through — a host
  // carries 'hosts', an administrator carries 'admins' — so an event with none
  // did not come through the front door. What produces that shape is the
  // internal paths: the generation worker's synthetic event
  // (shared/generated-set.js, whose header says groups are omitted on purpose),
  // the seed and migration scripts, the archive importer, and the suite's
  // direct handler calls. All of them wrote platform content before tenancy and
  // there is no organisation for them to belong to, so platform is what they
  // keep writing. Zero migration, same as everything else here.
  //
  // Deciding it HERE, once, keeps it out of `canManageSet`: such a caller still
  // MANAGES nothing, because managing a platform row needs the admins group and
  // managing an org row needs a membership. So this cannot be turned into a way
  // to reach an existing row — it only answers "where does a brand new set go".
  //
  // A REAL host lands below instead, and if they have no organisation selected
  // they are refused rather than defaulted. That refusal is the point: a host
  // who belongs somewhere must not be able to write their material into the
  // shared library that every other customer reads.
  const internal = callerGroups(event).length === 0 && !orgId;
  if (internal && !wanted) return setRef({ scope: tenant.PLATFORM, orgId: '', setId });

  const candidates = wanted
    ? [{ scope: wanted, orgId: wanted === tenant.ORG ? orgId : '' }]
    : [{ scope: tenant.ORG, orgId }, { scope: tenant.PLATFORM, orgId: '' }];

  for (const c of candidates) {
    if (c.scope === tenant.ORG && !c.orgId) continue;
    if (tenant.canManageScope(event, c.scope, c.orgId)) {
      return setRef({ ...c, setId });
    }
  }
  return null;
}

/**
 * Find an existing set for this caller, by id, across the scopes they may READ.
 *
 * Every route is `/{setId}`, so this is how a handler recovers the pair. It is
 * also the read guard: another organisation's partition is never probed, so
 * their set is ABSENT rather than forbidden and the handler 404s exactly as it
 * would for a set that does not exist. Whether org B has a set called
 * `teamretro` is not a fact org A gets to establish.
 *
 * Delegates to set-version.js so the game bundle — which cannot require
 * anything under admin/shared — runs the identical search.
 *
 * @returns {Promise<{ref, item}|null>}
 */
function findSetForCaller(db, tableName, event, setId, requestedScope) {
  return findSetMetadata(db, tableName, event, setId, requestedScope);
}

/** The scope named by a request, or '' when it did not name one. */
function requestedScope(event) {
  const q = (event && event.queryStringParameters) || {};
  const p = (event && event.pathParameters) || {};
  let b = {};
  try { b = JSON.parse((event && event.body) || '{}') || {}; } catch { b = {}; }
  const raw = q.scope ?? p.scope ?? b.scope ?? '';
  const value = String(raw).trim().toLowerCase();
  return tenant.SCOPES.includes(value) ? value : '';
}

/**
 * Guard for a handler that is about to change an existing set. Returns an HTTP
 * response to return immediately, or `null` when the caller may proceed.
 *
 * Denies by default: no authorizer context, an unreadable shape, a missing
 * `createdBy` and an empty event all fail closed for a non-admin.
 *
 * @param {object} event   the Lambda event
 * @param {object} setItem the SETS metadata row (already read by the caller)
 * @param {string} verb    what was attempted, for the log line only
 */
function requireSetManager(event, setItem, verb = 'change') {
  if (canManageSet(event, setItem)) return null;

  const who = callerUsername(event);
  const groups = callerGroups(event);
  console.warn(
    `🚫 refused to let "${who}" (groups: ${groups.join(', ') || 'none'}, `
    + `org: ${tenant.callerOrgId(event) || 'none'}/${tenant.callerOrgRole(event) || '-'}) ${verb} `
    + `question set "${setItem?.SK || '?'}" in ${setScopeOf(setItem)}`
    + `${setOrgOf(setItem) ? `/${setOrgOf(setItem)}` : ''} `
    + `owned by "${setOwnerId(setItem) || '(no owner recorded)'}"`
  );

  return {
    statusCode: 403,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    // Says what the rule is, because unlike the admin refusal this one is
    // actionable: the person is legitimately signed in and simply picked
    // somebody else's set. It names no owner — who made a set is not a fact a
    // refusal should hand out.
    body: JSON.stringify({
      error: 'This question set belongs to someone else. You can only change sets you created.',
    }),
  };
}

/**
 * The attributes to stamp on a newly created set: WHO made it, and WHICH
 * LIBRARY it is in.
 *
 * The scope pair is written onto the row because `canManageSet` reads it back
 * off the row. Deriving it at read time from the partition key would work too,
 * and would be worse: a row is copied between partitions by the publish flow
 * and by version snapshots, and an attribute that travels with the row is one
 * that cannot be silently reinterpreted by wherever it lands.
 *
 * PLATFORM IS STAMPED AS AN ABSENCE, not as `scope: 'platform'`. Writing the
 * string would put a new attribute on new platform rows that the ~41 existing
 * ones do not have, so "unstamped" and "platform" would stop being the same
 * thing and every reader would need both branches. `setScopeOf` reads absent
 * as platform; keeping new rows in that same shape is what keeps ONE rule.
 *
 * No `ttl` here, and none anywhere near a set row. `ttl` is for SESSION data
 * only (docs/02-data-model.md); prompts once carried a 365-day ttl and silently
 * vanished a year later.
 *
 * Returns `{}` when the caller cannot be identified, so an unattributable write
 * produces an unowned row rather than a row owned by the empty string — which
 * `isSetOwner` would otherwise have to special-case at every read.
 */
function ownerStamp(event, ref) {
  const { scope, orgId } = setRef(ref || {});
  const place = scope === tenant.PLATFORM ? {} : { scope, ...(orgId ? { orgId } : {}) };

  const userId = callerUserId(event);
  if (!userId) return place;
  const username = callerUsername(event);
  return {
    ...place,
    createdBy: userId,
    ...(username && username !== 'unknown' ? { createdByName: username } : {}),
  };
}

module.exports = {
  callerUserId,
  setOwnerId,
  isSetOwner,
  setScopeOf,
  setOrgOf,
  setRefOf,
  canManageSet,
  createSetRef,
  findSetForCaller,
  requestedScope,
  requireSetManager,
  ownerStamp,
};
