/**
 * components/OverviewPanel.jsx — the landing page of every scope
 * (docs/design/admin-landing, F1 to F6; owner's rulings 2026-10-11).
 *
 * What this pins:
 *   - alerts above the numbers, in urgency order (people, stuck, info);
 *   - a box opens IN PLACE, the rows carry only the actions that already
 *     exist, and the foot links to where the full action lives;
 *   - one orange: the top box's main action, then the open box's first row's;
 *   - nothing waiting: one green line, no orange anywhere;
 *   - a member sees only what is theirs; staff see Engage's queues;
 *   - a failed read hides one box and says so, never blanks the page.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within,
} from '@testing-library/react';
import OverviewPanel from '../components/OverviewPanel';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const NOW = '2026-10-11T09:40:00.000Z';
const day = (n) => new Date(Date.parse(NOW) + n * 86400000).toISOString();
const TEAM = { orgId: 'org_nw', name: 'Northwind Learning', type: 'team', plan: 'team' };
const HOME = { orgId: 'org_me', name: 'Maya Reyes', type: 'personal', plan: 'free' };

const ok = (body) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob(['x']) });
const fail = (status) => ({ ok: false, status, json: async () => ({ error: `nope ${status}` }) });

/** Route table: the first key the URL contains wins. */
function serve(routes) {
  global.fetch = jest.fn(async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    for (const [key, value] of Object.entries(routes)) {
      const [m, frag] = key.includes(' ') ? key.split(' ') : ['GET', key];
      if (m === method && u.includes(frag)) return typeof value === 'function' ? value(u, init) : value;
    }
    return ok({});
  });
}
/** Every request made, as "METHOD path" with the API base stripped. */
const calls = () => global.fetch.mock.calls.map(([u, i = {}]) => `${(i.method || 'GET').toUpperCase()} ${String(u).replace(/^.*\/api\//, '')}`);

const TEAM_ROUTES = {
  'orgs/org_nw/members': ok({
    members: [
      { userId: 'u_p', displayName: 'Priya Shah', email: 'priya@nw.example', joinedByInvite: true, awaitingHostApproval: true, joinedAt: day(-2) },
      { userId: 'u_t', displayName: 'Tom Becker', email: 'tom@nw.example', joinedByInvite: true, awaitingHostApproval: true, joinedAt: day(-1) },
      { userId: 'u_o', displayName: 'Maya Reyes', email: 'maya@nw.example', role: 'owner' },
    ],
    invites: [{ token: 'tok_lee', email: 'lee@nw.example', invitedAt: day(-13), expiresAt: day(1) }],
  }),
  'orgs/org_nw/usage': ok({ plan: { name: 'Organisation', metersOverage: true }, totalIfPeriodEndedTodayDisplay: '$7.75', usage: {}, allowances: {} }),
  'orgs/org_nw/plan-requests': ok({ requests: [] }),
  'orgs/org_nw/audit': ok({ entries: [{ at: day(-2), actor: { role: 'platform-admin', name: 'Support' }, reason: 'ticket' }] }),
  'orgs/org_nw/stats': ok({ months: [{ period: '2026-10', totals: { counted: 31, created: 36, started: 33, participants: 612, questions: 284 } }] }),
  reports: ok({ reports: [] }),
};
const FLAGGED = [{ id: 'quiz', scope: 'org', name: 'Onboarding quiz v2', share: { status: 'flagged', at: day(-3), note: 'Q4' } }];

beforeEach(() => { localStorage.clear(); });

