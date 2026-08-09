/**
 * The predicate behind the green meter.
 *
 * Each case names the wrong implementation it rejects, because a test that
 * rejects nothing is the dominant failure mode in this repo.
 */
import { roomIsComplete } from '../config/hostControls';

describe('roomIsComplete', () => {
  test('everyone in is complete', () => {
    // rejects: a predicate that never returns true
    expect(roomIsComplete({ phase: 'ASK', responded: 8, playerCount: 8 })).toBe(true);
  });

  test('one short is not complete', () => {
    // rejects: `responded > 0`
    expect(roomIsComplete({ phase: 'ASK', responded: 7, playerCount: 8 })).toBe(false);
  });

  test('an empty room is never complete', () => {
    // rejects: the naive `responded >= playerCount`, which is 0 >= 0 === true.
    // A green meter in front of a room nobody has joined is a lie that costs a round.
    expect(roomIsComplete({ phase: 'ASK', responded: 0, playerCount: 0 })).toBe(false);
  });

  test('more responses than players is complete, not a paradox', () => {
    // rejects: strict equality. Answer rows can outnumber deduplicated players.
    expect(roomIsComplete({ phase: 'VOTE', responded: 9, playerCount: 8 })).toBe(true);
  });

  test('VOTE is judged too', () => {
    // rejects: an ASK-only implementation
    expect(roomIsComplete({ phase: 'VOTE', responded: 8, playerCount: 8 })).toBe(true);
  });

  test('phases with nothing to wait for are never complete', () => {
    // rejects: a predicate that ignores phase and greens the dock on RESULTS
    for (const phase of ['LOBBY', 'RESULTS', 'FIELD_NOTES', 'ENDED']) {
      expect(roomIsComplete({ phase, responded: 8, playerCount: 8 })).toBe(false);
    }
  });

  test('missing or non-numeric counts are not complete', () => {
    // rejects: an implementation that compares undefined and gets NaN-truthiness wrong
    expect(roomIsComplete({ phase: 'ASK' })).toBe(false);
    expect(roomIsComplete({ phase: 'ASK', responded: 'x', playerCount: 8 })).toBe(false);
    expect(roomIsComplete({})).toBe(false);
  });
});
