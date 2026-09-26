/**
 * WHAT THE HOST'S PHONE SAYS WHEN THE SERVER REFUSES IT.
 *
 * Two sentences shipped, and both were useless mid-session in front of a room:
 *
 *   "Could not read the question set."   — names no cause at all
 *   "Game not found."                    — names a FALSE one
 *
 * The second is the worse of the two. `tenant.callerMayDriveSession` answers 404
 * with those words for exactly two reasons — the session's rows are missing, or
 * the caller's active organisation is not the session's — and a phone whose
 * state poll is answering right now has ruled the first one out, because
 * `game/get-game-state.js` 404s on a missing METADATA row. So the phone told a
 * host their running session was gone while displaying that session's round
 * number, player count and title.
 *
 * `hostRemoteOrgScope.test.jsx` covers the cause. This file covers the words,
 * and the rule they have to obey: NEVER CLAIM A CAUSE THE RESPONSE DOES NOT
 * SUPPORT. Where the phone has proved something it may say so; where it has
 * not, the server's own words go through untouched.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostRemote from '../HostRemote';
import { questionSetFailure, sessionActionMessage } from '../config/hostRemote';

/* PARTIAL MOCK: `HostRemote` mounts `ActiveOrgSwitcher`, which reads and writes
   the active organisation through this same module. Only the transport moves. */
jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((...args) => global.fetch(...args)),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

const TRIVIA = {
  id: '004',
  title: 'Which pricing change produced the largest one-year improvement?',
  optionA: 'A 5% list increase held through renewal',
  correctAnswer: 'OptionA',
};

/**
 * Route every request the remote makes, with the question-set route and the
 * dispatch route independently breakable. Shapes are the real handlers'.
 *
 * `questions` may be a list (served 200) or a `{status}` refusal;
 * `questionsThen` is the second attempt, so a retry can be watched succeeding.
 */