describe('a team, as owner', () => {
  const mount = (props = {}) => render(
    <OverviewPanel scope="team" org={TEAM} role="owner" sets={FLAGGED} now={NOW} {...props} />,
  );

  // rejects: numbers first; boxes in arrival order
  test('alerts come first, people before stuck before info, and the numbers after', async () => {
    serve(TEAM_ROUTES);
    mount();
    await screen.findByTestId('ovw-box-approvals');
    const boxes = [...document.querySelectorAll('[data-testid^="ovw-box-"]')];
    expect(boxes.map((b) => b.getAttribute('data-class'))).toEqual(['people', 'people', 'stuck', 'info']);
    expect(boxes.map((b) => b.dataset.testid)).toEqual(['ovw-box-approvals', 'ovw-box-invitesout', 'ovw-box-sentback', 'ovw-box-staffopened']);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^Needs you/);
    expect(headings[1]).toMatch(/October so far/);
    expect(await screen.findByText('612')).toBeInTheDocument();
  });

  test('exactly one orange: the top box’s main action, until a box opens', async () => {
    serve(TEAM_ROUTES);
    mount();
    await screen.findByTestId('ovw-box-approvals');
    let primaries = document.querySelectorAll('.ovw-btn--primary');
    expect(primaries).toHaveLength(1);
    // F2: "Awaiting approval" is the top box and its Review is the orange.
    expect(within(screen.getByTestId('ovw-box-approvals')).getByRole('button', { name: 'Review' })).toHaveClass('ovw-btn--primary');

    // Open "Awaiting approval" in place: the orange moves to its oldest row.
    fireEvent.click(within(screen.getByTestId('ovw-box-approvals')).getAllByRole('button', { expanded: false })[0]);
    const box = screen.getByTestId('ovw-box-approvals');
    const rows = within(box).getAllByTestId('ovw-row');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/Priya Shah/), expect.stringMatching(/Tom Becker/)]);
    primaries = document.querySelectorAll('.ovw-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(within(rows[0]).getByRole('button', { name: 'Approve' })).toHaveClass('ovw-btn--primary');
    expect(within(rows[1]).getByRole('button', { name: 'Approve' })).not.toHaveClass('ovw-btn--primary');
  });

  test('Approve posts to the team route, then re-reads the roster', async () => {
    serve({ ...TEAM_ROUTES, 'POST orgs/org_nw/members/u_p/approve': ok({ approved: true }) });
    mount();
    fireEvent.click(within(await screen.findByTestId('ovw-box-approvals')).getByRole('button', { name: 'Review' }));
    fireEvent.click(within(screen.getAllByTestId('ovw-row')[0]).getByRole('button', { name: 'Approve' }));
    await screen.findByText('Priya Shah can host now.');
    expect(calls()).toContain('POST orgs/org_nw/members/u_p/approve');
    expect(calls().filter((c) => c === 'GET orgs/org_nw/members').length).toBeGreaterThanOrEqual(2);
  });

  // rejects: a box without a way to where the full action lives (ruling 8)
  test('the foot links to the section that owns the action', async () => {
    serve(TEAM_ROUTES);
    const onNavigate = jest.fn();
    mount({ onNavigate });
    fireEvent.click(within(await screen.findByTestId('ovw-box-approvals')).getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Members ›' }));
    expect(onNavigate).toHaveBeenCalledWith('members');
    fireEvent.click(within(screen.getByTestId('ovw-box-staffopened')).getByRole('button', { name: 'Read the log' }));
    expect(onNavigate).toHaveBeenCalledWith('privacy');
  });

  test('“Engage staff opened your content” clears once the log has been read', async () => {
    localStorage.setItem('engage.overview.auditSeen.org_nw', day(-1));
    serve(TEAM_ROUTES);
    mount();
    await screen.findByTestId('ovw-box-approvals');
    expect(screen.queryByTestId('ovw-box-staffopened')).toBeNull();
  });

  test('the tab number: people and stuck only', async () => {
    serve(TEAM_ROUTES);
    const onTotalChange = jest.fn();
    mount({ onTotalChange });
    await waitFor(() => expect(onTotalChange).toHaveBeenLastCalledWith(4)); // 1 invite + 2 approvals + 1 sent back
  });

  test('more than five rows: five shown, and the foot says so', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ userId: `u${i}`, email: `p${i}@x`, joinedByInvite: true, awaitingHostApproval: true, joinedAt: day(-i - 1) }));
    serve({ ...TEAM_ROUTES, 'orgs/org_nw/members': ok({ members: many, invites: [] }) });
    mount();
    fireEvent.click(within(await screen.findByTestId('ovw-box-approvals')).getByRole('button', { name: 'Review' }));
    expect(screen.getAllByTestId('ovw-row')).toHaveLength(5);
    expect(screen.getByText(/Showing 5 of 7/)).toBeInTheDocument();
  });

  // rejects: one failed route blanking the page
  test('a failed read hides that box only, and says so', async () => {
    serve({ ...TEAM_ROUTES, 'orgs/org_nw/members': fail(500) });
    mount();
    await screen.findByTestId('ovw-box-sentback');
    expect(screen.queryByTestId('ovw-box-approvals')).toBeNull();
    expect(await screen.findByRole('status')).toHaveTextContent(/Could not read the members/);
  });
});

describe('a team, as member', () => {
  test('only what is theirs: no approvals, plan, log or monthly numbers', async () => {
    serve(TEAM_ROUTES);
    render(<OverviewPanel scope="team" org={TEAM} role="member" sets={FLAGGED} now={NOW} />);
    await screen.findByTestId('ovw-box-sentback');
    expect(screen.queryByTestId('ovw-box-approvals')).toBeNull();
    expect(screen.queryByTestId('ovw-box-invitesout')).toBeNull();
    const asked = calls().join(' ');
    expect(asked).not.toMatch(/usage|plan-requests|audit|stats/);
    expect(screen.getByText(/Monthly numbers are shown to the team’s owners and admins/)).toBeInTheDocument();
  });
});

