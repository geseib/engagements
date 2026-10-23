/**
 * GOING BACK TO AN EARLIER ROUND SHOWS ITS LESSON (issue #47).
 *
 * At the end of a Call & Answer session a participant revisiting a round to
 * add a comment saw "Lesson 1", "Lesson 2" in the list, and an opened round
 * restored its title and responses but not the lesson the room had answered.
 *
 * rejects: the end screen listing rounds by number only when their titles are
 *          known; a round with no title labelled with anything but its number;
 *          a long title rendered whole on the button, or its full text lost
 *          from title=; an ALL-CAPS title left shouting; an opened round
 *          without its lesson text or its "Your turn"; Workie's Background
 *          reaching the phone; an unsent comment lost when the player goes
 *          back and opens another round, shown in another round's composer,
 *          or posted against another round.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import FeedbackRoundPanel from '../components/FeedbackRoundPanel';
import RoundReport from '../components/RoundReport';
import {
  pastRoundLabel, pastRoundQuestion, shortenTitle, PAST_TITLE_MAX,
} from '../config/pastRounds';

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    isConnected: () => false,
    sendCleanMessage: jest.fn(() => true),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

const LESSON_1 = 'Good design is honest. It does not make a product appear more innovative, powerful or valuable than it really is.';
const LESSON_2 = 'Describe a tool you use whose shape tells you how to use it. The handle of a hammer, the slot of a letterbox: form that follows function needs no manual.';

/* ------------------------------------------------------------ pure helpers */

describe('pastRoundLabel', () => {
  test('a round with a title reads "<noun> N · <title>"', () => {
    const l = pastRoundLabel('Lesson', 2, 'Form Follows Function');
    expect(l.full).toBe('Lesson 2 · Form Follows Function');
    expect(l.number).toBe('Lesson 2');
    expect(l.short).toBe('Form Follows Function');
  });

  test('a round with no title falls back to its number alone', () => {
    expect(pastRoundLabel('Round', 3, '').full).toBe('Round 3');
    expect(pastRoundLabel('Round', 3, undefined).short).toBe('');
    expect(pastRoundLabel('', 3, '   ').full).toBe('Round 3');
  });

  test('an ALL-CAPS title reads in title case, as on the room screen', () => {
    expect(pastRoundLabel('Lesson', 1, 'FORM FOLLOWS FUNCTION').title).toBe('Form Follows Function');
  });

  test('a long title is shortened for the button and kept whole in full', () => {
    const long = 'Why every great workshop starts with the question nobody in the room wants to ask out loud';
    const l = pastRoundLabel('Lesson', 4, long);
    expect(l.short.length).toBeLessThanOrEqual(PAST_TITLE_MAX);
    expect(l.short.endsWith('…')).toBe(true);
    expect(l.full).toBe(`Lesson 4 · ${long}`);
    expect(shortenTitle('Short one')).toBe('Short one');
  });
});

describe('pastRoundQuestion', () => {
  test('the lesson and the question\'s own instruction', () => {
    const q = pastRoundQuestion({
      title: 'HONEST DESIGN', detail: LESSON_1, customInstructions: 'Name one product that oversells itself.',
    });
    expect(q.title).toBe('Honest Design');
    expect(q.detail).toBe(LESSON_1);
    expect(q.task).toBe('Name one product that oversells itself.');
  });

  test('with no instruction of its own, the question at the front of the lesson is the task', () => {
    const q = pastRoundQuestion({ title: 'Form Follows Function', detail: LESSON_2 });
    expect(q.task).toBe('Describe a tool you use whose shape tells you how to use it.');
    expect(q.detail).toMatch(/^The handle of a hammer/);
  });

  test('never Background, whatever a caller hands in', () => {
    const q = pastRoundQuestion({ title: 'T', detail: 'A lesson.', Background: 'WORKIE ONLY', background: 'WORKIE ONLY' });
    expect(JSON.stringify(q)).not.toMatch(/WORKIE ONLY/);
  });

  test('no title and no lesson: the fallback title and nothing else', () => {
    const q = pastRoundQuestion(null, 'Round 3');
    expect(q).toEqual({ title: 'Round 3', detail: '', task: '', category: '', image: null, school: null });
  });
});

