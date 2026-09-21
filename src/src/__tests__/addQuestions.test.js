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
