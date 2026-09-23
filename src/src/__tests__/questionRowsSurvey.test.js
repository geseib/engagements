import { SURVEY_KINDS, SURVEY_CATEGORY, defaultsFor } from '../config/surveyKinds';

/*
 * THE SURVEY BRANCH OF THE EDITOR'S DATA — utils/questionRows.js.
 *
 * Contract: docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md, "THE
 * CONTRACT". The server implements the other half against the same text
 * (lambda-functions/admin/shared/survey-kinds.js, download-question-set.js),
 * and tests/question-set-roundtrip.js holds the two byte-identical once both
 * halves exist. So every expected string below is TYPED OUT from the contract
 * rather than built from the code under test: a serialiser checked against
 * itself agrees with itself on every day it is wrong.
 *
 * questionRows.js is CommonJS on purpose (the roundtrip suite requires it from
 * node), so it is required here, not imported.
 */
const {
  toRow, blankRow, rowProblems, rowsToCsv,
} = require('../utils/questionRows');

/* ---------------------------------------------------------------- helpers -- */

const CONTRACT_HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,'
  + 'Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,'
  + 'YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes';

/** The 20 survey cells, named, so a failure says which column went wrong. */
const cells = (over = {}) => {
  const c = {
    Kind: '', Required: 'false', Options: '', AllowMultiple: 'false', MaxPicks: '',
    AllowOther: 'false', Shuffle: 'false', Scale: '', LowLabel: '', HighLabel: '',
    YesLabel: '', NoLabel: '', Unsure: 'false', FollowUpWhen: '', FollowUpPrompt: '',
    RankTop: '', TextLength: '', MaxLength: '', Placeholder: '', Themes: 'false',
    ...over,
  };
  return Object.values(c).map((v) => `"${v}"`).join(',');
};

/** A new survey row as the editor holds one: category filled, nothing stored yet. */
const survey = (fields) => ({
  ...blankRow({ kind: fields.kind }),
  ...fields,
});

const csvLines = (rows) => rowsToCsv(rows, 'survey').trim().split('\n');

/* ---------------------------------------------------------------- reading -- */

describe('toRow reads every contract field', () => {
  test('lower-case attributes, as the questions endpoint passes them through', () => {
    const row = toRow({
      id: 'c001#003', Category: 'Survey', Title: 'Pick two', kind: 'choice', required: true,
      options: ['Pace', 'Examples', 'Slides'], allowMultiple: true, maxPicks: 2,
      allowOther: true, shuffle: true,
    });
    expect(row.kind).toBe('choice');
    expect(row.required).toBe(true);
    expect(row.options).toEqual(['Pace', 'Examples', 'Slides']);
    expect(row.allowMultiple).toBe(true);
    expect(row.maxPicks).toBe(2);
    expect(row.allowOther).toBe(true);
    expect(row.shuffle).toBe(true);
  });

  test('capitalised spellings too, because the table holds both', () => {
    const rating = toRow({ Kind: 'rating', Required: 'true', Scale: '0-10', LowLabel: 'Never', HighLabel: 'Always' });
    expect(rating).toMatchObject({ kind: 'rating', required: true, scale: '0-10', lowLabel: 'Never', highLabel: 'Always' });

    const yesno = toRow({
      Kind: 'yesno', YesLabel: 'Sure', NoLabel: 'Nope', Unsure: true, FollowUpWhen: 'no', FollowUpPrompt: 'Why not?',
    });
    expect(yesno).toMatchObject({
      kind: 'yesno', yesLabel: 'Sure', noLabel: 'Nope', unsure: true, followUpWhen: 'no', followUpPrompt: 'Why not?',
    });

    expect(toRow({ Kind: 'rank', Options: ['A', 'B', 'C', 'D'], RankTop: 3 }))
      .toMatchObject({ kind: 'rank', options: ['A', 'B', 'C', 'D'], rankTop: 3 });

    expect(toRow({ Kind: 'text', TextLength: 'short', MaxLength: 140, Placeholder: 'A line', Themes: false }))
      .toMatchObject({ kind: 'text', textLength: 'short', maxLength: 140, placeholder: 'A line', themes: false });
  });

  test('a relevant field left empty reads as the contract default', () => {
    // rejects: reading an absent `scale` as '' and then serialising "" into the
    // Scale column — the importer would call that a blank scale, not a 1–5 one.
    expect(toRow({ kind: 'rating' }).scale).toBe('1-5');
    const long = toRow({ kind: 'text' });
    expect(long.textLength).toBe('long');
    expect(long.maxLength).toBe(500);
    expect(long.themes).toBe(true);
    expect(toRow({ kind: 'text', textLength: 'short' }).maxLength).toBe(280);
  });

  test('a field the kind does not use reads back as its empty value', () => {
    // The server stores only the fields relevant to the row's kind.
    const row = toRow({ kind: 'yesno' });
    expect(row).toMatchObject({
      options: [], allowMultiple: false, maxPicks: null, allowOther: false, shuffle: false,
      scale: '', lowLabel: '', highLabel: '', rankTop: null,
      textLength: '', maxLength: null, placeholder: '', themes: false,
      required: false, yesLabel: '', noLabel: '', unsure: false, followUpWhen: '', followUpPrompt: '',
    });
  });

  test('a row with no kind at all (trivia, poll, call-and-answer) carries an empty kind', () => {
    const row = toRow({ Category: 'Music', Title: 'WHO SANG THIS' });
    expect(row.kind).toBe('');
    expect(row.required).toBe(false);
  });
});

