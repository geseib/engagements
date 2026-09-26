/**
 * TASK 6 — THE PHONE REMOTE SAYS UP FRONT WHEN THIS ACCOUNT CANNOT RUN THE
 * SESSION.
 *
 * Reported 26 Sep 2026: *"when logging in i can see the players, the
 * questions, but there is an error when trying to move the game forward or
 * make any changes."* Root-caused in
 * `.superpowers/sdd/2026-09-26-bugsweep/remote-bug-rootcause.md`: every WRITE
 * this phone makes is Cognito-gated and refused by `callerMayDriveSession`
 * when this device's account cannot drive the session; every READ it opened
 * with (`/state`, `/players`) is a plain, unauthenticated `fetch`, so the
 * phone showed the room in full and only failed the moment a button was
 * pressed.
 *
 * The fix asks ONE authenticated question up front — `GET
 * /games/{id}/host-details` (bug-sweep Task 1: Cognito + `callerMayDriveSession`
 * + a uniform 404) — and shows nothing else about the session until it comes
 * back 200. The owner's ruling, on being shown the alternative of merely
 * disabling the write buttons: *"they should not be able to see the other
 * team's questions. what if they were private customer questions."* This
 * file is the direct test of that ruling — every scenario below seeds a
 * DISTINCTIVE player name, question title and answer text, and the refused
 * scenarios assert none of it ever reaches the DOM, and that this phone never
 * even ASKS for it (`/state`, `/players`, `/questions`, `/answers` are
 * asserted un-called, not merely un-rendered).
 *
 * `hostRemoteOrgScope.test.jsx` covers the org-switch recheck;
 * `hostRemoteFailureCopy.test.jsx` covers `accessDeniedMessage` and
 * `sessionActionMessage` as pure functions, plus the dispatch failure naming
 * the account. This file is the component-level contract for the gate itself.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostRemote from '../HostRemote';

jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((...args) => global.fetch(...args)),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

const mockSignOut = jest.fn();
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useOptionalAuth: () => ({
    currentUser: { username: 'host', attributes: { email: 'host@example.com' } },
    signOut: mockSignOut,
  }),
}));

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
const { navigateTo } = require('../auth/navigate');

/* --------------------------------------------------------------- fixtures */

// Distinctive on purpose — a substring match on any of these anywhere in the
// DOM, or in a fetch URL/history, means something.
const PLAYER_NAME = 'Zephyrine Quoxtail';
const QUESTION_TITLE = 'The confidential Zorblatt merger terms';
const ANSWER_TEXT = 'Redact this entirely: the acquisition price is $40M';

const TRIVIA = {
  id: '004',
  title: QUESTION_TITLE,
  optionA: 'Yes',
  optionB: 'No',
  correctAnswer: 'OptionA',
};

/**
 * Routes every request this phone can make. `hostDetails` is a status code
 * (or a function of the call count, for the retry test); everything else is
 * seeded with the distinctive fixtures above so a leak has something to catch.
 */
function serve({
  hostDetails = 200, orgs = [], stateStatus = 200, playersStatus = 200,
} = {}) {
  let hostDetailsCalls = 0;
  let stateCalls = 0;
  let playersCalls = 0;
  global.fetch = jest.fn((url, init) => {
    const href = String(url);

    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    if (href.includes('/host-details')) {
      hostDetailsCalls += 1;
      const status = typeof hostDetails === 'function' ? hostDetails(hostDetailsCalls) : hostDetails;
      return Promise.resolve({ ok: status === 200, status, json: async () => ({}) });
    }
    if (href.includes('/orgs')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ orgs }) });
    }
    if (href.includes('/state')) {
      stateCalls += 1;
      const status = typeof stateStatus === 'function' ? stateStatus(stateCalls) : stateStatus;
      if (status !== 200) return Promise.resolve({ ok: false, status, json: async () => ({}) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          gameId: '4821',
          state: 'CREATED',
          gameType: 'trivia',
          gameMetadata: { title: 'Q3 Offsite', gameType: 'trivia', questionSetId: 'pricing' },
        }),
      });
    }
    if (href.includes('/players')) {
      playersCalls += 1;
      const status = typeof playersStatus === 'function' ? playersStatus(playersCalls) : playersStatus;
      if (status !== 200) return Promise.resolve({ ok: false, status, json: async () => ({}) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          players: [{ playerName: PLAYER_NAME, totalScore: 0, readiness: {} }],
          stats: { totalPlayers: 1 },
        }),
      });
    }
    if (href.includes('/categories')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ categories: [] }) });
    }
    if (href.includes('/questions')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ questions: [TRIVIA], setName: 'Strategic Pricing Plays' }),
      });
    }
    if (href.includes('/answers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ answers: [{ playerName: PLAYER_NAME, answerText: ANSWER_TEXT }] }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

// Types the code and presses Connect, WITHOUT waiting for Live: most of this
// file's scenarios are refused before the state poll ever starts (that is the
// whole point of the gate — see the file header), so "Live" never appears in
// them and a wait for it would time out by design, not by bug.
function enterCode() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
}

// The standard connect() every other host-remote suite carries (asserted by
// asyncWaitBudget.test.js's cross-suite scan): waits for the session's first
// reply before anything taps. Used only by the 200 scenario below, where a
// reply is actually coming.
async function connect() {
  enterCode();
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
}

/** Nothing this phone learned about the session is anywhere in the DOM. */
function expectNoSessionContent() {
  expect(screen.queryByText(PLAYER_NAME)).not.toBeInTheDocument();
  expect(screen.queryByText(QUESTION_TITLE)).not.toBeInTheDocument();
  expect(screen.queryByText(ANSWER_TEXT)).not.toBeInTheDocument();
  expect(screen.queryByText('Q3 Offsite')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start first round/i })).not.toBeInTheDocument();
}

