/**
 * USAGE STATS FOR ENGAGE STAFF — components/StaffStatsDrill.jsx, as mounted by
 * ObservabilityPanel.jsx (docs/design/usage-stats B1–B4).
 *
 * What this pins:
 *   - Observability shows the platform by type and every team, named from
 *     GET /platform/orgs (the observability route names nobody);
 *   - opening a team asks GET /platform/stats?org=…, says the visit is
 *     logged, and shows a team set as "Team set · <ref>", never by name;
 *   - a member opens their account; a team set opens by its ref;
 *   - each place has one orange control;
 *   - the trail goes back.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ObservabilityPanel from '../components/ObservabilityPanel';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const c = (o) => ({ created: 0, started: 0, counted: 0, questions: 0, participants: 0, decisions: 0, tasks: 0, ...o });
const THIS = new Date().toISOString().slice(0, 7);
const NW = 'org_NorthwindAAAAAAAAAAAAA';

const OBS = {
  generatedAt: '2026-10-11T10:00:00.000Z',
  now: { accounts: { count: 3, capped: false }, organisations: { teams: 1, personal: 2 }, questionSets: { platform: 1, public: 0, org: 2, total: 3 }, storedReports: 0 },
  months: [],
  categories: [],
  countingSince: null,
  unavailable: [],
  stats: {
    month: THIS,
    recorded: true,
    byType: { trivia: c({ created: 190, counted: 131, questions: 1861, participants: 3315 }) },
    totals: c({ created: 190, counted: 131, questions: 1861, participants: 3315 }),
    events: c({ started: 17, participants: 1120 }),
    gauge: { existing: { trivia: 82 }, setsHeld: 31, kept: 82, teams: 61 },
    teams: [{ orgId: NW, type: 'team', totals: c({ counted: 14, questions: 165, participants: 312 }), kept: 9, setsHeld: 12, sets: 12 }],
    noTeam: c({ counted: 3, questions: 28, participants: 41, created: 3 }),
  },
};
const ORGS = { orgs: [{ orgId: NW, name: 'Northwind' }] };
const TEAM = {
  org: { orgId: NW, name: 'Northwind', plan: 'team', createdAt: '2026-08-02T00:00:00.000Z' },
  from: '2026-05',
  to: THIS,
  countingSince: '2026-10-02T09:00:00.000Z',
  months: [{ period: THIS, recorded: true, byType: { trivia: c({ created: 5, counted: 4, questions: 52 }) }, totals: c({ created: 5, counted: 4, questions: 52 }), events: c({}), gauge: null, plan: null }],
  members: [{ userId: 'u-ben', displayName: 'Ben Okafor', role: 'admin', months: { [THIS]: { totals: c({ counted: 5 }), setsHeld: 4 } } }],
  sets: [{ ref: 'a1b2c3d4', versions: [{ version: 3, sessions: 7, questions: 61, copies: 0, downloads: 2 }], total: { sessions: 7, questions: 61, copies: 0, downloads: 2 } }],
};
const ACCOUNT = {
  account: { userId: 'u-ben', displayName: 'Ben Okafor', email: 'ben@nw.example' },
  teams: [{ orgId: NW, name: 'Northwind' }],
  from: '2026-05',
  to: THIS,
  months: [{ period: THIS, teams: [{ orgId: NW, byType: { trivia: c({ created: 2, counted: 2, questions: 29, participants: 41 }) }, totals: c({}), events: c({}), gauge: { existing: { trivia: 1 }, setsHeld: 4, kept: 1 } }] }],
};
const SET = { set: { scope: 'org', orgId: NW, ref: 'a1b2c3d4', name: '', engagementType: '', activeVersion: null, versions: TEAM.sets[0].versions, total: { ...TEAM.sets[0].total, lastAt: null } }, org: { orgId: NW, name: 'Northwind' } };

function route() {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    let body = OBS;
    if (u.includes('platform/orgs')) body = ORGS;
    else if (u.includes('platform/stats?org=')) body = TEAM;
    else if (u.includes('platform/stats?user=')) body = ACCOUNT;
    else if (u.includes('platform/stats?set=')) body = SET;
    return { ok: true, status: 200, json: async () => body };
  });
}
const calls = () => global.fetch.mock.calls.map((x) => String(x[0]));

beforeEach(() => { window.API_BASE = 'https://api.test/'; route(); });

test('Observability shows the platform by type and the teams, named from the orgs list', async () => {
  render(<ObservabilityPanel />);
  const byType = await screen.findByRole('region', { name: 'Platform by type' });
  expect(within(byType).getByText('Trivia').closest('tr').querySelector('[data-l="Counted"]')).toHaveTextContent('131');
  expect(await screen.findByRole('button', { name: 'Northwind' })).toBeInTheDocument();
  expect(screen.getByText('No team')).toBeInTheDocument();
  expect(calls()).toContain('https://api.test/platform/orgs');
  // One orange on the overview.
  expect(document.querySelectorAll('.ust-btn--primary')).toHaveLength(1);
});

test('opening a team asks the staff route, says it is logged, and names no team set', async () => {
  render(<ObservabilityPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Northwind' }));
  expect(await screen.findByText(/This visit is recorded in Northwind’s audit log/)).toBeInTheDocument();
  expect(calls().some((u) => u.startsWith(`https://api.test/platform/stats?org=${NW}&from=`))).toBe(true);
  expect(screen.getByRole('button', { name: 'Team set · a1b2c3d4' })).toBeInTheDocument();
  expect(document.querySelectorAll('.ust-btn--primary')).toHaveLength(1);
  // rejects: the crumb going nowhere.
  fireEvent.click(screen.getByRole('button', { name: 'Observability' }));
  expect(await screen.findByRole('region', { name: 'Platform by type' })).toBeInTheDocument();
});

test('a member opens their account, by team and type', async () => {
  render(<ObservabilityPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Northwind' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ben Okafor' }));
  const table = await screen.findByRole('region', { name: 'By team and type' });
  expect(within(table).getByText('Northwind · Trivia')).toBeInTheDocument();
  expect(calls().some((u) => u.includes('platform/stats?user=u-ben'))).toBe(true);
  expect(screen.getByText(/recorded in the audit log/)).toBeInTheDocument();
  // The trail goes back one step.
  fireEvent.click(screen.getByRole('button', { name: 'Northwind' }));
  expect(await screen.findByRole('region', { name: 'Members' })).toBeInTheDocument();
});

test('a team set opens by its ref, every version listed', async () => {
  render(<ObservabilityPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Northwind' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Team set · a1b2c3d4' }));
  const versions = await screen.findByRole('region', { name: 'By version, all time' });
  expect(within(versions).getByText('v3')).toBeInTheDocument();
  expect(calls().some((u) => u.includes(`platform/stats?set=${encodeURIComponent(`org:${NW}:a1b2c3d4`)}`))).toBe(true);
  expect(document.querySelectorAll('.ust-btn--primary')).toHaveLength(1);
});
