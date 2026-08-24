/**
 * WHICH ORGANISATIONS ARE WAITING FOR ME TO SAY YES.
 *
 * ── WHY THIS EXISTS AND WHY IT IS NOT AN EMAILED LINK ──────────────────────
 *
 * `invite-member.js` says in its own header that it sends no email, and nothing
 * ever wired the delivery it was waiting for. So an invitation was written, the
 * admin was told it had been "mailed", the token was never shown to anybody,
 * and `POST /invites/{token}/accept` — which is complete and correct — had no
 * caller and had never once been invoked.
 *
 * The owner's answer removes the delivery problem rather than solving it:
 *
 *   "they dont need to get an email, just login with the same email as they use
 *    for their account and click the accept button on the main screen."
 *
 * `accept-invite.js` already refuses any invitation whose address does not match
 * the caller's Cognito email, so the email match was always the real check and
 * the token was only ever a way of finding the row. This route finds it instead.
 * A link still works and is still worth having for somebody with no account yet;
 * it is no longer the only way in.
 *
 * ── HOW IT FINDS THEM WITHOUT A GSI ────────────────────────────────────────
 *
 * An invitation lives in the INVITING organisation's partition, which the
 * invitee cannot read and whose id they do not know. There are no GSIs on this
 * table. So `invite-member.js` writes a second row keyed on the invitee's
 * address — `INVITEE#{email}` / `INVITE#{token}` — in the same transaction, the
 * same way a membership is written both to the org and to the user. This is one
 * Query of that partition.
 *
 * ── WHAT IT DOES NOT LEAK ──────────────────────────────────────────────────
 *
 * Only rows addressed to the CALLER'S OWN verified email, and only the fields
 * the prompt needs. The organisation's name is denormalised onto the pointer at
 * invite time precisely so answering this does not require reading a partition
 * the caller is not a member of.
 */
const G = require('./shared/org-guards');

async function listMyInvites(event) {
  const sub = G.callerSub(event);
  if (!sub) return G.fail(403, 'Sign in to see your invitations.');

  const email = G.callerEmail(event);
  /*
    NO EMAIL, NO INVITATIONS — and an empty list rather than an error.

    An account with no email attribute cannot be matched to an invitation and
    `accept-invite.js` refuses it outright. Failing here would put an error
    banner on the landing screen of every such account for a feature they are
    not using; an empty list is the truth.
  */
  if (!email) return G.json(200, { invites: [] });

  const now = Date.now();
  const rows = await G.listInvitesFor(email, now);

  const invites = rows.map((row) => ({
    token: G.clean(row.token) || G.clean(row.SK).replace(/^INVITE#/, ''),
    orgId: G.clean(row.orgId),
    orgName: G.clean(row.orgName) || 'an organisation',
    role: G.clean(row.role).toLowerCase(),
    invitedByEmail: row.invitedByEmail || '',
    invitedAt: row.invitedAt || null,
    expiresAt: row.expiresAt || null,
    daysUntilExpiry: G.daysUntilExpiry(row, now),
  }));

  /* Soonest to expire first: the one that needs answering is the one about to
     stop being answerable. */
  invites.sort((a, b) => String(a.expiresAt || '').localeCompare(String(b.expiresAt || '')));

  return G.json(200, { invites });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return G.handlePreflight();
  if (method === 'GET') return listMyInvites(event);
  return G.fail(404, 'Endpoint not found');
};
