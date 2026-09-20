/**
 * THE PROJECTOR AND THE SCOREBOARD READ ONE SET ONE WAY.
 *
 * `isCorrectTriviaOption` (config/questionCard.js) decides which option the
 * room is SHOWN as correct. `isAnswerCorrect` (lambda-functions/…/trivia-answer.js)
 * decides who is PAID. A player the projector marks correct must be scored
 * correct, so every case below asks both layers the same question: of the
 * letters a phone can submit, which are right?
 *
 * The backend module is required from lambda-functions/ rather than copied, as
 * triviaAnswerDecoder.test.js does, so this pins the code that actually scores.
 */
import { isCorrectTriviaOption, triviaOptions } from '../config/questionCard';

const { isAnswerCorrect } =
  require('../../../lambda-functions/websocket/trivia-answer.js');

/** The drawn letters the projector marks correct. */
const shownCorrect = (question) =>
  triviaOptions(question)
    .filter(({ key, letter }) => isCorrectTriviaOption(question, key, letter))
    .map(({ letter }) => letter);

/** The drawn letters the scorer pays. */
const paid = (question) =>
  triviaOptions(question)
    .map(({ letter }) => letter)
    .filter((letter) => isAnswerCorrect(question, letter));

const FULL = { optionA: 'Mercury', optionB: 'Venus', optionC: 'Earth', optionD: 'Mars' };
/* A hole: optionC is empty, so the room draws optionD as C. */
const GAPPED = { optionA: 'Mercury', optionB: 'Venus', optionC: '', optionD: 'Mars' };

const SPELLINGS = ['OptionC', 'optionc', 'Option C', 'c', 'C'];

describe('no hole in the slots', () => {
  test.each(SPELLINGS)('%j marks and pays the third option, and only it', (correctAnswer) => {
    const question = { ...FULL, correctAnswer };
    expect(shownCorrect(question)).toEqual(['C']);
    expect(paid(question)).toEqual(['C']);
  });
});

describe('a hole in the slots (A, B, D filled — C empty)', () => {
  /* The named slot holds nothing, so nobody can tap it. The projector falls
     back to the POSITION and marks the option drawn as C; the scorer must pay
     the player who tapped what the room was told was right. */
  test.each(SPELLINGS)('%j — whoever the projector marks is who is paid', (correctAnswer) => {
    const question = { ...GAPPED, correctAnswer };
    expect(shownCorrect(question)).toEqual(['C']);
    expect(paid(question)).toEqual(shownCorrect(question));
  });

  test.each(['OptionD', 'optiond', 'Option D', 'd', 'D', 'Mars'])(
    '%j names the FILLED slot after the hole: drawn as C, marked and paid as C',
    (correctAnswer) => {
      const question = { ...GAPPED, correctAnswer };
      expect(shownCorrect(question)).toEqual(['C']);
      expect(paid(question)).toEqual(['C']);
    },
  );

  test.each(['OptionB', 'b'])('%j before the hole is unaffected by it', (correctAnswer) => {
    const question = { ...GAPPED, correctAnswer };
    expect(shownCorrect(question)).toEqual(['B']);
    expect(paid(question)).toEqual(['B']);
  });
});

describe('the scorer never pays a player the projector did not mark', () => {
  const QUESTIONS = [
    { optionA: 'a1', optionC: 'c1', optionD: 'd1' },
    { optionB: 'b1', optionC: 'c1', optionD: 'd1' },
    GAPPED,
    FULL,
  ];
  const ANSWERS = ['OptionA', 'optionb', 'Option C', 'd', 'C', ['OptionA', 'optiond']];

  QUESTIONS.forEach((options, i) => {
    test.each(ANSWERS)(`question ${i}: %j`, (correctAnswer) => {
      const question = { ...options, correctAnswer };
      const shown = shownCorrect(question);
      paid(question).forEach((letter) => expect(shown).toContain(letter));
    });
  });
});
