import {
  resolveInstruction, currentQuestionOf, ART_TITLE_INSTRUCTION, GAME_TYPE_INSTRUCTIONS,
} from '../config/instructions';

const CALL_AND_ANSWER_DEFAULT = GAME_TYPE_INSTRUCTIONS['call-and-answer'];

const artQuestion = {
  id: '002',
  title: 'THE COMPANY STEPS OUT',
  image: '/assets/art/the-company-steps-out.jpg',
  customInstructions: 'This is a group portrait pretending to be an action scene. Title the action.',
};

describe('resolveInstruction', () => {
  it("uses the question's own instruction first", () => {
    expect(resolveInstruction(artQuestion, 'set-level', 'call-and-answer'))
      .toBe(artQuestion.customInstructions);
  });

  it('falls back to the set instruction when the question has none', () => {
    expect(resolveInstruction({ id: '1' }, 'Answer in the STAR format.', 'call-and-answer'))
      .toBe('Answer in the STAR format.');
  });

  it('uses the art instruction for an image round with no instruction anywhere', () => {
    expect(resolveInstruction({ id: '1', image: '/assets/art/x.jpg' }, '', 'call-and-answer'))
      .toBe(ART_TITLE_INSTRUCTION);
  });

  it('falls back to the game-type default for an ordinary question', () => {
    expect(resolveInstruction({ id: '1' }, '', 'call-and-answer')).toBe(CALL_AND_ANSWER_DEFAULT);
    expect(resolveInstruction({ id: '1' }, '', 'trivia')).toBe(GAME_TYPE_INSTRUCTIONS.trivia);
  });

  // The reported bug: an art round showed the generic call-and-answer default.
  it('never shows the generic default for an art round', () => {
    for (const setInstruction of ['', null, undefined]) {
      expect(resolveInstruction(artQuestion, setInstruction, 'call-and-answer'))
        .not.toBe(CALL_AND_ANSWER_DEFAULT);
    }
  });

  it('tolerates a missing question without throwing', () => {
    expect(resolveInstruction(null, '', 'call-and-answer')).toBe(CALL_AND_ANSWER_DEFAULT);
    expect(resolveInstruction(undefined, '', 'trivia')).toBe(GAME_TYPE_INSTRUCTIONS.trivia);
  });

  it('accepts the capitalised DynamoDB spellings too', () => {
    expect(resolveInstruction({ CustomInstructions: 'Capitalised' }, '', 'call-and-answer'))
      .toBe('Capitalised');
    expect(resolveInstruction({ Image: '/assets/art/x.jpg' }, '', 'call-and-answer'))
      .toBe(ART_TITLE_INSTRUCTION);
  });

  it('treats a whitespace-only instruction as absent', () => {
    expect(resolveInstruction({ customInstructions: '   ' }, '  ', 'call-and-answer'))
      .toBe(CALL_AND_ANSWER_DEFAULT);
  });
});

describe('currentQuestionOf', () => {
  it('finds the question by id', () => {
    expect(currentQuestionOf([{ id: 'a' }, { id: 'b' }], 'b').id).toBe('b');
  });

  // This is the actual defect. The host's restore path sets `questions` but not
  // `currentQuestionId`, so the id lookup missed and the caller got undefined —
  // which silently skipped the artwork check.
  it('falls back to the only question when the id does not match', () => {
    expect(currentQuestionOf([artQuestion], undefined)).toBe(artQuestion);
    expect(currentQuestionOf([artQuestion], '')).toBe(artQuestion);
    expect(currentQuestionOf([artQuestion], '999')).toBe(artQuestion);
  });

  it('returns null rather than undefined when there is nothing to show', () => {
    expect(currentQuestionOf([], '1')).toBeNull();
    expect(currentQuestionOf(null, '1')).toBeNull();
  });

  it('end to end: a restored art round still gets its own instruction', () => {
    const q = currentQuestionOf([artQuestion], undefined); // id never set, as after a refresh
    expect(resolveInstruction(q, '', 'call-and-answer')).toBe(artQuestion.customInstructions);
  });
});
