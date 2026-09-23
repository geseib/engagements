import {
  ADD_MODES, existingCategories, rowsFromItems, rowsFromCsv, holdToMode, describeAdded, AI_DRAFT_TAG,
} from '../utils/addQuestions';
import { toRow } from '../utils/questionRows';

const current = [
  toRow({ Category: 'History', Title: 'a' }),
  toRow({ Category: 'History', Title: 'b' }),
  toRow({ Category: 'Method', Title: 'c' }),
  { ...toRow({ Category: 'Gone', Title: 'd' }), removed: true },
];
const incoming = rowsFromItems([
  { id: 'QUESTION#c009#001', category: 'history', title: 'one' },
  { category: 'Forensics', title: 'two' },
  { category: '', title: 'three' },
]);

describe('adding questions to an existing set', () => {
  test('the set\'s categories ignore rows removed but not yet saved', () => {
    expect(existingCategories(current)).toEqual(['History', 'Method']);
  });

  test('generated items arrive as NEW rows: no stored key, no number, AI-tagged', () => {
    // rejects: a generator id read as this set's sort key, which would collide.
    expect(incoming[0]).toMatchObject({ origin: 'new', sk: '', questionNumber: null });
    expect(incoming[0].tags).toContain(AI_DRAFT_TAG);
  });

  test('"existing" keeps only the set\'s own categories, re-spelled the set\'s way', () => {
    const { kept, dropped } = holdToMode(incoming, current, ADD_MODES.EXISTING);
    expect(kept.map((r) => [r.title, r.category])).toEqual([['one', 'History']]);
    expect(dropped).toHaveLength(2);
  });

  test('"new" keeps only categories the set does not have — one or the other, never both', () => {
    const { kept, dropped } = holdToMode(incoming, current, ADD_MODES.NEW);
    expect(kept.map((r) => r.category)).toEqual(['Forensics']);
    expect(dropped.map((d) => d.reason)).toEqual(['“History” already exists in this set', 'it has no category']);
  });

  test('the AI path re-files strays across the set\'s categories rather than discarding paid work', () => {
    const { kept, dropped } = holdToMode(incoming, current, ADD_MODES.EXISTING, { spread: true });
    expect(dropped).toHaveLength(0);
    expect(kept.map((r) => r.category)).toEqual(['History', 'History', 'Method']);
  });

  test('new categories stop at the 24 the bitmask can hold', () => {
    const full = Array.from({ length: 23 }, (_, i) => toRow({ Category: `C${i}`, Title: 't' }));
    const two = rowsFromItems([{ category: 'X', title: 'x' }, { category: 'Y', title: 'y' }]);
    const { kept, overCap } = holdToMode(two, full, ADD_MODES.NEW);
    expect(kept.map((r) => r.category)).toEqual(['X']);
    expect(overCap).toBe(1);
  });

  test('a CSV in the template\'s columns becomes rows, whatever the header case', () => {
    const { rows, error } = rowsFromCsv('category,Question#,TITLE,Detail\nForensics,7,"Who, exactly?",Some detail\n,,,\n');
    expect(error).toBe('');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'Forensics', title: 'Who, exactly?', detail: 'Some detail', questionNumber: null });
  });

  test('a CSV with no Title column is refused in words', () => {
    expect(rowsFromCsv('Category,Detail\nA,b\n').error).toMatch(/Category and a Title/);
  });

  test('the status sentence says what was added, what was left out, and that nothing is saved', () => {
    const result = holdToMode(incoming, current, ADD_MODES.NEW);
    expect(describeAdded(result, ADD_MODES.NEW))
      .toBe('1 question added in 1 new category. 2 left out: “History” already exists in this set; it has no category. Nothing is saved until you press Save.');
  });
});

describe('adding questions from a survey CSV (surveys phase 1)', () => {
  // The contract's own header, as download-question-set.js and rowsToCsv write it.
  const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes,Tags';
  const csv = [
    HEADER,
    '"Survey",1,"How useful was it?","Think about next week","","","rating","true","","false","","false","false","1-10","Not useful","Very useful","","","false","","","","","","","false",""',
    '"Survey",2,"Most valuable part?","","","","choice","false","The live demo|The case studies, with their renewal numbers|Q&A","true","2","true","false","","","","","","false","","","","","","","false",""',
    '"Survey",3,"Length right?","","","","yesno","true","","false","","false","false","","","","","","true","no","What would you cut?","","","","","false",""',
    '"Survey",4,"Rank these","","","","rank","false","A|B|C|D","false","","false","false","","","","","","false","","","2","","","","false",""',
    '"Survey",5,"Best part?","","","","text","false","","false","","false","false","","","","","","false","","","","short","280","Say it in a line","true",""',
  ].join('\n') + '\n';

  test('every survey column reaches the row, typed', () => {
    const { rows, error } = rowsFromCsv(csv);
    expect(error).toBe('');
    expect(rows.map((r) => r.kind)).toEqual(['rating', 'choice', 'yesno', 'rank', 'text']);
    expect(rows[0]).toMatchObject({ required: true, scale: '1-10', lowLabel: 'Not useful', highLabel: 'Very useful' });
    expect(rows[1]).toMatchObject({ allowMultiple: true, maxPicks: 2, allowOther: true });
    expect(rows[2]).toMatchObject({ required: true, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut?' });
    expect(rows[3]).toMatchObject({ options: ['A', 'B', 'C', 'D'], rankTop: 2 });
    expect(rows[4]).toMatchObject({ textLength: 'short', maxLength: 280, placeholder: 'Say it in a line', themes: true });
  });

  // rejects: an options cell split on commas as well as pipes. The file's
  // separator is the pipe; a comma is part of an option's words.
  test('an option containing a comma stays one option', () => {
    const { rows } = rowsFromCsv(csv);
    expect(rows[1].options).toEqual(['The live demo', 'The case studies, with their renewal numbers', 'Q&A']);
  });

  // rejects: the Detail_lesson column — the one every download writes for
  // call-and-answer, poll and survey — being dropped on the way in.
  test('the Detail_lesson column is read as the detail', () => {
    expect(rowsFromCsv(csv).rows[0].detail).toBe('Think about next week');
  });
});

describe('Add questions reads a hand-made survey file the way the importer does (review finding)', () => {
  test('yes / 1 read as true, and a capitalised or legacy kind is understood', () => {
    const csv = 'Category,Title,Kind,Required,Options,AllowMultiple\n'
      + '"Survey","Pick","multiple_choice","yes","a|b|c","1"\n'
      + '"Survey","Rate","Rating","Y","",""\n';
    const { rows } = rowsFromCsv(csv);
    expect(rows[0]).toMatchObject({ kind: 'choice', required: true, allowMultiple: true });
    expect(rows[1]).toMatchObject({ kind: 'rating', required: true });
  });
});
