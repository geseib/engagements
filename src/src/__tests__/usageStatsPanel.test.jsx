/**
 * ACTIVITY — components/UsageStatsPanel.jsx (docs/design/usage-stats A1/A2).
 *
 * What this pins:
 *   - it asks the team route, through authFetch, for six months ending at
 *     the month shown, and again when the month moves;
 *   - "counted" leads; a Build Room's counted is a dash and its questions are
 *     asks; the event line sits under the table, never in "All types";
 *   - an empty month says "Nothing ran in October 2026", never zeros;
 *   - a month before counting shows the plan's number, labelled;
 *   - a team set is named from the console's own list, by id;
 *   - one orange control, and the CSV carries every column.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import UsageStatsPanel, { buildCsv, addMonths, typeRows } from '../components/UsageStatsPanel';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const NOW = new Date('2026-10-11T10:00:00Z');
const counters = (o) => ({
  created: 0, started: 0, counted: 0, questions: 0, participants: 0, decisions: 0, tasks: 0, ...o,
});
const OCT = {
  period: '2026-10',
  recorded: true,
  byType: {
    trivia: counters({ created: 5, started: 4, counted: 4, questions: 52, participants: 88 }),
    build: counters({ created: 1, started: 1, questions: 11, participants: 6, decisions: 7, tasks: 4 }),
  },
  totals: counters({ created: 6, started: 5, counted: 4, questions: 63, participants: 94 }),
  events: counters({ created: 2, started: 1, participants: 46 }),
  gauge: { existing: { trivia: 2, build: 1 }, setsHeld: 12, kept: 3 },
  plan: { sessionsRun: 4, setsPeak: 12 },
};
const empty = (period, plan = null) => ({
  period, recorded: false, byType: {}, totals: counters({}), events: counters({}), gauge: null, plan,
});
const DATA = {
  orgId: 'org_x',
  from: '2026-05',
  to: '2026-10',
  countingSince: '2026-10-02T09:00:00.000Z',
  months: [OCT, empty('2026-09', { sessionsRun: 19, setsPeak: 11 }), empty('2026-08'), empty('2026-07'), empty('2026-06'), empty('2026-05')],
  members: [
    { userId: 'u-ana', displayName: 'Ana Ruiz', role: 'owner', months: { '2026-10': { totals: counters({ created: 3, counted: 2, questions: 30, participants: 50 }), setsHeld: 5 } } },
  ],
  sets: [
    { setId: 'q3retro', versions: [{ version: 2, sessions: 4, questions: 33, copies: 0, downloads: 1 }, { version: 1, sessions: 1, questions: 8, copies: 0, downloads: 0 }], total: { sessions: 5, questions: 41, copies: 0, downloads: 1 } },
  ],
};
const SETS = [{ id: 'q3retro', scope: 'org', name: 'Q3 retro prompts', activeVersion: 2 }];

function serve(...bodies) {
  const queue = [...bodies];
  global.fetch = jest.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next && next.status) return { ok: false, status: next.status, json: async () => next.body || {} };
    return { ok: true, status: 200, json: async () => next };
  });
}

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

const mount = () => render(<UsageStatsPanel orgId="org_x" orgName="Northwind" sets={SETS} now={NOW} />);
const loaded = () => screen.findByRole('region', { name: 'By type' });

describe('what it asks for', () => {
  // rejects: a bare fetch (no token) or the wrong route/range.
  it('asks the team route for the six months ending this month', async () => {
    serve(DATA);
    mount();
    await loaded();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.test/orgs/org_x/stats?from=2026-05&to=2026-10');
  });
  it('moving back a month asks again, ending at that month; next is shut at this month', async () => {
    serve(DATA);
    mount();
    await loaded();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch.mock.calls[1][0]).toBe('https://api.test/orgs/org_x/stats?from=2026-04&to=2026-09');
  });
  it('a refusal shows the server\'s words', async () => {
    serve({ status: 403, body: { error: 'Only an admin of this organisation can do this.' } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin of this organisation can do this.');
  });
});

describe('the month', () => {
  // rejects: leading with created (a rehearsal inflates it), or counting
  // a Build Room before there is a rule.
  it('leads with counted, created and started beside it', async () => {
    serve(DATA);
    mount();
    await loaded();
    expect(screen.getByText('Sessions counted').parentElement).toHaveTextContent('6 created · 5 started');
  });
  it('a Build Room\'s counted is a dash, its questions are asks, its decisions and tasks are named', async () => {
    serve(DATA);
    mount();
    const table = within(await loaded()).getByRole('table');
    const row = within(table).getByText('Build Room').closest('tr');
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
    expect(row.querySelector('[data-l="Asks"]')).toHaveTextContent('11');
    expect(table).toHaveTextContent('Build Room also: 7 decisions, 4 crew tasks.');
  });
  // rejects: the event row summed into All types — its sessions twice.
  it('events are one line under the table, not a type', async () => {
    serve(DATA);
    mount();
    const region = await loaded();
    expect(region).toHaveTextContent('Events: 2 created, 1 run, 46 people registered.');
    const tot = within(region).getByText('All types').closest('tr');
    expect(tot.querySelector('[data-l="Participants"]')).toHaveTextContent('94');
  });
  // rejects: a month where nothing ran drawn as a row of zeros.
  it('an empty month says "Nothing ran in …", not zeros', async () => {
    serve({ ...DATA, months: [empty('2026-10'), ...DATA.months.slice(1)] });
    mount();
    expect(await screen.findByText('Nothing ran in October 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'By type' })).toBeNull();
  });
  it('a month before counting shows the plan\'s number, labelled', async () => {
    serve(DATA);
    mount();
    const months = await screen.findByRole('region', { name: 'Recent months' });
    const sept = within(months).getByText(/September 2026/).closest('tr');
    expect(sept).toHaveTextContent('from your plan');
    expect(sept.querySelector('[data-l="Counted"]')).toHaveTextContent('19');
    expect(sept.querySelector('[data-l="Questions"]')).toHaveTextContent('—');
  });
});

describe('members and sets', () => {
  it('members show their numbers for this team', async () => {
    serve(DATA);
    mount();
    const region = await screen.findByRole('region', { name: 'Members' });
    const ana = within(region).getByText('Ana Ruiz').closest('tr');
    expect(ana).toHaveTextContent('· owner');
    expect(ana.querySelector('[data-l="Questions"]')).toHaveTextContent('30');
  });
  // rejects: printing the set id (or reading a name from the stats rows).
  it('a set is named from the console\'s own list, every version listed, the active one marked', async () => {
    serve(DATA);
    mount();
    const region = await screen.findByRole('region', { name: /your question sets/i });
    expect(region).toHaveTextContent('Q3 retro prompts');
    expect(region).not.toHaveTextContent('q3retro');
    expect(region).toHaveTextContent('2 versions');
    expect(region).toHaveTextContent('v2 (active)');
  });
});

describe('one orange, and the CSV', () => {
  it('Download CSV is the one primary control', async () => {
    serve(DATA);
    const { container } = mount();
    await loaded();
    expect(container.querySelectorAll('.ust-btn--primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
  });
  it('the CSV carries every column the narrow screen folds away, and the sets by name', () => {
    const csv = buildCsv(DATA, '2026-10', { setLabel: () => 'Q3 retro prompts' });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Section,Month,Name,Created,Started,Counted,Questions,Participants,Decisions,Crew tasks,Kept,Sets');
    expect(csv).toContain('Type,2026-10,Trivia,5,4,4,52,88,,,2,');
    expect(csv).toContain('Type,2026-10,Build Room,1,1,,11,6,7,4,1,');
    expect(csv).toContain('Month,2026-09,From the plan,,,19,,,,,,');
    expect(csv).toContain('Q3 retro prompts,2,4,33,0,1');
    expect(csv).not.toContain('q3retro');
  });
  it('months step across a year without a Date', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(typeRows(OCT).map((r) => r.type)).toEqual(['trivia', 'build']);
  });
});
