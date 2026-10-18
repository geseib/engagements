/**
 * THE PRESENTATION'S KEYS (two-surface 2.11; owner, 2026-10-13).
 *
 * Keys walk the wall for a host who may drive the session; with nothing left
 * to walk, Forward asks first on the wall ("Next step: Start voting", ← stay,
 * → go) and then runs the same request the Remote sends; J puts the join code
 * up and takes it down. When the keys cannot act, the wall says why instead
 * of staying silent.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import usePresentControls, { keyDirection, KEY_DEBOUNCE_MS, WALL_PRIMARIES, ACCESS_NOTES } from '../present/presentControls';
import { authFetch, getAuthToken } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn() }));

const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const host = (over = {}) => ({
  state: 'ASK#005', gameType: 'call-and-answer', currentQuestion: 5,
  answerProgress: { answersReceived: 4, totalPlayers: 4 }, stageFocus: { focus: 'none' }, ...over,
});
const ASK = { state: 'ASK#005', stageFocus: { focus: 'none' }, roomCounts: { joined: 4, answered: 4 } };
const RESULTS = {
  state: 'RESULTS#005', stageBeat: 'results',
  stageFocus: { focus: 'none', index: null }, stageNotes: { page: 0, pages: 3 }, roomCounts: { joined: 4 },
};
const press = (key) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
const posts = () => authFetch.mock.calls.filter(([, init]) => init && init.method === 'POST');
const serve = (hostJson, status = 200) => authFetch.mockImplementation((url) => (String(url).includes('host-state')
  ? reply(hostJson, status) : reply({})));
const pause = () => new Promise((r) => setTimeout(r, KEY_DEBOUNCE_MS + 30));

beforeEach(() => {
  window.API_BASE = 'https://api.test.invalid/dev/';
  authFetch.mockReset();
  getAuthToken.mockReset();
  getAuthToken.mockResolvedValue('token');
});

test('keyDirection: clicker and arrow keys, never with a modifier or in a field', () => {
  expect(keyDirection({ key: 'PageDown' })).toBe('forward');
  expect(keyDirection({ key: ' ' })).toBe('forward');
  expect(keyDirection({ key: 'ArrowLeft' })).toBe('back');
  expect(keyDirection({ key: 'ArrowRight', metaKey: true })).toBeNull();
  expect(keyDirection({ key: 'ArrowRight', target: { tagName: 'INPUT' } })).toBeNull();
});

describe('when the keys cannot act, the wall says why', () => {
  test('no sign-in on this browser', async () => {
    getAuthToken.mockResolvedValue(null);
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.access).toBe('signed-out'));
    expect(result.current.note).toBe(ACCESS_NOTES['signed-out']);
    press('ArrowRight');
    await waitFor(() => expect(result.current.strip).toBe(true));
    expect(posts()).toHaveLength(0);
  });
  test('signed in, but not a host of this session', async () => {
    serve({ error: 'Game not found' }, 404);
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.access).toBe('not-host'));
    expect(result.current.note).toMatch(/not as a host of this session/);
  });
  test('a key press checks again, so signing in elsewhere and pressing works', async () => {
    getAuthToken.mockResolvedValueOnce(null);
    serve(host({ state: 'RESULTS#005', stageBeat: 'results' }));
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.access).toBe('signed-out'));
    press('ArrowRight');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toMatch(/stage-focus$/);
  });
});

describe('for a host', () => {
  test('→ walks the wall first: response 1 at results', async () => {
    serve(host({ state: 'RESULTS#005', stageBeat: 'results' }));
    const refetch = jest.fn();
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch }));
    await waitFor(() => expect(result.current.armed).toBe(true));
    press('ArrowRight');
    await waitFor(() => expect(refetch).toHaveBeenCalledWith(true));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ focus: 'answer', index: 0, part: 0, questionNumber: 5 });
  });

  test('nothing left to walk: → asks on the wall, a second → goes on', async () => {
    serve(host());
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: ASK, total: 4, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.step && result.current.step.primary.id).toBe('open-vote'));
    press('ArrowRight');
    await waitFor(() => expect(result.current.confirm).toEqual({ id: 'open-vote', label: 'Start voting', note: '' }));
    expect(posts()).toHaveLength(0);
    await pause();
    press('ArrowRight');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe('https://api.test.invalid/dev/games/5479/start-vote');
    expect(result.current.confirm).toBeNull();
  });

  test('the ask says who is still going, and ← or Esc stays', async () => {
    serve(host({ answerProgress: { answersReceived: 2, totalPlayers: 4 } }));
    const snapshot = { ...ASK, roomCounts: { joined: 4, answered: 2 } };
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot, total: 2, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.step && result.current.step.primary.arm).toBeTruthy());
    press('PageDown');
    // roundStep's arm says the room's size since 16 Oct 2026 (walk W3).
    await waitFor(() => expect(result.current.confirm && result.current.confirm.note).toBe('2 of 4 still writing.'));
    await pause();
    press('ArrowLeft');
    await waitFor(() => expect(result.current.confirm).toBeNull());
    await pause();
    press('PageDown');
    await waitFor(() => expect(result.current.confirm).not.toBeNull());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await waitFor(() => expect(result.current.confirm).toBeNull());
    expect(posts()).toHaveLength(0);
  });

  test('Enter confirms too', async () => {
    serve(host());
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: ASK, total: 4, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.step).not.toBeNull());
    press('ArrowRight');
    await waitFor(() => expect(result.current.confirm).not.toBeNull());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  // THE QR SIDE PANEL (owner, 18 Oct 2026): J sends {join: !current} and no
  // focus, so whatever the room is looking at stays up beside the QR.
  test('J shows the QR panel, and takes it down, leaving the focus alone', async () => {
    serve(host());
    const { result, rerender } = renderHook(({ snap }) => usePresentControls({ gameId: '5479', snapshot: snap, total: 4, refetch: jest.fn() }),
      { initialProps: { snap: ASK } });
    await waitFor(() => expect(result.current.armed).toBe(true));
    press('j');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ join: true, questionNumber: 5 });
    rerender({ snap: { ...ASK, stageFocus: { focus: 'none', index: null, join: true } } });
    expect(result.current.joinShown).toBe(true);
    press('J');
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse(posts()[1][1].body)).toEqual({ join: false, questionNumber: 5 });
  });

  test('a legacy focus of join still reads as the QR up', async () => {
    serve(host());
    const { result } = renderHook(() => usePresentControls({
      gameId: '5479', snapshot: { ...ASK, stageFocus: { focus: 'join' } }, total: 4, refetch: jest.fn(),
    }));
    await waitFor(() => expect(result.current.armed).toBe(true));
    expect(result.current.joinShown).toBe(true);
  });

  test('the keys step from the voting overview when every answer fits (overview passed through)', async () => {
    serve(host({ state: 'VOTE#005' }));
    const snapshot = { state: 'VOTE#005', stageFocus: { focus: 'none', index: null }, roomCounts: { joined: 4 } };
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot, total: 3, overview: true, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.armed).toBe(true));
    press('ArrowRight');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ focus: 'answer', index: 0, part: 0, questionNumber: 5 });
  });

  test('Workie\'s page turns with a relative step', async () => {
    serve(host({ state: 'RESULTS#005', stageBeat: 'field-notes' }));
    const snapshot = { ...RESULTS, stageBeat: 'field-notes', stageNotes: { page: 1, pages: 3 } };
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot, total: 3, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.armed).toBe(true));
    press('PageUp');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ step: 'prev', questionNumber: 5 });
  });

  test('a clicker\'s double pulse is one press', async () => {
    serve(host({ state: 'RESULTS#005', stageBeat: 'results' }));
    const { result } = renderHook(() => usePresentControls({ gameId: '5479', snapshot: RESULTS, total: 3, refetch: jest.fn() }));
    await waitFor(() => expect(result.current.armed).toBe(true));
    press('PageDown');
    press('PageDown');
    await waitFor(() => expect(posts()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(posts()).toHaveLength(1);
  });

  test('round moves the wall makes, and the ones it never does', () => {
    expect(WALL_PRIMARIES).toEqual(expect.arrayContaining(['start', 'open-vote', 'reveal', 'next']));
    for (const never of ['skip', 'report', 'leave']) expect(WALL_PRIMARIES).not.toContain(never);
  });
});
