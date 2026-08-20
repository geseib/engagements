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
 * assert containment, the modalReachability technique.
 *
 * §2 CONTENT. The owner's ask, verbatim: "it should say what the host should
 * fill in like number of questions/lessons, level of detail, difficulty, etc
 * ... clearly marking that in the copied prompt." Marking IS the requirement,
 * so the [BRACKETS] are asserted, not hoped for.
 */
const fs = require('fs');
const path = require('path');
const {
  AUTHORING_PROMPT_TYPES,
  authoringPrompt,
  CALL_AND_ANSWER_HEADER,
  TRIVIA_HEADER,
} = require('../config/aiAuthoringPrompt');

const LAMBDA = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'lambda-functions', 'admin', 'download-template.js'),
  'utf8'
);

describe('§1 the header the prompt dictates is the header the template carries', () => {
  test('call-and-answer, character for character', () => {
    expect(LAMBDA).toContain(CALL_AND_ANSWER_HEADER);
    expect(authoringPrompt('call-and-answer')).toContain(CALL_AND_ANSWER_HEADER);
  });

  test('trivia, character for character', () => {
    expect(LAMBDA).toContain(TRIVIA_HEADER);
    expect(authoringPrompt('trivia')).toContain(TRIVIA_HEADER);
  });
});

describe('§2 the host knows what to fill in, because it is marked', () => {
  test('the two types the owner scoped have prompts; the others have none', () => {
    // rejects: a button for a type whose prompt does not exist, which would
    // copy `null` — and a prompt for a type the owner has not asked for yet.
    expect(AUTHORING_PROMPT_TYPES).toEqual(['call-and-answer', 'trivia']);
    for (const type of AUTHORING_PROMPT_TYPES) {
      expect(typeof authoringPrompt(type)).toBe('string');
    }
    for (const type of ['poll', 'wavelength', 'survey', '', undefined]) {
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
});

describe('§3 the rules that keep the returned CSV importable', () => {
  test('trivia: correctAnswer names a column, in the importer\'s exact spelling', () => {
    // rejects: "the letter of the answer" or lowercase "optionA" — the stored
    // value the game compares against is OptionA..OptionF, capital O
    // (upload-questions / trivia scoring), and "A" alone never matches.
    const text = authoringPrompt('trivia');
    expect(text).toMatch(/exactly one of OptionA, OptionB, OptionC, OptionD, OptionE or OptionF/);
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

  test.each(AUTHORING_PROMPT_TYPES)('%s: CSV-only output, quoting rule, ask-don\'t-guess', (type) => {
    const text = authoringPrompt(type);
    expect(text).toMatch(/ONLY the CSV/);
    expect(text).toMatch(/Wrap any field that contains a comma/);
    // An unfilled bracket must become a question back to the host, not thirty
    // questions for a guessed room.
    expect(text).toMatch(/ask me for it before writing anything/);
    // The 24-category bitmask ceiling, stated where the categories are chosen.
    expect(text).toMatch(/24 is the hard maximum/);
  });
});
