/**
 * The backend's scoring decoder and the host's phone, pinned against each other.
 *
 * WHY THIS FILE EXISTS RATHER THAN MORE TESTS IN EITHER MODULE. This exact
 * class of bug has now been found three times, and every time it was the same
 * shape: one surface learned to read a spelling and another did not, so the
 * projector, the host's phone and the scoreboard disagreed about which option
 * was right — in the same room, about the same question. Neither module's own
 * tests can catch a widening of one and not the other. This one can.
 *
 *   src/src/config/hostRemote.js         correctOptionIndex -> the host's phone
 *   lambda-functions/game/trivia-answer  correctSlots       -> who actually scores
 *
 * Both answer in SLOTS — the column an author typed into — so they are directly
 * comparable: `correctOptionIndex` returns an index into optionA..optionF and
 * `correctSlots` returns the letters of the same slots.
 *
 * The backend module is deliberately required from lambda-functions/ rather
 * than copied here. A copy would drift, which is the very failure being pinned.
 */
import { correctOptionIndex } from '../config/hostRemote';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const { correctSlots, drawnOptions } =
  require('../../../lambda-functions/game/trivia-answer.js');

/** The slot letter the phone would mark, or null. */
const phoneSlot = (question) => {
  const index = correctOptionIndex(question);
  return index === null || index < 0 ? null : LETTERS[index];
};

/** The slot letter the scorer would pay, or null. */
const scorerSlot = (question) => correctSlots(question)[0] || null;

const SOLID = {
  optionA: 'Mercury', optionB: 'Jupiter', optionC: 'Neptune', optionD: 'Saturn',
};

// optionB is empty: the room draws optionA as A, optionC as B, optionD as C.
const GAPPED = { optionA: 'Mercury', optionC: 'Jupiter', optionD: 'Neptune' };

describe('the phone and the scorer place the answer in the same slot', () => {
  const SPELLINGS = [
    'OptionB', 'optionb', 'Optionb', 'OPTIONB', 'Option B', 'option b',
    '  OptionB  ', 'B', 'b', 'Jupiter', 'jupiter', '  Jupiter  ',
    'OptionD', 'd', 'Saturn',
  ];

  it.each(SPELLINGS)('%s, on a question with no gaps', (stored) => {
    const question = { ...SOLID, correctAnswer: stored };
    expect(scorerSlot(question)).toBe(phoneSlot(question));
    // and it is not that they both failed to place it
    expect(scorerSlot(question)).not.toBeNull();
  });

  // The option's own TEXT places by text, so a hole changes nothing.
  it.each(['Jupiter', 'jupiter', '  Jupiter  '])(
    '%s, on a question with a hole in its slots', (stored) => {
      const question = { ...GAPPED, correctAnswer: stored };
      expect(scorerSlot(question)).toBe(phoneSlot(question));
      expect(scorerSlot(question)).toBe('C');
    });

  // A POINTER at the hole itself is the one place the scorer deliberately leaves
  // the phone. The phone indexes OPTION_KEYS and lands on optionB, which this
  // question never drew, so it flags no row at all; the PROJECTOR
  // (questionCard.js isCorrectTriviaOption) reads the letter as a position and
  // marks the option drawn as B. The room is told that option is right, so that
  // is the player who is paid — triviaScorerAgreesWithProjector.test.js pins it.
  it.each(SPELLINGS.filter((s) => !/d|D|Saturn|upiter/.test(s)))(
    '%s names the hole: the scorer follows the projector to the option drawn there', (stored) => {
      const question = { ...GAPPED, correctAnswer: stored };
      expect(phoneSlot(question)).toBe('B');
      expect(scorerSlot(question)).toBe('C');
    });

  const UNPLACEABLE = ['', '   ', 'who knows', 'OptionZ', 'Z', 'Pluto'];

  it.each(UNPLACEABLE)('%s places nowhere on either surface', (stored) => {
    const question = { ...SOLID, correctAnswer: stored };
    expect(scorerSlot(question)).toBeNull();
    expect(phoneSlot(question)).toBeNull();
  });

  it('agrees about the CorrectAnswer spelling too', () => {
    const question = { ...SOLID, CorrectAnswer: 'OptionC' };
    expect(scorerSlot(question)).toBe(phoneSlot(question));
    expect(scorerSlot(question)).toBe('C');
  });

  // The array form is the one shape the two surfaces need not agree on, and
  // this branch's base and origin/dev genuinely differ: the phone here takes
  // only a string, while dev's correctOptionIndex resolves an array to its
  // first placing entry. Asserted as the PROPERTY that holds either way —
  // the scorer must read every entry, and where the phone places one at all it
  // must be one of the scorer's — so this file does not turn red on a rebase
  // for a disagreement that is not one.
  it('the scorer reads every entry of the array form', () => {
    const question = { ...SOLID, correctAnswer: ['optionb', 'Option D'] };
    expect(correctSlots(question)).toEqual(['B', 'D']);

    const phone = correctOptionIndex(question);
    if (phone !== null) expect(correctSlots(question)).toContain(LETTERS[phone]);
  });
});

describe('a slot is not a drawn letter', () => {
  // The distinction the scoring bug erased. correctOptionIndex answers in
  // SLOTS; what the room sees is the position among the FILLED slots. On a
  // gapped question those are different letters for the same option, and
  // comparing one against the other is what paid the wrong player.
  it('names a different letter for the same option when a slot is skipped', () => {
    const question = { ...GAPPED, correctAnswer: 'OptionC' };
    expect(scorerSlot(question)).toBe('C');

    const drawn = drawnOptions(question).find((o) => o.slot === 'C');
    expect(drawn.letter).toBe('B');
    expect(drawn.text).toBe('Jupiter');
  });

  it('and the same letter when no slot is skipped', () => {
    const question = { ...SOLID, correctAnswer: 'OptionC' };
    const drawn = drawnOptions(question).find((o) => o.slot === 'C');
    expect(drawn.letter).toBe('C');
  });
});
