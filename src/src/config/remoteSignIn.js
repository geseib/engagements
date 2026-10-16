/**
 * WHO MAY SIGN IN ON THE PHONE (owner, 16 Oct 2026: "a reminder of who must
 * login. it should be any host/admin in that team (obviously for individual,
 * its only their account) but we should tell them in the help and on the
 * setup remote box which team/person is logged in").
 *
 * THE WORDS FOLLOW THE SERVER, tenant.js callerMayDriveSession: a signed-in
 * account that is an approved host (the `hosts` or `admins` group, which the
 * authorizer requires on every host route) and a MEMBER of the team that owns
 * the session, whatever its role in that team. Engage staff outside the team
 * are refused. A personal space has one member, so only that account.
 *
 * THE ROOM MUST NEVER SEE AN EMAIL ADDRESS (SessionSetupPanel's header). On one
 * screen the room watches this laptop, so the email is printed only where the
 * laptop is private (two screens); on one screen the person's name stands in.
 * Two screens chosen is not enough: until the room's window is up (the host
 * door's `presenting` > 0) the room may still be watching this laptop, so the
 * caller passes `privateScreen` only when both hold.
 */

/** The organisation this browser acts for (the X-Engage-Org choice), else the personal one, else null. */
export function pickSignedInOrg(orgs, activeOrgId) {
  const list = Array.isArray(orgs) ? orgs : [];
  if (!list.length) return null;
  return list.find((o) => o && o.orgId === activeOrgId)
    || list.find((o) => o && o.type === 'personal')
    // No match: say "this session's team" rather than guess a team by order.
    || null;
}

function personName(user) {
  const a = (user && user.attributes) || {};
  const full = String(a.name || '').trim()
    || [a.given_name, a.family_name].filter(Boolean).join(' ').trim();
  return full;
}

/**
 * The remote box's words: `{ lead, who, tail, laptop, text }`. `who` is the
 * part drawn bold; `text` is the whole sentence, for tests and help.
 */
export function remoteSignIn({ org = null, user = null, privateScreen = false } = {}) {
  const name = personName(user);
  const email = String((user && user.attributes && user.attributes.email) || '').trim();
  const lead = 'Sign in on the phone as ';
  let who;
  let tail;
  if (!org) {
    who = 'a host or admin of this session\'s team';
    tail = '.';
  } else if (org.type === 'personal') {
    const shown = privateScreen && email ? email : name;
    who = shown ? `you (${shown})` : 'you';
    tail = '. Only your account can drive this session.';
  } else {
    who = `any host or admin of ${org.name}`;
    tail = '.';
  }
  const label = name || (privateScreen ? email : '');
  const where = org ? (org.type === 'personal' ? 'Personal' : org.name) : '';
  const laptop = label ? `On this laptop now: ${[label, where].filter(Boolean).join(' · ')}` : null;
  return { lead, who, tail, laptop, text: `${lead}${who}${tail}` };
}
