/**
 * THE USERS SCREEN — components/UserManagement.jsx
 *
 * Every test below names the implementation change it rejects. Where the answer
 * to "what would this reject?" was "nothing", the test is not here.
 *
 * WHY THIS RENDERS RATHER THAN READING SOURCE. UserManagement talks to the API
 * through `authFetch` — a plain module, not a hook — for the same reason
 * QuestionSetEditor does, so mocking that one module plus `useAuth` is enough to
 * mount the whole screen. Two assertions at the bottom are deliberately source
 * assertions: they are about code that must NOT exist, and a route nothing calls
 * cannot be observed by rendering.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import UserManagement from '../components/UserManagement';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const mockAuth = { admin: true };
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ isAdmin: () => mockAuth.admin }),
}));

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

/**
 * The exact shape lambda-functions/admin/manage-users.js:55-65 returns.
 * `created` (not `createdAt`), `status` is a Cognito GROUP NAME, and
 * `userStatus` is Cognito's confirmation state.
 */
const USERS = [
  {
    username: 'Google_107691503500061507',
    email: 'george.seib@gmail.com',
    name: 'George Seib',
    groups: ['admins'],
    state: 'admins',
    status: 'admins',
    userStatus: 'CONFIRMED',
    enabled: true,
    created: '2026-01-04T09:12:00.000Z',
  },
  {
    username: 'ren',
    email: 'ren.takahashi@example.com',
    name: 'Ren Takahashi',
    groups: ['admins'],
    state: 'admins',
    status: 'admins',
    userStatus: 'CONFIRMED',
    enabled: true,
    created: '2026-02-11T12:00:00.000Z',
  },
  {
    username: 'priya',
    email: 'priya.b@example.com',
    name: 'Priya Balasubramanian',
    groups: ['hosts'],
    state: 'hosts',
    status: 'hosts',
    userStatus: 'CONFIRMED',
    enabled: true,
    created: '2026-03-02T09:12:00.000Z',
  },
  {
    username: 'Facebook_88121',
    email: 'm.lindqvist@example.com',
    name: 'Marcus Lindqvist',
    groups: ['hosts'],
    state: 'hosts',
    status: 'hosts',
    userStatus: 'CONFIRMED',
    enabled: true,
    created: '2026-03-09T09:12:00.000Z',
  },
  {
    username: 'sam',
    email: 'sam.okonkwo@example.com',
    name: 'Sam Okonkwo',
    groups: ['disabled'],
    state: 'disabled',
    status: 'disabled',
    userStatus: 'CONFIRMED',
    enabled: true,
    created: '2026-03-11T09:12:00.000Z',
  },
  {
    username: 'ada',
    email: 'a.okafor@example.com',
    name: 'Adaeze Okafor',
    groups: ['pending'],
    state: 'pending',
    status: 'pending',
    userStatus: 'UNCONFIRMED',
    enabled: true,
    created: daysAgo(6),
  },
  {
    // No name, no email, no group — the account the mockups draw deliberately.
    username: 'd4f8b2e1-9c33-4a7e-b501-6f2a8c1d9e04',
    email: undefined,
    name: '',
    groups: [],
    state: 'pending',
    status: 'pending',
    userStatus: 'CONFIRMED',
    enabled: true,
    created: daysAgo(21),
  },
];

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function mockApi({ users = USERS, listStatus = 200, stateStatus = 200 } = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && url.includes('/admin/users/list')) {
      return listStatus === 200
        ? jsonResponse(200, { users })
        : jsonResponse(listStatus, { error: 'Cognito is unavailable' });
    }
    if (method === 'PUT' && /\/admin\/users\/.+\/state$/.test(url)) {
      return stateStatus === 200
        ? jsonResponse(200, { success: true })
        : jsonResponse(stateStatus, { error: 'nope' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

async function mount(options) {
  mockApi(options);
  const utils = render(<UserManagement />);
  // Wait for the LOAD TO SETTLE, not for a fixed number of microtask flushes:
  // fetch → json() is two awaits deep, and a single act() flush resolves the
  // first only. That is a flaky test, not a slow one.
  await waitFor(() => expect(screen.queryByText(/Loading accounts/i)).toBeNull());
  return utils;
}

/** The one call that changed a user, or undefined. */
const stateCalls = () =>
  authFetch.mock.calls.filter(([url, opts = {}]) => (opts.method || 'GET') === 'PUT');

beforeEach(() => {
  mockAuth.admin = true;
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

/* ------------------------------------------------------------------ the list */

describe('the list is fetched the way every other admin surface fetches', () => {
  test('the request goes through authFetch, at window.API_BASE, with no hand-rolled header', async () => {
    // rejects: UserManagement.jsx:21, which fell back to a hardcoded dev API
    // Gateway id whenever window.API_BASE was unset — so a production console
    // with a missing config would have listed, and edited, DEV's users. Also
    // rejects the hand-rolled `Authorization: Bearer` on all four calls, which
    // is the one thing authFetch exists to own.
    await mount();
    const [url, options] = authFetch.mock.calls[0];
    expect(url).toBe('https://api.example.test/dev/admin/users/list');
    expect(options.method).toBe('POST');
    expect(Object.keys(options.headers || {})).not.toContain('Authorization');
  });

  test('with no API_BASE configured it asks this origin, never another environment', async () => {
    // rejects: any hardcoded execute-api host as a fallback. A relative URL
    // fails visibly; a dev URL fails silently and destructively.
    delete window.API_BASE;
    await mount();
    expect(authFetch.mock.calls[0][0]).toBe('/admin/users/list');
    window.API_BASE = 'https://api.example.test/dev/';
  });

  test('a failed load says so instead of showing an empty list', async () => {
    // rejects: an empty state that lies (host §7.9, kept unchanged by
    // RATIONALE §4) — a Cognito outage rendering as "no users have registered".
    await mount({ listStatus: 500 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cognito is unavailable/i);
    expect(screen.queryByText(/No users have been registered/i)).toBeNull();
  });
});

/* ----------------------------------------------------------------- the queue */

describe('the approval queue, which is a queue and not a filter tab', () => {
  test('everyone pending is in the queue and nobody pending is in the members table', async () => {
    // rejects: leaving approval as the second of four filter tabs. The queue is
    // the only thing in this console that decays if nobody looks at it
    // (RATIONALE §7), so it owns the top of the screen and the members table
    // below it is members only.
    await mount();
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    expect(within(queue).getByText('Adaeze Okafor')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Adaeze Okafor')).toBeNull();
    expect(within(table).getByText('Priya Balasubramanian')).toBeInTheDocument();
  });

  test('the frame stays when nobody is waiting', async () => {
    // rejects: hiding the section when it is empty. A section that disappears
    // when it has nothing in it is a section you stop looking for
    // (17-users-clear.html keeps the frame on purpose).
    await mount({ users: USERS.filter((u) => u.state !== 'pending') });
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    expect(within(queue).getByText(/nobody is waiting/i)).toBeInTheDocument();
  });

  test('the queue names how long the oldest person has waited', async () => {
    // rejects: dropping the wait. "21 days" is the number that makes someone
    // act, and it is derivable from `created` — the field the old table read
    // under the wrong name and therefore never used.
    await mount();
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    // scoped to the header on purpose: the oldest person's own row also says
    // "21 days ago", and the point of this assertion is the header summary that
    // is visible without reading the list.
    expect(within(queue).getByTestId('um-oldest-wait')).toHaveTextContent('21 days');
  });

  test('each waiting person shows their sign-up age and whether their email is confirmed', async () => {
    // rejects: discarding `userStatus`. manage-users.js:62 returns
    // CONFIRMED/UNCONFIRMED and the shipped screen displayed it nowhere, so an
    // account that can never sign in looked identical to one that can.
    await mount();
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    expect(within(queue).getByText(/6 days ago/)).toBeInTheDocument();
    expect(within(queue).getByText(/email not confirmed/i)).toBeInTheDocument();
    expect(within(queue).getAllByText(/email confirmed/i).length).toBeGreaterThan(0);
  });

  test('an account with no name is still identifiable', async () => {
    // rejects: rendering `user.name` straight through, which prints an empty
    // cell with a Reject button beside it and no way to tell who it is.
    await mount();
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    expect(within(queue).getByText(/no name provided/i)).toBeInTheDocument();
    expect(within(queue).getByText('d4f8b2e1-9c33-4a7e-b501-6f2a8c1d9e04')).toBeInTheDocument();
  });

  test('Approve as host is a named verb wired to the route that is actually deployed', async () => {
    // rejects: `approveUser`, which POSTed /admin/users/{id}/approve — a route
    // that does not exist in template-clean.yaml and that manage-users.js:209
    // answers 404 for. Also rejects the shipped treatment, where a pending
    // person showed the same four group buttons as everyone else with the one
    // they were already in disabled, and nothing said which was the approval.
    await mount();
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    const row = within(queue).getByText('Adaeze Okafor').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /approve as host/i }));

    await waitFor(() => expect(stateCalls()).toHaveLength(1));
    const [url, options] = stateCalls()[0];
    expect(url).toBe('https://api.example.test/dev/admin/users/ada/state');
    expect(JSON.parse(options.body)).toEqual({ newState: 'hosts' });
    expect(authFetch.mock.calls.some(([u]) => u.includes('/approve'))).toBe(false);
  });

  test('an approved person leaves the queue and appears among the members', async () => {
    // rejects: a successful state change that does not update the list, which
    // leaves the person in the queue and the nav badge overstating the work.
    await mount();
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    const row = within(queue).getByText('Adaeze Okafor').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /approve as host/i }));

    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Adaeze Okafor')).toBeInTheDocument()
    );
    expect(within(queue).queryByText('Adaeze Okafor')).toBeNull();
  });

  test('Reject states what it actually does and does nothing until confirmed', async () => {
    // rejects: wiring Reject to the permanent account delete. Rejecting a
    // registration has a reversible neighbour (RATIONALE §8) — disabled — and
    // the dialog has to say which one it is rather than shouting that it cannot
    // be undone.
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    const row = within(queue).getByText('Adaeze Okafor').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /reject/i }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/disabled/i);
    expect(stateCalls()).toHaveLength(0);

    confirm.mockReturnValue(true);
    fireEvent.click(within(row).getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(stateCalls()).toHaveLength(1));
    expect(JSON.parse(stateCalls()[0][1].body)).toEqual({ newState: 'disabled' });
    confirm.mockRestore();
  });
});

