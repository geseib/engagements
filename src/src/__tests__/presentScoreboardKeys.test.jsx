/**
 * THE SCOREBOARD FROM THE ROOM'S WINDOW (owner, 3 Nov 2026: "the scoreboard
 * shortcut key should work on two screen mode from either screen in focus").
 *
 * The room's window (/present) sends the host page's own request,
 * POST /games/{id}/scoreboard, and only once the host's door for the session
 * has said 200 (present/presentControls.js); the server checks
 * callerMayDriveSession again. The host's laptop hears the change on its
 * scoreboardChanged frame, as it hears the phone Remote's.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import usePresentControls, { KEY_DEBOUNCE_MS } from '../present/presentControls';
import { authFetch, getAuthToken } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn() }));

const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const host = (over = {}) => ({
  state: 'RESULTS#005', stageBeat: 'results', gameType: 'trivia', currentQuestion: 5,
  answerProgress: { answersReceived: 4, totalPlayers: 4 }, stageFocus: { focus: 'none' }, ...over,
});
const RESULTS = {
  state: 'RESULTS#005', stageBeat: 'results', gameType: 'trivia',
  stageFocus: { focus: 'none', index: null }, stageNotes: { page: 0, pages: 3 }, roomCounts: { joined: 4 },
};
const CLOSED = { ...RESULTS, scoreboard: { open: false, style: 'departure', rev: 2 } };
const OPEN = { ...RESULTS, scoreboard: { open: true, style: 'olympic', rev: 3 } };

const press = (key, init = {}) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })); });
const posts = () => authFetch.mock.calls.filter(([, init]) => init && init.method === 'POST');
const boardPosts = () => posts().filter(([url]) => /\/scoreboard$/.test(url));
const wallPosts = () => posts().filter(([url]) => /stage-(focus|beat)$/.test(url));
const bodyOf = (call) => JSON.parse(call[1].body);
const serve = (hostJson, status = 200) => authFetch.mockImplementation((url) => (String(url).includes('host-state')
  ? reply(hostJson, status) : reply({})));
const pause = () => new Promise((r) => setTimeout(r, KEY_DEBOUNCE_MS + 30));
const mount = (snapshot, refetch = jest.fn()) => renderHook(() => usePresentControls({ gameId: '5479', snapshot, total: 3, refetch }));

beforeEach(() => {
  window.API_BASE = 'https://api.test.invalid/dev/';
  authFetch.mockReset();
  getAuthToken.mockReset();
  getAuthToken.mockResolvedValue('token');
});

test('S on the room\'s window shows the scoreboard with the host page\'s request', async () => {
  serve(host());
  const refetch = jest.fn();
  const { result } = mount(CLOSED, refetch);
  await waitFor(() => expect(result.current.armed).toBe(true));
  press('s');
  await waitFor(() => expect(boardPosts()).toHaveLength(1));
  expect(boardPosts()[0][0]).toBe('https://api.test.invalid/dev/games/5479/scoreboard');
  expect(bodyOf(boardPosts()[0])).toEqual({ open: true });
  await waitFor(() => expect(refetch).toHaveBeenCalledWith(true));
  expect(wallPosts()).toHaveLength(0);
});

test('while it is up: V the next look, → and a clicker page it, Space and S hide it; the wall underneath never moves', async () => {
  serve(host());
  const { result } = mount(OPEN);
  await waitFor(() => expect(result.current.armed).toBe(true));
  expect(result.current.scoreboardOpen).toBe(true);
  const steps = [
    ['V', { style: 'tote' }],
    ['ArrowRight', { step: 'next' }],
    ['PageUp', { step: 'prev' }],
    [' ', { open: false }],
    ['Escape', { open: false }],
    ['S', { open: false }],
  ];
  for (let i = 0; i < steps.length; i += 1) {
    const [key, body] = steps[i];
    // eslint-disable-next-line no-await-in-loop
    if (i) await pause();
    press(key);
    // eslint-disable-next-line no-await-in-loop
    await waitFor(() => expect(boardPosts()).toHaveLength(i + 1));
    expect(bodyOf(boardPosts()[i])).toEqual(body);
  }
  expect(wallPosts()).toHaveLength(0);
  expect(result.current.confirm).toBeNull();
});

test('V with the board down does nothing', async () => {
  serve(host());
  const { result } = mount(CLOSED);
  await waitFor(() => expect(result.current.armed).toBe(true));
  press('v');
  await pause();
  expect(posts()).toHaveLength(0);
});

test('a public viewer (no sign-in) cannot toggle it: no request, no error, the strip says why', async () => {
  getAuthToken.mockResolvedValue(null);
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { result } = mount(CLOSED);
    await waitFor(() => expect(result.current.access).toBe('signed-out'));
    press('s');
    await waitFor(() => expect(result.current.strip).toBe(true));
    expect(posts()).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

test('signed in as someone who may not drive the session: no request', async () => {
  serve({ error: 'Game not found' }, 404);
  const { result } = mount(OPEN);
  await waitFor(() => expect(result.current.access).toBe('not-host'));
  press('s');
  await pause();
  press('v');
  await waitFor(() => expect(result.current.strip).toBe(true));
  expect(posts()).toHaveLength(0);
});

test('never while typing, with a modifier or on auto-repeat', async () => {
  serve(host());
  const { result } = mount(CLOSED);
  await waitFor(() => expect(result.current.armed).toBe(true));
  const input = document.createElement('input');
  document.body.appendChild(input);
  try {
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })); });
    press('s', { ctrlKey: true });
    press('s', { metaKey: true });
    press('s', { repeat: true });
    await pause();
    expect(posts()).toHaveLength(0);
  } finally {
    input.remove();
  }
});

test('a session with no board (Poll): S is not the board\'s', async () => {
  serve(host({ gameType: 'poll' }));
  const { result } = mount({ ...RESULTS, gameType: 'poll' });
  await waitFor(() => expect(result.current.armed).toBe(true));
  press('s');
  await pause();
  expect(boardPosts()).toHaveLength(0);
});
