/**
 * EVENTS AND EARLY ARRIVALS ON THE PARTICIPANT'S PHONE (experience plan 3e;
 * audit C P5, P8).
 *
 * rejects:
 *   - joining before the host starts as a dead end: "This game has not been
 *     started yet" under the Join button, and nothing retries;
 *   - an event's item that has not started yet stuck on "Not in yet." with a
 *     Try again the attendee has to guess when to press;
 *   - a survey inside an event saying "You can close this page", with no way
 *     back to the agenda;
 *   - an item's end screen with no agenda and no word of what is next, or a
 *     "Final score 0" on an unscored item;
 *   - a new device in an event silently seated as "Chris 2": the server now
 *     asks (409 NAME_TAKEN, attendee) and the phone shows the same screen a
 *     typed name gets, with "I'm someone else" as a numbered seat.
 *
 * Fake timers drive the page's own retry clock, so "joins by itself" is
 * asserted at its edge rather than waited for.
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import PlayerPage, { EARLY_RETRY_MS } from '../PlayerPage';
import SurveyRunner from '../components/survey/SurveyRunner';
import { HANDOVER_LABELS } from '../components/JoinNameCollision';

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    isConnected: () => true,
    sendCleanMessage: jest.fn(() => true),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

const GAME = '4821';
const ME = 'Ada';

/** A server whose join answers come from a queue, then the last one forever. */
function makeServer({ joins, state = 'CREATED', gameType = 'trivia' }) {
  const server = { joinCalls: [], asks: [], state, gameType, joins: [...joins] };
  global.fetch.mockImplementation((rawUrl, options) => {
    const url = String(rawUrl);
    const method = options?.method || 'GET';
    const body = JSON.parse(options?.body || '{}');
    let status = 200;
    let out = {};
    if (method === 'POST' && url.includes('/handover-request')) {
      server.asks.push(body);
      out = { success: true, askAgainAfterSeconds: 60, lapseSeconds: 600 };
    } else if (method === 'POST' && url.endsWith(`games/${GAME}/players`)) {
      server.joinCalls.push(body);
      const next = server.joins.length > 1 ? server.joins.shift() : server.joins[0];
      const answer = typeof next === 'function' ? next(body) : next;
      status = answer.status;
      out = answer.body;
    } else if (url.includes(`games/${GAME}/state`)) {
      out = { state: server.state, gameType: server.gameType, currentQuestion: '001', commentsOpen: false };
    } else if (url.includes(`games/${GAME}/players`)) {
      out = { players: [{ playerName: ME, totalScore: 40 }] };
    }
    return Promise.resolve({ ok: status < 300, status, json: async () => out });
  });
  return server;
}

const NOT_STARTED = { status: 403, body: { error: 'Game not started', message: 'This game has not been started yet. Please wait for the host to start the session.' } };
const IN = (name = ME) => ({ status: 200, body: { success: true, playerName: name } });

const tick = async (ms) => {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

const dock = () => document.querySelector('.plr-dock');
const dockLabels = () => (dock() ? within(dock()).queryAllByRole('button').map((b) => b.textContent.trim()) : []);

const eventProps = (extra = {}) => ({
  code: '5307', token: 'at_0123456789abcdef.secret', gameId: GAME,
  onAgenda: jest.fn(), onFrame: jest.fn(), onNotJoined: jest.fn(), nextTitle: 'Break', ...extra,
});

beforeEach(() => {
  localStorage.clear();
  global.fetch.mockReset();
  window.history.pushState({}, '', '/play');
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

async function typeAndJoin() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByLabelText(/Session code/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Join$/ })); });
  await tick(0);
}

