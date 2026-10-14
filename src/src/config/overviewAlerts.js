/**
 * THE CONSOLE OVERVIEW'S BOXES AND THE SCOPE TABS' ARITHMETIC — pure.
 *
 * docs/design/admin-landing (SPEC.md §3, §4, §6; owner's rulings 2026-10-11).
 * No React, no fetch: data in, descriptors out, so every rule below is tested
 * without mounting AdminPage (which cannot be mounted in jsdom at all).
 *
 * A BOX is one kind of thing waiting: a count, a plain title, one summary
 * line, an urgency class, the rows it opens to, and the section where the
 * full action lives. Classes, in this order (SPEC §3):
 *
 *   people  a person or customer is waiting on you          blue edge
 *   stuck   something of yours cannot go ahead               red edge
 *   info    for your information                             grey edge
 *
 * Within a class, oldest first. No box is ever dismissed: it goes when its
 * cause goes (owner, ruling 5). Only people and stuck are COUNTED on a tab —
 * a number on a tab is a request to come and act (my-attention.js says the
 * same on the server).
 */

export const CLASS_ORDER = { people: 0, stuck: 1, info: 2 };
/** Rows shown when a box opens; the foot says "Showing 5 of 12". */
export const SHOW_ROWS = 5;
/** Reports this close to deletion are shown. */
export const REPORT_DAYS = 7;
/** Invitations this close to running out are shown (my-attention.js agrees). */
export const RUNNING_OUT_DAYS = 2;

const DAY = 86400000;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ts = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

/** "3 days", "1 day", "today" — how long something has waited. */
export function waitedWords(iso, now = Date.now()) {
  const t = ts(iso);
  if (t === null) return '';
  const days = Math.floor((now - t) / DAY);
  if (days <= 0) return 'today';
  return plural(days, 'day', 'days');
}

