/**
 * Late answers on the phone (session flow v3 §4.4): never dropped while the
 * session runs, the player told plainly, and the round on screen left open.
 * The server side is tests/late-answers.js.
 */
import fs from 'fs';
import path from 'path';
import { pendingVerdict } from '../utils/pendingAnswer';

const page = fs.readFileSync(path.join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');

test('a held answer goes late once its round has moved on, and is dropped only when the session has ended', () => {
  const p = { round: 2 };
  expect(pendingVerdict(p, 'VOTE#002')).toBe('late');
  expect(pendingVerdict(p, 'ASK#003')).toBe('late');
  expect(pendingVerdict(p, 'ENDED')).toBe('drop');
  expect(pendingVerdict(p, 'ASK#002')).toBe('send');
});

test('a late send clears the hold without marking the round on screen answered', () => {
  expect(page).toMatch(/if \(sent && verdict === 'late'\) \{[\s\S]{0,400}drop\(false\);/);
});

test('the phone hears answerReceived and says "Kept, but late" in plain words', () => {
  expect(page).toMatch(/onMessage\('answerReceived'/);
  expect(page).toMatch(/Voting has started\. Your answer is kept with this round, but it is not in the vote\./);
  expect(page).toMatch(/<b>Kept, but late\.<\/b>/);
});

test('still writing when voting starts: the draft can be sent anyway', () => {
  expect(page).toMatch(/You were still writing\./);
  expect(page).toMatch(/Send it anyway/);
});

test('the held receipt shows only for its own round', () => {
  expect(page).toMatch(/!hasAnswered && pendingAnswer && roundOf\(gameState\) === pendingAnswer\.round/);
});
