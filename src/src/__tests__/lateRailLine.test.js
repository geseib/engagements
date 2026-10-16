/**
 * THE CONSOLE RAIL'S LATE LINE (walk on dev, session 3343, finding W1). It
 * read "<text> · Late answer · Late answer": the kind, then the server's `who`,
 * which falls back to the kind's own words when there is no author. It now
 * says what LateList says: the author, then when it arrived ("Dan · during
 * Round 1 · Voting"); with no author (a hidden round, or any late answer to a
 * question for the room) the kind stands in for the author, once.
 * rejects: the kind said twice; the "who" fallback read as a name.
 */
import { lateRailMeta } from '../config/lateWords';

test('a named late answer: the author and when it arrived', () => {
  expect(lateRailMeta({ kind: 'answer', author: 'Dan', who: 'Dan', arrivedDuring: 'VOTE#001', roundNoun: 'Round' }))
    .toBe('Dan · during Round 1 · Voting');
});

test('a late answer to a question for the room: the kind once, never twice', () => {
  const line = lateRailMeta({ kind: 'askAnswer', author: null, who: 'Late answer', arrivedDuring: 'RESULTS#002' });
  expect(line).toBe('Late answer to a question · during Round 2 · Results');
  expect(line).not.toMatch(/Late answer.*Late answer/);
});

test('a hidden round: the kind, not the fallback "who"', () => {
  expect(lateRailMeta({ kind: 'answer', author: null, who: 'Late answer', arrivedDuring: 'ASK#003', roundNoun: 'Lesson' }))
    .toBe('Late answer · during Lesson 3 · Answering');
});

test('no arrival stamp: the author or kind alone', () => {
  expect(lateRailMeta({ kind: 'comment', author: 'Sam' })).toBe('Sam');
});

test('the page builds the rail line with it', () => {
  // eslint-disable-next-line global-require
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  expect(src).toMatch(/meta: lateRailMeta\(item\)/);
});
