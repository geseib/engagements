/**
 * WHO MAY CHANGE A QUESTION SET.
 *
 * The rule, in the owner's words: a host may create question sets, and may edit
 * or delete ONLY the ones they created; an admin may edit or delete any of them.
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
const { callerGroups, callerUsername, isAdminCaller } = require('./require-admin');

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
 * May this caller edit, replace or delete this set?
 *
 * Admins: always. Everyone else: only what they created.
 */
function canManageSet(event, setItem) {
  if (isAdminCaller(event)) return true;
  return isSetOwner(event, setItem);
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
    `🚫 refused to let "${who}" (groups: ${groups.join(', ') || 'none'}) ${verb} `
    + `question set "${setItem?.SK || '?'}" owned by "${setOwnerId(setItem) || '(no owner recorded)'}"`
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
 * The attributes to stamp on a newly created set.
 *
 * Returns `{}` when the caller cannot be identified, so an unattributable write
 * produces an unowned row rather than a row owned by the empty string — which
 * `isSetOwner` would otherwise have to special-case at every read.
 */
function ownerStamp(event) {
  const userId = callerUserId(event);
  if (!userId) return {};
  const username = callerUsername(event);
  return {
    createdBy: userId,
    ...(username && username !== 'unknown' ? { createdByName: username } : {}),
  };
}

module.exports = {
  callerUserId,
  setOwnerId,
  isSetOwner,
  canManageSet,
  requireSetManager,
  ownerStamp,
};
