/**
 * The half of `17-remote.html` that drives the SET rather than the round: the
 * question browser, and the Categories control under Session.
 *
 * Every assertion here names the change it rejects, because the two defects
 * this surface can have are both silent:
 *
 *   1. showing the wrong option as correct — the host reads it out;
 *   2. posting an advance that returns 200 and moves nothing —
 *      `next-question.js:473` refuses to leave ASK# without `skip_to_specific`,
 *      and refuses by answering "Already asking a question" with a 200.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HostRemote from '../HostRemote';
import {
  correctOptionIndex,
  remoteQuestionRow,
  filterRemoteRows,
  askNextRequest,
} from '../config/hostRemote';

// Delegates to the same router `serve()` installs on global.fetch.
//
// It used to answer every call with `{}`, which was harmless only while the
// authenticated calls were ones this file did not assert on. The question-set
// routes (`/questions`, `/categories`) moved onto `authFetch` when they stopped
// being public — a blanket stub then fed the browser an empty set and the
// failures read as "the browser lists nothing", pointing at the component
// rather than at the mock. Route both transports through one place so the
// fixtures below are what the component actually receives, whichever it uses.
jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn((...args) => global.fetch(...args)),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

/* ----------------------------------------------------------------- fixtures */

const TRIVIA = {
  id: '004',
  title: 'Which pricing change produced the largest one-year improvement?',
  category: 'Pricing Mechanics',
  difficulty: 'Hard',
  optionA: 'A 5% list increase held through renewal',
  optionB: 'Seat-based to usage-based billing',
  optionC: 'A premium support tier at 20% of contract',
  optionD: 'Discounting the entry plan',
  correctAnswer: 'OptionA',
};

const CATEGORIES = [
  { name: 'Pricing Mechanics', questionCount: 12 },
  { name: 'Pricing Power', questionCount: 9 },
];

/**
 * Route every request the remote makes. Shapes are the real handlers':
 * get-game-state.js (state, incl. `categoryCounts` / `categoryState` /
 * `gameMetadata.questionSetId`), get-players.js, get-categories.js and
 * admin/get-question-set-questions.js.
 */
function serve({ state = 'ASK#003', live = true, questions = [TRIVIA] } = {}) {
  const posts = [];
  global.fetch = jest.fn((url, init) => {
    const href = String(url);

    if (init?.method === 'POST') {
      posts.push({ url: href, body: JSON.parse(init.body || '{}') });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ state }) });
    }
    if (href.includes('/state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '4821',
          state,
          stageBeat: 'results',
          currentQuestion: 3,
          gameType: 'trivia',
          gameMetadata: { title: 'Offsite', gameType: 'trivia', questionSetId: 'pricing' },
          ...(live ? {
            categoryCounts: { '1-8': [12, 0], '9-16': [], '17-24': [], totalRemaining: 31 },
            categoryState: {
              'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
            },
          } : {}),
        }),
      });
    }
    if (href.includes('/players')) {
      return Promise.resolve({ ok: true, json: async () => ({ players: [], stats: { totalPlayers: 0 } }) });
    }
    if (href.includes('/categories')) {
      return Promise.resolve({ ok: true, json: async () => ({ categories: CATEGORIES }) });
    }
    if (href.includes('/questions')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ questions, setName: 'Strategic Pricing Plays' }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
  return posts;
}

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  await waitFor(() => expect(screen.queryByLabelText(/session code/i)).not.toBeInTheDocument());
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

/* ------------------------------------------------------------- the decode */

