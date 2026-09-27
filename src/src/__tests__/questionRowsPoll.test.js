import { POLL_KINDS } from '../config/surveyKinds';

/*
 * THE POLL BRANCH OF THE EDITOR'S DATA — utils/questionRows.js.
 *
 * A poll question is a survey question the host asks (the owner, 27 Sep 2026):
 * one of four kinds, the survey's fields and the survey's validation, less
 * rank. The server's half is POLL_KINDS / pollFieldsOf / validatePoll in
 * lambda-functions/admin/shared/survey-kinds.js and the poll branch of
 * download-question-set.js; tests/question-set-roundtrip.js holds the two
 * writers byte-identical against the real handlers.
 *
 * Every expected string below is TYPED OUT from the contract rather than built
 * from the code under test. questionRows.js is CommonJS (the roundtrip suite
 * requires it from node), so it is required here, not imported.
 */
const {
  toRow, editableRows, blankRow, pollRow, rowProblems, rowsToCsv,
} = require('../utils/questionRows');

const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,'
  + 'Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,'
  + 'YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes,Tags';

describe('the poll kinds', () => {
  test('are the server\'s four, in its order — choice first, no rank', () => {
    // The browser keeps its own copy (a Lambda bundle cannot import the
    // frontend's ESM, nor the frontend a Lambda's CommonJS at runtime), so the
    // two are held equal here rather than trusted to agree.
    const server = require('../../../lambda-functions/admin/shared/survey-kinds.js');
    expect(POLL_KINDS).toEqual(['choice', 'rating', 'yesno', 'text']);
    expect(POLL_KINDS).toEqual(server.POLL_KINDS);
  });

  test('the editor and the importer agree on a rank row, in validatePoll\'s words', () => {
    const server = require('../../../lambda-functions/admin/shared/survey-kinds.js');
    const rank = { ...blankRow({ category: 'Work', kind: 'rank' }), title: 'Q', options: ['a', 'b', 'c'] };
    expect(rowProblems(rank, 'poll')).toEqual(server.validatePoll(server.surveyFieldsFromItem(rank)));
  });
});

describe('pollRow reads a stored poll row as the kind it is', () => {
  test('a row from before kinds with two or more options is the choice it always meant', () => {
    const row = pollRow(toRow({ Category: 'Work', Title: 'Where?', options: ['Office', 'Home'], allowMultiple: true }));
    expect(row).toMatchObject({
      kind: 'choice', required: false, options: ['Office', 'Home'], allowMultiple: true,
      maxPicks: null, allowOther: false, shuffle: false,
    });
  });

  test('with fewer it is an open answer, with the open answer\'s defaults', () => {
    expect(pollRow(toRow({ Title: 'Why?' }))).toMatchObject({
      kind: 'text', textLength: 'long', maxLength: 500, placeholder: '', themes: true,
    });
    expect(pollRow(toRow({ Title: 'Why?', options: ['Only one'] })).kind).toBe('text');
  });

  test('a row that names its kind keeps it — even one a poll cannot be', () => {
    const rating = toRow({ kind: 'rating', scale: '1-10' });
    expect(pollRow(rating)).toBe(rating);
    // rejects: quietly turning a ranking copied in from a survey into a choice,
    // so rowProblems can say what is wrong with it instead.
    expect(pollRow(toRow({ kind: 'rank', options: ['a', 'b', 'c'] })).kind).toBe('rank');
  });

  test('editableRows reads a poll set\'s rows through it, and no other type\'s', () => {
    const payload = { questions: [{ id: 'c001#001', Title: 'Where?', options: ['a', 'b'] }] };
    expect(editableRows(payload, 'poll')[0].kind).toBe('choice');
    expect(editableRows(payload, 'call-and-answer')[0].kind).toBe('');
    expect(editableRows(payload)[0].kind).toBe('');
  });
});

describe("rowProblems(row, 'poll') speaks validatePoll's words", () => {
  const poll = (fields) => ({ ...blankRow({ category: 'Work', kind: fields.kind || 'choice' }), title: 'Q', ...fields });
  const problems = (fields) => rowProblems(poll(fields), 'poll');

  test('a well-formed question of each poll kind has none', () => {
    expect(problems({ kind: 'choice', options: ['a', 'b'] })).toEqual([]);
    expect(problems({ kind: 'rating' })).toEqual([]);
    expect(problems({ kind: 'yesno', yesLabel: 'Approve', noLabel: 'Decline' })).toEqual([]);
    expect(problems({ kind: 'text' })).toEqual([]);
  });

  test('a ranking is refused in the importer\'s one sentence', () => {
    expect(problems({ kind: 'rank', options: ['a', 'b', 'c'] })).toEqual(["a poll can't be a rank question"]);
  });

  test('the survey\'s checks apply to each kind', () => {
    expect(problems({ kind: 'choice', options: ['a', '', ''] })).toEqual(['needs at least two options']);
    expect(problems({ kind: 'yesno', followUpWhen: 'no', followUpPrompt: '' })).toEqual(['needs the follow-up question']);
    expect(problems({ kind: 'text', maxLength: 5 })).toEqual(['answer limit must be 20–2000 characters']);
    expect(problems({ kind: 'banana' })).toEqual(["unknown kind 'banana'"]);
  });

  test('a poll keeps its category: a blank one is still a problem, named first', () => {
    expect(rowProblems({ ...poll({ kind: 'rating' }), category: '' }, 'poll')).toEqual(['needs a category']);
  });

  test('a row from before kinds is checked as the kind it reads as', () => {
    expect(rowProblems({ category: 'Work', title: 'Q', options: ['a', 'b'] }, 'poll')).toEqual([]);
    expect(rowProblems({ category: 'Work', title: 'Q' }, 'poll')).toEqual([]);
  });
});

describe("rowsToCsv(rows, 'poll') writes the contract CSV", () => {
  test('the survey\'s columns, each row in its own category, a legacy row as its kind', () => {
    const rows = [
      toRow({ id: 'c001#001', Category: 'Workplace', QuestionNumber: 1, Title: 'Where?', options: ['Office', 'Home'], Tags: ['work'] }),
      toRow({ id: 'c002#001', Category: 'Decisions', QuestionNumber: 1, Title: 'Ship it?', kind: 'yesno', yesLabel: 'True', noLabel: 'False' }),
      { ...blankRow({ category: 'Ideas', kind: 'text' }), title: 'Anything else?' },
    ];
    expect(rowsToCsv(rows, 'poll').split('\n')).toEqual([
      HEADER,
      '"Workplace",1,"Where?","","",""'
        + ',"choice","false","Office|Home","false","","false","false","","","","","","false","","","","","","","false","work"',
      '"Decisions",1,"Ship it?","","",""'
        + ',"yesno","false","","false","","false","false","","","","True","False","false","","","","","","","false",""',
      '"Ideas",1,"Anything else?","","",""'
        + ',"text","false","","false","","false","false","","","","","","false","","","","long","500","","true",""',
      '',
    ]);
  });
});
