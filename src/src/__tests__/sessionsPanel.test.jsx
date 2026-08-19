/**
 * THE SESSIONS SCREEN — components/SessionsPanel.jsx
 *
 * The tab this replaces had no list. It was one red card: a Single/All radio
 * pair, a free-text "Enter Game ID" box and a Delete button — so to remove one
 * session you had to already know an id the console never showed you, and the
 * only place ids appear is the host screen.
 *
 * `GET /games` has been deployed the whole time (template-clean.yaml:808-825,
 * handler lambda-functions/game/get-games-list.js) and admin has never called
 * it. Every column below is a field that handler actually returns; the mockup's
 * Players and Report columns are NOT here, because that endpoint does not carry
 * them and a column of invented numbers is worse than no column.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SessionsPanel from '../components/SessionsPanel';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

/** Exactly the shape get-games-list.js:21-31 maps. */
const GAMES = [
  {
    gameId: 'ABCD12',
    title: 'Q3 Leadership Offsite',
    gameType: 'call-and-answer',
    questionSetId: 'lessons-learned',
    createdAt: '2026-08-06T18:00:00.000Z',
    started: true,
    lastPlayedAt: '2026-08-06T19:12:00.000Z',
    visibility: 'public',
    hostName: 'george.seib',
  },
  {
    gameId: 'NAKA07',
    title: 'Nakamura Trivia Night',
    gameType: 'trivia',
    questionSetId: 'nakamura-integration',
    createdAt: '2026-08-05T12:00:00.000Z',
    started: true,
    lastPlayedAt: '2026-08-05T12:30:00.000Z',
    visibility: 'public',
    hostName: 'g.seib',
  },
  {
    // Created and abandoned. `gameType` absent — the legacy rows this table has
    // to survive.
    gameId: 'ZZZ999',
    title: 'Untitled engagement',
    gameType: undefined,
    questionSetId: undefined,
    createdAt: undefined,
    started: false,
    lastPlayedAt: undefined,
    visibility: 'public',
    hostName: undefined,
  },
];

