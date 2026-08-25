/**
 * EVERY APPROVED ACCOUNT HAS A HOME. This is what gives them one.
 *
 * The owner's decision, in one sentence: there is no "belongs to no
 * organisation" state after approval. That state is not a rare edge case to be
 * handled carefully — it is a branch that EVERY handler has to remember to
 * consider, and every place that forgets it is a bug. `create-game.js` already
 * writes a session that no session list will ever show when the caller has no
 * org; `upload-questions.js` already refuses a set with "Choose an organisation
 * before creating a question set" to a person with nothing to choose from.
 * Deleting the state deletes the whole class of defect.
 *
 * ── WHERE THIS RUNS, AND WHY NOT IN post-confirmation.js ───────────────────
 *
 * The obvious home is `auth/post-confirmation.js`, and it is the wrong one.
 *
 * That trigger fires at CONFIRMATION — the moment an email is verified — which
 * in this product is BEFORE anything has been approved. Read its code: it puts
 * the new account in the `pending` group and stamps `status: 'pending'`, and an
 * administrator later moves them to `hosts` on the Members screen, or rejects
 * them (manage-users.js disables the account). So provisioning there would mint
 * an organisation for every casual signup, every abandoned registration and
 * every account that is about to be rejected — rows that are never entered,
 * never billed and never deleted, in the same partition `10-platform-orgs.html`
 * counts to say "47 teams". The count would become "every address that ever
 * typed itself into the signup form".
 *
 * The approval itself lives in `admin/manage-users.js:changeUserState`, which
 * is a Cognito-only handler in a different work stream. So provisioning is
 * LAZY, and hangs off the first authenticated request that needs an
 * organisation to exist: `GET /orgs` — `list-my-orgs.js`, the request that
 * renders the switcher on every page of the console. By the time anybody can
 * see a screen, the request that draws its chrome has already run.
 *
 * That has three properties worth having:
 *
 *   - it can READ THE CALLER'S GROUPS, so an account still sitting in
 *     `pending` gets nothing. Approval is a fact about the token, and the
 *     token is right here.
 *   - it needs no new route, no new Lambda and no template change.
 *   - it is self-healing. The accounts that already exist — including the
 *     federated ones on dev that never had a PROFILE row — are provisioned the
 *     next time they load the console, with no backfill script to write, run
 *     and then delete.
 *
 * The cost is one extra Get on a request that already does several, and only
 * until the profile carries `personalOrgId`.
 *
 * ── IDEMPOTENT IN DYNAMODB, NOT IN THIS FUNCTION ───────────────────────────
 *
 * This runs on every page load, in parallel, from several tabs. "Read the
 * profile, see no organisation, create one" is a check-then-write and races:
 * two tabs both read nothing and both create, and the person ends up with two
 * homes and no way to tell which is which.
 *
 * `attribute_not_exists(PK)` cannot help — the orgId is 22 random base58
 * characters, so the two writes collide with nothing. The guard is instead on
 * the PROFILE row, inside the same transaction:
 *
 *     Update USER#{sub}/PROFILE  SET personalOrgId = :orgId …
 *                                ConditionExpression: attribute_not_exists(personalOrgId)
 *
 * At most one transaction can satisfy that condition, so at most one personal
 * organisation is ever created for an account, decided by DynamoDB rather than
 * by a lucky interleaving. The loser gets TransactionCanceledException, re-reads
 * the profile and reports the winner's org. Both callers end up telling the
 * truth about the same organisation.
 *
 * `personalOrgId` is also the answer to "which of my organisations is my home",
 * which nothing else can state: `type: 'personal'` on the org row says an
 * organisation IS a home, and this says WHOSE.
 *
 * ── AND defaultOrgId, WHICH NOTHING WROTE ──────────────────────────────────
 *
 * `auth/authorizer.js` reads `defaultOrgId` as its tie-break for a caller who
 * belongs to several organisations, and until this file existed NOTHING WROTE
 * IT except create-org and accept-invite — so for most accounts the tie-break
 * was inert and the active org was whatever `pick-active-org.js` fell through
 * to. The home organisation is the natural default, so it is written with
 * `if_not_exists`: a person who joined a team before this ran keeps that team
 * as their default, because moving somebody's home under them reads as "all my
 * sets disappeared".
 */

const { TransactWriteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../../shared/tenant');
const { createOrgDataKey } = require('../../shared/tenant-crypto');
const G = require('./org-guards');

/** The groups that mean APPROVED. `pending` is deliberately absent, and so is
 *  the empty list: an account with no groups at all has not been approved
 *  either, and fail-closed is the only safe reading of "I could not tell". */
const APPROVED_GROUPS = ['hosts', 'admins'];

function isApproved(event) {
  const groups = tenant.callerGroups(event);
  return APPROVED_GROUPS.some((g) => groups.includes(g));
}

/**
 * What the switcher will show. `01-org-switcher.html` draws
 * "Amara Reyes · Personal" — the name is the PERSON, and the "· Personal" half
 * is rendered from `type`, not stored in the name. So this is just their name.
 *
 * The email's local part is the fallback, because a federated identity may
 * arrive with no `name` attribute at all, and an organisation called '' is
 * unpickable in a dropdown for ever (the same argument as `validateName`).
 */
/**
 * DOES THIS "NAME" ACTUALLY NAME A PERSON, OR A FEDERATED IDENTITY?
 *
 * Cognito's username for a social sign-in is `<Provider>_<opaque id>` —
 * `Google_113956208956782440356`, `Facebook_1016…`, `SignInWithApple_0012…`,
 * `LoginWithAmazon_amzn1.account.…`. `callerName` falls back to `username`, so
 * on dev the first auto-provisioned space came out called
 * `Google_113956208956782440356`, and that string became the switcher chip, the
 * organisation list and the org's slug.
 *
 * Matched on the PROVIDER PREFIX, not on "has an underscore" or "has digits".
 * Real names contain both — `amara_reyes`, `user123` — and a pattern loose
 * enough to catch the machine ids would quietly rename people, which is a worse
 * failure than the one being fixed.
 */
function looksFederated(value) {
  return /^(Google|Facebook|SignInWithApple|LoginWithAmazon|AzureAD|Okta)_/i
    .test(String(value || '').trim());
}

/** `george.seib` -> `George Seib`. Separators are word breaks, not characters. */
function titleiseLocalPart(local) {
  return String(local || '')
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * "Amara Reyes · Personal" — the name is the PERSON, and the "· Personal" half
 * is rendered from `type`, not stored in the name. So this is just their name.
 *
 * The order is deliberate: a real display name, then the email local part, then
 * a constant. A federated username is skipped entirely rather than used as a
 * fallback, because a name nobody recognises is worse than a generic one.
 */
function personalOrgName(event) {
  const display = G.callerName(event);
  if (display && !looksFederated(display)) return display.slice(0, G.NAME_MAX);

  const email = G.callerEmail(event);
  const local = titleiseLocalPart(String(email).split('@')[0].trim());
  return (local || 'Personal').slice(0, G.NAME_MAX);
}

/** One org's stored name, or '' when it cannot be read. */
async function readOrgName(orgId) {
  const res = await G.db.send(new GetCommand({
    TableName: G.tableName(),
    Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' },
  }));
  return G.clean(res.Item && res.Item.name);
}

async function readProfile(sub) {
  const res = await G.db.send(new GetCommand({
    TableName: G.tableName(),
    Key: { PK: tenant.userPk(sub), SK: 'PROFILE' },
  }));
  return res.Item || null;
}

/**
 * Make sure this caller has a personal organisation. Safe to call on every
 * request; safe to call concurrently; safe to call for an account that already
 * has ten organisations.
 *
 * @returns {{orgId: string, created: boolean, reason: string}}
 *          `orgId` is '' when nothing was provisioned, and `reason` says why —
 *          a caller that logs it can tell "already had one" from "not approved
 *          yet", which are the two states worth telling apart in a support
 *          thread. IT NEVER THROWS: a failure to provision must not turn the
 *          switcher into a 500. The next page load tries again.
 */
async function ensurePersonalOrg(event) {
  const sub = G.callerSub(event);
  if (!sub) return { orgId: '', created: false, reason: 'anonymous' };

  // NOT YET APPROVED — nothing is created. See the header: an organisation per
  // unapproved signup is an organisation per stranger.
  if (!isApproved(event)) return { orgId: '', created: false, reason: 'not-approved' };

  let profile;
  try {
    profile = await readProfile(sub);
  } catch (error) {
    console.warn('ensurePersonalOrg: could not read the profile:', error.message);
    return { orgId: '', created: false, reason: 'error' };
  }

  const existing = G.clean(profile && profile.personalOrgId);

  /*
    ── IS THAT HOME STILL THEIRS? ───────────────────────────────────────────

    This used to return the moment `personalOrgId` was set, without ever asking
    whether the organisation it names still exists or still contains the caller.
    That made the product's stated invariant — "there is no belongs-to-no-org
    state after approval" — false by an entirely ordinary route:

      somebody accepts an invitation into a personal space
        -> it flips to `team` (correct: it has two members now)
        -> the "a home cannot be left" guard is keyed on `type`, so it lifts
        -> the original owner hands over and leaves
        -> nothing mints them a new home, because PROFILE still names the old one
        -> they leave their last remaining team
        -> `GET /orgs` returns `{orgs: [], activeOrgId: ""}` for ever, while
           PROFILE still points at an organisation somebody else now owns.

    Every step answers 200. Reproduced end to end against dev.

    The check is MEMBERSHIP, not type: a home that legitimately became a team is
    still a place this person has, and minting a second one there would be
    churn. What must never happen is an approved account with nowhere at all.

    An unreadable row is NOT treated as gone — a transient error must not mint a
    duplicate home.
  */
  let homeIsStillTheirs = false;
  if (existing) {
    try {
      const [meta, membership] = await Promise.all([
        G.getOrgMetadata(existing),
        G.getMembership(existing, sub),
      ]);
      homeIsStillTheirs = Boolean(meta && membership);
    } catch (error) {
      console.warn('ensurePersonalOrg: could not verify the recorded home:', error.message);
      homeIsStillTheirs = true;
    }
    if (!homeIsStillTheirs) {
      console.log(`ensurePersonalOrg: ${sub} no longer belongs to ${existing}; provisioning a new home`);
    }
  }

  if (existing && homeIsStillTheirs) {
    /*
      SELF-HEAL A SPACE NAMED AFTER A MACHINE.

      Everything provisioned before `looksFederated` existed is called
      `Google_113956208956782440356` or a sibling of it, and that name is on the
      switcher chip of the account that owns it. There is no backfill script
      because there does not need to be one: this runs on every page load, so
      the row repairs itself the next time its owner opens the console, on every
      tier, with nothing to schedule and nothing to remember.

      Conditioned so it can only ever rewrite a name that is STILL the bad one —
      a person who has since renamed their own space must not have that undone,
      and two tabs racing here must not fight.
    */
    try {
      const current = await readOrgName(existing);
      if (looksFederated(current)) {
        const repaired = personalOrgName(event);
        if (repaired && repaired !== current) {
          /* BOTH ROWS, IN ONE TRANSACTION. The name is denormalised onto the
             platform's index row (ORGS / ORG#{id}) so the staff console can
             list every organisation without opening each METADATA — so
             repairing only METADATA would leave Engage staff still looking at
             `Google_1139…` in the one place the whole tenant list is drawn. */
          await G.db.send(new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: G.tableName(),
                  Key: { PK: tenant.orgPk(existing), SK: 'METADATA' },
                  UpdateExpression: 'SET #n = :name, slug = :slug',
                  ConditionExpression: '#n = :current',
                  ExpressionAttributeNames: { '#n': 'name' },
                  ExpressionAttributeValues: {
                    ':name': repaired, ':slug': G.slugify(repaired), ':current': current,
                  },
                },
              },
              {
                Update: {
                  TableName: G.tableName(),
                  Key: { PK: tenant.ORGS_INDEX_PK, SK: tenant.orgPk(existing) },
                  UpdateExpression: 'SET #n = :name',
                  ExpressionAttributeNames: { '#n': 'name' },
                  ExpressionAttributeValues: { ':name': repaired },
                },
              },
            ],
          }));
          console.log(`renamed personal organisation ${existing}: ${current} -> ${repaired}`);
        }
      }
    } catch (error) {
      // A failed repair is cosmetic. It must never cost anybody their console.
      if (error.name !== 'ConditionalCheckFailedException') {
        console.warn('ensurePersonalOrg: could not repair the name:', error.message);
      }
    }
    return { orgId: existing, created: false, reason: 'exists' };
  }

  const orgId = G.mintOrgId();
  const now = new Date().toISOString();
  const name = personalOrgName(event);
  const email = G.callerEmail(event);

  // The SAME FIVE ROWS create-org.js writes, in the same one transaction, for
  // the same reason: every gap between them is a state somebody lives in for
  // ever, and the worst of them — an organisation with no members — is
  // unenterable, undeletable and un-invitable-to.
  // MINT THE DATA KEY FIRST — same reasoning as create-org.js.
  //
  // This path matters MORE, not less: it is the org almost everybody actually
  // uses. `tenant-crypto` throws rather than writing plaintext for a tenant that
  // believes it is encrypted, so a home provisioned without a key is an account
  // that can sign in, see its switcher, and fail on the first set it saves.
  //
  // Minted before the transaction on purpose. A key for an org that never
  // commits is unreachable bytes; a committed org with no key is a broken
  // account.
  const dataKeyCiphertext = await createOrgDataKey(orgId);

  const org = {
    PK: tenant.orgPk(orgId),
    SK: 'METADATA',
    orgId,
    dataKeyCiphertext,
    name,
    slug: G.slugify(name),
    // THE ATTRIBUTE THIS WHOLE FILE IS ABOUT. It is what makes the org
    // un-leavable (remove-member.js), what the switcher draws "· Personal"
    // from, and what platform staff filter out of a count of teams.
    type: G.PERSONAL,
    // Free, and CAPPED rather than metered — pricing.js:PERSONAL_PLAN. Five
    // sessions and five stored sets, then an upgrade. It becomes `team` when a
    // second member joins (accept-invite.js), which is the upgrade.
    plan: 'free',
    seats: null,
    status: 'active',
    createdAt: now,
    createdBy: sub,
    // Provisioned, not asked for. Worth being able to tell apart in the data
    // when somebody asks "why do I have this organisation I never made".
    provisioned: true,
    ownerUserId: sub,
  };

  const member = {
    PK: tenant.orgPk(orgId),
    SK: G.memberSk(sub),
    orgId,
    userId: sub,
    role: 'owner',
    email,
    displayName: G.callerName(event),
    joinedAt: now,
  };

  const reverse = {
    PK: tenant.userPk(sub),
    SK: G.userOrgSk(orgId),
    orgId,
    userId: sub,
    role: 'owner',
    joinedAt: now,
  };

  const indexRow = {
    PK: tenant.ORGS_INDEX_PK,
    SK: tenant.orgPk(orgId),
    orgId,
    name,
    plan: 'free',
    type: G.PERSONAL,
    status: 'active',
    createdAt: now,
  };

  try {
    await G.db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: G.tableName(),
            Item: indexRow,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: G.tableName(),
            Item: org,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        { Put: { TableName: G.tableName(), Item: member } },
        { Put: { TableName: G.tableName(), Item: reverse } },
        {
          // THE IDEMPOTENCY GUARD — see the header. This condition, and not the
          // two above it, is what makes "at most one home per account" an
          // arithmetic fact rather than a hope about timing.
          //
          // `defaultOrgId` uses if_not_exists rather than a plain SET so that
          // somebody who joined a team first keeps that team as their default.
          Update: {
            TableName: G.tableName(),
            Key: { PK: tenant.userPk(sub), SK: 'PROFILE' },
            UpdateExpression:
              'SET personalOrgId = :orgId, '
              + 'defaultOrgId = if_not_exists(defaultOrgId, :orgId), '
              + 'userId = if_not_exists(userId, :sub), '
              + 'updatedAt = :now',
            /*
              TWO SHAPES, ONE GUARANTEE: at most one home per account, whatever
              the timing.

              First provisioning — there must be no `personalOrgId` yet.
              RE-provisioning — there is one, and it must still be the STALE id
              we just proved this account no longer belongs to. Conditioning on
              its exact value is what stops two concurrent calls both minting a
              replacement, and stops a replacement racing a legitimate write
              from somewhere else.
            */
            ConditionExpression: existing
              ? 'personalOrgId = :stale'
              : 'attribute_not_exists(personalOrgId)',
            ExpressionAttributeValues: {
              ':orgId': orgId,
              ':sub': sub,
              ':now': now,
              ...(existing ? { ':stale': existing } : {}),
            },
          },
        },
      ],
    }));
  } catch (error) {
    if (error && error.name === 'TransactionCanceledException') {
      // Somebody else — another tab, a retried invocation — got there first.
      // Report THEIR organisation, not a failure: from the caller's point of
      // view the postcondition holds.
      try {
        const after = await readProfile(sub);
        const won = G.clean(after && after.personalOrgId);
        if (won) return { orgId: won, created: false, reason: 'raced' };
      } catch (readError) {
        console.warn('ensurePersonalOrg: lost the race and could not re-read:', readError.message);
      }
      return { orgId: '', created: false, reason: 'raced' };
    }
    // NOT rethrown. The switcher must still render; the next page load retries.
    console.error('ensurePersonalOrg: could not provision a personal organisation:', error);
    return { orgId: '', created: false, reason: 'error' };
  }

  console.log(`🏠 provisioned personal organisation ${orgId} for ${sub}`);
  return { orgId, created: true, reason: 'created' };
}

module.exports = {
  ensurePersonalOrg, personalOrgName, looksFederated, isApproved, APPROVED_GROUPS,
};
