/**
 * THE GOAL ON THE WIRE, FROM THE BROWSER — createGameBody and updateGameBody
 * (config/createGame.js), events M1b Task 4. create-game.js and
 * update-game.js are whitelists, so the one tested definition of the key
 * lives here, beside createGamePayload.test.js (which is not edited).
 *
 * rejects: a blank goal sent at create; a goal sent for a survey; an edit
 * that cannot clear a goal; an edit that never mentioned the goal sending one;
 * a refused value dropped in silence instead of reaching the server's refusal.
 */
import { createGameBody, updateGameBody } from '../config/createGame';

const base = { title: 'Space night', gameType: 'trivia', setId: 'space', setScope: 'platform' };

describe('createGameBody', () => {
  test('a goal is sent as a number', () => {
    expect(createGameBody({ ...base, target: 5 }).target).toBe(5);
  });
  test('no goal sends no key', () => {
    for (const target of [undefined, null, '']) {
      expect('target' in createGameBody({ ...base, target })).toBe(false);
    }
  });
  test('a survey never sends one', () => {
    expect('target' in createGameBody({ ...base, gameType: 'survey', target: 5 })).toBe(false);
  });
  test('a value the rule refuses is sent as typed, for the server to refuse', () => {
    expect(createGameBody({ ...base, target: 0 }).target).toBe(0);
  });
});

describe('updateGameBody', () => {
  test('a goal the form carries is sent; null clears it', () => {
    expect(updateGameBody({ ...base, target: 7 }).target).toBe(7);
    expect(updateGameBody({ ...base, target: null }).target).toBeNull();
  });
  test('a form that says nothing about the goal sends no key', () => {
    expect('target' in updateGameBody(base)).toBe(false);
  });
  test('a survey never sends one', () => {
    expect('target' in updateGameBody({ ...base, gameType: 'survey', target: 3 })).toBe(false);
  });
});
