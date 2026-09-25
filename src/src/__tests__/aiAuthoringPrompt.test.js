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

describe('§4 the optional Background column is not caught by "no extra columns"', () => {
  // Fix round 1: the column guide names Background as an optional column
  // (question-background Task 7), but OUTPUT_RULES used to say "The first
  // line must be exactly this header, unchanged" and "No extra columns" right
  // underneath it — two irreconcilable rules an outside AI would have to
  // guess between. Assert the carve-out sits WITH each rule it qualifies,
  // not just that the word "Background" appears somewhere in the prompt.
  // Robust to wording: matches structure, not a pinned phrase.
  test.each(AUTHORING_PROMPT_TYPES)('%s: the header-unchanged rule names the Background exception', (type) => {
    const text = authoringPrompt(type);
    const headerRule = text.match(/The first line must be exactly this header[^\n]*\n/i);
    expect(headerRule).not.toBeNull();
    expect(headerRule[0]).toMatch(/Background/);
  });

  test.each(AUTHORING_PROMPT_TYPES)('%s: "no extra columns" is qualified, not an unqualified ban', (type) => {
    const text = authoringPrompt(type);
    const noExtraColumnsSentence = text.match(/No extra columns[^.\n]*\.?/i);
    expect(noExtraColumnsSentence).not.toBeNull();
    expect(noExtraColumnsSentence[0]).toMatch(/Background/i);
  });

  test.each(AUTHORING_PROMPT_TYPES)('%s: the pinned header const itself is untouched by the carve-out', (type) => {
    // The exception lives in the surrounding rule text, never in the header
    // line an AI is told to reproduce verbatim — that line stays pinned to
    // download-template.js (§1) regardless of whether a Background column
    // guide was added.
    const header = type === 'call-and-answer' ? CALL_AND_ANSWER_HEADER : TRIVIA_HEADER;
    expect(header).not.toMatch(/Background/);
    expect(authoringPrompt(type)).toContain(header);
  });
});
