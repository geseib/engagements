/**
 * THE PROMPT A HOST HANDS TO SOMEBODY ELSE'S AI — config/aiAuthoringPrompt.js
 *
 * Two kinds of pin, and the first is the reason this file exists:
 *
 * §1 CROSS-FILE. The copied prompt tells Claude/ChatGPT to emit "exactly this
 * header" — so that header must be, character for character, the one in the
 * template the host downloads from lambda-functions/admin/download-template.js.
 * The two files can be edited a repo apart, and the day they disagree the AI
 * follows whichever it was pasted, the importer half-drops the result, and the
 * failure surfaces as "the AI wrote a broken CSV". Read the Lambda AS TEXT and
 * assert containment, the modalReachability technique. Poll and survey build
 * their header from the contract; tests/template-roundtrip.js downloads every
 * template and compares its real first line.
 *
 * §2 CONTENT. The owner's ask, verbatim: "it should say what the host should
 * fill in like number of questions/lessons, level of detail, difficulty, etc
 * ... clearly marking that in the copied prompt." Marking IS the requirement,
 * so the [BRACKETS] are asserted, not hoped for.
 *
 * Every type a template downloads for has one since 25 Oct 2026
 * (docs/design/authoring-guidance/).
 */
const fs = require('fs');
const path = require('path');
const {
  AUTHORING_PROMPT_TYPES,
  BACKGROUND_TYPES,
  KIND_COLUMN_HELP,
  authoringPrompt,
  fillInCount,
  templateFileFor,
  CALL_AND_ANSWER_HEADER,
  TRIVIA_HEADER,
  WAVELENGTH_HEADER,
  ART_TITLE_HEADER,
  SURVEY_HEADER,
  WAVELENGTH_INSTRUCTION,
} = require('../config/aiAuthoringPrompt');
const contract = require('../config/surveyContract.json');

const LAMBDA = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'lambda-functions', 'admin', 'download-template.js'),
  'utf8'
);

/** The types whose host chooses categories; a survey files every row under one. */
const WITH_CATEGORIES = AUTHORING_PROMPT_TYPES.filter((t) => t !== 'survey');
const WITHOUT_BACKGROUND = AUTHORING_PROMPT_TYPES.filter((t) => !BACKGROUND_TYPES.includes(t));

describe('§1 the header the prompt dictates is the header the template carries', () => {
  test.each([
    ['call-and-answer', CALL_AND_ANSWER_HEADER],
    ['trivia', TRIVIA_HEADER],
    ['wavelength', WAVELENGTH_HEADER],
    ['art-title', ART_TITLE_HEADER],
  ])('%s, character for character', (type, header) => {
    expect(LAMBDA).toContain(header);
    expect(authoringPrompt(type)).toContain(header);
  });

  test('poll and survey: the contract header, which is what their templates are written with', () => {
    expect(SURVEY_HEADER).toBe(contract.header);
    expect(authoringPrompt('poll')).toContain(SURVEY_HEADER);
    expect(authoringPrompt('survey')).toContain(SURVEY_HEADER);
  });

  test('every type names the file it pairs with', () => {
    for (const type of AUTHORING_PROMPT_TYPES) expect(templateFileFor(type)).toMatch(/\.csv$/);
  });
});

