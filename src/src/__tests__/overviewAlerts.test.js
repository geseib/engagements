/**
 * config/overviewAlerts.js — the Overview's boxes and the scope tabs'
 * arithmetic, as pure functions (docs/design/admin-landing, SPEC §3, §4, §6).
 */
import {
  orderBoxes, orangeTarget, scopeTotal, boxTabCount,
  invitationBox, sentBackBox, usageBox, planRequestBox, reportsBox, approvalsBox,
  invitesRunningOutBox, staffOpenedBox, accountsBox, planQueueBox, moderationBox, claudeBox,
  scopeList, tabCounts, splitTeams, PLATFORM_KEY,
} from '../config/overviewAlerts';

const NOW = Date.parse('2026-10-11T09:40:00.000Z');
const day = (n) => new Date(NOW + n * 86400000).toISOString();

describe('order: people, then stuck, then info; oldest first', () => {
  // rejects: ordering by count, or newest first
  test('class first, then age', () => {
    const boxes = [
      { id: 'i', cls: 'info', since: day(-9) },
      { id: 's', cls: 'stuck', since: day(-1) },
      { id: 'p2', cls: 'people', since: day(-1) },
      { id: 'p1', cls: 'people', since: day(-3) },
      { id: 'pn', cls: 'people', since: null },
    ];
    expect(orderBoxes(boxes).map((b) => b.id)).toEqual(['p1', 'p2', 'pn', 's', 'i']);
  });
});

describe('the one orange', () => {
  const boxes = orderBoxes([
    { id: 'a', cls: 'people', since: day(-2), main: { id: 'open' }, rows: [{ id: 'r1', actions: [{ id: 'approve', primary: true }] }, { id: 'r2', actions: [{ id: 'approve', primary: true }] }] },
    { id: 'b', cls: 'info', since: day(-1), main: { id: 'read-log' }, rows: [] },
  ]);
  test('collapsed: the top box’s main action', () => {
    expect(orangeTarget(boxes, '')).toEqual({ boxId: 'a', row: -1 });
  });
  test('a box open: its oldest row’s main action, nothing on any head', () => {
    expect(orangeTarget(boxes, 'a')).toEqual({ boxId: 'a', row: 0 });
  });
  test('an open box with no actionable row: no orange at all', () => {
    expect(orangeTarget(boxes, 'b')).toBeNull();
  });
  test('nothing waiting: no orange', () => {
    expect(orangeTarget([], '')).toBeNull();
  });
});

describe('what a tab counts', () => {
  // rejects: counting info boxes, or counting the usage box by its size (4)
  test('people and stuck by their counts; info never; the usage box once when stuck', () => {
    const usageFull = usageBox({ plan: { name: 'Free', metersOverage: false }, allowances: { sessions: 5 }, usage: { sessionsRun: 5 }, period: {} });
    const usageNear = usageBox({ plan: { name: 'Free', metersOverage: false }, allowances: { sessions: 5 }, usage: { sessionsRun: 4 }, period: {} });
    expect(usageFull.cls).toBe('stuck');
    expect(usageNear.cls).toBe('info');
    expect(boxTabCount(usageFull)).toBe(1);
    expect(boxTabCount(usageNear)).toBe(0);
    expect(scopeTotal([{ cls: 'people', count: 3 }, { cls: 'stuck', count: 1 }, { cls: 'info', count: 7 }, usageFull])).toBe(5);
  });
  test('a metered plan never shows the usage box; three short of the cap does not either', () => {
    expect(usageBox({ plan: { metersOverage: true }, allowances: { sessions: 5 }, usage: { sessionsRun: 9 } })).toBeNull();
    expect(usageBox({ plan: { metersOverage: false }, allowances: { sessions: 5 }, usage: { sessionsRun: 3 } })).toBeNull();
  });
});

