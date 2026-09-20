/**
 * The question card's decisions, as data (config/questionCard.js).
 *
 * `isCorrectTriviaOption` and `TRIVIA_OPTION_KEYS` lived inside GameHostPage.jsx,
 * which cannot mount in jsdom, so nothing tested them. They moved out verbatim
 * when the card was extracted (spec 2026-09-19 §4.1); these pin the behaviour
 * from the new home so the move cannot have changed it.
 */
import {
  TRIVIA_OPTION_KEYS, isCorrectTriviaOption, triviaOptions, optionShare,
} from '../config/questionCard';

const QUESTION = {
  optionA: 'A 5% list increase held through renewal',
  optionB: 'Seat-based to usage-based billing',
  optionC: 'A premium support tier',
  optionD: 'Discounting the entry plan',
};
/** Which of A–D come back correct for this recorded answer. */
const correctSlots = (correctAnswer) => ['A', 'B', 'C', 'D']
  .filter((letter) => isCorrectTriviaOption({ ...QUESTION, correctAnswer }, `option${letter}`, letter));

describe('isCorrectTriviaOption — every way a set records the answer', () => {
  /* A LOWERCASE bare letter is a spelling sets really use, and until it was
     handled here the stage marked NOTHING for such a set — every option dimmed,
     the room never told which answer was right. The host's phone read the same
     sets correctly all along: config/hostRemote.js `correctOptionIndex` matches
     `/^[A-F]$/i` deliberately. Nothing upstream closes the gap —
     lambda-functions/game/get-question.js rewrites an answer only when it
     startsWith('Option'), so a bare letter reaches the card exactly as stored. */

  test.each([
    ['the slot id', 'OptionB'],
    ['the bare letter', 'B'],
    ['the option\'s own text', QUESTION.optionB],
    ['the bare letter in lower case', 'b'],
    ['an array of the slot id', ['OptionB']],
    ['an array of the bare letter', ['B']],
    ['an array of the bare letter in lower case', ['b']],
    ['an array of the text', [QUESTION.optionB]],
  ])('%s marks B and only B', (_label, correctAnswer) => {
    expect(correctSlots(correctAnswer)).toEqual(['B']);
  });

  test('an array naming two options marks both', () => {
    expect(correctSlots(['OptionA', QUESTION.optionD])).toEqual(['A', 'D']);
  });

  test('no recorded answer marks nothing, and no question marks nothing', () => {
    expect(correctSlots('')).toEqual([]);
    expect(correctSlots(undefined)).toEqual([]);
    expect(correctSlots([null, ''])).toEqual([]);
    expect(isCorrectTriviaOption(null, 'optionA', 'A')).toBe(false);
  });
});

describe('triviaOptions — the options as the stage letters them', () => {
  test('the slots are A to F, in that order', () => {
    expect(TRIVIA_OPTION_KEYS).toEqual(['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']);
  });

  test('filled slots only, lettered by position among the filled ones', () => {
    // rejects: lettering by slot. The stage has always drawn A, C and D as
    // A, B and C — the room's phones answer in those letters.
    expect(triviaOptions({ optionA: 'one', optionC: 'three', optionD: 'four' })).toEqual([
      { key: 'optionA', letter: 'A', text: 'one' },
      { key: 'optionC', letter: 'B', text: 'three' },
      { key: 'optionD', letter: 'C', text: 'four' },
    ]);
  });

  test('no question, no options', () => {
    expect(triviaOptions(null)).toEqual([]);
    expect(triviaOptions(undefined)).toEqual([]);
  });
});

describe('optionShare — the RESULTS arithmetic', () => {
  const answers = [{ answer: 'B' }, { answer: 'B' }, { answer: 'A' }];

  test('a whole percent of the room', () => {
    expect(optionShare(answers, 'B')).toBe(67);
    expect(optionShare(answers, 'A')).toBe(33);
    expect(optionShare(answers, 'C')).toBe(0);
  });

  test('nobody answered is 0, never NaN', () => {
    expect(optionShare([], 'A')).toBe(0);
    expect(optionShare(undefined, 'A')).toBe(0);
  });
});
