/**
 * THE CONSOLE REMEMBERS WHICH SECTION YOU ARE IN — the mounted half.
 *
 * `config/adminSection.js` is four pure string functions and has its own suite.
 * This one exists because a correct pair of string functions that nothing calls
 * is a failure mode this repo has shipped more than once: the preflight rule in
 * `e8c167d1` was green in its module and unreachable from the screen for a
 * fortnight, and `roundsFrom` was proved against a fixture invented from the
 * client rather than copied from the server. So these drive the real component
 * through the real History API.
 *
 * ── `setupTests.js` DOES NOT MOCK `window.location`, THOUGH IT TRIES ────────
 *
 * Line 37 is `delete window.location`, and it does nothing: `location` is a
 * non-configurable property of `window`, so the delete fails silently in
 * sloppy mode and the assignment on line 38 goes through the REAL Location
 * setter — which is what emits the "Not implemented: navigation" noise every
 * suite in this repo prints on startup.
 *
 * The consequence is worth stating because a test written against the belief
 * would be wrong in both directions: `window.location` here is jsdom's genuine
 * Location, `history.pushState` genuinely updates `location.search`, and
 * `history.back()` genuinely fires `popstate`. So nothing below simulates the
 * browser — arriving, navigating and going Back are all done with the real API,
 * and the spies only OBSERVE.
 *
 * The one thing still asserted directly is the URL STRING handed to pushState.
 * Reading it back off `location.search` afterwards would pass just as happily
 * for `/admin?section=users` as for `/somewhere-else?section=users`, because
 * only the query half is ever read back.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'admin', groups: ['admins', 'hosts'], attributes: { email: 'admin@example.com', name: 'Dana Whitfield' } },
    signOut: jest.fn(),
    // A FUNCTION, because that is what AuthContext exports (AuthContext.jsx:412)
    // and what UserManagement calls (`const canAdminister = isAdmin()`). The
    // `isAdmin: true` that AdminPage.test.jsx uses only survives because that
    // suite never opens the Users section — mount it and the whole console
    // unmounts on `isAdmin is not a function`.
    isAdmin: () => true,
  }),
  AuthProvider: ({ children }) => children,
}));

// The active-organisation accessors live beside `authFetch` because the header
// they drive is sent from there. A mock that stubs only `authFetch` leaves
// `getActiveOrgId` undefined and AdminPage dies on its first render — which is
// what happened, and reads as a component bug rather than a mock gap.
/*
  THE PLATFORM MODE, because Accounts is a PLATFORM section and this suite is
  about reaching it by URL.

  It used to be reachable from anywhere: the platform links were stacked onto
  whatever organisation you were standing in. That was replaced by an exclusive
  mode (config/consoleSections.js) after the owner asked to be able to tell
  "acting as Engage" from "acting as an org admin", so an account inside an
  organisation no longer has an Accounts entry at all — and every assertion here
  started failing with "Received: Question sets", which is the fallback doing
  its job rather than the deep link being broken.
*/
const PLATFORM_MODE = '~platform';
let mockActiveOrg = PLATFORM_MODE;
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
  getActiveOrgId: () => mockActiveOrg,
  setActiveOrgId: (id) => { mockActiveOrg = id || ''; },
}));

import AdminPage from '../AdminPage';

/*
  THE NAV IS ASYNCHRONOUS NOW. It is computed from the caller's organisations
  (config/consoleSections.js), and those arrive from `GET /orgs` — the same
  request that provisions a personal one. So a nav entry must be AWAITED:
  grabbing it synchronously catches the first paint, where only the sections
  that need no organisation exist yet.
*/

/** The h1 the shell renders for whichever section is open. */
const openSection = () => screen.getByRole('heading', { level: 1 }).textContent;

/** The URL string handed to a history spy on its most recent call. */
const lastUrl = (spy) => (spy.mock.calls.length ? spy.mock.calls[spy.mock.calls.length - 1][2] : null);

