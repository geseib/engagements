/**
 * The Quick start sheet, opened from the welcome screen.
 *
 * It is redesigned onto the same dusk field as WelcomeScreen (it covers that
 * screen and nothing else), and two defects went with the restyle: the set
 * "cards" were <div>s with an onClick, so no keyboard could reach a single
 * one, and the close control was a bare "×" with no accessible name.
 *
 * NO GEOMETRIC ASSERTIONS — jsdom has no layout engine, so every measured box
 * is zero and every such assertion passes unconditionally.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import QuickstartMenu from '../components/QuickstartMenu';

jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(),
}));
const { authFetch } = require('../auth/authFetch');

const SETS = [
  {
    id: 'set-tech',
    name: 'Tech Trends',
    description: 'Where the industry is heading',
    engagementType: 'call-and-answer',
    totalQuestions: 12,
    categoryCount: 3,
    quickstart: true,
    active: true,
  },
];

// Routed by URL rather than a single canned reply: the sheet now makes TWO
// authFetch calls with different shapes (the set list, then the create), and a
// blanket mockResolvedValue would hand the create an object with no `ok`,
// sending it down the error branch while looking like a fixture detail.
beforeEach(() => {
  jest.clearAllMocks();
  authFetch.mockImplementation(async (url) => {
    if (String(url).endsWith('admin/question-sets')) {
      return { ok: true, json: async () => ({ questionSets: SETS }) };
    }
    return { ok: true, json: async () => ({ gameId: '4821' }) };
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
});

const renderMenu = (props = {}) => {
  const onGameCreated = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <QuickstartMenu onGameCreated={onGameCreated} onClose={onClose} {...props} />
  );
  return { ...utils, onGameCreated, onClose };
};

test('a set is a real button, not a div nobody can tab to', async () => {
  // rejects: the shipped state — `<div className="quickstart-set-card"
  // onClick=…>`, which is unreachable by keyboard and announces as nothing.
  // getByRole('button') matches no div, so reverting fails this outright.
  renderMenu();
  await waitFor(() => expect(screen.getByRole('button', { name: /Tech Trends/ })).toBeInTheDocument());
});

test('pressing a set still creates and starts the game', async () => {
  // rejects: the onClick being lost in the swap from <div> to <button> — the
  // element changed, so the handler is exactly the thing that can go missing
  // while the screen still looks right.
  const { onGameCreated, onClose } = renderMenu();
  const card = await screen.findByRole('button', { name: /Tech Trends/ });
  fireEvent.click(card);

  await waitFor(() => expect(onGameCreated).toHaveBeenCalledTimes(1));
  expect(onGameCreated).toHaveBeenCalledWith(
    expect.objectContaining({ gameId: '4821', questionSetId: 'set-tech' })
  );
  // create, then start — BOTH authenticated now.
  //
  // `/start` used to be asserted against the bare `global.fetch` mock, because
  // POST /games/{id}/start was a public route. It is not any more: an
  // unauthenticated start let anyone holding the four-digit join code open
  // somebody else's session. The route and this call site moved together —
  // see tests/session-control-routes-authorization.js, which fails if either
  // half is reverted alone.
  const authUrls = authFetch.mock.calls.map(([url]) => String(url));
  expect(authUrls.some((u) => u.endsWith('games'))).toBe(true);
  expect(authUrls.some((u) => u.endsWith('games/4821/start'))).toBe(true);
  expect(onClose).toHaveBeenCalled();
});

test('the create call carries a token', async () => {
  // rejects: this call site reverting to a bare `fetch`. `POST /games` is
  // public today and about to stop being — anyone can create unlimited
  // sessions in the environment — and buildspec-dev.yml:49-58 deploys the API
  // BEFORE the frontend, with cached bundles outliving the build. So the token
  // has to be here first; a route that starts demanding one before its callers
  // send one 401s quick start for everyone still holding the old JS, and the
  // breakage surfaces as a dead button, not as a build error.
  //
  // A token is always available: QuickstartMenu renders only from GameHostPage
  // (GameHostPage.jsx:3118), which sits behind ProtectedRoute (App.jsx:176).
  renderMenu();
  const card = await screen.findByRole('button', { name: /Tech Trends/ });
  fireEvent.click(card);

  await waitFor(() =>
    expect(authFetch.mock.calls.some(([url]) => String(url).endsWith('games'))).toBe(true));

  const barePost = global.fetch.mock.calls.find(
    ([url, opts]) => String(url).endsWith('games') && opts?.method === 'POST'
  );
  expect(barePost).toBeUndefined();
});

test('the close control has a name a screen reader can read', async () => {
  // rejects: the bare "×" glyph, whose accessible name was the multiplication
  // sign and nothing else.
  const { onClose } = renderMenu();
  const close = await screen.findByRole('button', { name: /close/i });
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Escape closes it', async () => {
  // rejects: an overlay with no keyboard exit. Clicking the scrim already
  // worked and is the mouse path; Escape was the missing keyboard path, and
  // without it a keyboard user who opened this had no way back at all.
  const { onClose } = renderMenu();
  await screen.findByRole('button', { name: /Tech Trends/ });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

/* ------------------------------------- a quickstart set the server can't read */

