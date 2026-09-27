/**
 * ANSWERS THAT BEAT THE HOST TO THE ROUND — GameHostPage.jsx.
 *
 * Seen in Chromium, 27 Sep 2026, on a typed poll: two phones answered while
 * the host was still loading the round. The page then reset `answers` for the
 * new round (showAnswersFor([], …)), which bumps the fetch sequence and made
 * the refetch already carrying both answers stale. The stage read "Nobody has
 * answered yet" beside a meter saying 2 / 2, with Show Results disabled, and
 * nothing asked again until another answer happened to arrive.
 *
 * GameHostPage cannot be mounted in jsdom, so this pins the call sites: every
 * reset of a new ASK round to "no answers" is followed by a refetch of that
 * round's answers.
 *
 * rejects: an empty reset on a new round with no refetch after it.
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

describe('a new round reset to "no answers" asks again', () => {
  test.each([
    ['the host\'s own next question', 'showAnswersFor([], newState);', 'fetchAnswersForQuestion(lessonNumber);'],
    ['a re-sync that read no answers yet', 'showAnswersFor([], currentState);', 'fetchAnswersForQuestion(questionNumber);'],
  ])('%s', (_label, reset, refetch) => {
    const at = source.indexOf(reset);
    expect(at).toBeGreaterThan(-1);
    const after = source.slice(at, at + 900);
    expect(after).toContain(refetch);
  });
});
