/**
 * POST /invites/{token}/accept — join the organisation that invited you.
 *
 * "Join Northwind Learning" on `09-first-run.html`. It is the one route in this
 * group that CANNOT require an organisation: the caller is being admitted to
 * one they are not in yet, and on first run they are in none at all. So there
 * is no `authorizeOrg` call here, and everything that would normally be proved
 * by membership is proved by the invitation instead.
 *
 * THAT MAKES THIS THE MOST DANGEROUS FILE IN THE GROUP. It is the only way into
 * a tenant from outside it. Four things are checked, and each of them is the
 * only thing standing between an outsider and somebody else's data:
 *
 *   1. THE TOKEN'S SHAPE. `parseInviteToken` matches a strict pattern before
 *      either half is allowed near a key. The token names its own partition
 *      (see org-guards.js) so an unvalidated one would let a caller aim a Get
 *      at any PK they can spell.
 *   2. THE ROW EXISTS. A revoked invitation is a deleted row, which is the
 *      whole mechanism by which Revoke works.
 *   3. IT HAS NOT EXPIRED — compared here, in the handler, against
 *      `expiresAt`. The DynamoDB TTL sweep is documented as "typically within
 *      48 hours" and guarantees nothing, so a fortnight-old invitation is
 *      READABLE and would otherwise still work two days after the screen said
 *      it was dead.
 *   4. IT WAS ADDRESSED TO THIS PERSON. The invitation's email must equal the
 *      caller's verified Cognito email. Without this the token is a bearer
 *      credential: forwarded, quoted in a ticket or pasted into a chat, it
 *      would admit whoever opened it. A caller whose context carries no email
 *      is REFUSED rather than waved through.
 *
 * ── IDEMPOTENT, BECAUSE THE SECOND CLICK IS THE COMMON CASE ────────────────
 *
 * People double-click, and a mail client prefetches links. Accepting twice must
 * not fail: the second call finds no invitation (the first deleted it), sees an
 * existing membership, and answers 200 with it. `accepted: false` distinguishes
 * "you are in, again" from "you are in, now" for anything that cares.
 *
 * The atomicity is in the transaction's `attribute_exists(SK)` on the DELETE:
 * two simultaneous accepts both try to consume the same invitation and exactly
 * one wins, so a race produces one membership, not two writes of it.
 */

const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');

/** 200 with the membership the caller already had. */
function alreadyIn(orgId, membership) {
  return G.json(200, {
    orgId,
    membership: G.publicMember(membership),
    accepted: false,
  });
}