const ENV = { id: 'dev', label: 'DEV', detail: 'API api.example.test' };

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function mockApi({ games = GAMES, listStatus = 200, deleteStatus = 200 } = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && /\/games$/.test(url)) {
      return listStatus === 200
        ? jsonResponse(200, { games, count: games.length })
        : jsonResponse(listStatus, { error: 'Failed to get games list: table missing' });
    }
    if (method === 'POST' && url.includes('/admin/clear-game/')) {
      return deleteStatus === 200
        ? jsonResponse(200, { itemsDeleted: 12 })
        : jsonResponse(deleteStatus, { error: 'delete refused' });
    }
    if (method === 'POST' && url.includes('/admin/clear-all-games')) {
      return deleteStatus === 200
        ? jsonResponse(200, { itemsDeleted: 240 })
        : jsonResponse(deleteStatus, { error: 'delete refused' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

async function mount(props = {}, options) {
  mockApi(options);
  const utils = render(<SessionsPanel environment={ENV} {...props} />);
  // Wait for the load to settle rather than for a fixed act() flush: fetch →
  // json() is two awaits deep and one flush resolves only the first.
  await waitFor(() => expect(screen.queryByText(/Loading sessions/i)).toBeNull());
  return utils;
}

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const rowFor = (text) => within(screen.getByRole('table')).getByText(text).closest('tr');

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

/* ------------------------------------------------------------------ the list */

describe('the list that has always been one GET away', () => {
  test('it reads GET /games and renders a row per session', async () => {
    // rejects: the shipped tab, which made no request at all. There is no
    // backend work here and never was — the endpoint is deployed, the host
    // page's switch-game dialog already reads it, and admin simply never asked.
    await mount();
    expect(authFetch.mock.calls[0][0]).toBe('https://api.example.test/dev/games');
    expect(rows()).toHaveLength(3);
    expect(screen.getByText('Q3 Leadership Offsite')).toBeInTheDocument();
  });

  test('the session id is on screen', async () => {
    // THE defect, stated plainly: deleting a session required an id the console
    // never displayed. rejects: a list that shows titles only and leaves the id
    // as something you have to go and find on the host screen.
    await mount();
    expect(within(rowFor('Nakamura Trivia Night')).getByText('NAKA07')).toBeInTheDocument();
  });

  test('a session whose type was never recorded is not printed as Call & Answer', async () => {
    // rejects: routing the cell through normalizeGameType, whose documented job
    // is to always return something — here that turns "we do not know" into a
    // confident wrong label on every legacy row. resolveGameType returns null
    // for exactly this reason.
    await mount();
    const row = rowFor('Untitled engagement');
    expect(within(row).queryByText(/Call & Answer/)).toBeNull();
    expect(within(rowFor('Nakamura Trivia Night')).getByText('Trivia')).toBeInTheDocument();
  });

  test('state distinguishes played from never started, and claims nothing more', async () => {
    // GET /games returns `started` and `lastPlayedAt` and no liveness at all.
    // rejects: a "Live" state — the mockup draws one, and this endpoint cannot
    // support it. Drawing it would be the same class of error as the Provider
    // column that said cognito for everyone.
    await mount();
    expect(within(rowFor('Untitled engagement')).getByText(/never started/i)).toBeInTheDocument();
    expect(within(rowFor('Q3 Leadership Offsite')).getByText(/played/i)).toBeInTheDocument();
    expect(screen.queryByText(/^live$/i)).toBeNull();
  });

  test('a missing date is a dash, and a date that is present is printed as it is', async () => {
    // rejects: `new Date(undefined)` reaching the formatter, which prints
    // "Invalid Date" in a column. It also rejects hiding a wrong-looking date:
    // the 1969 epoch defect (CLAUDE.md, Active Issues) is a real write to find,
    // not a formatter to paper over — OPEN-QUESTIONS #11 needs it visible.
    await mount();
    expect(within(rowFor('Untitled engagement')).getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    // ±1 day: the cell renders in the reader's timezone. Two cells, because
    // Created and Last played are both real fields and both are rendered.
    expect(within(rowFor('Nakamura Trivia Night')).getAllByText(/Aug [45], 2026/)).toHaveLength(2);
  });

  test('typing filters the loaded list without asking the server again', async () => {
    // rejects: a search box wired to a refetch of an endpoint that takes no
    // query — the exact mistake the users screen shipped with.
    await mount();
    const before = authFetch.mock.calls.length;
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'naka' },
    });
    expect(rows()).toHaveLength(1);
    expect(authFetch.mock.calls).toHaveLength(before);
  });

  test('search matches the id, because the id is what an operator has', async () => {
    // rejects: searching titles only. The one thing a person arrives at this
    // screen holding is a game code from a host.
    await mount();
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'ZZZ999' },
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Untitled engagement')).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- empty state */

describe('the two ways this screen can have nothing to show', () => {
  test('an outage is reported as an outage, not as "no sessions yet"', async () => {
    // rejects: an empty state that lies (host §7.9). Three of the shipped
    // console's empty states already do this; this screen does not get a fourth.
    await mount({}, { listStatus: 500 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/table missing/i);
    expect(screen.queryByText(/No sessions yet/i)).toBeNull();
  });

  test('a genuinely empty list explains the likeliest reason a host could not start one', async () => {
    // rejects: a bare "No sessions found". Sessions are created by hosts, not
    // here, and a host can only start from an Active set — a number this console
    // already has in hand.
    await mount({ inactiveSetCount: 12, totalSetCount: 41 }, { games: [] });
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
    expect(screen.getByText(/12 of your 41 sets/i)).toBeInTheDocument();
  });

  test('with no set counts to hand it says nothing about sets', async () => {
    // rejects: printing "0 of your 0 sets are inactive" while the sets list is
    // still loading — an empty state that lies, one level down.
    await mount({}, { games: [] });
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/sets are currently inactive/i)).toBeNull();
  });
});

/* -------------------------------------------------------------- delete a row */

describe('deleting one session, from the row that names it', () => {
  test('it names the session and calls clear-game with the id from that row', async () => {
    // rejects: the free-text "Enter Game ID" box. Also rejects a confirmation
    // that says only "this action cannot be undone" — severity is not
    // information (RATIONALE §8); which session it is, is.
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await mount();
    fireEvent.click(
      within(rowFor('Nakamura Trivia Night')).getByRole('button', { name: /delete/i })
    );
    expect(confirm.mock.calls[0][0]).toMatch(/Nakamura Trivia Night/);
    expect(confirm.mock.calls[0][0]).toMatch(/NAKA07/);

    await waitFor(() =>
      expect(
        authFetch.mock.calls.some(([u]) => u.endsWith('/admin/clear-game/NAKA07'))
      ).toBe(true)
    );
    confirm.mockRestore();
  });

  test('a declined confirmation deletes nothing', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    fireEvent.click(
      within(rowFor('Nakamura Trivia Night')).getByRole('button', { name: /delete/i })
    );
    expect(authFetch.mock.calls.some(([, o = {}]) => o.method === 'POST')).toBe(false);
    confirm.mockRestore();
  });

  test('a deleted session leaves the list', async () => {
    // rejects: firing the request and leaving the row on screen, which is what
    // the old screen did — it printed a status string and never re-read
    // anything, so the only feedback was a sentence.
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await mount();
    fireEvent.click(
      within(rowFor('Nakamura Trivia Night')).getByRole('button', { name: /delete/i })
    );
    await waitFor(() => expect(rows()).toHaveLength(2));
    confirm.mockRestore();
  });

  test('a refused delete is reported and the row stays', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await mount({}, { deleteStatus: 500 });
    fireEvent.click(
      within(rowFor('Nakamura Trivia Night')).getByRole('button', { name: /delete/i })
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/delete refused/i));
    expect(rows()).toHaveLength(3);
    confirm.mockRestore();
  });
});