describe('§2 the host knows what to fill in, because it is marked', () => {
  test('every type with a template has a prompt; anything else has none', () => {
    // rejects: a set type whose template downloads with nothing to tell the
    // AI about its columns (poll and survey had 27, unexplained) — and a
    // button for a type with no prompt, which would copy `null`.
    expect(AUTHORING_PROMPT_TYPES).toEqual(['call-and-answer', 'trivia', 'poll', 'survey', 'wavelength', 'art-title']);
    for (const type of AUTHORING_PROMPT_TYPES) {
      expect(typeof authoringPrompt(type)).toBe('string');
    }
    for (const type of ['build', '', undefined, 'toString', 'constructor']) {
      expect(authoringPrompt(type)).toBeNull();
    }
  });

  test.each(AUTHORING_PROMPT_TYPES)('%s marks every host decision in [BRACKETS]', (type) => {
    const text = authoringPrompt(type);
    // The owner's list: "number of questions/lessons, level of detail,
    // difficulty, etc" — plus the two nothing sensible can be written without.
    expect(text).toContain('[TOPIC');
    expect(text).toContain('[AUDIENCE');
    expect(text).toContain('[COUNT');
    expect(text).toMatch(/FILL THIS IN BEFORE SENDING \(replace every \[BRACKET\]\)/);
    expect(fillInCount(type)).toBeGreaterThanOrEqual(4);
  });

  test('trivia asks for the difficulty mix and the explanation depth', () => {
    const text = authoringPrompt('trivia');
    expect(text).toMatch(/Difficulty mix: \[/);
    expect(text).toMatch(/easy, medium or hard/);
    expect(text).toMatch(/answer explanations should be: \[/);
  });

  test('call-and-answer asks for the lesson length', () => {
    expect(authoringPrompt('call-and-answer')).toMatch(/Length of each lesson: \[SHORT/);
  });

  test('poll and survey ask which kinds; the survey asks what the host wants to find out', () => {
    expect(authoringPrompt('poll')).toMatch(/\[KINDS/);
    expect(authoringPrompt('survey')).toMatch(/\[KINDS/);
    expect(authoringPrompt('survey')).toMatch(/\[GOAL/);
  });
});

describe('§3 the rules that keep the returned CSV importable', () => {
  test('trivia: correctAnswer names a column, in the importer\'s exact spelling', () => {
    // rejects: "the letter of the answer" or lowercase "optionA" — the stored
    // value the game compares against is OptionA..OptionF, capital O
    // (upload-questions / trivia scoring), and "A" alone never matches.
    const text = authoringPrompt('trivia');
    expect(text).toMatch(/exactly one of OptionA, OptionB, OptionC, OptionD, OptionE or OptionF/);
    expect(text).toMatch(/Vary which letter is correct/);
    expect(text).toMatch(/same kind/);
  });

  test('call-and-answer: the participant prompt is forward-looking and team-lens', () => {
    // The owner's own rule, from the Historic World Leaders rework: "the intent
    // was for them to think how this could be applied... through the teams
    // lens", never "Recall a time you...". A generated set that gets this wrong
    // reproduces the exact defect that rework fixed.
    const text = authoringPrompt('call-and-answer');
    expect(text).toMatch(/FORWARD-LOOKING AND THROUGH THE TEAM'S LENS/);
    expect(text).toMatch(/never a personal retrospective/i);
    expect(text).toMatch(/Recall a time you/);
  });

  test.each(AUTHORING_PROMPT_TYPES)('%s: CSV-only output, quoting rule, ask-don\'t-guess, upload back', (type) => {
    const text = authoringPrompt(type);
    expect(text).toMatch(/ONLY the CSV/);
    expect(text).toMatch(/Wrap any field that contains a comma/);
    // An unfilled bracket must become a question back to the host, not thirty
    // questions for a guessed room.
    expect(text).toMatch(/ask me for it before writing anything/);
    expect(text).toMatch(/upload the CSV back into Engage/);
  });

  test.each(WITH_CATEGORIES)('%s: the 24-category ceiling, stated where the categories are chosen', (type) => {
    expect(authoringPrompt(type)).toMatch(/24 is the hard maximum/);
  });

  test('survey: every row is filed under the survey category, named exactly', () => {
    expect(authoringPrompt('survey')).toContain(`always exactly ${contract.surveyCategory}`);
  });

  test.each(AUTHORING_PROMPT_TYPES)('%s: the house rules — plain words, nothing invented, no hyperbole', (type) => {
    const text = authoringPrompt(type);
    expect(text).toMatch(/HOUSE RULES/);
    expect(text).toMatch(/Plain words/);
    expect(text).toMatch(/no invented facts/);
    expect(text).toMatch(/No hyperbole/);
  });
});

describe('§4 the optional Background column, only where it is offered', () => {
  // Fix round 1: the column guide names Background as an optional column
  // (question-background Task 7), but OUTPUT_RULES used to say "The first
  // line must be exactly this header, unchanged" and "No extra columns" right
  // underneath it — two irreconcilable rules an outside AI would have to
  // guess between. Assert the carve-out sits WITH each rule it qualifies.
  test.each(BACKGROUND_TYPES)('%s: the header-unchanged rule names the Background exception', (type) => {
    const headerRule = authoringPrompt(type).match(/The first line must be exactly this header[^\n]*\n/i);
    expect(headerRule).not.toBeNull();
    expect(headerRule[0]).toMatch(/Background/);
  });

  test.each(BACKGROUND_TYPES)('%s: "no extra columns" is qualified, not an unqualified ban', (type) => {
    const sentence = authoringPrompt(type).match(/No extra columns[^.\n]*\.?/i);
    expect(sentence).not.toBeNull();
    expect(sentence[0]).toMatch(/Background/i);
  });

  test.each(WITHOUT_BACKGROUND)('%s: no Background is offered, so none is excepted', (type) => {
    const text = authoringPrompt(type);
    expect(text).not.toMatch(/Background/);
    expect(text).toMatch(/No extra columns;/);
  });

  test.each([['call-and-answer', CALL_AND_ANSWER_HEADER], ['trivia', TRIVIA_HEADER]])(
    '%s: the pinned header const itself is untouched by the carve-out',
    (type, header) => {
      // The exception lives in the surrounding rule text, never in the header
      // line an AI is told to reproduce verbatim.
      expect(header).not.toMatch(/Background/);
      expect(authoringPrompt(type)).toContain(header);
    }
  );
});

describe('§5 each type says what its own game needs', () => {
  test('poll and survey explain every kind column the contract has, with its real values and limits', () => {
    // rejects: a column added to survey-kinds.js that the prompt never explains.
    for (const column of contract.kindColumns.filter((c) => c !== 'Kind' && c !== 'Required')) {
      expect(typeof KIND_COLUMN_HELP[column]).toBe('function');
      expect(authoringPrompt('survey')).toContain(`${column} —`);
    }
    const survey = authoringPrompt('survey');
    for (const scale of contract.scales) expect(survey).toContain(scale);
    const { choiceOptions, rankItems, maxLength } = contract.limits;
    expect(survey).toContain(`${choiceOptions.min} to ${choiceOptions.max} answers`);
    expect(survey).toContain(`${rankItems.min} to ${rankItems.max} items`);
    expect(survey).toContain(`${maxLength.min} to ${maxLength.max}`);
  });

  test('a poll is offered only the kinds a poll may be — no ranking', () => {
    const poll = authoringPrompt('poll');
    for (const kind of contract.pollKinds) expect(poll).toMatch(new RegExp(`^- ${kind}: `, 'm'));
    expect(poll).not.toMatch(/^- rank: /m);
    expect(authoringPrompt('survey')).toMatch(/^- rank: /m);
  });

  test('wavelength: a 1-4 word subject, no framing detail, the fixed instruction', () => {
    const text = authoringPrompt('wavelength');
    expect(text).toMatch(/1 to 4 words/);
    expect(text).toMatch(/Detail_lesson: ALWAYS EMPTY/);
    expect(text).toContain(WAVELENGTH_INSTRUCTION);
    expect(LAMBDA).toContain(WAVELENGTH_INSTRUCTION);
  });

  test('art title: no lesson to spoil the round, the reveal in AnswerDetails, never an invented link', () => {
    const text = authoringPrompt('art-title');
    expect(text).toMatch(/Detail_lesson: ALWAYS EMPTY/);
    expect(text).toMatch(/AnswerDetails: the reveal/);
    expect(text).toMatch(/Never invent a link/);
  });
});