/* --------------------------------------------------------------- the members */

describe('the members table, and the badge that used to lie about it', () => {
  test('every role filter renders exactly the people its own count claimed', async () => {
    // THE defect. The Enabled badge counted `u.enabled && u.status !== 'pending'`
    // while the filter tested `user.status === 'enabled'` — and `status` is a
    // Cognito GROUP NAME (pending|hosts|admins|disabled), so 'enabled' matched
    // nothing and the tab always rendered empty under a non-zero badge.
    // Disabled had the same shape. rejects: a badge and a filter computed by two
    // different predicates.
    await mount();
    const filters = screen.getByRole('group', { name: /filter members/i });
    for (const [name, expected] of [['Admins', 2], ['Hosts', 2], ['Disabled', 1], ['Active', 4]]) {
      const button = within(filters).getByRole('button', { name: new RegExp(`^${name}`, 'i') });
      expect(button).toHaveTextContent(String(expected));
      fireEvent.click(button);
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(expected);
    }
  });

  test('disabled accounts are out of the default view — noise, per the owner', async () => {
    // rejects: an "All" default that surfaces every rejected account forever.
    // The default tab is Active and is honestly NAMED Active — a tab labelled
    // All that withheld rows would be the badge-that-lies defect again. The
    // Disabled tab (asserted above) is where they live.
    await mount();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    const filters = screen.getByRole('group', { name: /filter members/i });
    expect(within(filters).getByRole('button', { name: /^Active/i }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(within(filters).queryByRole('button', { name: /^All/i })).toBeNull();
  });

  test('Joined shows the date the account was created', async () => {
    // rejects: reading `createdAt` when the lambda returns `created`
    // (manage-users.js:64 vs UserManagement.jsx:538), which printed N/A for
    // every account and made the wait age underivable.
    await mount();
    const row = within(screen.getByRole('table')).getByText('Ren Takahashi').closest('tr');
    // ±1 day: the cell renders in the reader's timezone and the suite must not
    // depend on the machine's.
    expect(within(row).getByText(/Feb 1[01], 2026/)).toBeInTheDocument();
    expect(screen.queryByText('N/A')).toBeNull();
  });

  test('the sign-in provider is read from the account, not printed as cognito for everybody', async () => {
    // rejects: `{user.provider || 'cognito'}` against a payload that never
    // carries `provider` — a column that was the same word on all 24 rows.
    // Cognito names a federated account <Provider>_<sub>, which is the only
    // provider signal this endpoint actually returns.
    await mount();
    const table = screen.getByRole('table');
    expect(within(within(table).getByText('George Seib').closest('tr')).getByText('Google'))
      .toBeInTheDocument();
    expect(within(within(table).getByText('Marcus Lindqvist').closest('tr')).getByText('Facebook'))
      .toBeInTheDocument();
    expect(within(within(table).getByText('Ren Takahashi').closest('tr')).getByText('Cognito'))
      .toBeInTheDocument();
  });

  test('a role change offers only the roles the person is not already in', async () => {
    // rejects: the shipped four-button group with the current one disabled —
    // four controls to express three choices, and no verb on any of them.
    await mount();
    const row = within(screen.getByRole('table')).getByText('Priya Balasubramanian').closest('tr');
    expect(within(row).queryByRole('button', { name: /make host/i })).toBeNull();
    /* "Make Engage admin", not "Make admin". The word carries the distinction
       between Engage staff and an ORG admin, which are unrelated roles granted
       on different screens — see the header of UserManagement.jsx. The regex
       stays loose enough to match either spelling so it is testing the control,
       not the wording. */
    fireEvent.click(within(row).getByRole('button', { name: /make (engage )?admin/i }));

    await waitFor(() => expect(stateCalls()).toHaveLength(1));
    expect(stateCalls()[0][0]).toBe('https://api.example.test/dev/admin/users/priya/state');
    expect(JSON.parse(stateCalls()[0][1].body)).toEqual({ newState: 'admins' });
  });

  test('removing a member names the person, states the consequence, and needs a yes', async () => {
    // rejects: `deleteUser`, which sent DELETE /admin/users/{id} — a route that
    // is not deployed — and rejects a confirmation that states severity
    // ("cannot be undone") instead of consequence (RATIONALE §8).
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    // Sam is the disabled fixture, and disabled rows live behind their own
    // tab now — which is also where a permanent removal actually happens.
    fireEvent.click(within(screen.getByRole('group', { name: /filter members/i }))
      .getByRole('button', { name: /^Disabled/i }));
    const row = within(screen.getByRole('table')).getByText('Sam Okonkwo').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /remove sam okonkwo/i }));

    expect(confirm.mock.calls[0][0]).toMatch(/Sam Okonkwo/);
    expect(confirm.mock.calls[0][0]).toMatch(/register again/i);
    expect(stateCalls()).toHaveLength(0);

    confirm.mockReturnValue(true);
    fireEvent.click(within(row).getByRole('button', { name: /remove sam okonkwo/i }));
    await waitFor(() => expect(stateCalls()).toHaveLength(1));
    expect(JSON.parse(stateCalls()[0][1].body)).toEqual({ newState: 'delete' });
    expect(authFetch.mock.calls.every(([, o = {}]) => o.method !== 'DELETE')).toBe(true);
    confirm.mockRestore();
  });

  test('a failed state change is reported rather than swallowed into the row', async () => {
    // rejects: optimistically rewriting local state before the response, which
    // makes a 500 look exactly like a success until the next reload.
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await mount({ stateStatus: 500 });
    fireEvent.click(within(screen.getByRole('group', { name: /filter members/i }))
      .getByRole('button', { name: /^Disabled/i }));
    const row = within(screen.getByRole('table')).getByText('Sam Okonkwo').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /remove sam okonkwo/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/nope/i));
    expect(within(screen.getByRole('table')).getByText('Sam Okonkwo')).toBeInTheDocument();
    confirm.mockRestore();
  });
});