describe('which option the set says is right', () => {
  // Rejects: dropping the `Option<letter>` branch, which is the spelling
  // CLAUDE.md mandates and the one every generated set uses.
  it('reads the mandated "OptionB" spelling', () => {
    expect(correctOptionIndex({ correctAnswer: 'OptionB', optionB: 'b' })).toBe(1);
  });

  // Rejects: a pattern anchored on /^option/, which would leave every set that
  // stores a bare letter with no flag at all.
  it('reads a bare letter', () => {
    expect(correctOptionIndex({ correctAnswer: 'c' })).toBe(2);
  });

  // Rejects: deleting the text-match fallback. config/setupPanel.js records
  // that sets store the option's own TEXT "as often as" they store OptionB —
  // that observation is the reason the STAGE browser carries no options at all,
  // so the phone must handle the spelling the stage is protecting itself from.
  it('reads the option text itself', () => {
    expect(correctOptionIndex({ ...TRIVIA, correctAnswer: 'Discounting the entry plan' })).toBe(3);
  });

  // Rejects: using findIndex's -1 as an index (flags the LAST option), or
  // falling back to 0 (flags the first). Both put a wrong answer in the host's
  // hand, which is worse than no answer because they read it out.
  it('flags nothing when the answer matches no option', () => {
    const row = remoteQuestionRow({ ...TRIVIA, correctAnswer: 'None of the above' });
    expect(row.options.some((option) => option.correct)).toBe(false);
    expect(row.answerUnresolved).toBe(true);
  });

  // Rejects: reusing config/setupPanel.js's `browserRow` here. That function
  // strips the options ON PURPOSE because the stage renders on a projector;
  // this surface is the host's own phone and the asymmetry is the feature.
  it('carries the options and the flag', () => {
    const row = remoteQuestionRow(TRIVIA);
    expect(row.options.map((option) => option.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(row.options[0]).toMatchObject({ correct: true });
  });
});

describe('the search', () => {
  // Rejects: filtering on detail or category too, which would surface rows the
  // host cannot see a reason for.
  it('matches titles, case-insensitively', () => {
    const rows = [TRIVIA, { id: '9', title: 'Renewal signals' }].map(remoteQuestionRow);
    expect(filterRemoteRows(rows, 'RENEWAL').map((row) => row.id)).toEqual(['9']);
    expect(filterRemoteRows(rows, '  ')).toHaveLength(2);
  });
});

describe('asking a chosen question', () => {
  // Rejects: sending `select_specific` unconditionally. next-question.js:473
  // refuses to advance out of ASK# without the skip variant AND ANSWERS 200,
  // so the tap would look like it worked and the round would not move.
  it('skips the round on screen when one is running', () => {
    expect(askNextRequest({ gameId: '4821', questionId: '004', state: 'ASK#003' }).body)
      .toEqual({ questionId: '004', action: 'skip_to_specific' });
    expect(askNextRequest({ gameId: '4821', questionId: '004', state: 'VOTE#003' }).body.action)
      .toBe('skip_to_specific');
  });

  // Rejects: sending `skip_to_specific` everywhere, which bypasses the guard
  // that exists to stop a double-tap consuming two questions.
  it('selects normally from RESULTS and from a game that has not started', () => {
    expect(askNextRequest({ gameId: '4821', questionId: '004', state: 'RESULTS#003' }).body.action)
      .toBe('select_specific');
    expect(askNextRequest({ gameId: '4821', questionId: '004', state: 'STARTED' }).body.action)
      .toBe('select_specific');
  });

  // Rejects: defaulting a missing id to something. Without an id the endpoint
  // would auto-select, i.e. ask a DIFFERENT question than the one tapped.
  it('refuses without a question id', () => {
    expect(askNextRequest({ gameId: '4821', state: 'ASK#003' })).toBeNull();
  });
});

/* ------------------------------------------------------------ the call site */

describe('the phone question browser', () => {
  // Rejects: any wiring where `Choose next question` does not reach the set —
  // a decision module can be perfect while the button opens nothing.
  it('opens from This round and lists the set', async () => {
    serve();
    await connect();

    fireEvent.click(await screen.findByRole('button', { name: /choose next question/i }));

    expect(await screen.findByText(TRIVIA.title)).toBeInTheDocument();
    expect(screen.getByText(/Strategic Pricing Plays/)).toBeInTheDocument();
  });

  // Rejects: rendering rows through setupPanel's `browserRow`, or dropping the
  // CORRECT flag to "match the stage". This is the whole reason the surface
  // exists, and it is exactly the change a consistency pass would make.
  it('shows the options AND which one is correct', async () => {
    serve();
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: /choose next question/i }));
    await screen.findByText(TRIVIA.title);

    expect(screen.getByText(TRIVIA.optionB)).toBeInTheDocument();

    const right = screen.getByText(TRIVIA.optionA).closest('li');
    expect(within(right).getByText(/correct/i)).toBeInTheDocument();
  });

  // Rejects: pointing `Ask this next` at a bare next-question advance, which
  // asks whatever the server picks instead of what the host tapped.
  it('posts the tapped question id, with the mid-round skip', async () => {
    const posts = serve({ state: 'ASK#003' });
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: /choose next question/i }));
    await screen.findByText(TRIVIA.title);

    fireEvent.click(screen.getByRole('button', { name: /ask this next/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe('https://api.test/games/4821/next-question');
    expect(posts[0].body).toEqual({ questionId: '004', action: 'skip_to_specific' });
  });

  // Rejects: leaving the browser open after a choice. The host chose; what they
  // need next is the progress meter, not the list.
  it('returns to the round once the question is asked', async () => {
    serve({ state: 'ASK#003' });
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: /choose next question/i }));
    await screen.findByText(TRIVIA.title);

    fireEvent.click(screen.getByRole('button', { name: /ask this next/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /choose next question/i })).toBeInTheDocument());
  });
});

describe('categories on the phone', () => {
  // Rejects: sending the 0-based array index. config/setupPanel.js keeps
  // `position` on the row precisely because recomputing it at the call site
  // toggles the NEIGHBOURING category, and the host would not see which.
  it('posts the 1-based position, as a string, with the flipped state', async () => {
    const posts = serve({ live: true });
    await connect();

    fireEvent.click(await screen.findByRole('button', { name: /^categories$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Pricing Mechanics/ }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe('https://api.test/games/4821/toggle-category');
    // Mask '10000000' has position 1 on, so the tap turns it off.
    expect(posts[0].body).toEqual({
      categoryId: '1', categoryName: 'Pricing Mechanics', enabled: false,
    });
  });

  // Rejects: enabling the toggle before the game owns the STATE#CATS records
  // the endpoint writes. The POST would have nothing to update, and the row
  // would spring back on the next poll with no explanation.
  it('is not togglable before the session has category records', async () => {
    serve({ live: false, state: 'STARTED' });
    await connect();

    fireEvent.click(await screen.findByRole('button', { name: /^categories$/i }));

    const row = await screen.findByRole('button', { name: /Pricing Mechanics/ });
    expect(row).toBeDisabled();
    expect(screen.getByText(/become adjustable once the session/i)).toBeInTheDocument();
  });
});