/** "11 Oct" in the reader's own time zone. */
export function shortDate(iso) {
  const t = ts(iso);
  if (t === null) return '';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Days left until `iso`, rounded up; negative once past. */
export function daysLeft(iso, now = Date.now()) {
  const t = ts(iso);
  if (t === null) return null;
  return Math.ceil((t - now) / DAY);
}

const leftWords = (days) => {
  if (days === null) return '';
  if (days < 0) return 'expired';
  if (days === 0) return 'expires today';
  return `${plural(days, 'day', 'days')} left`;
};

/** People first, then stuck, then info; oldest first within a class. */
export function orderBoxes(boxes) {
  return (boxes || []).filter(Boolean).slice().sort((a, b) => {
    const c = (CLASS_ORDER[a.cls] ?? 9) - (CLASS_ORDER[b.cls] ?? 9);
    if (c) return c;
    const ta = ts(a.since);
    const tb = ts(b.since);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });
}

/**
 * WHERE THE ONE ORANGE GOES (SPEC §6). Collapsed: the top box's main action.
 * A box open: that box's oldest row's main action. Nothing waits: nowhere.
 * Returns `{ boxId, row }` — `row` is a row index, or -1 for the head.
 */
export function orangeTarget(boxes, openId = '') {
  const list = orderBoxes(boxes);
  if (!list.length) return null;
  const open = openId ? list.find((b) => b.id === openId) : null;
  if (open) {
    const rows = open.rows || [];
    const at = rows.findIndex((r) => (r.actions || []).some((a) => a.primary));
    return at === -1 ? null : { boxId: open.id, row: at };
  }
  return list[0].main ? { boxId: list[0].id, row: -1 } : null;
}

/* ── the box builders ───────────────────────────────────────────────────── */

/** Team invitations to the person (GET /invites). Accept only; no decline. */
export function invitationBox(invites, now = Date.now()) {
  const list = (invites || []).filter((i) => !(daysLeft(i.expiresAt, now) < 0));
  if (!list.length) return null;
  const first = list[0];
  return {
    id: 'invites',
    cls: 'people',
    count: list.length,
    title: list.length === 1 ? 'Team invitation' : 'Team invitations',
    summary: list.length === 1
      ? `${first.orgName} invited you as ${first.role === 'admin' ? 'an admin' : 'a member'} · ${leftWords(daysLeft(first.expiresAt, now))}`
      : `${list.map((i) => i.orgName).slice(0, 2).join(' and ')}${list.length > 2 ? ' and others' : ''} invited you`,
    since: first.invitedAt,
    rows: list.map((i) => ({
      id: i.token,
      name: i.orgName,
      detail: [i.invitedByEmail && `From ${i.invitedByEmail}`, i.role === 'admin' ? 'admin' : 'member', leftWords(daysLeft(i.expiresAt, now))].filter(Boolean).join(' · '),
      actions: [{ id: 'accept', label: 'Accept', primary: true }],
      data: i,
    })),
    foot: 'There is no decline. An invitation you leave runs out on its own.',
    main: list.length === 1 ? { id: 'accept', label: 'Accept', row: 0 } : { id: 'open', label: 'Review' },
  };
}

/** Sets the check sent back (share.status flagged), in this scope's own library. */
export function sentBackBox(sets) {
  const list = (sets || []).filter((s) => (s.scope || 'platform') === 'org' && s.share && s.share.status === 'flagged');
  if (!list.length) return null;
  const name = (s) => s.name || s.title || s.id;
  return {
    id: 'sentback',
    cls: 'stuck',
    count: list.length,
    title: 'Sent back by the check',
    summary: list.length === 1
      ? `“${name(list[0])}” was not published. Read the note.`
      : `${plural(list.length, 'set was', 'sets were')} not published. Each has a note.`,
    since: (list[0].share && list[0].share.at) || null,
    rows: list.map((s) => ({
      id: s.id,
      name: name(s),
      detail: s.share.note ? s.share.note : 'The note is on the set.',
      actions: [{ id: 'open-set', label: 'Open the set', primary: true }],
      data: s,
    })),
    link: { label: 'Question sets', section: 'questionsets' },
    main: list.length === 1 ? { id: 'open-set', label: 'Open the set', row: 0 } : { id: 'open', label: 'Review' },
  };
}

/**
 * A capped plan near its session limit (GET /orgs/{id}/usage). Shown at one
 * short of the cap (info) and at the cap (stuck). Never for a metered plan.
 */
export function usageBox(usage) {
  if (!usage || !usage.plan || usage.plan.metersOverage === true) return null;
  const cap = Number(usage.allowances && usage.allowances.sessions);
  const used = Number(usage.usage && usage.usage.sessionsRun);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(used) || used < cap - 1) return null;
  const full = used >= cap;
  const resets = usage.period && usage.period.resetsOn ? shortDate(usage.period.resetsOn) : '';
  return {
    id: 'usage',
    cls: full ? 'stuck' : 'info',
    count: used,
    countIsSize: true,
    title: `${usage.plan.name || 'Free'} plan: ${used} of ${cap} sessions used`,
    summary: full
      ? `No more sessions this month on this plan${resets ? `. It resets on ${resets}` : ''}.`
      : `The next one is the last this month${resets ? `. It resets on ${resets}` : ''}.`,
    since: null,
    rows: [],
    link: { label: 'Plan & usage', section: 'billing' },
    main: { id: 'see-plans', label: 'See plans' },
    /* A box counts once on a tab when stuck, never by its size. */
    tabCount: full ? 1 : 0,
  };
}

/** The scope's own open plan request (GET /orgs/{id}/plan-requests). */
export function planRequestBox(request, now = Date.now()) {
  if (!request || request.status !== 'requested') return null;
  return {
    id: 'planrequest',
    cls: 'info',
    count: 1,
    title: 'Your plan request',
    summary: `Asked ${waitedWords(request.requestedAt, now) === 'today' ? 'today' : `${waitedWords(request.requestedAt, now)} ago`}. Engage answers with a note.`,
    since: request.requestedAt,
    rows: [{
      id: request.reqId,
      name: `${request.toPlan ? `${String(request.toPlan)[0].toUpperCase()}${String(request.toPlan).slice(1)} plan` : 'A new plan'}`,
      detail: `Asked ${shortDate(request.requestedAt)}${request.note ? ` · “${request.note}”` : ''}`,
      actions: [{ id: 'withdraw', label: 'Withdraw', primary: false }],
      data: request,
    }],
    link: { label: 'Plan & usage', section: 'billing' },
    main: { id: 'open', label: 'Review' },
  };
}