describe('a personal space with nothing waiting', () => {
  test('one green line, the numbers, and no orange anywhere', async () => {
    serve({
      'orgs/org_me/usage': ok({ plan: { name: 'Free', metersOverage: false }, allowances: { sessions: 5, sets: 5 }, usage: { sessionsRun: 2, setsCurrent: 3 }, period: { resetsOn: '2026-11-01' } }),
      'orgs/org_me/plan-requests': ok({ requests: [] }),
      'orgs/org_me/stats': ok({ months: [] }),
      invites: ok({ invites: [] }),
      reports: ok({ reports: [] }),
    });
    render(<OverviewPanel scope="personal" org={HOME} role="owner" showInvites now={NOW} />);
    expect(await screen.findByTestId('ovw-none')).toHaveTextContent('Nothing needs you.');
    expect(document.querySelector('.ovw-btn--primary')).toBeNull();
    // Free is capped: sessions and sets are shown against their limit.
    expect(screen.getAllByText('of 5', { exact: false })).toHaveLength(2);
  });

  test('an invitation is the top box and Accept is the orange', async () => {
    serve({
      invites: ok({ invites: [{ token: 't1', orgName: 'Riverside Church', role: 'member', invitedAt: day(-1), expiresAt: day(3) }] }),
      'orgs/org_me/usage': ok({ plan: { name: 'Free', metersOverage: false }, allowances: { sessions: 5 }, usage: { sessionsRun: 4 }, period: {} }),
      reports: ok({ reports: [] }),
    });
    render(<OverviewPanel scope="personal" org={HOME} role="owner" showInvites now={NOW} />);
    const box = await screen.findByTestId('ovw-box-invites');
    expect(within(box).getByRole('button', { name: 'Accept' })).toHaveClass('ovw-btn--primary');
    // 4 of 5 on Free is information, below the invitation.
    expect(await screen.findByTestId('ovw-box-usage')).toHaveAttribute('data-class', 'info');
  });
});

describe('Engage', () => {
  const PLATFORM = {
    'POST admin/users/list': ok({ users: [{ username: 'sam', email: 'sam.ito@gmail.com', groups: ['pending'], enabled: true, created: day(-3), userStatus: 'CONFIRMED' }] }),
    'platform/plan-requests': ok({ requests: [{ orgId: 'org_hs', reqId: 'r1', orgName: 'Harbour School', status: 'requested', fromPlan: 'free', toPlan: 'team', requestedAt: day(-2) }] }),
    'admin/moderation': ok({ items: [{ sk: 'q1', title: 'A set', waitingSince: day(-4) }], count: 1 }),
    'platform/settings/claude-models': ok({ anthropic55: true, connected: false }),
    'platform/observability': ok({ now: { accounts: { count: 212 }, organisations: { teams: 17, personal: 171 }, questionSets: { total: 904, platform: 61, public: 38 } }, months: [{ period: '2026-10', counted: 164 }] }),
  };

  test('the queues waiting on staff, and the platform in numbers', async () => {
    serve(PLATFORM);
    render(<OverviewPanel scope="platform" now={NOW} />);
    await screen.findByTestId('ovw-box-accounts');
    expect(screen.getByRole('heading', { level: 2, name: /Needs Engage/ })).toBeInTheDocument();
    expect([...document.querySelectorAll('[data-testid^="ovw-box-"]')].map((b) => b.dataset.testid))
      .toEqual(['ovw-box-moderation', 'ovw-box-accounts', 'ovw-box-planqueue', 'ovw-box-claude']);
    expect(await screen.findByText('212')).toBeInTheDocument();
    expect(screen.getByText('any status · 1 pending')).toBeInTheDocument();
  });

  test('Decide opens the existing decision dialog (a note is required)', async () => {
    serve(PLATFORM);
    render(<OverviewPanel scope="platform" now={NOW} />);
    fireEvent.click(within(await screen.findByTestId('ovw-box-planqueue')).getByRole('button', { name: 'Decide' }));
    expect(await screen.findByRole('heading', { name: /Decide: Harbour School/ })).toBeInTheDocument();
  });

  test('Reject keeps its confirmation; declining it changes nothing', async () => {
    serve(PLATFORM);
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<OverviewPanel scope="platform" now={NOW} />);
    fireEvent.click(within(await screen.findByTestId('ovw-box-accounts')).getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(confirm).toHaveBeenCalled();
    expect(calls().some((c) => c.startsWith('PUT'))).toBe(false);
    confirm.mockRestore();
  });

  test('Moderation is reviewed where its findings are', async () => {
    serve(PLATFORM);
    const onNavigate = jest.fn();
    render(<OverviewPanel scope="platform" now={NOW} onNavigate={onNavigate} />);
    fireEvent.click(within(await screen.findByTestId('ovw-box-moderation')).getByRole('button', { name: 'Review' }));
    expect(onNavigate).toHaveBeenCalledWith('moderation');
  });
});
