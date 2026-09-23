/**
 * THE PLATFORM CONSOLE'S OBSERVABILITY PAGE — components/ObservabilityPanel.jsx.
 *
 * How Engage is used, in numbers, for Engage staff. What this pins:
 *
 *   - it asks the one staff route, through authFetch, and nothing else;
 *   - the numbers it is given are the numbers it shows, formatted to read;
 *   - the average says, on screen, exactly what it divides;
 *   - a number the server could not read says so, and never shows as 0;
 *   - an empty history says it is empty rather than drawing zeros;
 *   - a team's own categories appear as one unnamed row, last.
 *
 * Built from docs/design/observability/index.html.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ObservabilityPanel, {
  monthLabel, dateLabel, countLabel, averageLabel, libraryLabel,
} from '../components/ObservabilityPanel';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const FULL = {
  generatedAt: '2026-11-14T10:42:00.000Z',
  now: {
    accounts: { count: 312, capped: false },
    organisations: { teams: 14, personal: 283 },
    questionSets: { platform: 41, public: 6, org: 141, total: 188 },
    storedReports: 23,
  },
  months: [
    {
      period: '2026-11',
      counted: 19,
      recorded: { sessionsCreated: 31, sessionsStarted: 24, roundsServed: 203, sessionsServed: 22, answersStored: 2871, averageRounds: 9.2 },
    },
    {
      period: '2026-09',
      counted: 5,
      recorded: { sessionsCreated: 9, sessionsStarted: 6, roundsServed: 30, sessionsServed: 5, answersStored: 140, averageRounds: 6 },
    },
    { period: '2026-08', counted: 2, recorded: null },
  ],
  categories: [
    { label: 'Leadership', library: 'platform', rounds: 118, answers: 1902 },
    { label: 'Party games', library: 'public', rounds: 22, answers: 318 },
    { label: 'Teams’ own sets', library: 'org', rounds: 338, answers: 4076 },
  ],
  countingSince: '2026-09-23T10:00:00.000Z',
  unavailable: [],
};

function serve(...bodies) {
  const queue = [...bodies];
  global.fetch = jest.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (next && next.status) return { ok: false, status: next.status, json: async () => next.body || {} };
    return { ok: true, status: 200, json: async () => next };
  });
}

const loaded = () => screen.findByRole('table', { name: /by month/i });

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

describe('what it asks for', () => {
  // rejects: a bare fetch (no token, so a 401 in production) or the wrong route.
  it('asks the staff route once, through authFetch', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    await loaded();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.test/platform/observability');
  });

  it('says it is working before the numbers arrive', () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    render(<ObservabilityPanel />);
    expect(screen.getByText(/gathering the numbers/i)).toBeInTheDocument();
  });

  it('Refresh asks again', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  // rejects: a dusk surface that inherits paper from <html>.
  it('declares its own dark theme on a .pobs root', async () => {
    serve(FULL);
    const { container } = render(<ObservabilityPanel />);
    await loaded();
    const root = container.querySelector('.pobs');
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-theme')).toBe('dark');
  });
});

describe('the four numbers that are true right now', () => {
  it('shows each tile with its breakdown', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    await loaded();
    const tiles = screen.getByRole('region', { name: /right now/i });
    const tile = (label) => within(tiles).getByText(label).closest('.pobs-tile');
    expect(tile('Accounts')).toHaveTextContent('312');
    expect(tile('Organisations')).toHaveTextContent('297');
    expect(tile('Organisations')).toHaveTextContent('14 teams · 283 personal spaces');
    expect(tile('Question sets')).toHaveTextContent('188');
    expect(tile('Question sets')).toHaveTextContent('41 Engage · 6 public · 141 teams’ own');
    expect(tile('Stored reports')).toHaveTextContent('23');
  });

  // rejects: a pool too large to page through shown as an exact count.
  it('a capped account count reads as “at least”', async () => {
    serve({ ...FULL, now: { ...FULL.now, accounts: { count: 6000, capped: true } } });
    render(<ObservabilityPanel />);
    await loaded();
    expect(screen.getByText('6,000+')).toBeInTheDocument();
  });

  // rejects: an unreadable source rendered as 0 — "nobody signed up" is a
  // claim, and the server did not make it.
  it('a number the server could not read is shown as missing, with the reason', async () => {
    serve({
      ...FULL,
      now: { ...FULL.now, accounts: null },
      unavailable: [{ part: 'accounts', reason: 'AccessDeniedException: not authorized' }],
    });
    render(<ObservabilityPanel />);
    await loaded();
    const tile = within(screen.getByRole('region', { name: /right now/i })).getByText('Accounts').closest('.pobs-tile');
    expect(tile).toHaveTextContent('—');
    expect(tile).not.toHaveTextContent(/\b0\b/);
    expect(screen.getByRole('status')).toHaveTextContent(/accounts could not be counted/i);
    expect(screen.getByRole('status')).toHaveTextContent(/AccessDeniedException/);
  });
});

describe('by month', () => {
  it('lists each month, newest first, with every column', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    const table = await loaded();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent))
      .toEqual(['November 2026', 'September 2026', 'August 2026']);
    const cells = within(rows[0]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['November 2026', '31', '24', '19', '203', '9.2', '2,871']);
  });

  // rejects: "6" where the column promises a decimal average.
  it('shows the average to one place', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    const table = await loaded();
    const sept = within(table).getByText('September 2026').closest('tr');
    expect(within(sept).getAllByRole('cell')[5]).toHaveTextContent('6.0');
  });

  // rejects: zeros for a month before counting began.
  it('a month from before counting began shows dashes, not zeros', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    const table = await loaded();
    const aug = within(table).getByText('August 2026').closest('tr');
    const cells = within(aug).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['August 2026', '—', '—', '2', '—', '—', '—']);
  });

  it('says when counting began', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    await loaded();
    expect(screen.getAllByText(/counted since/i)[0].closest('p')).toHaveTextContent('Counted since 23 September 2026');
  });

  // rejects: an empty table drawn under a caption that implies history.
  it('an empty history says so', async () => {
    serve({ ...FULL, months: [], categories: [], countingSince: null });
    render(<ObservabilityPanel />);
    expect(await screen.findByText(/nothing has been counted yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no questions have been asked yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('by category', () => {
  it('names Engage’s and public categories, and puts the teams’ bucket last, unnamed', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    await loaded();
    const table = screen.getByRole('table', { name: /by category/i });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([
      ['Leadership', 'Engage', '118', '1,902'],
      ['Party games', 'Public', '22', '318'],
      ['Teams’ own sets', 'Teams', '338', '4,076'],
    ]);
  });

  // rejects: a server that ever sent an org row with a name — the screen
  // prints the one fixed label for that library, whatever the row says.
  it('prints the fixed label for a teams row whatever label arrives', async () => {
    serve({ ...FULL, categories: [{ label: 'Layoffs and Morale', library: 'org', rounds: 1, answers: 1 }] });
    render(<ObservabilityPanel />);
    await loaded();
    expect(screen.queryByText('Layoffs and Morale')).toBeNull();
    expect(screen.getByText('Teams’ own sets')).toBeInTheDocument();
  });
});

describe('what each number means', () => {
  // rejects: an average whose divisor is not stated on the screen.
  it('states what the average divides', async () => {
    serve(FULL);
    render(<ObservabilityPanel />);
    await loaded();
    const defs = screen.getByRole('region', { name: /what each number means/i });
    expect(defs).toHaveTextContent(/Questions ÷ sessions that put at least one question on screen, that month/);
    expect(defs).toHaveTextContent(/Questions a set holds but nobody reached are not counted/);
    expect(defs).toHaveTextContent(/Changing an answer does not count again/);
  });
});

describe('when the server refuses', () => {
  it('shows the server’s reason and no numbers', async () => {
    serve({ status: 403, body: { error: 'This is an Engage staff screen.' } });
    render(<ObservabilityPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This is an Engage staff screen.');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the formatters', () => {
  // rejects: formatting in the viewer's zone — the 1st of a month would read as
  // the previous month for anybody west of Greenwich.
  it('reads months and dates in UTC', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(dateLabel('2026-10-01T00:30:00.000Z')).toBe('1 October 2026');
  });
  it('formats counts and averages', () => {
    expect(countLabel(4076)).toBe('4,076');
    expect(countLabel(null)).toBe('—');
    expect(averageLabel(6)).toBe('6.0');
    expect(averageLabel(null)).toBe('—');
  });
  it('names the libraries', () => {
    expect(libraryLabel('platform')).toBe('Engage');
    expect(libraryLabel('public')).toBe('Public');
    expect(libraryLabel('org')).toBe('Teams');
    expect(libraryLabel('anything else')).toBe('Teams');
  });
});
