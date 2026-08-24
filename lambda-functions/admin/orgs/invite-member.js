/**
 * POST /orgs/{orgId}/invites — invite somebody to an organisation.
 *
 * Org admins only. Returns the invitation record; IT SENDS NO EMAIL. Delivery
 * is wired separately (SES) against the record this route returns, so that a
 * mail failure cannot leave an invitation half-created and a retry cannot mint
 * a second token for the same person.
 *
 * ── NOTHING IS CREATED UNTIL IT IS ACCEPTED ────────────────────────────────
 *
 * 03-team.html says it in the panel: "An invitation expires after 14 days.
 * Nothing is created until it is accepted." So this route writes ONE row and
 * no membership. There is no placeholder MEMBER row with a pending flag —
 * a pending member would be counted by `list-members`, counted by the seat
 * meter, and, worst, counted by `ownersOf`, where a never-accepted invitation
 * could satisfy the last-owner rule and let the real owner walk out.
 *
 * ── RE-INVITING IS THE SAME INVITATION, NOT A SECOND ONE ───────────────────
 *
 * The screen has a Resend button, and a person who does not see the email
 * presses it. If each press minted a fresh token, the Invited list would grow a
 * row per press, every earlier link would still work, and revoking would mean
 * finding all of them. So an unexpired invitation for that address is RETURNED
 * (200, `created: false`) rather than duplicated: one address, one live token,
 * and one thing to revoke.
 *
 * An EXPIRED invitation for the same address is replaced — that is what
 * re-inviting somebody after a fortnight means — and the dead row is deleted in
 * the same transaction so the list does not accumulate corpses.
 */

const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');

/**
 * Deliberately loose. Address validation is a famous tar pit and the strict
 * patterns reject real mailboxes; the only thing that matters here is that the
 * value is a single address-shaped token, because it is COMPARED against the
 * accepting user's Cognito email and never parsed.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function inviteMember(event) {
  const orgId = G.clean(event?.pathParameters?.orgId);

  // Admin of THIS organisation — both the authorizer context and the row.
  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;

  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');

  const email = G.clean(body.email).toLowerCase();
  if (!EMAIL_RE.test(email)) return G.fail(400, 'Give an email address to invite.');

  const role = G.clean(body.role).toLowerCase() || 'member';
  if (!G.INVITABLE_ROLES.includes(role)) {
    // `owner` is absent from INVITABLE_ROLES on purpose. Ownership is handed
    // over between people who are already in the organisation
    // (change-member-role.js); minting an owner from an email address means a
    // typo'd address can be handed the one role that cannot be removed.
    return G.fail(400, `Role must be one of: ${G.INVITABLE_ROLES.join(', ')}.`);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Already in the room? Inviting an existing member produces an invitation
  // that can never be accepted (accept-invite is idempotent against the
  // membership) and a row in the Invited list that never clears.
  const members = await G.listMembers(orgId);
  const already = members.find((m) => G.clean(m.email).toLowerCase() === email);
  if (already) {
    return G.fail(409, 'That person is already a member of this organisation.');
  }

  const invites = await G.listInvites(orgId);
  const live = invites.find(
    (i) => G.clean(i.email).toLowerCase() === email && !G.isExpired(i, now),
  );
  if (live) {
    // Resend, not re-invite. Same token, same expiry — the caller mails it
    // again.
    return G.json(200, { invite: G.publicInvite(live, now), created: false });
  }
  const stale = invites.filter(
    (i) => G.clean(i.email).toLowerCase() === email && G.isExpired(i, now),
  );

  const token = G.mintInviteToken(orgId);
  const { expiresAt, ttl } = G.inviteExpiry(now);

  const invite = {
    PK: tenant.orgPk(orgId),
    SK: G.inviteSk(token),
    orgId,
    token,
    email,
    role,
    invitedBy: G.callerSub(event),
    invitedByEmail: G.callerEmail(event),
    invitedAt: nowIso,
    expiresAt,
    // The TTL is HOUSEKEEPING, not the rule. DynamoDB deletes expired rows
    // "typically within 48 hours" and promises nothing, so accept-invite
    // compares `expiresAt` itself and refuses a row the sweeper has not
    // reached yet. See org-guards.isExpired.
    ttl,
  };

  /* BOTH ROWS, ONE TRANSACTION. The invitee cannot read this organisation's
     partition and does not know its id, and this table has no GSIs — so
     without the reverse row there is no answer to "which invitations are
     waiting for me?". See org-guards.invitePointer. */
  const pointer = G.invitePointer(invite, auth.org && auth.org.name);

  try {
    await G.db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: G.tableName(),
            Item: invite,
            // Cannot fire — the token is 32 random base58 characters — and is
            // here so that a future change to token minting cannot overwrite a
            // live invitation without tripping over this line first.
            ConditionExpression: 'attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: G.tableName(),
            Item: pointer,
          },
        },
        /* The expired rows for this address go with it, in the same
           transaction: either this address has one live invitation, or the
           table is untouched. Their POINTERS go too — one left behind is a
           prompt offering an invitation the accept route refuses as expired, a
           button that exists only to fail. */
        ...stale.flatMap((i) => [
          {
            Delete: {
              TableName: G.tableName(),
              Key: { PK: i.PK, SK: i.SK },
            },
          },
          {
            Delete: {
              TableName: G.tableName(),
              Key: { PK: G.inviteePk(i.email), SK: G.inviteSk(i.token) },
            },
          },
        ]),
      ],
    }));
  } catch (error) {
    console.error('invite-member transaction failed:', error);
    return G.fail(500, `Could not create that invitation: ${error.message}`);
  }

  // 201 and the whole record. The SES wiring reads `email`, `token` and
  // `expiresAt` off this response — it is not expected to re-read the row.
  return G.json(201, { invite: G.publicInvite(invite, now), created: true });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  if (method === 'POST') return inviteMember(event);

  return G.fail(404, 'Endpoint not found');
};
