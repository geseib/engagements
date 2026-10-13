/**
 * The Presentation's keys act only for a host who may drive the session, walk
 * the wall through presentKeys, and debounce a clicker's double pulse.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import usePresentControls, { keyDirection, KEY_DEBOUNCE_MS } from '../present/presentControls';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const ok = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
const refused = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
const RESULTS = {
  state: 'RESULTS#005', stageBeat: 'results',
  stageFocus: { focus: 'none', index: null }, stageNotes: { page: 0, pages: 3 },
};
const press = (key, extra = {}) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra })); });

beforeEach(() => { window.API_BASE = 'https://api.test.invalid/dev/'; authFetch.mockReset(); });

test('keyDirection: clicker and arrow keys, never with a modifier or in a field', () => {
  expect(keyDirection({ key: 'PageDown' })).toBe('forward');
  expect(keyDirection({ key: ' ' })).toBe('forward');
  expect(keyDirection({ key: 'ArrowLeft' })).toBe('back');
  expect(keyDirection({ key: 'PageUp' })).toBe('back');
  expect(keyDirection({ key: 'ArrowRight', metaKey: true })).toBeNull();
  expect(keyDirection({ key: 'ArrowRight', target: { tagName: 'INPUT' } })).toBeNull();
  expect(keyDirection({ key: 'f' })).toBeNull();
});

test('unsigned or not this session\'s host: keys do nothing', async () => {
  authFetch.mockImplementation(refused);
  const refetch = jest.fn();
  const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch }));
  await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
  expect(result.current.armed).toBe(false);
  press('ArrowRight');
  expect(authFetch).toHaveBeenCalledTimes(1);
});

test('a host\'s → shows response 1 on the wall, through /stage-focus, then looks again', async () => {
  authFetch.mockImplementation(ok);
  const refetch = jest.fn();
  const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch }));
  await waitFor(() => expect(result.current.armed).toBe(true));
  expect(String(authFetch.mock.calls[0][0])).toBe('https://api.test.invalid/dev/games/5479/host-state');
  press('ArrowRight');
  await waitFor(() => expect(refetch).toHaveBeenCalledWith(true));
  const [url, init] = authFetch.mock.calls[1];
  expect(url).toBe('https://api.test.invalid/dev/games/5479/stage-focus');
  expect(JSON.parse(init.body)).toEqual({ focus: 'answer', index: 0, part: 0, questionNumber: 5 });
});

test('Workie\'s page turns with a relative step', async () => {
  authFetch.mockImplementation(ok);
  const snapshot = { ...RESULTS, stageBeat: 'field-notes', stageNotes: { page: 1, pages: 3 } };
  const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot, total: 3, refetch: jest.fn() }));
  await waitFor(() => expect(result.current.armed).toBe(true));
  press('PageUp');
  await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(authFetch.mock.calls[1][1].body)).toEqual({ step: 'prev', questionNumber: 5 });
});

test('a clicker\'s double pulse is one press', async () => {
  authFetch.mockImplementation(ok);
  const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch: jest.fn() }));
  await waitFor(() => expect(result.current.armed).toBe(true));
  press('PageDown');
  press('PageDown');
  await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
  expect(KEY_DEBOUNCE_MS).toBe(250);
});

describe('the round\'s own next step from the wall (owner, 2026-10-13)', () => {
  const host = (over = {}) => ({
    state: 'ASK#005', gameType: 'call-and-answer', currentQuestion: 5,
    answerProgress: { answersReceived: 4, totalPlayers: 4 }, stageFocus: { focus: 'none' }, ...over,
  });
  const reply = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const ASK = { state: 'ASK#005', stageFocus: { focus: 'none' }, roomCounts: { joined: 4, answered: 4 } };
  const posts = () => authFetch.mock.calls.filter(([, init]) => init && init.method === 'POST');

  test('everyone in: → starts voting, through the same request the Remote sends', async () => {
    authFetch.mockImplementation((url) => (String(url).includes('host-state') ? reply(host()) : ok()));
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: ASK, total: 4, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.step && result.current.step.primary.id).toBe('open-vote'));
    press('ArrowRight');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe('https://api.test.invalid/dev/games/5479/start-vote');
    expect(JSON.parse(posts()[0][1].body)).toEqual({ questionNumber: 5 });
  });

  test('an early advance takes two presses, and the first says why', async () => {
    authFetch.mockImplementation((url) => (String(url).includes('host-state')
      ? reply(host({ answerProgress: { answersReceived: 2, totalPlayers: 4 } })) : ok()));
    const snapshot = { ...ASK, roomCounts: { joined: 4, answered: 2 } };
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot, total: 2, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.step && result.current.step.primary.arm).toBeTruthy());
    press('PageDown');
    await waitFor(() => expect(result.current.arming).toMatch(/still answering/));
    expect(posts()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 300));
    press('PageDown');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toMatch(/start-vote$/);
  });

  test('the walk comes first: at results → shows response 1, not What we heard', async () => {
    authFetch.mockImplementation((url) => (String(url).includes('host-state')
      ? reply(host({ state: 'RESULTS#005', stageBeat: 'results' })) : ok()));
    const snapshot = { state: 'RESULTS#005', stageBeat: 'results', stageFocus: { focus: 'none' }, roomCounts: { joined: 4 } };
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot, total: 3, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.step).not.toBeNull());
    press('ArrowRight');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toMatch(/stage-focus$/);
  });

  test('J puts the join code on the wall, and takes it down', async () => {
    authFetch.mockImplementation((url) => (String(url).includes('host-state') ? reply(host()) : ok()));
    const { result, rerender } = renderHook(({ snap }) => usePresentControls({ gameId: '5479', snapshot: snap, total: 4, refetch: jest.fn() }),
      { initialProps: { snap: ASK } });
    await waitFor(() => expect(result.current.armed).toBe(true));
    press('j');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ focus: 'join', index: null, questionNumber: 5 });
    rerender({ snap: { ...ASK, stageFocus: { focus: 'join' } } });
    expect(result.current.joinShown).toBe(true);
    press('J');
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse(posts()[1][1].body)).toEqual({ focus: 'none', index: null, questionNumber: 5 });
  });

  test('a round move the wall never makes: Next round is fine, the report and Skip are not offered', () => {
    const { WALL_PRIMARIES } = require('../present/presentControls');
    expect(WALL_PRIMARIES).toContain('next');
    expect(WALL_PRIMARIES).not.toContain('skip');
    expect(WALL_PRIMARIES).not.toContain('report');
    expect(WALL_PRIMARIES).not.toContain('leave');
  });
});
