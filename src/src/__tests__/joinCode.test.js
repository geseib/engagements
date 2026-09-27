/**
 * WHAT A FOUR-DIGIT CODE OPENS — utils/joinCode.js (events M2), asked by the
 * join box (hooks/useJoinCode.js) and by the player page after a 404.
 *
 * rejects: a request that is not exactly GET {API_BASE}join/{code}, or that
 * carries credentials; an event's code sent to the session join; a check
 * that strands a participant — anything the check cannot settle must read as
 * a session, exactly as before events existed; a request for a code that is
 * not four digits.
 */
import { resolveJoinCode, joinPathFor, eventPath, sessionPath } from '../utils/joinCode';

const answer = (status, body) => jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

test('asks GET {API_BASE}join/{code}, with nothing but the URL', async () => {
  const fetchImpl = answer(200, { code: '5307', kind: 'event' });
  await resolveJoinCode('5307', { apiBase: 'https://api.test/dev/', fetchImpl });
  expect(fetchImpl).toHaveBeenCalledWith('https://api.test/dev/join/5307');
});

test.each([
  [200, { kind: 'event' }, 'event'],
  [200, { kind: 'session' }, 'session'],
  [404, { error: 'Nothing is running with that code.' }, 'missing'],
  [500, {}, 'unknown'],
  [200, {}, 'unknown'],
])('%s %j reads as %s', async (status, body, kind) => {
  expect(await resolveJoinCode('5307', { apiBase: '/', fetchImpl: answer(status, body) })).toBe(kind);
});

test('a network failure is "unknown", never "missing"', async () => {
  const fetchImpl = jest.fn(async () => { throw new Error('Failed to fetch'); });
  expect(await resolveJoinCode('5307', { apiBase: '/', fetchImpl })).toBe('unknown');
});

test('a code that is not four digits is never sent', async () => {
  const fetchImpl = answer(200, { kind: 'event' });
  expect(await resolveJoinCode('53a7', { apiBase: '/', fetchImpl })).toBe('unknown');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('an event goes to the attendee\'s page; everything else to the session join', () => {
  expect(joinPathFor('5307', 'event')).toBe(eventPath('5307'));
  expect(eventPath('5307')).toBe('/play?event=5307');
  for (const kind of ['session', 'unknown', 'missing']) expect(joinPathFor('4821', kind)).toBe(sessionPath('4821'));
  expect(sessionPath('4821')).toBe('/play?gameId=4821');
});