describe('joining before the host starts is a lobby that joins by itself', () => {
  test('not started: the lobby, no error, then in by itself once the host starts', async () => {
    const server = makeServer({ joins: [NOT_STARTED, NOT_STARTED, IN()] });
    await typeAndJoin();
    expect(screen.getByTestId('early-lobby')).toBeInTheDocument();
    expect(screen.getByText(`Holding your place as ${ME}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting for the host.' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toMatch(/game/i);
    expect(server.joinCalls).toHaveLength(1);

    await tick(EARLY_RETRY_MS - 100);
    expect(server.joinCalls).toHaveLength(1);
    await tick(100);
    expect(server.joinCalls).toHaveLength(2);
    expect(screen.getByTestId('early-lobby')).toBeInTheDocument();

    await tick(EARLY_RETRY_MS);
    expect(server.joinCalls).toHaveLength(3);
    expect(server.joinCalls.every((c) => c.playerName === ME)).toBe(true);
    expect(screen.queryByTestId('early-lobby')).toBeNull();
    await tick(200);
    expect(screen.getByText(`You’re in as ${ME}`)).toBeInTheDocument();
    // In: the retry stops.
    await tick(EARLY_RETRY_MS * 2);
    expect(server.joinCalls).toHaveLength(3);
  });

  test('"Change the code or name" goes back to the form with both kept, and stops retrying', async () => {
    const server = makeServer({ joins: [NOT_STARTED] });
    await typeAndJoin();
    expect(dockLabels()).toEqual(['Change the code or name']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change the code or name' })); });
    expect(screen.getByLabelText(/Session code/i)).toHaveValue(GAME);
    expect(screen.getByPlaceholderText(/Your Name/i)).toHaveValue(ME);
    await tick(EARLY_RETRY_MS * 3);
    expect(server.joinCalls).toHaveLength(1);
  });

  test('a link with a name in it that arrives early waits in the lobby too', async () => {
    const server = makeServer({ joins: [NOT_STARTED, IN()] });
    window.history.pushState({}, '', `/play?gameId=${GAME}&name=${ME}`);
    render(<PlayerPage />);
    await tick(0);
    expect(screen.getByTestId('early-lobby')).toBeInTheDocument();
    await tick(EARLY_RETRY_MS);
    await tick(200);
    expect(server.joinCalls).toHaveLength(2);
    expect(screen.getByText(`You’re in as ${ME}`)).toBeInTheDocument();
  });

  test('an event\'s item that has not started waits and joins by itself, by token', async () => {
    const server = makeServer({ joins: [NOT_STARTED, IN('Priya Raman')] });
    render(<PlayerPage event={eventProps()} />);
    await tick(0);
    expect(screen.getByTestId('early-lobby')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await tick(EARLY_RETRY_MS);
    await tick(200);
    expect(server.joinCalls).toHaveLength(2);
    expect(server.joinCalls[1].attendeeToken).toBe('at_0123456789abcdef.secret');
    expect(screen.queryByTestId('early-lobby')).toBeNull();
  });
});

describe('one item-ended screen in an event', () => {
  test('a game item: finished, Up next, keep the page open, and the agenda in the dock', async () => {
    makeServer({ joins: [IN('Priya Raman')], state: 'ENDED', gameType: 'trivia' });
    const props = eventProps({ nextTitle: 'Talk · The FY27 plan' });
    render(<PlayerPage event={props} />);
    await tick(200);
    await tick(200);
    expect(screen.getByText('This item is finished')).toBeInTheDocument();
    expect(screen.getByTestId('ended-next')).toHaveTextContent('Up next Talk · The FY27 plan');
    expect(screen.getByText(/Keep this page open: the next item starts here by itself\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/close this page/i);
    expect(document.querySelector('.plr-ctx').textContent).toBe('Item finished');
    expect(dockLabels()).toEqual(['Open the agenda']);
    fireEvent.click(within(dock()).getByRole('button', { name: 'Open the agenda' }));
    expect(props.onAgenda).toHaveBeenCalled();
    // Trivia scores.
    expect(screen.getByText('Final score')).toBeInTheDocument();
  });

  test('an unscored item (a poll) ends without a score', async () => {
    makeServer({ joins: [IN('Priya Raman')], state: 'ENDED', gameType: 'poll' });
    render(<PlayerPage event={eventProps()} />);
    await tick(200);
    await tick(200);
    expect(screen.getByRole('heading', { name: 'Thanks for taking part, Priya Raman.' })).toBeInTheDocument();
    expect(screen.queryByText('Final score')).toBeNull();
  });

  test('a survey item knows it is in an event: no "close this page", the agenda instead', () => {
    const onAgenda = jest.fn();
    render(
      <SurveyRunner
        gameId={GAME}
        playerName="Priya"
        apiBase="http://api.test/"
        fetchFn={() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })}
        state="ENDED"
        event={{ onAgenda, nextTitle: 'Break' }}
      />,
    );
    expect(screen.getByText('This item is finished')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thanks for taking part, Priya.' })).toBeInTheDocument();
    expect(screen.getByTestId('ended-next')).toHaveTextContent('Up next Break');
    expect(document.body.textContent).not.toMatch(/close this page/i);
    expect(screen.queryByText('Final score')).toBeNull();
    fireEvent.click(within(dock()).getByRole('button', { name: 'Open the agenda' }));
    expect(onAgenda).toHaveBeenCalled();
    expect(document.querySelector('.plr')).toHaveAttribute('data-phase', 'done');
  });

  test('the same survey on its own still says you can close the page, with no dock', () => {
    render(
      <SurveyRunner
        gameId={GAME}
        playerName="Priya"
        apiBase="http://api.test/"
        fetchFn={() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })}
        state="ENDED"
      />,
    );
    expect(screen.getByText('That’s a wrap')).toBeInTheDocument();
    expect(screen.getByText(/You can close this page/)).toBeInTheDocument();
    expect(dock()).toBeNull();
  });
});

describe('a new device in an event is asked, never silently "Chris 2"', () => {
  const TAKEN = { status: 409, body: { error: 'Name already in use', code: 'NAME_TAKEN', playerName: 'Chris', attendee: true, message: 'Someone in this event is already answering as "Chris". If that is you on another device, you can move your name here.' } };

  test('the collision screen, with the event\'s way to be someone else', async () => {
    makeServer({ joins: [TAKEN] });
    render(<PlayerPage event={eventProps()} />);
    await tick(0);
    expect(screen.getByRole('heading', { name: 'Chris is already in this session.' })).toBeInTheDocument();
    expect(dockLabels()).toEqual([HANDOVER_LABELS.claim, HANDOVER_LABELS.someoneElseEvent]);
    // No name form inside an event.
    expect(screen.queryByLabelText(/Session code/i)).toBeNull();
  });

  test('"I\'m someone else" takes a numbered seat with the token and newSeat', async () => {
    const server = makeServer({ joins: [TAKEN, IN('Chris 2')] });
    render(<PlayerPage event={eventProps()} />);
    await tick(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: HANDOVER_LABELS.someoneElseEvent })); });
    await tick(200);
    const last = server.joinCalls[server.joinCalls.length - 1];
    expect(last.newSeat).toBe(true);
    expect(last.attendeeToken).toBe('at_0123456789abcdef.secret');
    expect(localStorage.getItem(`playerName_${GAME}`)).toBe('Chris 2');
  });

  test('"That\'s me" asks the host for "Chris", and the quiet retry claims with the token', async () => {
    const server = makeServer({
      joins: [TAKEN, (b) => (b.claimExisting ? { status: 200, body: { ...TAKEN.body, waiting: true } } : TAKEN)],
    });
    render(<PlayerPage event={eventProps()} />);
    await tick(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: HANDOVER_LABELS.claim })); });
    await tick(0);
    expect(server.asks).toHaveLength(1);
    expect(screen.getByText('Waiting for the host to let you in as Chris.')).toBeInTheDocument();
    await tick(4000);
    const claims = server.joinCalls.filter((c) => c.claimExisting);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims.every((c) => c.attendeeToken === 'at_0123456789abcdef.secret' && c.waitStatus === true)).toBe(true);
  });
});
