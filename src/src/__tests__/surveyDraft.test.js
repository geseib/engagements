/**
 * THE SURVEY GENERATOR'S ARITHMETIC — utils/surveyDraft.js
 *
 * Pure functions, no DOM. What the generator form (mockup 02) computes before
 * a job starts, and the one bridge from a generated item to the CSV contract.
 *
 * THE CSV IS NOT WRITTEN HERE. The browser has exactly one writer of the
 * question-set CSV — `rowsToCsv` in utils/questionRows.js, held byte-identical
 * to the server's download by tests/question-set-roundtrip.js — and a survey
 * is a branch of it. This file only maps generated items to rows and hands
 * them over, so the mock below asserts the HAND-OVER, not the bytes.
 */
jest.mock('../utils/questionRows', () => {
  const actual = jest.requireActual('../utils/questionRows');
  return { ...actual, rowsToCsv: jest.fn(actual.rowsToCsv) };
});

const { rowsToCsv } = require('../utils/questionRows');
const {
  MAX_SURVEY_QUESTIONS,
  SURVEY_SIZES,
  DEFAULT_SURVEY_KINDS,
  clampQuestionCount,
  plannedMinutes,
  draftSurveyTitle,
  surveyItemsToCsv,
  surveyItemRow,
  kindMix,
} = require('../utils/surveyDraft');

describe('the numbers the form offers', () => {
  test('the three sizes are Quick 5, Standard 8 and Thorough 12, and the cap is 20', () => {
    // rejects: the old CountField presets (5/10/20/30) and its 50 ceiling.
    // Mockup 02: "Past twelve, people stop reading. The cap is 20."
    expect(SURVEY_SIZES.map((s) => [s.label, s.count])).toEqual([
      ['Quick', 5], ['Standard', 8], ['Thorough', 12],
    ]);
    expect(MAX_SURVEY_QUESTIONS).toBe(20);
  });

  test('every kind is on by default except Ranking', () => {
    // rejects: defaulting to all five. A ranking question is the slowest to
    // answer and the easiest to get wrong; the mockup draws it off.
    expect(DEFAULT_SURVEY_KINDS).toEqual(['rating', 'choice', 'yesno', 'text']);
  });

  test.each([
    [35, 20], ['35', 20], [20, 20], [8, 8], ['12', 12], [0, 1], [-4, 1], ['abc', 1], [7.6, 7],
  ])('a count of %p is clamped to %p', (raw, clamped) => {
    // rejects: sending 35 and trusting the server to cap it silently. The
    // number the form shows is the number that is asked for.
    expect(clampQuestionCount(raw)).toBe(clamped);
  });
});

describe('about N minutes to answer', () => {
  test('Workie mixes the ticked kinds, so the estimate mixes them too', () => {
    // 8 across rating/choice/yesno/text: two of each, two open answers.
    // 6 × 20s + 2 × 60s = 240s = 4 minutes (estimateMinutes' own rule).
    // rejects: estimating as if every question were the quick kind.
    expect(plannedMinutes(8, ['rating', 'choice', 'yesno', 'text'])).toBe(4);
  });

  test('an all-open-answer survey is a minute a question', () => {
    expect(plannedMinutes(5, ['text'])).toBe(5);
  });

  test('no open answers is twenty seconds a question, rounded up', () => {
    expect(plannedMinutes(5, ['rating'])).toBe(2);
  });

  test('nothing asked is nothing to answer', () => {
    expect(plannedMinutes(0, ['rating'])).toBe(0);
  });
});

describe('the name the set is created under', () => {
  test('a typed name wins', () => {
    expect(draftSurveyTitle({ title: '  Q3 All-Hands feedback ', source: 'x', goal: 'y' })).toBe('Q3 All-Hands feedback');
  });

  test('otherwise the first line of the material, cut at a word', () => {
    // rejects: sending no title. shared/generated-set.js creates NOTHING
    // without one and records "No title was given for the set" on the job, so
    // a blank name would quietly turn the draft-set path back into the manual
    // one.
    const source = 'Q3 all-hands, 22 Sep, 40 minutes, whole company (about forty-five people in the room)\n1. Q2 recap';
    const title = draftSurveyTitle({ title: '', source, goal: '' });
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.startsWith('Q3 all-hands, 22 Sep')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/Q2 recap/);
  });

  test('then the goal, then a plain fallback', () => {
    expect(draftSurveyTitle({ title: '', source: '  ', goal: 'Did the new format work?' })).toBe('Did the new format work?');
    expect(draftSurveyTitle({ title: '', source: '', goal: '' })).toBe('Untitled survey');
  });
});

describe('a generated item becomes a row of the one CSV contract', () => {
  const ITEMS = [
    { kind: 'rating', title: 'How useful was it?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['feedback'] },
    { kind: 'choice', title: 'Which part?', required: false, options: ['Demo', 'Stories'], tags: [] },
  ];

  test('every row is filed under Survey', () => {
    // rejects: an item with no category, which the importer skips as
    // "needs a category". Surveys expose no categories; every row carries one.
    expect(surveyItemRow(ITEMS[0]).category).toBe('Survey');
    expect(surveyItemRow(ITEMS[0]).title).toBe('How useful was it?');
    expect(surveyItemRow(ITEMS[0]).origin).toBe('new');
  });

  test('the CSV is the survey branch of rowsToCsv, not a second writer', () => {
    // rejects: a hand-rolled survey CSV here. Two writers of one contract is
    // how the poll exporter once emitted an empty Options column for every set.
    rowsToCsv.mockClear();
    surveyItemsToCsv(ITEMS);
    expect(rowsToCsv).toHaveBeenCalledTimes(1);
    const [rows, type] = rowsToCsv.mock.calls[0];
    expect(type).toBe('survey');
    expect(rows.map((r) => r.title)).toEqual(['How useful was it?', 'Which part?']);
    expect(rows.every((r) => r.category === 'Survey')).toBe(true);
  });
});

describe('the mix line over the review table', () => {
  test('counts each kind in menu order and leaves out the absent ones', () => {
    const mix = kindMix([{ kind: 'text' }, { kind: 'rating' }, { kind: 'text' }, { kind: 'choice' }]);
    expect(mix).toEqual([
      { kind: 'rating', count: 1 },
      { kind: 'choice', count: 1 },
      { kind: 'text', count: 2 },
    ]);
  });
});