/* ------------------------------------------------------------- delete it all */

describe('delete all, which states consequence rather than severity', () => {
  const openDialog = async () => {
    fireEvent.click(screen.getByRole('button', { name: /delete all sessions/i }));
    return screen.getByRole('dialog');
  };

  test('the count is on screen before the press, not reported after it', async () => {
    // rejects: "Are you sure you want to delete ALL games? This action cannot be
    // undone!" followed by an itemsDeleted count AFTERWARDS. The number that
    // matters is the one you see first (RATIONALE §8).
    await mount();
    const dialog = await openDialog();
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Delete all 3 sessions?');
  });

  test('it names what survives as well as what goes', async () => {
    // clear-all-games.js:30-34 filters to PK GAME# and the GAMES index, so
    // question sets genuinely are untouched — and that is the fact that stops a
    // person cancelling a delete they actually wanted. rejects: a dialog that
    // lists only losses.
    await mount({ totalSetCount: 41 });
    const dialog = await openDialog();
    expect(within(dialog).getByText(/question sets are not touched/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/41/)).toBeInTheDocument();
  });

  test('it says which environment is about to lose them', async () => {
    // rejects: dropping the env chip from the one dialog that could ruin a
    // Tuesday. The stack, the API base and the archive are near-identical
    // across the three tiers.
    await mount();
    const dialog = await openDialog();
    expect(within(dialog).getByText(/DEV/)).toBeInTheDocument();
  });

  test('the confirm button does nothing until the phrase is typed exactly', async () => {
    // Type-to-confirm is used twice in this whole console by design; this is one
    // of them. rejects: a one-click delete-all, and rejects a fuzzy match that
    // accepts a near-miss and so trains people to type without reading.
    await mount();
    const dialog = await openDialog();
    const confirmButton = within(dialog).getByRole('button', { name: /^delete all 3$/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/type/i), {
      target: { value: 'delete all session' },
    });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/type/i), {
      target: { value: 'delete all sessions' },
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() =>
      expect(authFetch.mock.calls.some(([u]) => u.endsWith('/admin/clear-all-games'))).toBe(true)
    );
  });

  test('cancelling closes the dialog and sends nothing', async () => {
    await mount();
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(authFetch.mock.calls.some(([, o = {}]) => o.method === 'POST')).toBe(false);
  });

  test('with nothing to delete the control is not offered', async () => {
    // rejects: a live "Delete all 0 sessions" button, which is a destructive
    // control advertising work that does not exist.
    await mount({}, { games: [] });
    expect(screen.queryByRole('button', { name: /delete all sessions/i })).toBeNull();
  });
});

/* --------------------------------------------- sort, and the nomatch exits */

describe('the sort control', () => {
  test('sorting reorders the loaded rows without asking the server again', async () => {
    // rejects: the pre-change panel, which had no sort control at all (the
    // combobox lookup below throws there), and rejects a sort wired to a
    // refetch of an endpoint that takes no ordering parameter — the same
    // mistake the search test above pins.
    await mount();
    const before = authFetch.mock.calls.length;
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), {
      target: { value: 'oldest' },
    });
    // Oldest first: the undated legacy row reads as epoch and sorts oldest.
    expect(rows()[0].textContent).toMatch(/Untitled engagement/);
    expect(rows()[2].textContent).toMatch(/Q3 Leadership Offsite/);
    expect(authFetch.mock.calls).toHaveLength(before);
  });

  test('title sort orders A to Z', () => {
    // rejects: a sort select whose options exist but whose comparator was
    // never wired — every option would leave the server's createdAt order.
    return mount().then(() => {
      fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), {
        target: { value: 'title' },
      });
      expect(rows().map((row) => row.textContent)).toEqual([
        expect.stringMatching(/Nakamura Trivia Night/),
        expect.stringMatching(/Q3 Leadership Offsite/),
        expect.stringMatching(/Untitled engagement/),
      ]);
    });
  });
});

