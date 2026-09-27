/**
 * THE ITEM DIALOG'S TWO LISTS — utils/sessionSetupApi.js (events M1b Task 11).
 *
 * rejects: the wrong route or a scope left off (an org's set read in Engage's
 * library); a refusal or a dropped connection breaking the dialog instead of
 * leaving the list empty.
 */
import { listPersonas, listSetCategories } from '../utils/sessionSetupApi';

jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

test('the voices for a format', async () => {
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ personas: [{ personaId: 'coach' }] }) });
  expect(await listPersonas('call-and-answer')).toEqual([{ personaId: 'coach' }]);
  expect(authFetch).toHaveBeenCalledWith('https://api.test/admin/personas?gameType=call-and-answer');
});

test('a set\'s categories, read in the library its reference names', async () => {
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ categories: [{ name: 'Ops', questionCount: 6 }] }) });
  expect(await listSetCategories('custq4', 'org')).toEqual([{ name: 'Ops', questionCount: 6 }]);
  expect(authFetch).toHaveBeenCalledWith('https://api.test/question-sets/custq4/categories?scope=org');
});

// fix round 1: an edited item's categories come from the version IT PLAYS,
// not the set's current active version — get-categories.js already accepts
// ?version= and falls back correctly on a deleted pin (set-version.js), so
// the fix here is sending it at all.
test('a set\'s categories at the version the item actually plays, not its current one', async () => {
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ categories: [{ name: 'Ops', questionCount: 4 }] }) });
  expect(await listSetCategories('custq4', 'org', 2)).toEqual([{ name: 'Ops', questionCount: 4 }]);
  expect(authFetch).toHaveBeenCalledWith('https://api.test/question-sets/custq4/categories?scope=org&version=2');
});

test('no version is sent when none is given — the set\'s current active version answers, as before', async () => {
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) });
  await listSetCategories('custq4', 'org', null);
  expect(authFetch).toHaveBeenCalledWith('https://api.test/question-sets/custq4/categories?scope=org');
});

test('a refusal, a dropped connection or no set is an empty list', async () => {
  authFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
  expect(await listPersonas('trivia')).toEqual([]);
  authFetch.mockRejectedValueOnce(new Error('offline'));
  expect(await listSetCategories('custq4', 'org')).toEqual([]);
  expect(await listSetCategories('', 'org')).toEqual([]);
});
