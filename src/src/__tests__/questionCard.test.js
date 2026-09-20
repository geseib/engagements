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
import { correctOptionIndex } from '../config/hostRemote';

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
  /* THE SLOT ID IS READ WHATEVER ITS CASE, and whatever the spacing, because
     the host's phone always has. `correctOptionIndex` matches
     `/^option\s*([A-F])$/i`, so `optionb`, `Option B` and `OPTIONB` all flag an
     option on the phone in the host's hand while the card behind them, guarded
     on `startsWith('Option')` and then comparing the stripped letter exactly,
     marked nothing at all. Nothing upstream tidies the spelling either:
     lambda-functions/admin/upload-questions.js writes the CorrectAnswer cell of
     an imported CSV verbatim, with no validation of any kind, and
     lambda-functions/game/get-question.js rewrites an answer only when it
     startsWith('Option'). */

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
    ['the slot id in lower case', 'optionb'],
    ['the slot id with a lowercase letter', 'Optionb'],
    ['the slot id shouted', 'OPTIONB'],
    ['the slot id with a space in it', 'Option B'],
    ['an array of the slot id in lower case', ['optionb']],
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

/*
 * ONE QUESTION, TWO SURFACES, ONE ANSWER.
 *
 * The room's card and the host's phone decode `correctAnswer` in two separate
 * modules, and twice now they have drifted apart: the phone read a spelling the
 * card could not, so the host's hand said C while the projector behind them
 * marked nothing at all. Both times the card was the half that was behind.
 *
 * These pin the two decoders against each other directly, which neither
 * module's own tests can do. QUESTION fills every slot A-D, so the phone's SLOT
 * index and the card's positional LETTER coincide here and can be compared; the
 * gapped case, where they deliberately differ, is pinned in
 * __tests__/hostRemotePreview.test.jsx.
 */
describe('the card and the host phone read the same spellings', () => {
  const SLOTS = ['A', 'B', 'C', 'D'];

  // rejects: widening one decoder and leaving the other. A spelling added to
  // config/hostRemote.js `correctOptionIndex` and not to `isCorrectTriviaOption`
  // reopens exactly the gap this describe exists to hold shut — and it reopens
  // it silently, because each module's own tests go on passing.
  test.each([
    ['the mandated slot id', 'OptionB'],
    ['the slot id in lower case', 'optionb'],
    ['the slot id with a lowercase letter', 'Optionb'],
    ['the slot id shouted', 'OPTIONB'],
    ['the slot id with a space in it', 'Option B'],
    ['the bare letter', 'B'],
    ['the bare letter in lower case', 'b'],
    ['the option\'s own text', QUESTION.optionB],
  ])('%s names option B to the room and to the host alike', (_label, correctAnswer) => {
    expect(correctSlots(correctAnswer)).toEqual(['B']);
    expect(SLOTS[correctOptionIndex({ ...QUESTION, correctAnswer })]).toBe('B');
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