let pushState;
let replaceState;

beforeEach(() => {
  localStorage.clear();
  // The real API. `jest.spyOn` calls through unless told otherwise, so the URL
  // actually changes and these only watch it happen.
  window.history.pushState({}, '', '/admin');
  pushState = jest.spyOn(window.history, 'pushState');
  replaceState = jest.spyOn(window.history, 'replaceState');
  global.fetch = jest.fn(async (url) => {
      // AdminPage now asks for the caller's organisations on mount — that one
      // request also PROVISIONS a personal org, so it is what gives a host
      // somewhere to put their work. Without it here, `sectionsFor` sees no
      // active org and the console legitimately renders no sections at all,
      // which is not what this file is testing.
      if (String(url).includes('/orgs')) {
        return {
          ok: true, status: 200, text: async () => '{}',
          json: async () => ({ orgs: [{
            orgId: 'org_nw', name: 'Northwind Learning', role: 'admin',
            type: 'team', plan: 'team',
          }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ questionSets: [], sets: [], games: [], prompts: [], users: [] }),
        text: async () => '{}',
      };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Arrive at a URL the way a paste or a reload does, before anything mounts. */
function arriveAt(url) {
  pushState.mockRestore();
  window.history.pushState({}, '', url);
  pushState = jest.spyOn(window.history, 'pushState');
}

/*
  THE SECTION IS STILL `users`; ITS LABEL IS NOW "Accounts".
  
  Managing Cognito accounts is a PLATFORM job — it sits under the "Engage"
  heading beside Organisations and Moderation, not inside a customer's team —
  and "Users" beside "Members" in the same console would be two words for two
  genuinely different things, one of which is a person in your team and one of
  which is an account in the whole system. The id is unchanged, so every
  `?section=users` bookmark still works, which is what this file is really about.
*/
describe('arriving at a URL opens the section it names', () => {
  // rejects: THE SHIPPED BEHAVIOUR — `useState('questionsets')`, which puts
  //          every reload and every pasted link on Question sets no matter what
  //          the address bar says.
  test('?section=users opens Users', async () => {
    arriveAt('/admin?section=users');
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Accounts'));
  });

  test('?section=archive opens Archive', async () => {
    arriveAt('/admin?section=archive');
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Archive'));
  });

  test('a bare /admin opens the landing section', async () => {
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Question sets'));
  });

  // rejects: rendering an empty work area for a section id that does not exist.
  //          The value is whatever was last in somebody's address bar, and a
  //          console showing nothing reads as broken long before anyone thinks
  //          to check the URL.
  test('an unrecognised section falls back rather than blanking', async () => {
    arriveAt('/admin?section=aiprompts');
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Question sets'));
  });
});

describe('moving between sections writes the URL', () => {
  // rejects: navigation that changes the screen and not the address bar, which
  //          leaves Back as "leave the console" — the shipped behaviour.
  test('pressing a nav entry pushes that section', async () => {
    render(<AdminPage />);
    await screen.findByRole('heading', { level: 1 });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^accounts$/i }));
    });

    expect(openSection()).toBe('Accounts');
    // The whole URL, not just the part that gets read back. `location.search`
    // alone cannot tell '/admin?section=users' from a wrong pathname.
    expect(lastUrl(pushState)).toBe('/admin?section=users');
    expect(window.location.search).toBe('?section=users');
  });

  // rejects: writing '?section=questionsets' for the landing section. That URL
  //          and a bare /admin render the same screen, so writing both makes
  //          Back land somewhere visibly identical and need a second press.
  test('returning to the landing section drops the parameter', async () => {
    arriveAt('/admin?section=users');
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Accounts'));

    /* Organisations, not Question sets: in platform mode the landing section is
       the first item of the platform group, and this suite runs in that mode
       because Accounts only exists there. */
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^organisations$/i }));
    });

    expect(lastUrl(pushState)).toBe('/admin');
    expect(window.location.search).toBe('');
  });

  // rejects: replaceState here. Replacing the entry is what the console did by
  //          doing nothing at all — the section changes and history does not
  //          grow, so Back still leaves.
  test('it is a push, not a replace', async () => {
    render(<AdminPage />);
    await screen.findByRole('heading', { level: 1 });
    const replacesBefore = replaceState.mock.calls.length;

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^moderation$/i }));
    });

    expect(pushState).toHaveBeenCalled();
    expect(replaceState.mock.calls.length).toBe(replacesBefore);
  });
});