/* ---------------------------------------------------------- search, honestly */

describe('search and paging, which used to be a round trip to nowhere', () => {
  test('typing filters the loaded list without asking the server again', async () => {
    // rejects: the search FORM. `listUsers` (manage-users.js:16-88) reads no
    // request body at all — limit, nextToken, search and status are discarded —
    // so submitting the form re-fetched the identical 60 rows and filtered them
    // client-side anyway. The round trip was theatre; this makes it local and
    // says so.
    await mount();
    const before = authFetch.mock.calls.length;
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'lindqvist' },
    });
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Marcus Lindqvist')).toBeInTheDocument();
    expect(authFetch.mock.calls).toHaveLength(before);
  });

  test('search reaches the queue too, and says when it has emptied it', async () => {
    // rejects: filtering only the table, which leaves three unrelated people
    // sitting above a search result and reads as if they matched it.
    await mount();
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'lindqvist' },
    });
    const queue = screen.getByRole('region', { name: /waiting for approval/i });
    expect(within(queue).queryByText('Adaeze Okafor')).toBeNull();
    expect(within(queue).getByText(/no one waiting matches/i)).toBeInTheDocument();
  });

  test('the 60-account cap is stated instead of hidden behind a button that cannot fire', async () => {
    // rejects: "Load More Users". `hasMore` is driven by a `nextToken` the
    // lambda never returns, so the control could not render — and if it had, it
    // would have re-requested page one. OPEN-QUESTIONS #10 asks when 60 becomes
    // real; until it is answered the limit belongs on screen.
    await mount();
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
    expect(screen.getByText(/at most 60/i)).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------------- the gates */

describe('what a non-admin sees', () => {
  test('the screen refuses and never asks for the list', async () => {
    // rejects: dropping the client-side gate while manage-users.js still
    // carries `// Skip authorization for now` and performs no in-lambda admin
    // check of its own. This is not a substitute for that check — it is the
    // only one there currently is.
    mockAuth.admin = false;
    mockApi();
    render(<UserManagement />);
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------- the code that is gone */

describe('the three functions that called routes which do not exist', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'UserManagement.jsx'),
    'utf8'
  );

  test('no call is made to a users route the template does not declare', () => {
    // rejects: reinstating updateUserStatus (PUT .../status), approveUser
    // (POST .../approve) or deleteUser (DELETE .../{id}). template-clean.yaml
    // declares exactly two: POST /admin/users/list and
    // PUT /admin/users/{username}/state. A rendered test cannot see a function
    // nothing calls, which is precisely how these three survived.
    expect(source).not.toMatch(/users\/\$\{[^}]+\}\/status/);
    expect(source).not.toMatch(/users\/\$\{[^}]+\}\/approve/);
    expect(source).toMatch(/users\/\$\{[^}]+\}\/state/);
  });

  test('no API host is written into the component', () => {
    // rejects: the `|| 'https://h1jcmja0w1.execute-api...'` fallback in any form.
    expect(source).not.toMatch(/execute-api/);
    expect(source).not.toMatch(/https?:\/\/[a-z0-9]/i);
  });
});
