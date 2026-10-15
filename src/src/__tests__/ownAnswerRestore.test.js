/**
 * Session 7924 (14 Oct): after a reload the phone said "You didn't send a
 * response this round" to a player whose answer was scored. The phone now reads
 * its own answer back from get-answers.js `getOwnAnswer`, proving identity with
 * its clientId. These pin the URL and the reading of the payload; the source
 * scan pins that PlayerPage asks and that the heading has a "checking" state.
 */
import fs from 'fs';
import path from 'path';
import { ownAnswerUrl, ownAnswerFrom, fetchOwnAnswer } from '../utils/playerParticipation';

describe('the own-answer address', () => {
  test('pads the round, names the player and carries the client id', () => {
    const url = ownAnswerUrl('/api/', '7924', 2, 'Dana R/W #1', 'c-123');
    expect(url.startsWith('/api/games/7924/answers?')).toBe(true);
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('question')).toBe('002');
    expect(q.get('player')).toBe('Dana R/W #1');
    expect(q.get('clientId')).toBe('c-123');
  });

  test('never carries role=host or view=room, which would read the whole round', () => {
    const url = ownAnswerUrl('/api/', '7924', '003', 'Dana', 'c');
    expect(url).not.toMatch(/role=|view=/);
  });
});

describe('reading the payload', () => {
  test('the text comes back when identity was proven', () => {
    expect(ownAnswerFrom({ hasAnswer: true, answer: 'Retire the sheet' }))
      .toEqual({ status: 'answered', text: 'Retire the sheet' });
  });
  test('an answer without the text is withheld, not missing', () => {
    expect(ownAnswerFrom({ hasAnswer: true, answerWithheld: true })).toEqual({ status: 'withheld' });
  });
  test('no answer is "none"', () => {
    expect(ownAnswerFrom({ hasAnswer: false })).toEqual({ status: 'none' });
  });
  test('a payload that does not say is null, never "none"', () => {
    expect(ownAnswerFrom(null)).toBeNull();
    expect(ownAnswerFrom({})).toBeNull();
    expect(ownAnswerFrom({ hasAnswer: 'false' })).toBeNull();
  });
  test('a failed request or a thrown fetch is null', async () => {
    const base = { apiBase: '/api/', gameId: 'g', round: 1, playerName: 'D', clientId: 'c' };
    expect(await fetchOwnAnswer({ ...base, fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await fetchOwnAnswer({ ...base, fetchImpl: async () => { throw new Error('x'); } })).toBeNull();
    expect(await fetchOwnAnswer({
      ...base, fetchImpl: async () => ({ ok: true, json: async () => ({ hasAnswer: true, answer: 'A' }) }),
    })).toEqual({ status: 'answered', text: 'A' });
  });
});

describe('PlayerPage uses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');
  test('the resync asks the server for the own answer', () => {
    expect(src).toMatch(/fetchOwnAnswer\(/);
  });
  test('the results heading has a checking state and a withheld state', () => {
    expect(src).toMatch(/Checking your answer…/);
    expect(src).toMatch(/ownAnswerStatus === 'withheld'/);
  });
});