describe('a quickstart set whose content could not be decrypted', () => {
  /*
    The sheet reads the SAME admin list as the console (`admin/question-sets`),
    so it receives the same degraded row: encrypted fields nulled,
    `decryptFailed: true`. See utils/unreadableSet.js.

    Quick start is the surface where an unreadable set costs the most. There is
    no confirmation step and no picker to back out of — one press creates the
    session AND starts it, so the first thing anybody learns about the set being
    unreadable would be a room already looking at it.
  */
  const UNREADABLE = {
    id: 'q3retro',
    name: null,
    description: null,
    engagementType: 'call-and-answer',
    totalQuestions: 42,
    categoryCount: 6,
    quickstart: true,
    active: true,
    decryptFailed: true,
  };

  beforeEach(() => {
    authFetch.mockImplementation(async (url) => {
      if (String(url).endsWith('admin/question-sets')) {
        return { ok: true, json: async () => ({ questionSets: [...SETS, UNREADABLE] }) };
      }
      return { ok: true, json: async () => ({ gameId: '4821' }) };
    });
  });

  // rejects: `<h4>{set.name}</h4>` rendered straight through. A nulled name
  // leaves a card whose heading is empty and whose accessible name is built
  // from the leftovers — "Ready to play 42 questions 6 categories" — which
  // reads as an invitation.
  test('the card names the set by the field that was never encrypted', async () => {
    renderMenu();
    expect(await screen.findByRole('button', { name: /q3retro/ })).toBeInTheDocument();
  });

  // rejects: leaving it pressable. One press here creates and starts a session,
  // so there is no later step at which the failure could be caught.
  test('and it cannot be started, because there is no step after this one', async () => {
    renderMenu();
    expect(await screen.findByRole('button', { name: /q3retro/ })).toBeDisabled();
  });

  // rejects: "Ready to play" — the description slot's default — surviving on a
  // set that is not.
  test('it does not claim to be ready to play', async () => {
    renderMenu();
    const card = await screen.findByRole('button', { name: /q3retro/ });
    expect(card.textContent).not.toMatch(/ready to play/i);
    expect(card.textContent).toMatch(/decrypt/i);
  });
});

