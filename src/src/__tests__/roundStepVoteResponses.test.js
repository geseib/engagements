/**
 * RESPONSES ON THE WALL DURING VOTING (owner, 2026-10-13: "while voting is
 * going on the host should be able to show the responses just like they look
 * in the results presenting but with the names redacted and random order").
 *
 * A VOTE-stamped answer focus is its own moment, VOTE_RESPONSES: step through
 * the responses in voting order, then Show results; Stop showing puts the
 * room back on the count. Same words as RESULTS' responses.
 */
import { roundStep, momentOf, MOMENTS } from '../config/roundStep';
import RW from '../config/roundWords';

const CTX = (over = {}) => ({
  gameType: 'call-and-answer', roundNoun: 'Round', playerCount: 5, answerCount: 8,
  progress: { received: 3, total: 5, allIn: false },
  focus: { focus: 'answer', index: 0, part: 0, parts: 1, phase: 'VOTE' },
  ...over,
});

test('a VOTE-stamped answer focus during VOTE is VOTE_RESPONSES', () => {
  expect(MOMENTS).toContain('VOTE_RESPONSES');
  expect(momentOf({ state: 'VOTE#003', focus: { focus: 'answer', index: 2, phase: 'VOTE' } })).toBe('VOTE_RESPONSES');
  // An unstamped or RESULTS-stamped focus is not a voting response.
  expect(momentOf({ state: 'VOTE#003', focus: { focus: 'answer', index: 2 } })).toBe('VOTING');
  expect(momentOf({ state: 'VOTE#003', focus: { focus: 'answer', index: 2, phase: 'RESULTS' } })).toBe('VOTING');
  // And never survives into RESULTS.
  expect(momentOf({ state: 'RESULTS#003', focus: { focus: 'answer', index: 2, phase: 'VOTE' } })).toBe('RESULTS');
});

test('Next response, then Show results on the last; Stop showing beside it', () => {
  const first = roundStep('VOTE_RESPONSES', CTX());
  expect(first.primary).toMatchObject({ id: 'next-response', label: RW.nextResponse, index: 1, part: 0 });
  expect(first.secondary).toMatchObject({ id: 'stop-showing', label: RW.stopShowing });
  const last = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 7, phase: 'VOTE' } }));
  expect(last.primary).toMatchObject({ id: 'reveal', label: RW.showResults, arm: { text: RW.armResults(2, 'voting') } });
  const lastAllIn = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 7, phase: 'VOTE' }, progress: { received: 5, total: 5, allIn: true } }));
  expect(lastAllIn.primary.arm).toBeUndefined();
});

test('a long response steps by part first', () => {
  const s = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 2, part: 0, parts: 2, phase: 'VOTE' } }));
  expect(s.primary).toMatchObject({ id: 'next-part', label: RW.nextPart, index: 2, part: 1, parts: 2 });
});

test('the status says which response and how the vote stands', () => {
  const s = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 1, phase: 'VOTE' } }));
  expect(s.status.text).toBe(`${RW.showingResponse(2, 8)} · ${RW.voted(3, 5)}`);
  expect(s.next).toBe(RW.nextLine.RESPONSES_NEXT);
  expect(roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 7, phase: 'VOTE' } })).next).toBe(RW.nextLine.VOTING);
});
