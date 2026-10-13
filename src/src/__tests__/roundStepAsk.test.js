/**
 * A QUESTION FOR THE ROOM (docs/design/followup-icons, phase B4): the `ask`
 * beat is two moments. Live: Show results (two presses while people are still
 * answering) and Cancel the question. Results: Next round and Ask another.
 * The laptop and the Remote reach the same step from their own facts.
 */
import { roundStep, momentOf } from '../config/roundStep';
import { hostControlsFor } from '../config/hostControls';
import { remoteStep } from '../config/hostRemote';
import RW from '../config/roundWords';

const CTX = (over = {}) => ({
  gameType: 'call-and-answer', roundNoun: 'Round', playerCount: 5, answerCount: 5,
  roomAsk: { status: 'live', answered: 3, total: 5 }, ...over,
});

test('the ask beat is ROOM_QUESTION while live, ROOM_RESULTS once closed', () => {
  expect(momentOf({ state: 'RESULTS#002', stageBeat: 'ask', roomAsk: { status: 'live' } })).toBe('ROOM_QUESTION');
  expect(momentOf({ state: 'RESULTS#002', stageBeat: 'ask' })).toBe('ROOM_QUESTION');
  expect(momentOf({ state: 'RESULTS#002', stageBeat: 'ask', roomAsk: { status: 'closed' } })).toBe('ROOM_RESULTS');
});

test('live: Show results, armed while people are still answering; Cancel the question beside it', () => {
  const s = roundStep('ROOM_QUESTION', CTX());
  expect(s.primary).toMatchObject({ id: 'close-ask', label: RW.showResults, intent: 'close-ask', arm: { text: RW.armResults(2, 'answering') } });
  expect(s.secondary).toMatchObject({ id: 'cancel-ask', label: RW.cancelQuestion, intent: 'cancel-ask' });
  expect(s.status).toEqual({ text: '3 of 5 answered', tone: 'pending' });
  const all = roundStep('ROOM_QUESTION', CTX({ roomAsk: { status: 'live', answered: 5, total: 5 } }));
  expect(all.primary.arm).toBeUndefined();
  expect(all.status).toEqual({ text: 'All 5 answered', tone: 'success' });
});

test('results: Next round, and Ask another goes back to the read', () => {
  const s = roundStep('ROOM_RESULTS', CTX({ roomAsk: { status: 'closed', answered: 5, total: 5 } }));
  expect(s.primary).toMatchObject({ id: 'next', label: RW.nextRound('Round'), intent: 'next' });
  expect(s.secondary).toMatchObject({ id: 'ask-another', label: RW.askAnother, intent: 'field-notes' });
  expect(s.status.text).toBe(RW.resultsOnScreen);
});

test('the read says how many asks are ready', () => {
  const s = roundStep('READ', CTX({ notes: { page: 2, pages: 4, ready: true }, asksReady: 3 }));
  expect(s.status.text).toBe(`${RW.readingPage(3, 4)} · 3 asks ready`);
  expect(roundStep('READ', CTX({ notes: { page: 0, pages: 1, ready: true }, asksReady: 1 })).status.text).toBe(`${RW.readOnScreen} · 1 ask ready`);
});

test('the laptop and the Remote take the same step', () => {
  const roomAsk = { status: 'live', answered: 2, total: 4 };
  const laptop = hostControlsFor({ gameType: 'call-and-answer', phase: 'ASKING', roundNoun: 'Round', playerCount: 4, answerCount: 4, roomAsk });
  const remote = remoteStep({ gameType: 'call-and-answer', state: 'RESULTS#003', stageBeat: 'ask' }, { playerCount: 4, answerCount: 4, roundNoun: 'Round', roomAsk });
  expect(laptop.primary.id).toBe(remote.primary.id);
  expect(laptop.secondary.id).toBe(remote.secondary.id);
  expect(laptop.primary.arm).toEqual(remote.primary.arm);
  const closed = { ...roomAsk, status: 'closed' };
  expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'ASKING', roundNoun: 'Round', playerCount: 4, roomAsk: closed }).primary.id)
    .toBe(remoteStep({ gameType: 'call-and-answer', state: 'RESULTS#003', stageBeat: 'ask' }, { roundNoun: 'Round', roomAsk: closed }).primary.id);
});