describe('the boxes', () => {
  test('a team invitation: Accept only, no decline', () => {
    const box = invitationBox([{ token: 't', orgName: 'Riverside Church', role: 'member', invitedAt: day(-1), expiresAt: day(3) }], NOW);
    expect(box.cls).toBe('people');
    expect(box.rows[0].actions.map((a) => a.id)).toEqual(['accept']);
    expect(box.summary).toMatch(/Riverside Church invited you as a member · 3 days left/);
  });
  test('sent back by the check counts only this scope’s own flagged sets', () => {
    const box = sentBackBox([
      { id: 'a', scope: 'org', name: 'Lent study', share: { status: 'flagged', note: 'Q3' } },
      { id: 'b', scope: 'platform', share: { status: 'flagged' } },
      { id: 'c', scope: 'org', share: { status: 'passed' } },
    ]);
    expect(box.count).toBe(1);
    expect(box.cls).toBe('stuck');
    expect(box.main.id).toBe('open-set');
  });
  test('a plan request only while it waits, with Withdraw', () => {
    expect(planRequestBox({ status: 'approved' })).toBeNull();
    expect(planRequestBox({ status: 'requested', reqId: 'r', requestedAt: day(-2), toPlan: 'standard' }, NOW).rows[0].actions[0].id).toBe('withdraw');
  });
  test('reports within seven days of deletion, soonest first', () => {
    const box = reportsBox([
      { id: 'a', title: 'Far', expiresAt: day(20) },
      { id: 'b', title: 'Soon', expiresAt: day(2), savedAt: day(-88) },
      { id: 'c', title: 'Sooner', expiresAt: day(1), savedAt: day(-89) },
      { id: 'd', title: 'Gone', expiresAt: day(-1) },
    ], NOW);
    expect(box.rows.map((r) => r.id)).toEqual(['c', 'b']);
    expect(box.rows[0].actions[0].id).toBe('download');
  });
  // rejects: offering Approve for somebody this team did not invite
  test('awaiting approval needs BOTH the invitation stamp and the queue flag', () => {
    const box = approvalsBox([
      { userId: 'a', email: 'a@x', joinedByInvite: true, awaitingHostApproval: true, joinedAt: day(-2) },
      { userId: 'b', email: 'b@x', awaitingHostApproval: true, joinedAt: day(-3) },
      { userId: 'c', email: 'c@x', joinedByInvite: true, joinedAt: day(-3) },
    ], NOW);
    expect(box.rows.map((r) => r.id)).toEqual(['a']);
    expect(box.link.section).toBe('members');
  });
  test('invitations running out: two days or fewer, and expired ones (Revoke only)', () => {
    const box = invitesRunningOutBox([
      { token: 'a', email: 'a@x', expiresAt: day(1), invitedAt: day(-13) },
      { token: 'b', email: 'b@x', expiresAt: day(9), invitedAt: day(-5) },
      { token: 'c', email: 'c@x', expiresAt: day(-1), expired: true, invitedAt: day(-15) },
    ], NOW);
    expect(box.rows.map((r) => r.id)).toEqual(['c', 'a']);
    expect(box.rows[0].actions.map((a) => a.id)).toEqual(['revoke']);
    expect(box.rows[1].actions.map((a) => a.id)).toEqual(['copy-link', 'revoke']);
  });
  test('staff opened your content: only staff entries since you last looked', () => {
    const entries = [
      { at: day(-5), actor: { role: 'platform-admin', name: 'Support' } },
      { at: day(-2), actor: { role: 'platform-admin', name: 'Support' }, reason: 'ticket' },
      { at: day(-1), actor: { role: 'org-owner', name: 'Maya' } },
    ];
    expect(staffOpenedBox(entries, '').count).toBe(2);
    expect(staffOpenedBox(entries, day(-3)).count).toBe(1);
    expect(staffOpenedBox(entries, day(-1))).toBeNull();
  });
  test('Engage: pending accounts, not disabled or approved ones', () => {
    const box = accountsBox([
      { username: 'p', email: 'p@x', groups: ['pending'], enabled: true, created: day(-3) },
      { username: 'd', groups: [], enabled: false },
      { username: 'h', groups: ['hosts'], enabled: true },
    ], NOW);
    expect(box.rows.map((r) => r.id)).toEqual(['p']);
    expect(box.rows[0].actions.map((a) => a.id)).toEqual(['reject-account', 'approve-account']);
  });
  test('Engage: plan requests decide in the existing dialog', () => {
    const box = planQueueBox([{ orgId: 'o', reqId: 'r', orgName: 'Harbour', status: 'requested', toPlan: 'team', requestedAt: day(-1) }], NOW);
    expect(box.rows[0].actions[0].id).toBe('decide');
  });
  test('Engage: Moderation is Review only (a set is judged on its findings)', () => {
    const box = moderationBox({ items: [{ sk: 'q', title: 'A set', waitingSince: day(-4) }] }, NOW);
    expect(box.rows[0].actions.map((a) => a.id)).toEqual(['review-moderation']);
  });
  test('Engage: Claude 5.5 chosen and not connected is stuck; connected is nothing', () => {
    expect(claudeBox({ anthropic55: true, connected: false }).cls).toBe('stuck');
    expect(claudeBox({ anthropic55: true, connected: true })).toBeNull();
    expect(claudeBox({ anthropic55: false, connected: false })).toBeNull();
  });
});