function serve({ questions = [TRIVIA], questionsThen = null, dispatch = null, categories = [] } = {}) {
  let attempt = 0;
  global.fetch = jest.fn((url, init) => {
    const href = String(url);

    if (init?.method === 'POST') {
      if (dispatch) {
        return Promise.resolve({
          ok: false,
          status: dispatch.status,
          json: async () => ({ error: dispatch.error }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    if (href.includes('/orgs')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ orgs: [] }) });
    }
    if (href.includes('/state')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          gameId: '4821',
          state: 'CREATED',
          gameType: 'trivia',
          gameMetadata: { title: 'Offsite', gameType: 'trivia', questionSetId: 'pricing' },
        }),
      });
    }
    if (href.includes('/players')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ players: [], stats: { totalPlayers: 0 } }) });
    }
    if (href.includes('/categories')) {
      if (categories && categories.status) {
        return Promise.resolve({ ok: false, status: categories.status, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ categories }) });
    }
    if (href.includes('/questions')) {
      attempt += 1;
      const wanted = attempt > 1 && questionsThen ? questionsThen : questions;
      if (wanted && wanted.throws) return Promise.reject(new TypeError('Failed to fetch'));
      if (wanted && wanted.status) {
        return Promise.resolve({ ok: false, status: wanted.status, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ questions: wanted, setName: 'Strategic Pricing Plays' }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

// Connected means the session's first `/state` reply is on screen, not that the
// code box has gone: until that reply lands the remote's controls are disabled
// and a tap on one is swallowed. The full account, and the test that pins it,
// are at connect() in hostRemoteBrowser.test.jsx.
async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
}

async function openQuestions() {
  // Held until the state poll lands: the control is `disabled={!setId}` and a
  // click on a disabled button is silently nothing.
  const open = await screen.findByRole('button', { name: /choose next question/i });
  await waitFor(() => expect(open).not.toBeDisabled());
  fireEvent.click(open);
  await screen.findByRole('tab', { name: /^questions$/i });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
  window.localStorage.clear();
});

/* -------------------------------------------------------- the question set */

describe('questionSetFailure — one sentence per thing that actually happened', () => {
  // Rejects: collapsing every non-ok response into one sentence, which is the
  // shape the bug was reported against. A host reading "Could not read the
  // question set" cannot tell a dead token from a set in another team's
  // library, and those two have different fixes.
  it('names an expired sign-in for 401', () => {
    const { kind, message } = questionSetFailure({ status: 401 });
    expect(kind).toBe('auth');
    expect(message).toMatch(/sign(ed)? in/i);
  });

  it('names an expired sign-in for 403 too', () => {
    expect(questionSetFailure({ status: 403 }).kind).toBe('auth');
  });

  // Rejects: telling the host the set does not exist. This handler's 404 means
  // "not in a library THIS CALLER may read" — `findSetMetadata` never probes
  // another organisation's partition — so the sentence is about this device,
  // and it must not assert the set is gone.
  it('says a 404 is about this device, not about the set existing', () => {
    const { kind, message } = questionSetFailure({ status: 404 });
    expect(kind).toBe('notFound');
    expect(message).toMatch(/team/i);
    expect(message).not.toMatch(/deleted|does not exist|no longer exists/i);
  });

  // Rejects: swallowing the status. 500 and a dead radio are both "try again",
  // but only one of them has a number worth carrying.
  it('carries the status on an unexplained failure', () => {
    const { kind, message } = questionSetFailure({ status: 500 });
    expect(kind).toBe('error');
    expect(message).toMatch(/500/);
  });

  // Rejects: printing "(undefined)" or "(0)" when the request never landed.
  it('says nothing about a status when there was no response', () => {
    const { kind, message } = questionSetFailure({ status: 0 });
    expect(kind).toBe('error');
    expect(message).not.toMatch(/undefined|NaN|\(0\)/);
  });
});

describe('the Questions tab says which failure it had, and offers a way out', () => {
  // Rejects: an error state with no recovery. The only way out was reloading
  // the page, which mid-session costs the host the round they were reading.
  it('retries without leaving the tab', async () => {
    serve({ questions: { status: 500 }, questionsThen: [TRIVIA] });
    await connect();
    await openQuestions();

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText(TRIVIA.title)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^questions$/i, selected: true })).toBeInTheDocument();
  });

  it('does not blame the question set when the sign-in is what failed', async () => {
    serve({ questions: { status: 401 } });
    await connect();
    await openQuestions();

    const flash = await screen.findByRole('alert');
    expect(flash.textContent).toMatch(/sign(ed)? in/i);
  });

  it('offers the retry on a 404 as well', async () => {
    serve({ questions: { status: 404 } });
    await connect();
    await openQuestions();

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  // Rejects: leaving a stale failure on screen while the retry is in the air.
  it('shows the attempt rather than the last failure', async () => {
    serve({ questions: { status: 500 }, questionsThen: [TRIVIA] });
    await connect();
    await openQuestions();

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------- the categories */

describe('the category list', () => {
  /*
    Rejects: the silent `if (cancelled || !res.ok) return;` this load used to
    have. `get-categories.js` searches the caller's readable libraries too, so
    the same blank organisation 404s it — and the disclosure then reported that
    a set full of categories had none. An empty state that lies.
  */
  it('says why it is empty instead of claiming the set has no categories', async () => {
    serve({ categories: { status: 404 } });
    await connect();

    fireEvent.click(await screen.findByRole('button', { name: /categories/i }));
    const flash = await screen.findByRole('alert');
    expect(flash.textContent).toMatch(/team/i);
  });
});

/* ------------------------------------------------------------ the dispatch */

describe('sessionActionMessage — the phone knows the session is there', () => {
  it('refuses to repeat "Game not found" about a session it is reading', () => {
    const message = sessionActionMessage({
      status: 404,
      payload: { error: 'Game not found' },
      live: true,
    });
    expect(message).not.toMatch(/game not found/i);
    expect(message).toMatch(/team/i);
  });

  // Rejects: asserting the scope cause when nothing has ruled out a missing
  // session. With no snapshot the phone has proved nothing, and the server's
  // own words are the honest answer.
  it('passes the server\'s words through when nothing rules out a missing session', () => {
    const message = sessionActionMessage({
      status: 404,
      payload: { error: 'Game not found' },
      live: false,
    });
    expect(message).toMatch(/game not found/i);
  });

  // Rejects: treating every 404 as a scope problem. `next-question` 404s for a
  // round that is not there too, and that has nothing to do with organisations.
  it('leaves an unrelated 404 alone', () => {
    const message = sessionActionMessage({
      status: 404,
      payload: { error: 'Question not found' },
      live: true,
    });
    expect(message).toMatch(/question not found/i);
  });

  it('names an expired sign-in on a 401', () => {
    expect(sessionActionMessage({ status: 401, payload: {}, live: true })).toMatch(/sign(ed)? in/i);
  });

  it('carries the status for anything it cannot explain', () => {
    expect(sessionActionMessage({ status: 502, payload: {}, live: true })).toMatch(/502/);
  });

  it('says nothing about a status when there was no response', () => {
    const message = sessionActionMessage({ status: 0, payload: {}, live: true });
    expect(message).not.toMatch(/undefined|NaN|\(0\)/);
  });
});

describe('the round controls', () => {
  it('do not tell a host their running session is gone', async () => {
    serve({ dispatch: { status: 404, error: 'Game not found' } });
    await connect();

    fireEvent.click(await screen.findByRole('button', { name: /start first round/i }));

    const flash = await screen.findByRole('alert');
    expect(flash.textContent).toMatch(/team/i);
    expect(flash.textContent).not.toMatch(/game not found/i);
  });
});