/** Saved reports deleted within REPORT_DAYS (GET /reports). */
export function reportsBox(reports, now = Date.now()) {
  const list = (reports || []).filter((r) => {
    const d = daysLeft(r.expiresAt, now);
    return d !== null && d >= 0 && d <= REPORT_DAYS;
  }).sort((a, b) => ts(a.expiresAt) - ts(b.expiresAt));
  if (!list.length) return null;
  return {
    id: 'reports',
    cls: 'info',
    count: list.length,
    title: 'Reports deleted soon',
    summary: list.length === 1
      ? `“${list[0].title || list[0].gameId}” is deleted on ${shortDate(list[0].expiresAt)}`
      : `${plural(list.length, 'saved report reaches', 'saved reports reach')} its end within ${REPORT_DAYS} days`,
    since: list[0].savedAt,
    rows: list.map((r) => ({
      id: r.id,
      name: r.title || `Session ${r.gameId}`,
      detail: `Saved ${shortDate(r.savedAt)} · deleted ${shortDate(r.expiresAt)}`,
      actions: [{ id: 'download', label: 'Download', primary: true }],
      data: r,
    })),
    foot: 'Every saved report is in Reports on the host screen.',
    hostLink: { label: 'Reports on the host screen', href: '/' },
    main: { id: 'open', label: 'Review' },
  };
}

/**
 * People who joined through THIS team's invitation and cannot host yet.
 * `canApprove` is the server's word (paid plans only, owner 2026-10-11): on a
 * Free team the same people show as information, waiting for Engage, with no
 * Approve.
 */
export function approvalsBox(members, now = Date.now(), { canApprove = true } = {}) {
  const list = (members || []).filter((m) => m.awaitingHostApproval === true && m.joinedByInvite === true)
    .sort((a, b) => (ts(a.joinedAt) || 0) - (ts(b.joinedAt) || 0));
  if (!list.length) return null;
  if (!canApprove) {
    return {
      id: 'approvals',
      cls: 'info',
      count: list.length,
      title: 'Waiting for Engage',
      summary: `Joined the team, cannot host yet · oldest ${waitedWords(list[0].joinedAt, now)}`,
      since: list[0].joinedAt,
      why: 'Only teams on a paid plan approve hosting. Engage approves people who join a Free team.',
      rows: list.map((m) => ({
        id: m.userId,
        name: m.displayName || m.email,
        detail: [m.displayName ? m.email : '', `accepted ${shortDate(m.joinedAt)}`, `waiting ${waitedWords(m.joinedAt, now)}`].filter(Boolean).join(' · '),
        actions: [],
        data: m,
      })),
      link: { label: 'Plan & usage', section: 'billing' },
    };
  }
  return {
    id: 'approvals',
    cls: 'people',
    count: list.length,
    title: 'Awaiting approval',
    summary: `Joined the team, cannot host yet · oldest ${waitedWords(list[0].joinedAt, now)}`,
    since: list[0].joinedAt,
    why: 'These people accepted your invitation. Approve lets them host sessions for this team. Engage is told and can still refuse.',
    rows: list.map((m) => ({
      id: m.userId,
      name: m.displayName || m.email,
      detail: [m.displayName ? m.email : '', `accepted ${shortDate(m.joinedAt)}`, `waiting ${waitedWords(m.joinedAt, now)}`].filter(Boolean).join(' · '),
      actions: [{ id: 'approve', label: 'Approve', primary: true }],
      data: m,
    })),
    link: { label: 'Members', section: 'members' },
    main: { id: 'open', label: 'Review' },
  };
}

/** Invitations within RUNNING_OUT_DAYS of expiry, and expired ones. */
export function invitesRunningOutBox(invites, now = Date.now()) {
  const list = (invites || []).filter((i) => {
    const d = daysLeft(i.expiresAt, now);
    return i.expired || (d !== null && d <= RUNNING_OUT_DAYS);
  }).sort((a, b) => (ts(a.expiresAt) || 0) - (ts(b.expiresAt) || 0));
  if (!list.length) return null;
  const words = (i) => (i.expired || daysLeft(i.expiresAt, now) < 0 ? 'expired' : leftWords(daysLeft(i.expiresAt, now)));
  return {
    id: 'invitesout',
    cls: 'people',
    count: list.length,
    title: 'Invitation running out',
    summary: list.length === 1
      ? `${list[0].email} has not accepted · ${words(list[0])}`
      : `${plural(list.length, 'person has', 'people have')} not accepted`,
    /* It started needing you when it began to run out, not when it was sent:
       a fortnight-old invitation is not older news than yesterday's joiner. */
    since: ts(list[0].expiresAt) === null ? null
      : new Date(ts(list[0].expiresAt) - RUNNING_OUT_DAYS * DAY).toISOString(),
    rows: list.map((i) => {
      const gone = words(i) === 'expired';
      return {
        id: i.token,
        name: i.email,
        detail: `Invited ${shortDate(i.invitedAt)} · ${words(i)}`,
        actions: gone
          ? [{ id: 'revoke', label: 'Revoke', primary: true, danger: true }]
          : [{ id: 'copy-link', label: 'Copy link', primary: true }, { id: 'revoke', label: 'Revoke', danger: true }],
        data: i,
      };
    }),
    foot: 'An expired invitation blocks inviting that address again until it is revoked.',
    link: { label: 'Members', section: 'members' },
    main: list.length === 1 && words(list[0]) !== 'expired' ? { id: 'copy-link', label: 'Copy link', row: 0 } : { id: 'open', label: 'Review' },
  };
}