describe('nothing matches, which is a different state from "no sessions yet"', () => {
  /*
    search "naka" (NAKA07 only, played) + state "Never started" intersect to
    nothing. Dropping the search leaves the one unstarted session; dropping
    the state leaves the one naka session. Both exits are real here.
  */
  const filterToNothing = async () => {
    await mount();
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'naka' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /state/i }), {
      target: { value: 'unstarted' },
    });
  };

  test('the dim table row is gone; the state has words, counts and exits', async () => {
    // rejects: the shipped `.sp-dimrow` — "No session matches this search." as
    // an italic row inside a table of headers, with no exit and no mention of
    // the state filter it also hides behind (design rule 6: two states need
    // two exits, and an empty state must not lie about why it is empty).
    await filterToNothing();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/No sessions match these 2 filters/i)).toBeInTheDocument();
    expect(screen.getByText(/3 sessions exist/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Search “naka” — 1 session/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /State: Never started — 1 session/ })
    ).toBeInTheDocument();
  });

  test('it never borrows the "no sessions yet" copy, and the bar stays usable', async () => {
    // rejects: collapsing the two empty states into one — the defect the
    // sets and prompts screens each had to un-ship — and rejects unmounting
    // the filter bar with the table, which would strand the operator with no
    // controls to loosen.
    await filterToNothing();
    expect(screen.queryByText(/No sessions yet/i)).toBeNull();
    expect(screen.getByRole('searchbox', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete all sessions/i })).toBeInTheDocument();
  });

  test('clicking one exit clears exactly that filter and leaves the other', async () => {
    // rejects: an exit wired to clearAll, which throws away the search the
    // operator meant to keep and is indistinguishable at a glance.
    await filterToNothing();
    fireEvent.click(screen.getByRole('button', { name: /State: Never started — 1 session/ }));
    expect(screen.getByRole('searchbox', { name: /search/i })).toHaveValue('naka');
    expect(screen.getByRole('combobox', { name: /state/i })).toHaveValue('all');
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Nakamura Trivia Night')).toBeInTheDocument();
  });

  test('an exit that leads to another empty screen is not offered', async () => {
    // rejects: listing every active filter unconditionally (`.filter(() =>
    // true)` in place of the count>0 gate). "zz-nope" matches nothing on its
    // own, so dropping the state filter still shows zero rows — that exit
    // must not be drawn, while dropping the search (leaving Played) is real.
    await mount();
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'zz-nope' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /state/i }), {
      target: { value: 'played' },
    });
    const offered = [...document.querySelectorAll('.sp-drop')].map((b) => b.textContent);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatch(/Search “zz-nope”/);
    expect(offered[0]).toMatch(/2 sessions/);
    expect(offered.join(' ')).not.toMatch(/State:/);
  });

  test('clear all filters brings the whole list back', async () => {
    await filterToNothing();
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    expect(rows()).toHaveLength(3);
  });
});

/* ------------------------------------------------------------- the call site */

describe('the page actually mounts the panel', () => {
  /** Source with every comment removed — a prior test in this repo passed on a comment. */
  const stripComments = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/([^:'"`\\])\/\/.*$/gm, '$1');

  const page = stripComments(
    fs.readFileSync(path.join(__dirname, '..', 'AdminPage.jsx'), 'utf8')
  );

  test('AdminPage imports SessionsPanel and renders it in the sessions section', () => {
    // AdminPage.jsx cannot be mounted in jsdom — it dies on the auth provider,
    // which is why AdminPage.test.jsx has failed 8/8 since it was written. That
    // gap is exactly where an extraction ships as dead code: a new component
    // file nothing renders, with the old markup still on screen.
    expect(page).toMatch(/import SessionsPanel from '\.\/components\/SessionsPanel'/);
    expect(page).toMatch(/<SessionsPanel/);
  });

  test('the free-text game-id box and its radio pair are gone', () => {
    // rejects: leaving the danger card in place beside the new list, which
    // would give the screen two delete paths and keep the one that needs an id
    // it does not show.
    expect(page).not.toMatch(/Enter Game ID/);
    expect(page).not.toMatch(/deleteMode/);
    expect(page).not.toMatch(/Are you sure you want to delete ALL games/);
  });
});
