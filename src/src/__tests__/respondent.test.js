/**
 * THE ANONYMOUS RESPONDENT ID — minted on the phone, never derived from anything.
 *
 * IMPLEMENTATION-phase-2.md §2 "Rows": in Anonymous and Who finished, a
 * person's answers are filed under `SURVEY#RESP#<respondent>`, and the whole of
 * the Names promise rests on that id carrying nothing about who they are. The
 * server checks the shape (`/^r_[A-Za-z0-9_-]{22}$/`); this file checks the
 * three things only the phone can get wrong: the shape, that it is per game,
 * and that it is not the join clientId — the one value the server DOES tie to a
 * player's name.
 */
import { getRespondentId, respondentStorageKey, mintRespondentId } from '../components/survey/respondent';
import { getClientId } from '../components/joinResult';

const SHAPE = /^r_[A-Za-z0-9_-]{22}$/;

/** A Storage double. `throws` makes every call throw, as private-mode Safari does on setItem. */
function memoryStorage({ throws = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => { if (throws) throw new Error('denied'); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error('QuotaExceededError'); data.set(k, String(v)); },
  };
}

describe('the respondent id', () => {
  test('is r_ and 22 base64url characters — 128 random bits', () => {
    const id = getRespondentId('4821', memoryStorage());
    expect(id).toMatch(SHAPE);
  });

  test('is minted from crypto.getRandomValues', () => {
    const spy = jest.spyOn(globalThis.crypto, 'getRandomValues');
    const id = mintRespondentId();
    expect(id).toMatch(SHAPE);
    expect(spy).toHaveBeenCalled();
    const bytes = spy.mock.calls[0][0];
    expect(bytes.length).toBe(16);
    spy.mockRestore();
  });

  test('two mints differ', () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintRespondentId()));
    expect(seen.size).toBe(50);
  });

  test('is kept under surveyResp_<gameId> and read back the same on the next call', () => {
    const store = memoryStorage();
    const first = getRespondentId('4821', store);
    expect(respondentStorageKey('4821')).toBe('surveyResp_4821');
    expect(store.data.get('surveyResp_4821')).toBe(first);
    expect(getRespondentId('4821', store)).toBe(first);
  });

  // rejects: one id across sessions, which would be a tracking handle
  test('is per game', () => {
    const store = memoryStorage();
    const a = getRespondentId('4821', store);
    const b = getRespondentId('7310', store);
    expect(a).not.toBe(b);
    expect(store.data.get('surveyResp_7310')).toBe(b);
  });

  // rejects: deriving the respondent from the join clientId — the clientId is
  // stamped on PLAYER#<name>, so a respondent made from it links name to answers
  test('is not the join clientId, and does not contain it', () => {
    const store = memoryStorage();
    const clientId = getClientId('4821', store);
    const respondent = getRespondentId('4821', store);
    expect(clientId).toBeTruthy();
    expect(respondent).not.toBe(clientId);
    expect(respondent).not.toContain(clientId);
    expect(respondent.slice(2)).not.toContain(String(clientId).replace(/-/g, '').slice(0, 8));
    expect(store.data.get('playerClient_4821')).toBe(clientId);
    expect(store.data.get('surveyResp_4821')).toBe(respondent);
  });

  test('replaces a stored value that is not the shape', () => {
    const store = memoryStorage();
    store.data.set('surveyResp_4821', 'Ada');
    const id = getRespondentId('4821', store);
    expect(id).toMatch(SHAPE);
    expect(store.data.get('surveyResp_4821')).toBe(id);
  });

  // rejects: a phone with storage switched off being unable to answer at all
  test('falls back to an in-memory id when storage throws, stable for the page', () => {
    const store = memoryStorage({ throws: true });
    const a = getRespondentId('4821', store);
    expect(a).toMatch(SHAPE);
    expect(getRespondentId('4821', store)).toBe(a);
    expect(getRespondentId('7310', store)).not.toBe(a);
  });

  test('with no storage at all, the same in-memory fallback', () => {
    const a = getRespondentId('5555', null);
    expect(a).toMatch(SHAPE);
    expect(getRespondentId('5555', null)).toBe(a);
  });
});