/** Nothing this phone learned about the session was even ASKED for. */
function expectNoSessionFetches() {
  const urls = global.fetch.mock.calls.map(([u]) => String(u));
  expect(urls.some((u) => u.includes('/state'))).toBe(false);
  expect(urls.some((u) => u.includes('/players'))).toBe(false);
  expect(urls.some((u) => u.includes('/questions'))).toBe(false);
  expect(urls.some((u) => u.includes('/answers'))).toBe(false);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
  window.localStorage.clear();
});

/* ------------------------------------------------------------------- 200 */

describe('200 — this account may drive the session', () => {
  it('shows the session, with no banner', async () => {
    serve({ hostDetails: 200 });
    await connect();

    expect(await screen.findByRole('button', { name: /start first round/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in as someone else/i)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------- 404 */

describe('404 — this account cannot drive the session', () => {
  it('names the account, offers to sign in as someone else, and shows nothing of the session', async () => {
    serve({ hostDetails: 404 });
    enterCode();

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toMatch(/host@example\.com/);
    expect(banner.textContent).toMatch(/can't run this session/i);
    // Both remedies the owner asked for, since the door cannot tell them apart.
    expect(banner.textContent).toMatch(/team that\s*(\n|\s)*runs it/i);
    expect(banner.textContent).toMatch(/created it/i);

    expect(screen.getByRole('button', { name: /sign in as someone else/i })).toBeInTheDocument();
    expectNoSessionContent();
  });

  it('never fetches the room, the question, or the answers while refused', async () => {
    serve({ hostDetails: 404 });
    enterCode();

    await screen.findByRole('alert');
    // Give any latent poll a chance to fire before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expectNoSessionFetches();
    expectNoSessionContent();
  });

  // Fix round 1: `navigateTo('/auth')` navigated to the STANDALONE /auth
  // ROUTE, whose own `onAuthSuccess` goes to '/' (App.jsx) — stranding the
  // host on the host page instead of back on their remote. `/remote` is
  // already wrapped in `ProtectedRoute` (App.jsx), which renders the sign-in
  // form IN PLACE the moment `currentUser` goes null and reloads the SAME
  // URL on success — so signing out is enough on its own, and navigating
  // anywhere is the bug, not the fix.
  it('"Sign in as someone else" signs out WITHOUT navigating away, so ProtectedRoute reloads this URL', async () => {
    serve({ hostDetails: 404 });
    enterCode();

    fireEvent.click(await screen.findByRole('button', { name: /sign in as someone else/i }));

    expect(mockSignOut).toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('still offers the team switcher, so a fix does not require signing out', async () => {
    serve({
      hostDetails: 404,
      orgs: [{ orgId: 'org_teamg', name: 'TeamG', type: 'team' }],
    });
    enterCode();

    await screen.findByRole('alert');
    expect(await screen.findByTestId('orgsw-chip')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------- 401 */

describe('401 — the sign-in itself has run out', () => {
  it('says so, offers to sign in again, and shows nothing of the session', async () => {
    serve({ hostDetails: 401 });
    enterCode();

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toMatch(/sign in again/i);
    expect(banner.textContent).not.toMatch(/host@example\.com/);
    expect(banner.textContent).not.toMatch(/team/i);

    expect(screen.getByRole('button', { name: /^sign in again$/i })).toBeInTheDocument();
    expectNoSessionContent();
  });

  it('never fetches the room, the question, or the answers with an expired token', async () => {
    serve({ hostDetails: 401 });
    enterCode();

    await screen.findByRole('alert');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expectNoSessionFetches();
  });

  // Fix round 1: see the matching 404 test above for why navigating anywhere
  // (rather than letting `ProtectedRoute` show sign-in in place) is the bug.
  it('"Sign in again" signs out WITHOUT navigating away, so ProtectedRoute reloads this URL', async () => {
    serve({ hostDetails: 403 });
    enterCode();

    fireEvent.click(await screen.findByRole('button', { name: /^sign in again$/i }));

    expect(mockSignOut).toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------- an odd status */

describe('a status this surface cannot explain', () => {
  it('neither claims the wrong account nor shows the session, and offers a retry', async () => {
    serve({ hostDetails: 500 });
    enterCode();

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).not.toMatch(/can't run this session/i);
    expect(banner.textContent).toMatch(/check signal|try again/i);
    expectNoSessionContent();

    const retry = screen.getByRole('button', { name: /try again/i });
    // A network hiccup, not a claimed refusal: a genuine sign-in/account
    // problem must not be offered a bare retry, and vice versa.
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    expect(retry).toBeInTheDocument();
  });

  it('a retry that then succeeds shows the session', async () => {
    // First call fails oddly, the retry succeeds — proves the button re-asks
    // the same door rather than only re-rendering the same failure.
    serve({ hostDetails: (call) => (call === 1 ? 500 : 200) });
    enterCode();

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('button', { name: /start first round/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/* --------------------------------------------- revoked mid-session (Task 6 fix round 1 item 3) */

/**
 * The up-front check and the team-switch recheck are not the only moments
 * this can happen. Once bug-sweep Task 7 lands `/state?includeHostData=true`
 * and `/players` behind their own authorizer, a member removed from the
 * team — or a token that expires — mid-session will make those POLLS start
 * answering 401/404 too, not just the up-front `/host-details` call. Without
 * this, the gate would never notice: it only asks the door at open and on a
 * team switch, so the phone would sit on a frozen "Waiting for the
 * session…"/stale roster instead of showing the same banner it would have
 * shown had the account been wrong from the start.
 *
 * `stateStatus`/`playersStatus` do not reflect anything this route actually
 * does TODAY — both are still plain, unauthenticated `fetch`, unchanged by
 * this fix — this only proves the client-side reaction is wired for the day
 * they do.
 */
describe('a later poll coming back 401/404 re-checks access (Task 6 fix round 1 item 3)', () => {
  it('a /state poll that starts 404ing re-runs the access check and the gate replaces the session', async () => {
    serve({
      hostDetails: (call) => (call === 1 ? 200 : 404),
      stateStatus: (call) => (call === 1 ? 200 : 404),
    });
    await connect();
    expect(await screen.findByRole('button', { name: /start first round/i })).toBeInTheDocument();

    // The next 2s poll tick hits the now-404 /state and re-asks the door.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByRole('button', { name: /start first round/i })).not.toBeInTheDocument();
  }, 8000);

  it('a /players poll that comes back 404 re-runs the access check and the gate replaces the session', async () => {
    // 404 from the very first roster call — this poll fires immediately once
    // access is OK, so this does not need to wait out a real timer.
    serve({
      hostDetails: (call) => (call === 1 ? 200 : 404),
      playersStatus: 404,
    });
    await connect();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /start first round/i })).not.toBeInTheDocument();
  });

  it('does not re-check on an ordinary 500 or a dropped connection', async () => {
    // Only 401/404 carry the "this account is not welcome" signal; anything
    // else is a hiccup the existing "Offline" state already covers, and
    // re-checking on every transient error would needlessly hit the door.
    serve({
      hostDetails: 200,
      stateStatus: (call) => (call === 1 ? 200 : 500),
    });
    await connect();
    expect(await screen.findByRole('button', { name: /start first round/i })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Offline')).toBeInTheDocument(), { timeout: 4000 });
    // Still showing the session — no re-check, no gate.
    expect(screen.getByRole('button', { name: /start first round/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }, 8000);
});