/** The browser-local "since you last looked" marker for the audit box. */
export const auditSeenKey = (orgId) => `engage.overview.auditSeen.${orgId}`;

/** Engage staff opened or changed something here since you last read the log. */
export function staffOpenedBox(entries, seenAt = '') {
  const seen = ts(seenAt) || 0;
  const list = (entries || []).filter((e) => e && e.actor && e.actor.role === 'platform-admin' && (ts(e.at) || 0) > seen)
    .sort((a, b) => ts(a.at) - ts(b.at));
  if (!list.length) return null;
  const last = list[list.length - 1];
  return {
    id: 'staffopened',
    cls: 'info',
    count: list.length,
    title: 'Engage staff opened your content',
    summary: `${last.actor.name || 'Engage staff'}, ${shortDate(last.at)}${last.reason ? ', with a written reason' : ''}. It is in your log.`,
    since: list[0].at,
    rows: [],
    link: { label: 'Data & privacy', section: 'privacy' },
    main: { id: 'read-log', label: 'Read the log' },
  };
}

/* ── Engage (platform mode) ─────────────────────────────────────────────── */

/** Accounts in `pending`, enabled (POST /admin/users/list). */
export function accountsBox(users, now = Date.now()) {
  const list = (users || []).filter((u) => {
    const groups = Array.isArray(u.groups) ? u.groups : [];
    return u.enabled !== false && !groups.includes('disabled') && !groups.includes('hosts') && !groups.includes('admins');
  }).sort((a, b) => (ts(a.created) || 0) - (ts(b.created) || 0));
  if (!list.length) return null;
  return {
    id: 'accounts',
    cls: 'people',
    count: list.length,
    title: 'Accounts awaiting approval',
    summary: `Registered, cannot host yet · oldest ${waitedWords(list[0].created, now)}`,
    since: list[0].created,
    rows: list.map((u) => ({
      id: u.username,
      name: u.email || u.name || u.username,
      detail: [`Registered ${shortDate(u.created)}`, u.userStatus === 'CONFIRMED' || u.userStatus === 'EXTERNAL_PROVIDER' ? 'email confirmed' : 'email not confirmed'].join(' · '),
      actions: [{ id: 'reject-account', label: 'Reject', danger: true }, { id: 'approve-account', label: 'Approve as host', primary: true }],
      data: u,
    })),
    foot: 'Reject asks first; the account is kept and can be restored.',
    link: { label: 'Accounts', section: 'users' },
    main: { id: 'open', label: 'Review' },
  };
}

/** Plan requests waiting on Engage (GET /platform/plan-requests?status=requested). */
export function planQueueBox(requests, now = Date.now()) {
  const list = (requests || []).filter((r) => r.status === 'requested')
    .sort((a, b) => (ts(a.requestedAt) || 0) - (ts(b.requestedAt) || 0));
  if (!list.length) return null;
  const plan = (p) => (p ? `${String(p)[0].toUpperCase()}${String(p).slice(1)}` : 'a plan');
  return {
    id: 'planqueue',
    cls: 'people',
    count: list.length,
    title: 'Plan requests',
    summary: list.slice(0, 2).map((r) => `${r.orgName} asks for ${plan(r.toPlan)}`).join(' · '),
    since: list[0].requestedAt,
    rows: list.map((r) => ({
      id: `${r.orgId}:${r.reqId}`,
      name: r.orgName,
      detail: `${plan(r.fromPlan)} to ${plan(r.toPlan)} · asked ${shortDate(r.requestedAt)} · waiting ${waitedWords(r.requestedAt, now)}`,
      actions: [{ id: 'decide', label: 'Decide', primary: true }],
      data: r,
    })),
    link: { label: 'Plan requests', section: 'planrequests' },
    main: list.length === 1 ? { id: 'decide', label: 'Decide', row: 0 } : { id: 'open', label: 'Review' },
  };
}

