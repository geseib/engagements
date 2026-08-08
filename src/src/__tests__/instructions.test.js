import {
  resolveInstruction, currentQuestionOf, ART_TITLE_INSTRUCTION, GAME_TYPE_INSTRUCTIONS,
  resolveRoundNoun, pluralRoundNoun, ART_ROUND_NOUN,
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

describe('the art instruction itself', () => {
  it('names the art round rather than describing a lesson', () => {
    const text = resolveInstruction({ image: '/assets/art/x.jpg' }, '', 'call-and-answer');
    expect(text).toBe(ART_TITLE_INSTRUCTION);
    expect(text).toMatch(/work of art/i);
    expect(text).not.toMatch(/lesson/i);
  });

  it('is what the placeholder surfaces get too, with no question or set text', () => {
    // Both textareas used to carry their own hardcoded art string
    // ("Enter your creative title for this masterpiece...").
    expect(resolveInstruction({ image: 'x.jpg' }, null, 'call-and-answer'))
      .toBe(ART_TITLE_INSTRUCTION);
  });

  it('gives poll and survey their own defaults instead of call-and-answer', () => {
    expect(resolveInstruction({}, '', 'poll')).toBe(GAME_TYPE_INSTRUCTIONS.poll);
    expect(resolveInstruction({}, '', 'survey')).toBe(GAME_TYPE_INSTRUCTIONS.survey);
    expect(resolveInstruction({}, '', 'wavelength')).toBe(GAME_TYPE_INSTRUCTIONS.wavelength);
  });
});

describe('resolveRoundNoun', () => {
  it('calls an art round an Artwork', () => {
    expect(resolveRoundNoun(artQuestion, 'call-and-answer')).toBe(ART_ROUND_NOUN);
    expect(resolveRoundNoun({ Image: '/assets/art/x.jpg' }, 'call-and-answer')).toBe('Artwork');
  });

  it('calls a plain call-and-answer round a Round, never a Lesson', () => {
    expect(resolveRoundNoun({ id: '1' }, 'call-and-answer')).toBe('Round');
  });

  it('uses the game type noun for the other types', () => {
    expect(resolveRoundNoun({}, 'trivia')).toBe('Question');
    expect(resolveRoundNoun({}, 'poll')).toBe('Poll');
    expect(resolveRoundNoun({}, 'wavelength')).toBe('Subject');
    expect(resolveRoundNoun({}, 'survey')).toBe('Question');
  });

  it('lets an explicit per-set noun beat the artwork', () => {
    expect(resolveRoundNoun(artQuestion, 'call-and-answer', 'Masterpiece')).toBe('Masterpiece');
    expect(resolveRoundNoun({}, 'trivia', 'Lesson')).toBe('Lesson');
  });

  it('ignores a blank or whitespace-only per-set noun', () => {
    expect(resolveRoundNoun(artQuestion, 'call-and-answer', '   ')).toBe(ART_ROUND_NOUN);
    expect(resolveRoundNoun({}, 'trivia', '')).toBe('Question');
    expect(resolveRoundNoun({}, 'trivia', null)).toBe('Question');
  });

  it('tolerates a missing question or an unknown game type', () => {
    expect(resolveRoundNoun(null, 'call-and-answer')).toBe('Round');
    expect(resolveRoundNoun(undefined, undefined)).toBe('Round');
    expect(resolveRoundNoun({}, 'nonsense')).toBe('Round');
  });

  it('accepts the storage spelling of call-and-answer', () => {
    expect(resolveRoundNoun({}, 'callandanswer')).toBe('Round');
    expect(resolveRoundNoun({}, 'polls')).toBe('Poll');
  });

  it('treats a whitespace-only image as no artwork', () => {
    expect(resolveRoundNoun({ image: '   ' }, 'call-and-answer')).toBe('Round');
  });

  // D3: the host said "Lesson N" while asking and "Question N" on results.
  it('gives ASK and RESULTS the same noun for the same round', () => {
    for (const type of ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey']) {
      const ask = resolveRoundNoun(artQuestion, type);
      const results = resolveRoundNoun(artQuestion, type);
      expect(ask).toBe(results);
    }
  });
});

describe('pluralRoundNoun', () => {
  it('pluralises everything but one', () => {
    expect(pluralRoundNoun('Round', 1)).toBe('Round');
    expect(pluralRoundNoun('Round', 0)).toBe('Rounds');
    expect(pluralRoundNoun('Round', 3)).toBe('Rounds');
    expect(pluralRoundNoun('Artwork', 5)).toBe('Artworks');
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
