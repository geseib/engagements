/**
 * Task 4, 2026-09-26 bug sweep — the client half of POST /games/{id}/end.
 *
 * Mirrors nextQuestion.test.js's shape: real response objects, no mocked
 * `fetch` global, and every case resolves rather than throwing.
 */
import { requestEndSession } from '../utils/endSession';

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  json: async () => JSON.parse(body),
});

describe('requestEndSession', () => {
  test('a good response ends the session', async () => {
    const out = await requestEndSession({
      fetchFn: async () => res(200, JSON.stringify({ success: true, state: 'ENDED', changed: true })),
      apiBase: '/api/',
      gameId: '4821',
    });
    expect(out.ended).toBe(true);
    expect(out.data.state).toBe('ENDED');
    expect(out.error).toBeNull();
  });

  // rejects: telling the host to press again after a second click that
  // legitimately did nothing. The route is idempotent (`changed: false`), and
  // that is still `ended: true` — the session IS ended, whichever call did it.
  test('an idempotent no-op still counts as ended', async () => {
    const out = await requestEndSession({
      fetchFn: async () => res(200, JSON.stringify({ success: true, state: 'ENDED', changed: false })),
      apiBase: '/api/',
      gameId: '4821',
    });
    expect(out.ended).toBe(true);
    expect(out.data.changed).toBe(false);
  });

  // rejects: a survey's 400 being read as a generic, retryable failure — the
  // host is told the truth (the server's own sentence), not "please try again".
  test('a survey is refused, and the reason comes through', async () => {
    const out = await requestEndSession({
      fetchFn: async () => res(400, JSON.stringify({ error: 'A survey ends through Close then End the session, not this route.' })),
      apiBase: '/api/',
      gameId: '4821',
    });
    expect(out.ended).toBe(false);
    expect(out.error).toMatch(/survey/i);
  });

  test('another organisation, or an anonymous caller: 404, described without throwing', async () => {
    const out = await requestEndSession({
      fetchFn: async () => res(404, JSON.stringify({ error: 'Game not found' })),
      apiBase: '/api/',
      gameId: '4821',
    });
    expect(out.ended).toBe(false);
    expect(out.error).toMatch(/Game not found/);
  });

  test('a request that never lands is a clean did-not-end', async () => {
    const out = await requestEndSession({
      fetchFn: async () => { throw new Error('NetworkError: connection lost'); },
      apiBase: '/api/',
      gameId: '4821',
    });
    expect(out.ended).toBe(false);
    expect(out.error).toMatch(/connection lost/);
  });

  test('a 2xx with an unreadable body still counts as ended', async () => {
    const out = await requestEndSession({
      fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
      apiBase: '/api/',
      gameId: '4821',
    });
    expect(out.ended).toBe(true);
    expect(out.error).toMatch(/ended/i);
  });
});