describe('a plan limit lands in the sheet, not in a browser alert', () => {
  // 22-plan-limit-notice.html: Quickstart said alert(`Failed to create
  // quickstart game: …`) — the server's sentence and nothing to click.
  test('a 402 shows the notice in place, starts nothing, and keeps the sheet open', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    authFetch.mockImplementation(async (url) => {
      if (String(url).endsWith('admin/question-sets')) {
        return { ok: true, json: async () => ({ questionSets: SETS }) };
      }
      return {
        ok: false,
        status: 402,
        json: async () => ({
          code: 'upgrade_required',
          limit: { kind: 'sessions', used: 5, included: 5 },
          resolve: { role: 'member', org: { name: 'Northwind', type: 'team' }, contacts: [{ name: 'Dana Whitfield', email: 'dana@x.example', role: 'owner' }], resetsOn: '2026-10-01' },
        }),
      };
    });
    const { onGameCreated, onClose } = renderMenu();
    fireEvent.click(await screen.findByRole('button', { name: /Tech Trends/ }));

    const box = await screen.findByTestId('plan-limit-notice');
    // rejects: the alert() coming back for the one refusal that has a way out
    expect(alertSpy).not.toHaveBeenCalled();
    expect(box).toHaveTextContent('Northwind has used the 5 sessions included this month. Nothing was created.');
    expect(box).toHaveTextContent('Dana Whitfield');
    // rejects: calling /start on a session that was never created
    expect(authFetch.mock.calls.some(([u]) => String(u).endsWith('/start'))).toBe(false);
    expect(onGameCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

/* WHERE THE ROOM WATCHES, AND THE WINDOW OPENING WITH THE SESSION (owner, 18
   Oct 2026: Quick start "doesnt let you know what screen mode its in or allow
   you to pick. if its auto to two screen its not opening the second browser
   window"). rejects: a mode chosen in another visit applied unseen; no way to
   change it here; on two screens, no room's window; the window opened after
   an await (a browser blocks that popup); a window left open, blank, when the
   session failed. */
describe('screen mode in Quick start', () => {
  let popup;
  beforeEach(() => {
    popup = { location: { href: 'about:blank' }, close: jest.fn(), opener: 'x' };
    window.open = jest.fn(() => popup);
  });

  test('shows the current mode and changes it with one press', async () => {
    const onRoomScreen = jest.fn();
    renderMenu({ roomScreen: 'two', onRoomScreen });
    const two = await screen.findByRole('button', { name: 'Two screens' });
    expect(two).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'One screen' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'One screen' }));
    expect(onRoomScreen).toHaveBeenCalledWith('classic');
  });

  test('not chosen yet: says so, neither pressed', async () => {
    renderMenu({ roomScreen: null, onRoomScreen: jest.fn() });
    await screen.findByRole('button', { name: 'Two screens' });
    expect(screen.getByText(/Not chosen yet/)).toBeInTheDocument();
  });

  test('two screens: the room\'s window opens inside the press, then goes to the session', async () => {
    const order = [];
    window.open = jest.fn(() => { order.push('open'); return popup; });
    const realImpl = authFetch.getMockImplementation();
    authFetch.mockImplementation(async (url, opts) => { if (opts && opts.method === 'POST') order.push(`post ${String(url).replace(/.*games/, 'games')}`); return realImpl(url, opts); });
    const { onGameCreated } = renderMenu({ roomScreen: 'two', onRoomScreen: jest.fn() });
    fireEvent.click(await screen.findByRole('button', { name: /Tech Trends/ }));
    await waitFor(() => expect(onGameCreated).toHaveBeenCalled());
    expect(order[0]).toBe('open');
    expect(window.open).toHaveBeenCalledWith('about:blank', 'engage-room', expect.stringContaining('popup'));
    expect(popup.location.href).toBe('/present?gameId=4821&placed=1');
  });

  test('one screen: no window', async () => {
    const { onGameCreated } = renderMenu({ roomScreen: 'classic', onRoomScreen: jest.fn() });
    fireEvent.click(await screen.findByRole('button', { name: /Tech Trends/ }));
    await waitFor(() => expect(onGameCreated).toHaveBeenCalled());
    expect(window.open).not.toHaveBeenCalled();
  });

  test('the session fails to start: the blank window closes again', async () => {
    window.alert = jest.fn();
    authFetch.mockImplementation(async (url) => {
      if (String(url).endsWith('admin/question-sets')) return { ok: true, json: async () => ({ questionSets: SETS }) };
      if (String(url).endsWith('/start')) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ gameId: '4821' }) };
    });
    renderMenu({ roomScreen: 'two', onRoomScreen: jest.fn() });
    fireEvent.click(await screen.findByRole('button', { name: /Tech Trends/ }));
    await waitFor(() => expect(popup.close).toHaveBeenCalled());
  });

  test('a blocked popup says where to open the window instead', async () => {
    window.open = jest.fn(() => null);
    renderMenu({ roomScreen: 'two', onRoomScreen: jest.fn() });
    fireEvent.click(await screen.findByRole('button', { name: /Tech Trends/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked the room's window/);
  });
});

/* SEARCH (owner, 23 Oct 2026: "search, filter by mine/team/public/engage or by
   date or by tag" as libraries grow). Quick start had no way to find a set
   but paging each format's carousel four at a time. The matcher is the set
   chooser's (config/setFinder.js SET_SEARCH_FIELDS), so these test what the
   sheet does with it, not the matching itself. */
describe('searching Quick start', () => {
  const set = (id, name, engagementType, extra = {}) => ({
    id, name, engagementType, description: '', totalQuestions: 10, categoryCount: 2, quickstart: true, active: true, ...extra,
  });
  // Six Call & Answer sets (two pages of four) and two Trivia sets.
  const LIBRARY = [
    set('ca1', 'Strategy offsite', 'call-and-answer'),
    set('ca2', 'Team retro', 'call-and-answer'),
    set('ca3', 'Budget planning', 'call-and-answer'),
    set('ca4', 'Hiring loop', 'call-and-answer'),
    set('ca5', 'Roadmap review', 'call-and-answer', { tags: ['planning'] }),
    set('ca6', 'Customer voice', 'call-and-answer'),
    set('tr1', 'Space trivia', 'trivia'),
    set('tr2', 'Planning trivia', 'trivia'),
  ];

  beforeEach(() => {
    authFetch.mockImplementation(async (url) => {
      if (String(url).endsWith('admin/question-sets')) return { ok: true, json: async () => ({ questionSets: LIBRARY }) };
      return { ok: true, json: async () => ({ gameId: '4821' }) };
    });
  });

  const box = () => screen.findByRole('searchbox', { name: /Search 8 quick start sets/ });
  const heading = (label) => screen.getByRole('heading', { level: 3, name: new RegExp(label) });

  // rejects: the search narrowing one carousel and not the other, or a tag
  // match being missed (the set chooser's fields, not the name alone).
  test('narrows every format, by name or tag, and the counts read "N of M"', async () => {
    renderMenu();
    fireEvent.change(await box(), { target: { value: 'planning' } });
    expect(screen.getByRole('button', { name: /Budget planning/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Roadmap review/ })).toBeInTheDocument(); // by its tag
    expect(screen.getByRole('button', { name: /Planning trivia/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Strategy offsite/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Space trivia/ })).toBeNull();
    expect(heading('Call & Answer')).toHaveTextContent('(2 of 6)');
    expect(heading('Trivia')).toHaveTextContent('(1 of 2)');
  });

  // rejects: a format whose sets all fail the search still drawing its header
  // and an empty carousel.
  test('a format with no match drops out', async () => {
    renderMenu();
    fireEvent.change(await box(), { target: { value: 'space' } });
    expect(screen.getByRole('button', { name: /Space trivia/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: /Call & Answer/ })).toBeNull();
  });

  // rejects: an empty sheet with no reason given and no way back but deleting
  // the words; and focus left on the button that unmounted.
  test('no match says so, and Clear the search brings every set back', async () => {
    renderMenu();
    const input = await box();
    fireEvent.change(input, { target: { value: 'zebra' } });
    expect(screen.getByRole('status')).toHaveTextContent('No quick start set matches “zebra”.');
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(heading('Call & Answer')).toHaveTextContent('(6 available)');
    expect(heading('Trivia')).toHaveTextContent('(2 available)');
  });

  // rejects: the carousel keeping page 2 after a search, which can leave it
  // past the end of its matches and showing nothing.
  test('searching starts each carousel again at its first page', async () => {
    renderMenu();
    const input = await box();
    fireEvent.click(screen.getByRole('button', { name: /More Call & Answer sets/ }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Customer voice/ })).toBeInTheDocument();
    // Five Call & Answer sets carry an "r": still two pages, back on the first.
    fireEvent.change(input, { target: { value: 'r' } });
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Strategy offsite/ })).toBeInTheDocument();
  });

  // rejects: Esc in the box closing the whole sheet when it should only empty
  // the box; and an empty box swallowing Esc so the sheet never closes.
  test('Esc clears the search first, then closes', async () => {
    const { onClose } = renderMenu();
    const input = await box();
    fireEvent.change(input, { target: { value: 'space' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Strategy offsite/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // rejects: a search box over an empty library, where there is nothing to find.
  test('an empty library keeps its own message and shows no search', async () => {
    authFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ questionSets: [] }) }));
    renderMenu();
    expect(await screen.findByText('No Quickstart Sets Available')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