/* ---------------------------------------------------------------- blank rows */

describe('blankRow({ kind }) is a new survey question', () => {
  test.each(SURVEY_KINDS.map((k) => k.id))('a new %s row carries exactly the defaults surveyKinds.js gives it', (kind) => {
    // questionRows.js is CommonJS and cannot import config/surveyKinds.js (ESM),
    // so the defaults are written down twice. This is what keeps the two copies
    // one table: rejects either being edited alone.
    const row = blankRow({ kind });
    const defaults = defaultsFor(kind);
    Object.entries(defaults).forEach(([field, value]) => {
      expect({ field, value: row[field] }).toEqual({ field, value });
    });
  });

  test('it is filed under Survey, because the importer needs a category and surveys expose none', () => {
    expect(blankRow({ kind: 'rating' }).category).toBe(SURVEY_CATEGORY);
    expect(blankRow({ kind: 'text' }).origin).toBe('new');
  });

  test('an explicit override still wins', () => {
    expect(blankRow({ kind: 'choice', title: 'Pick one' }).title).toBe('Pick one');
  });

  test('blankRow with no kind is the trivia/poll blank row, untouched', () => {
    // rejects: every blank row in the product becoming a survey question.
    const row = blankRow({ category: 'Music' });
    expect(row.category).toBe('Music');
    expect(row.kind).toBe('');
    expect(row.options).toEqual([]);
  });
});

/* ------------------------------------------------------------- validation -- */

describe("rowProblems(row, 'survey') speaks the importer's words", () => {
  const problems = (fields) => rowProblems(survey({ title: 'A question', ...fields }), 'survey');

  test('a kind, and a known one', () => {
    expect(rowProblems({ category: 'Survey', title: 'Q', kind: '' }, 'survey')).toEqual(['needs a kind']);
    expect(rowProblems({ category: 'Survey', title: 'Q', kind: 'nps' }, 'survey')).toEqual(["unknown kind 'nps'"]);
  });

  test('category and title, as for every set', () => {
    expect(rowProblems({ ...blankRow({ kind: 'rating' }), category: '', title: '' }, 'survey'))
      .toEqual(['needs a category', 'needs a title']);
  });

  test('a new row of every kind with a title and its list filled is saveable', () => {
    expect(problems({ kind: 'rating' })).toEqual([]);
    expect(problems({ kind: 'choice', options: ['A', 'B'] })).toEqual([]);
    expect(problems({ kind: 'yesno' })).toEqual([]);
    expect(problems({ kind: 'rank', options: ['A', 'B', 'C'] })).toEqual([]);
    expect(problems({ kind: 'text' })).toEqual([]);
  });

  test('choice: two to eight options, blank slots not counted', () => {
    expect(problems({ kind: 'choice', options: ['A', ''] })).toEqual(['needs at least two options']);
    expect(problems({ kind: 'choice', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }))
      .toEqual(['has more than eight options']);
  });

  test('choice: a pick limit has to fit the options', () => {
    expect(problems({ kind: 'choice', options: ['A', 'B', 'C'], allowMultiple: true, maxPicks: 4 }))
      .toEqual(["can't allow 4 picks from 3 options"]);
    expect(problems({ kind: 'choice', options: ['A', 'B', 'C'], allowMultiple: true, maxPicks: 1 }))
      .toEqual(["can't allow 1 picks from 3 options"]);
    expect(problems({ kind: 'choice', options: ['A', 'B', 'C'], allowMultiple: true, maxPicks: 3 })).toEqual([]);
    expect(problems({ kind: 'choice', options: ['A', 'B', 'C'], allowMultiple: true, maxPicks: null })).toEqual([]);
  });

  test('rank: three to seven items, and a top-N that leaves something unranked', () => {
    expect(problems({ kind: 'rank', options: ['A', 'B'] })).toEqual(['needs at least three items']);
    expect(problems({ kind: 'rank', options: ['1', '2', '3', '4', '5', '6', '7', '8'] }))
      .toEqual(['has more than seven items']);
    expect(problems({ kind: 'rank', options: ['A', 'B', 'C', 'D'], rankTop: 4 }))
      .toEqual(["can't rank the top 4 of 4"]);
    expect(problems({ kind: 'rank', options: ['A', 'B', 'C', 'D'], rankTop: 0 }))
      .toEqual(["can't rank the top 0 of 4"]);
    expect(problems({ kind: 'rank', options: ['A', 'B', 'C', 'D'], rankTop: 3 })).toEqual([]);
  });

  test('rating: one of the four scales', () => {
    expect(problems({ kind: 'rating', scale: '1-7' })).toEqual(["unknown scale '1-7'"]);
    ['1-5', '1-10', '0-10', 'stars'].forEach((scale) => expect(problems({ kind: 'rating', scale })).toEqual([]));
  });

  test('yes/no: a known follow-up, and its question when there is one', () => {
    expect(problems({ kind: 'yesno', followUpWhen: 'maybe' })).toEqual(["unknown follow-up 'maybe'"]);
    expect(problems({ kind: 'yesno', followUpWhen: 'no', followUpPrompt: '  ' })).toEqual(['needs the follow-up question']);
    expect(problems({ kind: 'yesno', followUpWhen: 'any', followUpPrompt: 'Why?' })).toEqual([]);
  });

  test('open answer: short or long, and a 20–2000 character limit', () => {
    expect(problems({ kind: 'text', textLength: 'medium' })).toEqual(["unknown length 'medium'"]);
    expect(problems({ kind: 'text', maxLength: 19 })).toEqual(['answer limit must be 20–2000 characters']);
    expect(problems({ kind: 'text', maxLength: 2001 })).toEqual(['answer limit must be 20–2000 characters']);
    expect(problems({ kind: 'text', maxLength: 2000 })).toEqual([]);
  });

  test('trivia and poll validation is not touched by any of it', () => {
    expect(rowProblems({ category: 'Food', title: 'Q', options: ['A'] }, 'poll')).toEqual(['needs at least two options']);
    expect(rowProblems({ category: 'Food', title: 'Q' }, 'call-and-answer')).toEqual([]);
  });
});