async function acceptInvite(event) {
  const sub = G.callerSub(event);
  if (!sub) return G.fail(403, 'Sign in to accept an invitation.');

  const email = G.callerEmail(event);
  if (!email) {
    // Fail closed. An invitation is addressed to a mailbox; with no mailbox on
    // the caller there is nothing to match it against, and "no email" must
    // never mean "matches anything".
    return G.fail(403, 'Your account has no email address, so an invitation cannot be matched to it.');
  }

  const parsed = G.parseInviteToken(event?.pathParameters?.token);
  if (!parsed) return G.fail(404, 'That invitation link is not valid.');
  const { orgId } = parsed;
  const token = G.clean(event.pathParameters.token);

  const invite = await G.getInvite(orgId, token);

  const existing = await G.getMembership(orgId, sub);

  if (!invite) {
    // Already accepted (this is the second click), or revoked, or swept.
    if (existing) return alreadyIn(orgId, existing);
    return G.fail(404, 'That invitation is no longer available.');
  }

  if (G.isExpired(invite)) {
    // 410 Gone, not 404: the difference between "never existed" and "you are
    // too late" is the difference between "check the link" and "ask them to
    // send another one", and only one of those is useful advice.
    return G.fail(410, 'That invitation has expired. Ask for a new one.');
  }

  if (G.clean(invite.email).toLowerCase() !== email) {
    return G.fail(403, 'That invitation was sent to a different email address.');
  }

  const role = G.clean(invite.role).toLowerCase();
  if (!G.INVITABLE_ROLES.includes(role)) {
    // An invitation carrying a role nobody recognises — or `owner`, which this
    // route must never mint — is refused, not coerced to a default. Guessing
    // here would grant a permission from a corrupted row.
    return G.fail(409, 'That invitation is not valid. Ask for a new one.');
  }

  const org = await G.getOrgMetadata(orgId);
  if (!org) return G.fail(404, 'That organisation no longer exists.');

  if (existing) {
    // A membership already exists AND a live invitation is lying around — the
    // person was added by hand after being invited. Consume the invitation so
    // the Invited list clears, and report the membership they already had.
    try {
      await G.db.send(new TransactWriteCommand({
        TransactItems: [{
          Delete: {
            TableName: G.tableName(),
            Key: { PK: tenant.orgPk(orgId), SK: G.inviteSk(token) },
          },
        }],
      }));
    } catch (error) {
      console.warn('accept-invite: could not clear a redundant invitation:', error.message);
    }
    return alreadyIn(orgId, existing);
  }

  const now = new Date().toISOString();
  const member = {
    PK: tenant.orgPk(orgId),
    SK: G.memberSk(sub),
    orgId,
    userId: sub,
    role,
    email,
    displayName: G.callerName(event),
    joinedAt: now,
  };
  const reverse = {
    PK: tenant.userPk(sub),
    SK: G.userOrgSk(orgId),
    orgId,
    userId: sub,
    role,
    joinedAt: now,
  };

  /*
    THE SECOND MEMBER IS WHAT MAKES IT A TEAM.

    A personal organisation is one person's home. The moment somebody else
    accepts an invitation into it, it is not that any more — and
    09-first-run.html has already priced this in writing: "Free while you are
    the only member", Team at $5 a month. So joining flips BOTH attributes:

      type  personal -> team   what it IS. Platform staff count teams by it,
                               and it is what makes the organisation leavable:
                               a home cannot be left, a team can.
      plan  free     -> team   what it COSTS. A team is metered rather than
                               capped, so this flip is also the moment the
                               owner stops being refused a sixth session — the
                               upgrade the refusal was pointing at.

    IT NEVER GOES BACK. Removing that second member later does not return the
    organisation to somebody's private home: it now holds content two people
    made, has been billed as a team, and un-billing it retroactively is not a
    thing this system can do. `remove-member.js` says the same in its own words.

    Written as UNCONDITIONAL Updates, included only when the org we just read is
    personal. A `ConditionExpression: type = personal` here would CANCEL THE
    WHOLE TRANSACTION on every ordinary join into a team — the exact trap
    remove-member.js documents for defaultOrgId — and two people accepting at
    the same instant would both write the same two values anyway.
  */
  const flipsToTeam = G.isPersonalOrg(org);
  const flipItems = flipsToTeam ? [
    {
      Update: {
        TableName: G.tableName(),
        Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' },
        UpdateExpression: 'SET #type = :team, #plan = :team, upgradedAt = :now',
        ExpressionAttributeNames: { '#type': 'type', '#plan': 'plan' },
        ExpressionAttributeValues: { ':team': G.TEAM, ':now': now },
      },
    },
    {
      // The platform index row carries the same two attributes and is read by
      // a different screen. Updating one and not the other is how a staff
      // console starts disagreeing with a billing screen.
      Update: {
        TableName: G.tableName(),
        Key: { PK: tenant.ORGS_INDEX_PK, SK: tenant.orgPk(orgId) },
        UpdateExpression: 'SET #type = :team, #plan = :team',
        ExpressionAttributeNames: { '#type': 'type', '#plan': 'plan' },
        ExpressionAttributeValues: { ':team': G.TEAM },
      },
    },
  ] : [];

  try {
    await G.db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: G.tableName(),
            Item: member,
            ConditionExpression: 'attribute_not_exists(SK)',
          },
        },
        // The reverse row goes in the SAME transaction as the MEMBER row. A
        // member the authorizer cannot see is a person who joined and then
        // cannot enter — the exact lockout create-org.js describes.
        { Put: { TableName: G.tableName(), Item: reverse } },
        {
          // CONSUMING the invitation, and the reason the whole thing is one
          // transaction: `attribute_exists` means exactly one of two
          // simultaneous accepts can succeed.
          Delete: {
            TableName: G.tableName(),
            Key: { PK: tenant.orgPk(orgId), SK: G.inviteSk(token) },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          // First organisation becomes the default one. `if_not_exists` so
          // that joining a second team does not silently move somebody's home.
          Update: {
            TableName: G.tableName(),
            Key: { PK: tenant.userPk(sub), SK: 'PROFILE' },
            UpdateExpression:
              'SET defaultOrgId = if_not_exists(defaultOrgId, :orgId), '
              + 'userId = if_not_exists(userId, :sub), '
              + 'updatedAt = :now',
            ExpressionAttributeValues: { ':orgId': orgId, ':sub': sub, ':now': now },
          },
        },
        ...flipItems,
      ],
    }));
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      // Somebody else won the race. Re-read: if the membership is there, this
      // call did its job even though this transaction did not.
      const after = await G.getMembership(orgId, sub);
      if (after) return alreadyIn(orgId, after);
      return G.fail(409, 'That invitation was just used. Refresh and try again.');
    }
    console.error('accept-invite transaction failed:', error);
    return G.fail(500, `Could not accept that invitation: ${error.message}`);
  }

  return G.json(200, {
    orgId,
    // The org AS IT NOW IS, not as it was read a few lines above. When this
    // join was the one that turned somebody's home into a team, answering with
    // the pre-flip row would hand the switcher `personal` for an organisation
    // that is no longer one, and the screen would draw "· Personal" beside a
    // team until the next reload.
    org: G.publicOrg(flipsToTeam ? { ...org, type: G.TEAM, plan: G.TEAM } : org),
    membership: G.publicMember(member),
    accepted: true,
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  // NO ORG GUARD, by necessity — see the header. The invitation is the
  // credential; the four checks in acceptInvite are what replace membership.
  if (method === 'POST') return acceptInvite(event);

  return G.fail(404, 'Endpoint not found');
};
