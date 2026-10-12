/**
 * ONE ORDER FOR "RESPONSE N" (two-surface D5). During VOTE the index is the
 * voting order every ballot shows (answer-order.js's shuffle, already applied
 * by /answers). During RESULTS it is tally order: most points first, ties by
 * voting order. The host page's spotlight and the Remote's list both read
 * this, so "Show response 2" means one response on every surface.
 */
import { voteOrder, tallyOrder, responseAt } from '../config/navigatorOrder';

const tally = (playerName, answerText, totalScore, first = 0, second = 0, third = 0) => ({
  playerName, answerText, totalScore, firstPlace: first, secondPlace: second, thirdPlace: third,
});

describe('voteOrder', () => {
  test('is the identity over /answers, each row stamped with its position', () => {
    const answers = [{ answer: 'b' }, { answer: 'a' }, { answer: 'c' }];
    expect(voteOrder(answers).map((r) => [r.position, r.answer])).toEqual([[0, 'b'], [1, 'a'], [2, 'c']]);
  });

  test('empty and junk are an empty list', () => {
    expect(voteOrder([])).toEqual([]);
    expect(voteOrder(undefined)).toEqual([]);
    expect(voteOrder('nope')).toEqual([]);
  });

  test('never carries a name into the voting order', () => {
    const order = voteOrder([{ answer: 'x', playerName: 'Ada', name: 'Ada' }]);
    expect(JSON.stringify(order)).not.toMatch(/Ada/);
  });
});

describe('tallyOrder', () => {
  test('most points first', () => {
    const order = tallyOrder({
      0: tally('Ada', 'first shown', 2, 0, 1),
      1: tally('Ben', 'second shown', 9, 3),
      2: tally('Cy', 'third shown', 5, 1, 1),
    });
    expect(order.map((r) => r.answer)).toEqual(['second shown', 'third shown', 'first shown']);
    expect(order.map((r) => r.position)).toEqual([1, 2, 0]);
    expect(order[0]).toMatchObject({ playerName: 'Ben', points: 9, placement: 1 });
  });

  test('ties keep the voting order, whatever order the keys arrive in', () => {
    // Object key order is numeric for integer-like keys, but a list built in
    // any order must still come out by display position on a tie.
    const order = tallyOrder({ 3: tally('D', 'd', 4), 1: tally('B', 'b', 4), 2: tally('C', 'c', 4), 0: tally('A', 'a', 4) });
    expect(order.map((r) => r.answer)).toEqual(['a', 'b', 'c', 'd']);
    expect(order.every((r) => r.placement === 1)).toBe(true);
  });

  test('accepts the tallies as an array too', () => {
    const order = tallyOrder([tally('A', 'a', 1), tally('B', 'b', 3)]);
    expect(order.map((r) => r.answer)).toEqual(['b', 'a']);
  });

  test('an answer the tally is missing goes last, in voting order, with no points', () => {
    const answers = [{ answer: 'a' }, { answer: 'b' }, { answer: 'c' }];
    const order = tallyOrder({ 0: tally('A', 'a', 3) }, answers);
    expect(order.map((r) => [r.position, r.answer, r.points])).toEqual([[0, 'a', 3], [1, 'b', 0], [2, 'c', 0]]);
  });

  test('empty is empty', () => {
    expect(tallyOrder({})).toEqual([]);
    expect(tallyOrder(null)).toEqual([]);
  });
});

describe('responseAt', () => {
  test('the row at an index, or null', () => {
    const order = voteOrder([{ answer: 'a' }, { answer: 'b' }]);
    expect(responseAt(order, 1).answer).toBe('b');
    expect(responseAt(order, 2)).toBeNull();
    expect(responseAt(order, -1)).toBeNull();
    expect(responseAt(order, '1')).toBeNull();
    expect(responseAt(null, 0)).toBeNull();
  });
});

describe('navigatorLabel: during VOTE a response is never named', () => {
  const { navigatorLabel } = require('../config/navigatorOrder');
  const named = { playerName: 'Ada', answer: 'x' };

  test('VOTE: "Response N" on a named round too (the owner\'s ruling)', () => {
    expect(navigatorLabel(named, 2, { phase: 'VOTE', authorsHidden: false })).toBe('Response 3');
  });

  test('RESULTS: the name as the round allows', () => {
    expect(navigatorLabel(named, 0, { phase: 'RESULTS', authorsHidden: false })).toBe('Ada');
    expect(navigatorLabel(named, 0, { phase: 'RESULTS', authorsHidden: true })).toBe('Response 1');
  });
});
