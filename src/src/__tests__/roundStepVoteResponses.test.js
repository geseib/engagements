/**
 * RESPONSES ON THE WALL DURING VOTING (owner, 2026-10-13: "while voting is
 * going on the host should be able to show the responses just like they look
 * in the results presenting but with the names redacted and random order").
 *
 * Simplified the same day ("when going to vote, we should automatically get
 * the response screens up ... the host can cycle through the response"):
 * Response 1 is on the wall from the start of voting. The main step is always
 * Show results; Next response is the secondary and wraps from the last to the
 * first. A VOTE-stamped answer focus is VOTE_RESPONSES, the moment after the
 * host has stepped on.
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

test('Show results is the main step throughout; Next response wraps', () => {
  const first = roundStep('VOTE_RESPONSES', CTX());
  expect(first.primary).toMatchObject({ id: 'reveal', label: RW.showResults, arm: { text: RW.armResults(2, 'voting') } });
  expect(first.secondary).toMatchObject({ id: 'next-response', label: RW.nextResponse, index: 1, part: 0 });
  const last = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 7, phase: 'VOTE' } }));
  expect(last.secondary).toMatchObject({ id: 'next-response', index: 0 });
  const lastAllIn = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 7, phase: 'VOTE' }, progress: { received: 5, total: 5, allIn: true } }));
  expect(lastAllIn.primary.arm).toBeUndefined();
});

test('voting with no focus yet already shows Response 1', () => {
  const s = roundStep('VOTING', CTX({ focus: null }));
  expect(s.primary).toMatchObject({ id: 'reveal' });
  expect(s.secondary).toMatchObject({ id: 'next-response', index: 1 });
  expect(s.status.text).toBe(`${RW.voted(3, 5)} · ${RW.showingResponse(1, 8)}`);
  // One response: nothing to cycle to.
  expect(roundStep('VOTING', CTX({ focus: null, answerCount: 1 })).secondary).toBeNull();
});

test('a long response steps by part first', () => {
  const s = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 2, part: 0, parts: 2, phase: 'VOTE' } }));
  expect(s.secondary).toMatchObject({ id: 'next-part', label: RW.nextPart, index: 2, part: 1, parts: 2 });
});

test('the status leads with the vote and says which response is up', () => {
  const s = roundStep('VOTE_RESPONSES', CTX({ focus: { focus: 'answer', index: 1, phase: 'VOTE' } }));
  expect(s.status).toEqual({ text: `${RW.voted(3, 5)} · ${RW.showingResponse(2, 8)}`, tone: 'pending' });
  expect(s.next).toBe(RW.nextLine.VOTING);
});
