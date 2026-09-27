/**
 * THE GOAL ON THE STAGE'S DOCK — config/hostControls.js (events M1b, Task 5).
 *
 * The owner: "we could alert the host/facilitator they have completed, but
 * they could do extra if time permitted". So the notice is words on the
 * dock's status line, never a stop: the primary action is exactly what it
 * would have been without it.
 *
 * rejects: the notice changing or disabling the primary action; the notice
 * replacing a live round's status; a long read-back losing its page position
 * to the notice; the default results line lost when there is no goal.
 */
import { hostControlsFor } from '../config/hostControls';

const READY = { playerCount: 6, answeredCount: 6, votedCount: 6, answerCount: 6, hasQuestionSet: true };
const LINE = 'That’s your 5. Keep going if there’s time, or end the session.';

test('RESULTS: the notice takes the status line, and the primary is untouched', () => {
  const plain = hostControlsFor({ ...READY, gameType: 'trivia', phase: 'RESULTS' });
  const goal = hostControlsFor({ ...READY, gameType: 'trivia', phase: 'RESULTS', goalLine: LINE });
  expect(goal.status.text).toBe(LINE);
  expect(goal.primary).toEqual(plain.primary);
  expect(goal.primary.disabled).toBe(false);
});

test('with no goal line, RESULTS still says the results are on screen', () => {
  expect(hostControlsFor({ ...READY, gameType: 'trivia', phase: 'RESULTS' }).status.text).toBe('Results are on screen');
});

test('a feedback round carries it too', () => {
  expect(hostControlsFor({ ...READY, gameType: 'call-and-answer', phase: 'FEEDBACK', goalLine: LINE }).status.text).toBe(LINE);
});

test('a one-page read-back carries it; a longer one keeps its page position', () => {
  expect(hostControlsFor({ ...READY, gameType: 'call-and-answer', phase: 'FIELD_NOTES', goalLine: LINE }).status.text).toBe(LINE);
  expect(hostControlsFor({
    ...READY, gameType: 'call-and-answer', phase: 'FIELD_NOTES', goalLine: LINE, notesPage: 0, notesPages: 3,
  }).status.text).toBe('Reading page 1 of 3');
});

test('a live round keeps its own status, whatever it is handed', () => {
  expect(hostControlsFor({ ...READY, gameType: 'trivia', phase: 'ASK', goalLine: LINE }).status.text).toBe('All 6 answered');
});
