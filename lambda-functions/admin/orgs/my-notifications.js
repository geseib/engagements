/**
 * /me/notifications/{proxy+} — the bell in the console's top line.
 *
 *   GET  list                 everything waiting for the caller, newest first
 *   POST {id}/read            mark one stored notification read
 *   POST read-all             mark every stored notification read
 *
 * Mounted on OrgsListFunction beside /me/attention (list-my-orgs.js), no new
 * Lambda: the stack is near its resource limit.
 *
 * ── WHAT IS IN IT ──────────────────────────────────────────────────────────
 *
 * STORED (shared/notifications.js): AI drafts that are ready, partly ready or
 * failed — with a reminder five days before a draft expires. Read/unread; each
 * goes away when its draft is accepted, discarded or expires.
 *
 * LIVE (computed here, from state that already exists): exactly the things
 * /me/attention COUNTS for the scope tabs — so the bell and the tabs can never
 * disagree about what is waiting — but named, with a deep link:
 *
 *   invite                 an invitation addressed to your verified email
 *   org.members-waiting    people waiting for hosting approval   (owner/admin)
 *   org.invites-expiring   invitations running out or expired    (owner/admin)
 *   org.cap-reached        the plan's session cap reached        (owner/admin)
 *   org.sets-flagged       sets the content check sent back      (any member)
 *   platform.accounts      accounts waiting in `pending`         (Engage staff)
 *   platform.plan-requests plan requests waiting                 (Engage staff)
 *   platform.moderation    sets waiting in Moderation            (Engage staff)
 *
 * A live entry has no read state: it is "unread" while the thing waits and
 * gone when somebody deals with it. Names only, never content — an org's name
 * is plaintext by decision (it is how a switcher draws), and nothing here
 * opens a set.
 *
 * A part that cannot be read is left out and named in `unavailable`, never
 * allowed to fail the whole inbox.
 */
const tenant = require('../shared/tenant');
const G = require('./shared/org-guards');
const notifications = require('../shared/notifications');
const A = require('./my-attention');
const { listQueue } = require('../shared/moderation-queue');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function live(id, kind, title, body, link, count = 1) {
  return {
    id, kind, source: 'live', title, body, link, read: false, count,
    orgId: link && link.orgId && link.orgId !== '~platform' ? link.orgId : '',
    createdAt: null, updatedAt: null,
  };
}

async function orgEntries(orgId, role, now, unavailable) {
  const org = await G.getOrgMetadata(orgId);
  if (!org) return [];
  const name = G.clean(org.name) || 'your team';
  const out = [];
  try {
    const n = await A.flaggedSets(orgId);
    if (n) {
      out.push(live(`org-sets-flagged#${orgId}`, 'org.sets-flagged',
        `${plural(n, 'set', 'sets')} sent back by the content check`,
        `In ${name}. Open it to see what to change.`,
        { type: 'section', orgId, section: 'questionsets' }, n));
    }
  } catch (e) { unavailable.push({ orgId, part: 'sets' }); }
  if (A.ADMIN_ROLES.includes(role)) {
    try {
      const { awaiting, runningOut } = await A.teamPeopleParts(orgId, now.getTime(), org);
      if (awaiting) {
        out.push(live(`org-members-waiting#${orgId}`, 'org.members-waiting',
          `${plural(awaiting, 'person', 'people')} waiting to be approved to host`,
          `In ${name}.`, { type: 'section', orgId, section: 'members' }, awaiting));
      }
      if (runningOut) {
        out.push(live(`org-invites-expiring#${orgId}`, 'org.invites-expiring',
          `${plural(runningOut, 'invitation', 'invitations')} running out or expired`,
          `In ${name}. Send again, or let it go.`, { type: 'section', orgId, section: 'members' }, runningOut));
      }
    } catch (e) { unavailable.push({ orgId, part: 'members' }); }
    try {
      if (await A.capReached(orgId, org, now)) {
        out.push(live(`org-cap-reached#${orgId}`, 'org.cap-reached',
          'Your plan’s sessions for this month are used up',
          `In ${name}. See the plan and what comes next.`, { type: 'section', orgId, section: 'billing' }));
      }
    } catch (e) { unavailable.push({ orgId, part: 'usage' }); }
  }
  return out;
}