/** Sets waiting in Moderation (GET /admin/moderation). Review lives there. */
export function moderationBox(queue, now = Date.now()) {
  const items = (queue && queue.items) || [];
  if (!items.length) return null;
  return {
    id: 'moderation',
    cls: 'people',
    count: items.length,
    title: 'Sets waiting in Moderation',
    summary: `The check held them for a person · oldest ${waitedWords(items[0].waitingSince, now)}`,
    since: items[0].waitingSince,
    rows: items.map((i) => ({
      id: i.sk,
      name: i.title || i.setId,
      detail: `${i.scope === 'platform' ? 'Engage' : (i.orgName || i.orgId || 'A team')} · waiting ${waitedWords(i.waitingSince, now)}`,
      actions: [{ id: 'review-moderation', label: 'Review', primary: true }],
      data: i,
    })),
    link: { label: 'Moderation', section: 'moderation' },
    main: { id: 'review-moderation', label: 'Review' },
  };
}

/** Claude 5.5 chosen but not connected (GET /platform/settings/claude-models). */
export function claudeBox(setting) {
  if (!setting || setting.anthropic55 !== true || setting.connected !== false) return null;
  return {
    id: 'claude',
    cls: 'stuck',
    count: 1,
    title: 'Claude 5.5 is chosen but not connected',
    summary: 'Every call on this tier is answered by the Bedrock models.',
    since: setting.updatedAt || null,
    rows: [],
    link: { label: 'Engage settings', section: 'engagesettings' },
    main: { id: 'engage-settings', label: 'Engage settings' },
  };
}

/** What a tab counts for one box: the box's own `tabCount` when it has one. */
export function boxTabCount(box) {
  if (!box || box.cls === 'info') return 0;
  return typeof box.tabCount === 'number' ? box.tabCount : (Number(box.count) || 0);
}

/** Total for the open scope's tab, from its own boxes. */
export function scopeTotal(boxes) {
  return (boxes || []).reduce((n, b) => n + boxTabCount(b), 0);
}

/* ── the scope tabs ─────────────────────────────────────────────────────── */

export const PLATFORM_KEY = '~platform';

/**
 * Every place this person works, in the fixed order: Personal, teams A to Z,
 * then Engage for staff. Never reordered by activity or count (ruling 10).
 */
export function scopeList(orgs = [], { staff = false } = {}) {
  const list = Array.isArray(orgs) ? orgs : [];
  const personal = list.filter((o) => o.type === 'personal').slice(0, 1);
  const teams = list.filter((o) => o.type !== 'personal')
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  const role = (o) => String(o.yourRole || o.role || '').toLowerCase();
  return [
    ...personal.map((o) => ({ key: o.orgId, kind: 'personal', name: 'Personal', fullName: o.name, role: 'owner', org: o })),
    ...teams.map((o) => ({ key: o.orgId, kind: 'team', name: o.name, fullName: o.name, role: role(o), org: o })),
    ...(staff ? [{ key: PLATFORM_KEY, kind: 'platform', name: 'Engage', fullName: 'Engage', role: 'staff', org: null }] : []),
  ];
}

/**
 * The number on each tab. Other scopes read GET /me/attention; the open one
 * prefers its own Overview's total once that has loaded, so the tab and the
 * page never disagree on screen. Invitations to the person count on Personal.
 */
export function tabCounts(scopes, attention, { activeKey = '', activeTotal = null } = {}) {
  const out = {};
  const counts = (attention && attention.scopes) || {};
  const invites = Number(attention && attention.invites) || 0;
  for (const s of scopes || []) {
    let n = Number(counts[s.key]) || 0;
    if (s.kind === 'personal') n += invites;
    if (s.key === activeKey && typeof activeTotal === 'number') n = activeTotal;
    out[s.key] = n;
  }
  return out;
}

/**
 * WHICH TEAMS GET A TAB when only `slots` fit. A to Z; the active team is
 * always visible (it takes the last slot); the rest go into "N more", A to Z.
 * `slots` counts team tabs only — Personal and Engage are never folded.
 */
export function splitTeams(teams = [], activeKey = '', slots = Infinity) {
  const list = teams.slice();
  if (!Number.isFinite(slots) || list.length <= slots) return { visible: list, hidden: [] };
  const n = Math.max(1, Math.floor(slots));
  let visible = list.slice(0, n);
  const active = list.find((t) => t.key === activeKey);
  if (active && !visible.includes(active)) visible = [...list.slice(0, n - 1), active];
  const hidden = list.filter((t) => !visible.includes(t));
  return { visible, hidden };
}

/** Initials for a tile: "Northwind Learning" -> "NL". */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Owner", "Admin", "Member", "Staff". */
export function roleWord(role) {
  const r = String(role || '').toLowerCase();
  return r ? r[0].toUpperCase() + r.slice(1) : '';
}