/* -------------------------------------------------------------------- CSV -- */

describe("rowsToCsv(rows, 'survey') writes the contract CSV", () => {
  test('the header is the contract header, then Tags', () => {
    expect(csvLines([survey({ kind: 'rating', title: 'Q' })])[0]).toBe(`${CONTRACT_HEADER},Tags`);
  });

  test('a rating row', () => {
    const [, line] = csvLines([survey({
      kind: 'rating', title: 'How useful was it?', required: true, lowLabel: 'Not useful', highLabel: 'Very useful',
    })]);
    expect(line).toBe(`"Survey",1,"How useful was it?","","",""`
      + `,${cells({ Kind: 'rating', Required: 'true', Scale: '1-5', LowLabel: 'Not useful', HighLabel: 'Very useful' })}`
      + ',""');
  });

  test('a choice row: options pipe-joined, blank slots dropped, a pick limit only when several are allowed', () => {
    const [, several, one] = csvLines([
      survey({
        kind: 'choice', title: 'Pick up to two', options: ['Pace', 'Examples', 'The "slides"', ''],
        allowMultiple: true, maxPicks: 2, allowOther: true, shuffle: true,
      }),
      // maxPicks left over from a moment when Several was on: not relevant, not written.
      survey({ kind: 'choice', title: 'Pick one', options: ['Yes', 'No'], allowMultiple: false, maxPicks: 2 }),
    ]);
    expect(several).toBe(`"Survey",1,"Pick up to two","","",""`
      + `,${cells({
        Kind: 'choice', Options: 'Pace|Examples|The ""slides""', AllowMultiple: 'true', MaxPicks: '2',
        AllowOther: 'true', Shuffle: 'true',
      })},""`);
    expect(one).toBe(`"Survey",2,"Pick one","","",""`
      + `,${cells({ Kind: 'choice', Options: 'Yes|No' })},""`);
  });

  test('a yes/no row: the follow-up question only when there is a follow-up', () => {
    const [, asks, quiet] = csvLines([
      survey({
        kind: 'yesno', title: 'Would you come again?', yesLabel: 'Sure', unsure: true,
        followUpWhen: 'no', followUpPrompt: 'What would change your mind?',
      }),
      survey({ kind: 'yesno', title: 'Did it start on time?', followUpWhen: '', followUpPrompt: 'left over' }),
    ]);
    expect(asks).toBe(`"Survey",1,"Would you come again?","","",""`
      + `,${cells({
        Kind: 'yesno', YesLabel: 'Sure', Unsure: 'true', FollowUpWhen: 'no', FollowUpPrompt: 'What would change your mind?',
      })},""`);
    expect(quiet).toBe(`"Survey",2,"Did it start on time?","","",""`
      + `,${cells({ Kind: 'yesno' })},""`);
  });

  test('a ranking row: items pipe-joined, a top-N or nothing', () => {
    const [, top, all] = csvLines([
      survey({ kind: 'rank', title: 'Top three', options: ['A', 'B', 'C', 'D', 'E'], rankTop: 3 }),
      survey({ kind: 'rank', title: 'All of them', options: ['A', 'B', 'C'] }),
    ]);
    expect(top).toBe(`"Survey",1,"Top three","","",""`
      + `,${cells({ Kind: 'rank', Options: 'A|B|C|D|E', RankTop: '3' })},""`);
    expect(all).toBe(`"Survey",2,"All of them","","",""`
      + `,${cells({ Kind: 'rank', Options: 'A|B|C' })},""`);
  });

  test('an open-answer row: length, limit, placeholder and themes', () => {
    const [, long, short] = csvLines([
      survey({ kind: 'text', title: 'What would you tell a colleague?', placeholder: 'A sentence or two' }),
      survey({ kind: 'text', title: 'One word', textLength: 'short', maxLength: 40, themes: false }),
    ]);
    expect(long).toBe(`"Survey",1,"What would you tell a colleague?","","",""`
      + `,${cells({ Kind: 'text', TextLength: 'long', MaxLength: '500', Placeholder: 'A sentence or two', Themes: 'true' })},""`);
    expect(short).toBe(`"Survey",2,"One word","","",""`
      + `,${cells({ Kind: 'text', TextLength: 'short', MaxLength: '40' })},""`);
  });

  test('fields left over from another kind are written as empty, as the server stores them', () => {
    // A choice switched to a rating by hand, without convertKind's clean-up:
    // the stale list must not reach the Options column of a rating row.
    const [, line] = csvLines([{
      ...survey({ kind: 'rating', title: 'Was it clear?' }),
      options: ['stale', 'list'], allowMultiple: true, themes: true, placeholder: 'stale',
    }]);
    expect(line).toBe(`"Survey",1,"Was it clear?","","",""`
      + `,${cells({ Kind: 'rating', Scale: '1-5' })},""`);
  });

  test('a loaded row keeps its stored number, tags and optional columns ride as for every type', () => {
    const loaded = toRow({
      id: 'c001#002', Category: 'Survey', QuestionNumber: 2, Title: 'Anything else?', kind: 'text',
      textLength: 'long', maxLength: 500, themes: true, Tags: ['close'], SourceSetId: 'older',
    });
    const lines = csvLines([loaded]);
    expect(lines[0]).toBe(`${CONTRACT_HEADER},SourceSetId,Tags`);
    expect(lines[1]).toBe(`"Survey",2,"Anything else?","","",""`
      + `,${cells({ Kind: 'text', TextLength: 'long', MaxLength: '500', Themes: 'true' })},"older","close"`);
  });

  test('a stored survey row reads and writes back to the same cells', () => {
    // The download → edit nothing → Save loop, the one the roundtrip suite
    // holds against the real server: what toRow reads, rowsToCsv writes.
    const stored = {
      id: 'c001#001', Category: 'Survey', QuestionNumber: 1, Title: 'Rate the pace', kind: 'rating',
      required: true, scale: 'stars', lowLabel: 'Too slow', highLabel: 'Too fast',
    };
    expect(csvLines([toRow(stored)])[1]).toBe(`"Survey",1,"Rate the pace","","",""`
      + `,${cells({ Kind: 'rating', Required: 'true', Scale: 'stars', LowLabel: 'Too slow', HighLabel: 'Too fast' })},""`);
  });
});

describe('a | inside an option (review finding, 2026-09-23)', () => {
  // The importer splits Options on | with no escape, so a pipe inside an
  // option became two options — and could push a choice past eight or a
  // ranking past seven, where the importer skips the question on Save.
  // Folded to '/', as shared/csv.js does for polls, identically on the server.
  test('is folded to / in the Options cell, and the option count is unchanged', () => {
    const row = toRow({ Category: 'Survey', Title: 'Q', kind: 'choice', options: ['Before | after', 'Q&A', 'Case study'] });
    const [, line] = rowsToCsv([row], 'survey').trim().split('\n');
    expect(line).toContain('"Before / after|Q&A|Case study"');
  });
});
