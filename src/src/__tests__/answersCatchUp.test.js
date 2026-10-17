/**
 * THE HOST'S LIST CATCHES UP WITH THE COUNT (review of test a76fda95, issue
 * #34: "3 of 4" answered while the list said "No responses yet", until a
 * reload). rejects: no retry once a fetch is refused or read too early; a
 * retry when the list already matches; polling forever on a count the server
 * cannot back; a page that never calls the rule.
 */
import fs from 'fs';
import path from 'path';
import { answersCatchUpDelay, CATCH_UP_TRIES } from '../config/stageAnswers';

test('count ahead of the rows: refetch, backing off', () => {
  expect(answersCatchUpDelay(3, 0, 0)).toBe(1500);
  expect(answersCatchUpDelay(3, 1, 1)).toBe(3000);
  expect(answersCatchUpDelay(3, 2, 2)).toBe(6000);
  expect(answersCatchUpDelay(3, 2, 4)).toBe(6000);
});

test('nothing to catch up, or the round has spent its tries', () => {
  expect(answersCatchUpDelay(3, 3, 0)).toBeNull();
  expect(answersCatchUpDelay(0, 0, 0)).toBeNull();
  expect(answersCatchUpDelay(4, 3, CATCH_UP_TRIES)).toBeNull();
});

test('the host page runs it during ASK and refetches through the same door', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const at = src.indexOf('answersCatchUpDelay(answeredCount, answers.length');
  expect(at).toBeGreaterThan(-1);
  const effect = src.slice(src.lastIndexOf('useEffect(() => {', at), src.indexOf('}, [gameState, gameId, answeredCount, answers.length]);', at));
  expect(effect).toMatch(/\^ASK#/);
  expect(effect).toMatch(/fetchAnswersForQuestion\(m\[1\]\)/);
});
