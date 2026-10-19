/**
 * THE WALL FOLLOWS THE SERVER (two-surface PLAN 2.8).
 *
 * Frames are refetch signals only: the payload is ignored and the public
 * reads are fetched again. A reconnect refetches. A reply that was overtaken
 * by a newer one is dropped. A game that is not there says so.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import usePresentation, { eventDetailsOf, REFETCH_DEBOUNCE_MS, FIRST_REPORT_EVERY_MS, FIRST_REPORT_TRIES } from '../present/usePresentation';
import webSocketClient from '../WebSocketClient';

jest.mock('../WebSocketClient', () => {
  const handlers = new Map();
  return {
    __esModule: true,
    default: {
      handlers,
      connect: jest.fn(() => true),
      disconnect: jest.fn(),
      isConnected: jest.fn(() => true),
      onMessage: jest.fn((type, fn) => handlers.set(type, fn)),
      offMessage: jest.fn((type) => handlers.delete(type)),
      onReconnected: jest.fn(function (fn) { this.reconnected = fn; }),
      sendCleanMessage: jest.fn(() => true),
      onConnectionStatusChange: jest.fn(),
    },
  };
});

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const stateBody = (over = {}) => ({
  gameId: '5479', state: 'ASK#002', currentQuestion: 2, gameType: 'call-and-answer',
  stageBeat: 'results', stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
  stageNotes: { page: 0, pages: null, rev: 0 }, scoreboard: { open: false },
  roomCounts: { joined: 4, answered: 1, voted: 0 }, gameMetadata: { title: 'T' }, ...over,
});

let stateQueue;
beforeEach(() => {
  jest.useFakeTimers();
  window.API_BASE = 'https://api.test.invalid/dev/';
  stateQueue = [];
  webSocketClient.handlers.clear();
  webSocketClient.connect.mockClear();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/state')) {
      const next = stateQueue.length ? stateQueue.shift() : json(stateBody());
      return typeof next === 'function' ? next() : next;
    }
    return json({});
  });
});
afterEach(() => { jest.useRealTimers(); });

const stateCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/state'));

test('reads the room view of /state and connects as a viewer', async () => {
  const { result } = renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  expect(String(stateCalls()[0][0])).toBe('https://api.test.invalid/dev/games/5479/state?view=room');
  const [gameId, name, isHost, options] = webSocketClient.connect.mock.calls[0];
  expect(gameId).toBe('5479');
  expect(name).toBeNull();
  expect(isHost).toBe(false);
  expect(options.viewerId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
});

test('a frame triggers a refetch, and its payload is ignored', async () => {
  const { result } = renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const before = stateCalls().length;
  stateQueue.push(json(stateBody({ state: 'VOTE#002' })));
  act(() => { webSocketClient.handlers.get('votingStarted')({ type: 'votingStarted', state: 'ENDED', names: ['Ada'] }); });
  act(() => { jest.advanceTimersByTime(REFETCH_DEBOUNCE_MS + 10); });
  await waitFor(() => expect(result.current.snapshot.state).toBe('VOTE#002'));
  expect(stateCalls().length).toBe(before + 1);
});

test('a burst of frames is one refetch', async () => {
  const { result } = renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const before = stateCalls().length;
  act(() => {
    webSocketClient.handlers.get('playerAnswered')({});
    webSocketClient.handlers.get('playerAnswered')({});
    webSocketClient.handlers.get('stageFocusChanged')({});
  });
  act(() => { jest.advanceTimersByTime(REFETCH_DEBOUNCE_MS + 10); });
  await waitFor(() => expect(stateCalls().length).toBe(before + 1));
});

test('a reconnect refetches', async () => {
  const { result } = renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const before = stateCalls().length;
  act(() => { webSocketClient.reconnected(); });
  act(() => { jest.advanceTimersByTime(REFETCH_DEBOUNCE_MS + 10); });
  await waitFor(() => expect(stateCalls().length).toBe(before + 1));
});

test('a reply overtaken by a newer one is dropped', async () => {
  let releaseSlow;
  const slow = () => new Promise((resolve) => { releaseSlow = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(stateBody({ state: 'ASK#002' })) }); });
  stateQueue.push(slow, json(stateBody({ state: 'VOTE#002' })));
  const { result } = renderHook(() => usePresentation('5479'));
  act(() => { webSocketClient.handlers.get('votingStarted')({}); });
  act(() => { jest.advanceTimersByTime(REFETCH_DEBOUNCE_MS + 10); });
  await waitFor(() => expect(result.current.snapshot && result.current.snapshot.state).toBe('VOTE#002'));
  await act(async () => { releaseSlow(); });
  expect(result.current.snapshot.state).toBe('VOTE#002');
});

test('a game that is not there is NOT_FOUND', async () => {
  stateQueue.push(json({ error: 'Game not found' }, 404));
  const { result } = renderHook(() => usePresentation('0000'));
  await waitFor(() => expect(result.current.snapshot).toEqual({ notFound: true }));
});

test('polls every 3 s while the room is answering', async () => {
  const { result } = renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const before = stateCalls().length;
  act(() => { jest.advanceTimersByTime(3100); });
  await waitFor(() => expect(stateCalls().length).toBeGreaterThan(before));
});

test('during VOTE with a vote focus it reads the room view of the answers', async () => {
  stateQueue.push(json(stateBody({ state: 'VOTE#002', stageFocus: { focus: 'answer', index: 0, part: 0, parts: 1, phase: 'VOTE', rev: 1 } })));
  renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/answers'))).toBe(true));
  const url = String(global.fetch.mock.calls.find(([u]) => String(u).includes('/answers'))[0]);
  expect(url).toBe('https://api.test.invalid/dev/games/5479/answers?questionNumber=002&view=room');
});

test('at RESULTS it reads get-results for the round on screen', async () => {
  stateQueue.push(json(stateBody({ state: 'RESULTS#002' })));
  renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes('get-results'))).toBe(true));
  const [, init] = global.fetch.mock.calls.find(([u]) => String(u).includes('get-results'));
  expect(JSON.parse(init.body)).toEqual({ gameId: '5479', questionNumber: '002' });
});

// A comment the host puts up during results or the read (19 Oct 2026): the
// window reads the round's comments on those beats too, not only on feedback.
test.each(['results', 'field-notes'])('on the %s beat it reads the round\'s comments', async (beat) => {
  stateQueue.push(json(stateBody({ state: 'RESULTS#002', stageBeat: beat })));
  renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/comments?'))).toBe(true));
  expect(String(global.fetch.mock.calls.find(([u]) => String(u).includes('/comments?'))[0])).toBe('https://api.test.invalid/dev/games/5479/comments?questionNumber=002');
});

// The end, as the stage ends it (19 Oct 2026): the public standings for the podium.
test('at ENDED it reads the public players once, for the podium', async () => {
  stateQueue.push(json(stateBody({ state: 'ENDED', currentQuestion: 3 })));
  global.fetch.mockImplementation((url) => {
    if (String(url).includes('/state')) return json(stateBody({ state: 'ENDED', currentQuestion: 3 }));
    if (String(url).endsWith('/players')) return json({ players: [{ playerName: 'Ada', totalScore: 3 }] });
    return json({});
  });
  const { result } = renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(result.current.reads.players).toEqual([{ playerName: 'Ada', totalScore: 3 }]));
  expect(String(global.fetch.mock.calls.find(([u]) => String(u).endsWith('/players'))[0])).toBe('https://api.test.invalid/dev/games/5479/players');
});

/*
  THE FIRST PRESENT_STATUS WAITS FOR THE SOCKET (final review, 15 Oct).
  sendCleanMessage returns false before the socket opens; the first report is
  retried every second until it returns true, ten tries at most.
*/
describe('the first PRESENT_STATUS', () => {
  const statusSends = () => webSocketClient.sendCleanMessage.mock.calls.filter(([type]) => type === 'PRESENT_STATUS').length;
  afterEach(() => { webSocketClient.sendCleanMessage.mockReset(); webSocketClient.sendCleanMessage.mockImplementation(() => true); });

  test('retried every second until the socket takes it, then no more', async () => {
    webSocketClient.sendCleanMessage.mockReset();
    webSocketClient.sendCleanMessage
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => false)
      .mockImplementation(() => true);
    const { result } = renderHook(() => usePresentation('5479'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(statusSends()).toBe(0);
    act(() => { jest.advanceTimersByTime(FIRST_REPORT_EVERY_MS); });
    expect(statusSends()).toBe(1);
    act(() => { jest.advanceTimersByTime(FIRST_REPORT_EVERY_MS); });
    expect(statusSends()).toBe(2);
    act(() => { jest.advanceTimersByTime(FIRST_REPORT_EVERY_MS); });
    expect(statusSends()).toBe(3); // accepted
    act(() => { jest.advanceTimersByTime(FIRST_REPORT_EVERY_MS * 5); });
    expect(statusSends()).toBe(3);
  });

  test('gives up after ten tries; the minute tick still reports', async () => {
    webSocketClient.sendCleanMessage.mockReset();
    webSocketClient.sendCleanMessage.mockImplementation(() => false);
    const { result } = renderHook(() => usePresentation('5479'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => { jest.advanceTimersByTime(FIRST_REPORT_EVERY_MS * (FIRST_REPORT_TRIES + 5)); });
    expect(statusSends()).toBe(FIRST_REPORT_TRIES);
    act(() => { jest.advanceTimersByTime(60 * 1000); });
    expect(statusSends()).toBe(FIRST_REPORT_TRIES + 1);
  });

  test('an unmount stops the retries', async () => {
    webSocketClient.sendCleanMessage.mockReset();
    webSocketClient.sendCleanMessage.mockImplementation(() => false);
    const { result, unmount } = renderHook(() => usePresentation('5479'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => { jest.advanceTimersByTime(FIRST_REPORT_EVERY_MS * 2); });
    expect(statusSends()).toBe(2);
    unmount();
    act(() => { jest.advanceTimersByTime(FIRST_REPORT_EVERY_MS * 10); });
    expect(statusSends()).toBe(2);
  });
});

// THE EVENT DETAILS for the lobby (owner, 18 Oct 2026): once, from the public
// read the join screen uses; Quick start's filler is left off.
test('reads the event details once, from the public session read', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/state')) return json(stateBody());
    if (/games\/5479\?role=player$/.test(String(url))) return json({ engagementInfo: '  Two hours on the roadmap. ' });
    return json({});
  });
  const { result } = renderHook(() => usePresentation('5479'));
  await waitFor(() => expect(result.current.reads.details).toBe('Two hours on the roadmap.'));
  const briefCalls = global.fetch.mock.calls.filter(([u]) => /\?role=player$/.test(String(u)));
  expect(briefCalls).toHaveLength(1);
});

test('the event details: the host\'s words only', () => {
  expect(eventDetailsOf('Quick start session using Amazon Leadership Principles')).toBe('');
  expect(eventDetailsOf(null)).toBe('');
  expect(eventDetailsOf('  Offsite, day two ')).toBe('Offsite, day two');
});