describe('the scope tabs', () => {
  const orgs = [
    { orgId: 'org_w', name: 'Westfield College', type: 'team', yourRole: 'admin' },
    { orgId: 'org_me', name: 'Maya Reyes', type: 'personal' },
    { orgId: 'org_a', name: 'acorn Choir', type: 'team', yourRole: 'member' },
    { orgId: 'org_n', name: 'Northwind Learning', type: 'team', yourRole: 'owner' },
  ];
  // rejects: ordering by activity, by count, or case-sensitively
  test('Personal, then teams A to Z, then Engage for staff only', () => {
    expect(scopeList(orgs, { staff: true }).map((s) => s.name))
      .toEqual(['Personal', 'acorn Choir', 'Northwind Learning', 'Westfield College', 'Engage']);
    expect(scopeList(orgs).map((s) => s.key)).not.toContain(PLATFORM_KEY);
  });
  test('counts come from /me/attention; invitations count on Personal; the open tab uses its own Overview', () => {
    const scopes = scopeList(orgs, { staff: true });
    const counts = tabCounts(scopes, { scopes: { org_me: 1, org_n: 3, '~platform': 9 }, invites: 2 }, { activeKey: 'org_n', activeTotal: 5 });
    expect(counts).toEqual({ org_me: 3, org_a: 0, org_n: 5, org_w: 0, '~platform': 9 });
  });
  describe('overflow', () => {
    const teams = 'ABCDEFGH'.split('').map((c) => ({ key: c }));
    test('everything fits: nothing folded', () => {
      expect(splitTeams(teams.slice(0, 3), 'A', 3)).toEqual({ visible: teams.slice(0, 3), hidden: [] });
    });
    test('A to Z into the slots, the rest into More', () => {
      const { visible, hidden } = splitTeams(teams, 'B', 3);
      expect(visible.map((t) => t.key)).toEqual(['A', 'B', 'C']);
      expect(hidden.map((t) => t.key)).toEqual(['D', 'E', 'F', 'G', 'H']);
    });
    // rejects: the active team disappearing into More
    test('the active team always keeps a visible tab, in the last slot', () => {
      const { visible, hidden } = splitTeams(teams, 'G', 3);
      expect(visible.map((t) => t.key)).toEqual(['A', 'B', 'G']);
      expect(hidden.map((t) => t.key)).toEqual(['C', 'D', 'E', 'F', 'H']);
    });
    test('one slot is still one tab: the active one', () => {
      expect(splitTeams(teams, 'H', 1).visible.map((t) => t.key)).toEqual(['H']);
    });
  });
});