/* ------------------------------------------------------- components alone */

describe('RoundReport and FeedbackRoundPanel', () => {
  test('RoundReport shows "Your turn" when the round carries a task, and not otherwise', () => {
    const { rerender } = render(<RoundReport round={{ title: 'T', detail: LESSON_1, task: 'Do the thing.', answers: [] }} />);
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText('Do the thing.')).toBeInTheDocument();
    rerender(<RoundReport round={{ title: 'T', detail: LESSON_1, answers: [] }} />);
    expect(screen.queryByText('Your turn')).toBeNull();
  });

  test('FeedbackRoundPanel restores a saved draft and reports every change', () => {
    const saves = [];
    const anchor = { anchorKind: 'results', anchorRef: '', anchorLabel: 'the results', anchorExcerpt: '' };
    render(
      <FeedbackRoundPanel
        round={{ title: 'T', answers: [] }}
        questionNumber="001"
        onSubmit={async () => ({ ok: true })}
        savedDraft={{ anchor, text: 'half a thought' }}
        onDraftSave={(d) => saves.push(d)}
      />,
    );
    expect(document.querySelector('textarea').value).toBe('half a thought');
    fireEvent.change(document.querySelector('textarea'), { target: { value: 'a whole thought' } });
    expect(saves[saves.length - 1]).toEqual({ anchor, text: 'a whole thought' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(saves[saves.length - 1]).toBeNull();
  });
});

/* -------------------------------------------------- the real player page */

const GAME = 'TEST123';
const ME = 'TestPlayer';

function makeServer() {
  const server = {
    state: 'CREATED',
    posted: [],
    // Round 1 has a title and a lesson; round 2 a lesson and no instruction;
    // round 3 nothing at all.
    rounds: {
      '001': {
        title: 'HONEST DESIGN', detail: LESSON_1, category: 'Design',
        customInstructions: 'Name one product that oversells itself.', image: '', school: '',
      },
      '002': {
        title: 'Form Follows Function', detail: LESSON_2, category: 'Design',
        customInstructions: '', image: '', school: '',
      },
      '003': null,
    },
  };
  server.handle = (url, options) => {
    const method = options?.method || 'GET';
    if (method === 'POST' && url.includes(`games/${GAME}/players`)) {
      return { ok: true, body: { success: true, playerName: ME } };
    }
    if (method === 'POST' && url.includes(`games/${GAME}/comments`)) {
      const body = JSON.parse(options.body);
      server.posted.push(body);
      return { ok: true, body: { comment: { ...body, id: `c${server.posted.length}`, playerName: ME } } };
    }
    if (url.includes(`games/${GAME}/comments`)) return { ok: true, body: { comments: [] } };
    if (url.includes(`games/${GAME}/state`)) {
      return { ok: true, body: { state: server.state, gameType: 'call-and-answer', currentQuestion: '003', commentsOpen: true } };
    }
    if (url.includes('games/get-results')) {
      const { questionNumber } = JSON.parse(options.body);
      const question = server.rounds[questionNumber];
      return {
        ok: true,
        body: {
          gameId: GAME, questionId: questionNumber, answers: [], noAnswers: true, stored: true,
          questionTitle: question ? question.title : '',
          question,
        },
      };
    }
    if (url.includes(`games/${GAME}/players`)) {
      return { ok: true, body: { players: [{ name: ME, playerName: ME, score: 0, totalScore: 4 }] } };
    }
    if (url.includes(`games/${GAME}`)) return { ok: true, body: {} };
    return { ok: true, body: {} };
  };
  return server;
}

function installFetch(server) {
  global.fetch.mockImplementation((url, options) => {
    const { ok, body } = server.handle(String(url), options);
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
  });
}

async function resync() {
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

async function arriveAtTheEnd(server) {
  installFetch(server);
  render(<PlayerPage />);
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
  });
  server.state = 'ENDED';
  await resync();
  await waitFor(() => expect(screen.getByText(/Something to add\?/i)).toBeInTheDocument());
}

