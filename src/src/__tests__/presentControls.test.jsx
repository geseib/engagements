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