async function platformEntries(unavailable) {
  const out = [];
  const P = { type: 'section', orgId: '~platform' };
  try {
    const n = await A.pendingAccounts();
    if (n) out.push(live('platform-accounts#~platform', 'platform.accounts', `${plural(n, 'account', 'accounts')} waiting for approval`, 'Engage', { ...P, section: 'users' }, n));
  } catch (e) { unavailable.push({ orgId: '~platform', part: 'accounts' }); }
  try {
    const n = await A.planRequestsWaiting();
    if (n) out.push(live('platform-plan-requests#~platform', 'platform.plan-requests', `${plural(n, 'plan request', 'plan requests')} waiting`, 'Engage', { ...P, section: 'planrequests' }, n));
  } catch (e) { unavailable.push({ orgId: '~platform', part: 'planrequests' }); }
  try {
    const n = (await listQueue(G.db, G.tableName())).length;
    if (n) out.push(live('platform-moderation#~platform', 'platform.moderation', `${plural(n, 'set', 'sets')} waiting in Moderation`, 'Engage', { ...P, section: 'moderation' }, n));
  } catch (e) { unavailable.push({ orgId: '~platform', part: 'moderation' }); }
  return out;
}

async function listNotifications(event, { now = new Date() } = {}) {
  const sub = G.callerSub(event);
  if (!sub) return G.fail(403, 'Sign in to do this.');
  const unavailable = [];

  let stored = [];
  try {
    stored = await notifications.listFor(G.db, sub, { now });
  } catch (e) {
    unavailable.push({ orgId: '', part: 'stored' });
  }

  const liveEntries = [];
  const memberships = await G.queryPartition(tenant.userPk(sub), 'ORG#').catch(() => {
    unavailable.push({ orgId: '', part: 'memberships' });
    return [];
  });
  const perOrg = await Promise.all(memberships.map(async (m) => {
    const orgId = G.clean(m.orgId) || G.clean(m.SK).replace(/^ORG#/, '');
    if (!G.isOrgId(orgId)) return [];
    try {
      return await orgEntries(orgId, G.clean(m.role).toLowerCase(), now, unavailable);
    } catch (e) {
      unavailable.push({ orgId, part: 'organisation' });
      return [];
    }
  }));
  perOrg.forEach((list) => liveEntries.push(...list));

  if (tenant.isPlatformAdmin(event)) liveEntries.push(...(await platformEntries(unavailable)));

  const email = G.callerVerifiedEmail(event);
  if (email) {
    try {
      const invites = await G.listInvitesFor(email, now.getTime());
      for (const inv of invites) {
        liveEntries.push(live(`invite#${G.clean(inv.orgId) || 'org'}`, 'invite',
          `Invitation to join ${G.clean(inv.orgName) || 'a team'}`,
          `As ${G.clean(inv.role) || 'member'}${inv.invitedByEmail ? `, from ${inv.invitedByEmail}` : ''}.`,
          { type: 'invites' }));
      }
    } catch (e) { unavailable.push({ orgId: '', part: 'invites' }); }
  }

  const items = [...stored, ...liveEntries];
  const unread = items.filter((n) => !n.read).length;
  return G.json(200, { items, unread, unavailable });
}

function routeOf(event) {
  const tail = String(
    (event && event.pathParameters && event.pathParameters.proxy)
    || String(event?.requestContext?.http?.path || event?.rawPath || '').replace(/^.*\/me\/notifications\/?/, ''),
  ).replace(/^\/+|\/+$/g, '');
  const parts = tail.split('/');
  return { id: decodeURIComponent(parts[0] || ''), action: parts[1] || '' };
}

async function myNotifications(event, { now = new Date() } = {}) {
  const method = event?.requestContext?.http?.method || 'GET';
  const { id, action } = routeOf(event);
  if (method === 'GET' && id === 'list') return listNotifications(event, { now });
  const sub = G.callerSub(event);
  if (!sub) return G.fail(403, 'Sign in to do this.');
  if (method === 'POST' && id === 'read-all') {
    const marked = await notifications.markAllRead(G.db, sub, { now });
    return G.json(200, { marked });
  }
  if (method === 'POST' && id && action === 'read') {
    try {
      await notifications.markRead(G.db, sub, id, { now });
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException' || /bad key/.test(error.message)) {
        return G.fail(404, 'That notification is gone.');
      }
      throw error;
    }
    return G.json(200, { read: true });
  }
  return G.fail(404, 'Endpoint not found');
}

const isNotificationsRoute = (event) => /\/me\/notifications(\/|$)/.test(String(event?.requestContext?.http?.path || event?.rawPath || ''));

module.exports = { myNotifications, isNotificationsRoute, listNotifications, routeOf };
