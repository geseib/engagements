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

test('a refusal, a dropped connection or no set is an empty list', async () => {
  authFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
  expect(await listPersonas('trivia')).toEqual([]);
  authFetch.mockRejectedValueOnce(new Error('offline'));
  expect(await listSetCategories('custq4', 'org')).toEqual([]);
  expect(await listSetCategories('', 'org')).toEqual([]);
});