describe('Back returns to the previous section', () => {
  // rejects: pushState with no popstate listener — which is WORSE than no
  //          history at all. Back would move the address bar to the previous
  //          section while the screen stayed put, so the URL becomes a lie
  //          about what is on screen.
  //
  // Driven with the genuine history stack: two pushes from the component, then
  // `history.back()`, which jsdom answers with a real asynchronous popstate.
  test('Back after two moves lands on the first of them', async () => {
    render(<AdminPage />);
    await screen.findByRole('heading', { level: 1 });

    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^accounts$/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^archive$/i })); });
    expect(openSection()).toBe('Archive');

    await act(async () => { window.history.back(); });
    await waitFor(() => expect(openSection()).toBe('Accounts'));
    expect(window.location.search).toBe('?section=users');
  });

  test('Back again reaches the landing section', async () => {
    render(<AdminPage />);
    await screen.findByRole('heading', { level: 1 });

    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^accounts$/i })); });
    await act(async () => { window.history.back(); });

    await waitFor(() => expect(openSection()).toBe('Organisations'));
    expect(window.location.search).toBe('');
  });

  // rejects: reading `event.state` instead of the URL. An entry pushed before
  //          this shipped — or by anything else on the page — carries a null
  //          state, and the URL is the thing that is always right.
  test('a popstate carrying no state object still works', async () => {
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Question sets'));

    // pushState(null, ...) directly, so the entry has no state of its own, then
    // announce it the way the browser would.
    await act(async () => {
      window.history.pushState(null, '', '/admin?section=users');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });

    expect(openSection()).toBe('Accounts');
  });

  // rejects: the listener outliving the component. AdminPage is unmounted
  //          whenever the pathname router swaps pages; a listener still calling
  //          setState afterwards is a React warning and a leak per visit.
  test('the listener is removed on unmount', async () => {
    const { unmount } = render(<AdminPage />);
    await screen.findByRole('heading', { level: 1 });
    const remove = jest.spyOn(window, 'removeEventListener');
    unmount();
    expect(remove.mock.calls.some(([type]) => type === 'popstate')).toBe(true);
  });
});

describe('the landing URL is canonicalised on arrival', () => {
  // rejects: leaving '?section=questionsets' in the bar. Bookmark that and Back
  //          needs two presses to leave a screen that never visibly changed.
  test('an explicit landing section is replaced with the bare path', async () => {
    arriveAt('/admin?section=questionsets');
    render(<AdminPage />);
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(lastUrl(replaceState)).toBe('/admin');
    expect(window.location.search).toBe('');
  });

  // rejects: leaving the address bar naming a section that is not on screen.
  test('an unrecognised section is replaced too', async () => {
    arriveAt('/admin?section=aiprompts');
    render(<AdminPage />);
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(lastUrl(replaceState)).toBe('/admin');
  });

  // rejects: replacing on every mount. A URL that is already canonical must
  //          cost no history operation at all.
  test('a URL that already says it is left alone', async () => {
    arriveAt('/admin?section=users');
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Accounts'));
    expect(replaceState).not.toHaveBeenCalled();
  });

  test('a bare /admin is left alone', async () => {
    render(<AdminPage />);
    await waitFor(() => expect(openSection()).toBe('Question sets'));
    expect(replaceState).not.toHaveBeenCalled();
  });
});