const roundButton = (re) => screen.getByRole('button', { name: re });

beforeEach(() => {
  global.fetch.mockClear();
  localStorage.clear();
  window.history.pushState({}, '', '/play');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('the end screen\'s rounds', () => {
  test('are listed by number and title, with the number alone where there is no title', async () => {
    await arriveAtTheEnd(makeServer());
    await waitFor(() => expect(roundButton(/^Round 1 · Honest Design$/)).toBeInTheDocument());
    expect(roundButton(/^Round 2 · Form Follows Function$/)).toHaveAttribute('title', 'Round 2 · Form Follows Function');
    expect(roundButton(/^Round 3$/)).toHaveAttribute('title', 'Round 3');
  });

  test('an opened round shows its lesson and "Your turn" above the responses', async () => {
    await arriveAtTheEnd(makeServer());
    await waitFor(() => expect(roundButton(/Honest Design/)).toBeInTheDocument());
    fireEvent.click(roundButton(/Honest Design/));
    await waitFor(() => expect(screen.getByText(LESSON_1)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Honest Design' })).toBeInTheDocument();
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText('Name one product that oversells itself.')).toBeInTheDocument();
    // Above the responses, in document order.
    const lesson = screen.getByText(LESSON_1);
    const responses = screen.getByRole('heading', { name: 'Responses' });
    // eslint-disable-next-line no-bitwise
    expect(lesson.compareDocumentPosition(responses) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).toMatch(/Round 1 · Feedback/);
  });

  test('a round with no lesson opens under its number, with no "Your turn"', async () => {
    await arriveAtTheEnd(makeServer());
    fireEvent.click(roundButton(/^Round 3$/));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Round 3' })).toBeInTheDocument());
    expect(screen.queryByText('Your turn')).toBeNull();
  });

  test('an unsent comment stays with its own round across going back and opening another', async () => {
    const server = makeServer();
    await arriveAtTheEnd(server);
    await waitFor(() => expect(roundButton(/Honest Design/)).toBeInTheDocument());

    // Start a comment on round 1, then go back without posting it.
    fireEvent.click(roundButton(/Honest Design/));
    await waitFor(() => expect(screen.getByText(LESSON_1)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /^Comment/ })[0]);
    await waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
    fireEvent.change(document.querySelector('textarea'), { target: { value: 'About round one' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.getByText(/Something to add\?/i)).toBeInTheDocument());
    expect(roundButton(/Round 1 · Honest Design, unsent comment/)).toBeInTheDocument();
    expect(screen.getByText('Unsent comment')).toBeInTheDocument();

    // Round 2 opens with an empty composer: round 1's words are not here.
    fireEvent.click(roundButton(/Form Follows Function/));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Form Follows Function' })).toBeInTheDocument());
    expect(document.querySelector('textarea')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Comment/ })[0]);
    await waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
    expect(document.querySelector('textarea').value).toBe('');
    fireEvent.change(document.querySelector('textarea'), { target: { value: 'About round two' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    });
    await waitFor(() => expect(server.posted).toHaveLength(1));
    expect(server.posted[0]).toMatchObject({ questionNumber: '002', text: 'About round two' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.getByText(/Something to add\?/i)).toBeInTheDocument());
    expect(roundButton(/^Round 2 · Form Follows Function$/)).toBeInTheDocument();

    // Back on round 1, the draft is where it was left, and posts to round 1.
    fireEvent.click(roundButton(/Honest Design/));
    await waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
    expect(document.querySelector('textarea').value).toBe('About round one');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    });
    await waitFor(() => expect(server.posted).toHaveLength(2));
    expect(server.posted[1]).toMatchObject({ questionNumber: '001', text: 'About round one' });
  });
});
