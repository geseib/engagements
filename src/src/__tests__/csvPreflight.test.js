/**
 * WHAT THE IMPORTER WILL DO, DECIDED BEFORE THE ROUND TRIP — utils/csvPreflight.js
 *
 * Every expectation below is checked against the real rule in
 * `lambda-functions/admin/upload-questions.js`, cited inline. These are pure
 * functions; nothing renders and there are no mocks.
 *
 * Each test names the implementation change it rejects. Where the answer would
 * be "nothing", the test is not written.
 */
import { preflight, unterminatedQuoteRow, describePreflight } from '../utils/csvPreflight';

const csv = (...lines) => lines.join('\n');

const GOOD_CALL_AND_ANSWER = csv(
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags',
  'Retro,1,"What broke, and when?","The last incident",Engineering,,"a|b"',
  'Retro,2,What did we learn?,Follow-up,Engineering,,'
);

describe('tier one — the file the server would answer 400 for', () => {
  test('a file with no Title column stops the import and lists what it found', () => {
    // upload-questions.js:343-355 answers 400 when Category or Title is
    // missing. rejects: a preflight that only counts rows — which is all
    // summarizeCsv() does, and is why the upload form learned about this
    // failure from a red banner after the write.
    const report = preflight(
      csv('Category,Question#,Prompt,Detail_lesson', 'Onboarding,1,Which step lost the most people?,x'),
      'call-and-answer'
    );
    expect(report.ok).toBe(false);
    expect(report.blocking.map((b) => b.code)).toContain('missing-columns');
    expect(report.blocking[0].title).toMatch(/no Title column/i);
    expect(report.blocking[0].detail).toMatch(/Prompt/);
  });

  test('a header called Prompt does NOT satisfy Title', () => {
    // The importer's fallback is `includes('title')` (upload-questions.js:309),
    // so "Prompt" matches neither the exact name nor the fallback. rejects: a
    // helpful preflight that guesses the mapping the server will not make, and
    // so reports green on a file that 400s.
    const report = preflight(csv('Category,Prompt', 'Retro,Something'), 'call-and-answer');
    expect(report.ok).toBe(false);
  });

  test('a header merely containing "title" does satisfy it, because the importer says so', () => {
    // The other half of the same rule, asserted so the check cannot drift into
    // an exact-match-only version that blocks files the server accepts.
    const report = preflight(csv('Category,Question Title', 'Retro,Something'), 'call-and-answer');
    expect(report.blocking).toEqual([]);
    expect(report.importedCount).toBe(1);
  });

  test('selecting Survey stops the import before anything is read', () => {
    // upload-questions.js:150-161 rejects survey outright, and the gate is
    // three-way. rejects: the shipped behaviour — the type was offered, the
    // Upload button enabled, and the problem admitted only in a sentence beside
    // the file picker. This is the "label it, not hide it" half of
    // OPEN-QUESTIONS #3: Survey stays selectable and says what it costs.
    const report = preflight(GOOD_CALL_AND_ANSWER, 'survey');
    expect(report.ok).toBe(false);
    expect(report.blocking.map((b) => b.code)).toContain('survey-unsupported');
  });

  test('JSON content is blocked whatever type is selected', () => {
    // The same gate fires on a leading [ or { even for a .csv name and a
    // call-and-answer type. rejects: gating only on the selected type.
    const report = preflight('[{"title":"x"}]', 'call-and-answer');
    expect(report.blocking.map((b) => b.code)).toContain('json-content');
  });

  test('a header row with no questions is named as that, not as an empty file', () => {
    const report = preflight('Category,Title', 'call-and-answer');
    expect(report.blocking.map((b) => b.code)).toEqual(['header-only']);
  });

  test('a file whose every row would be skipped is blocked, not reported as a 0-question success', () => {
    // `questions.length === 0` is a 400 (upload-questions.js:474-480). rejects:
    // a preflight that lists three skipped rows and leaves the Upload button
    // live, which sends a file that cannot produce a set.
    const report = preflight(
      csv('Category,Title', ',No category here', ',Nor here'),
      'call-and-answer'
    );
    expect(report.ok).toBe(false);
    expect(report.blocking.map((b) => b.code)).toContain('no-usable-rows');
    expect(report.skipped).toHaveLength(2);
  });
});

describe('tier two — rows that vanish inside a successful import', () => {
  test('a row missing Category is reported with the importer’s own row number', () => {
    // upload-questions.js:458-464 pushes { row: i + 1 }, counting from the
    // header, so the first DATA row is row 2. rejects: an off-by-one that makes
    // every reported row number useless for finding the line in a spreadsheet.
    const report = preflight(
      csv('Category,Title', 'Retro,Fine', ',Missing its category'),
      'call-and-answer'
    );
    expect(report.skipped).toEqual([
      expect.objectContaining({ row: 3, problem: 'Missing Category', result: 'Row skipped' }),
    ]);
    expect(report.importedCount).toBe(1);
  });

  test('a one-field row is "too few columns", the branch that fires first', () => {
    // `values.length < 2` is checked BEFORE Title/Category
    // (upload-questions.js:372-375), so a single-cell row reports that reason
    // and not "missing Category + Title". rejects: reordering the two checks,
    // which would give the operator a reason the server does not use.
    const report = preflight(csv('Category,Title', 'Retro,Fine', 'Engagement'), 'call-and-answer');
    expect(report.skipped[0]).toMatchObject({ row: 3, problem: 'Only one field' });
  });

  test('a quoted comma is one field, not two', () => {
    // parseCsv is quote-aware; `lines[0].split(',')` was not. rejects: a return
    // to the hand-rolled split, which counts this file as three columns and
    // reads the Title column out of the middle of a sentence.
    const report = preflight(
      csv('Category,Title,Detail_lesson', 'Retro,"What broke, and when?",Context'),
      'call-and-answer'
    );
    expect(report.headers).toEqual(['Category', 'Title', 'Detail_lesson']);
    expect(report.importedCount).toBe(1);
    expect(report.skipped).toEqual([]);
  });

  test('an unterminated quote is reported at the row it opens on', () => {
    // rejects: silence. parseCsv closes the field at end-of-input, so this file
    // parses "successfully" and every row below the stray quote disappears.
    const text = csv(
      'Category,Title',
      'Retro,Fine',
      'Retro,"Team health',
      'Retro,Never seen',
      'Retro,Nor this'
    );
    expect(unterminatedQuoteRow(text)).toBe(3);
    const report = preflight(text, 'call-and-answer');
    expect(report.skipped[0]).toMatchObject({ row: 3, problem: 'Unbalanced quote' });
    expect(report.skipped[0].result).toMatch(/rest of the file/i);
  });

  test('a well-formed file with escaped quotes and an embedded newline is not flagged', () => {
    // rejects: any cheaper malformed-check — a `""` test, an odd-count of `"`,
    // or "a field containing a newline is broken". All three would condemn the
    // 80s trivia set, whose answer details carry both.
    expect(
      unterminatedQuoteRow('Category,Title\nRetro,"THE ""RIGHT"" CALL"\nRetro,"two\nlines"')
    ).toBeNull();
  });

  test('the reported row is the PARSED row, not the physical line', () => {
    // A quoted field can contain newlines, so the two diverge — and the number
    // has to be the one `upload-questions.js` would print, which counts parsed
    // rows. rejects: incrementing the counter on every \n, which reports row 4
    // for a file whose third row is the broken one.
    const text = 'Category,Title\nRetro,"multi\nline ""q"" here"\nRetro,"open';
    expect(unterminatedQuoteRow(text)).toBe(3);
  });

  test('the skipped table is in file order and counts DISTINCT rows', () => {
    // A row can be two problems at once — an unterminated quote AND a missing
    // Title are both true of the same line — and the unbalanced-quote entry is
    // found before the row walk. rejects: counting ENTRIES, which printed
    // "5 of 4 data rows" on the fixture below, and rejects leaving the quote
    // entry above row 2 in a table sorted by nothing.
    const report = preflight(
      csv('Category,Title', ',Missing category', 'Retro,Fine', ',"open'),
      'call-and-answer'
    );
    expect(report.skipped.map((r) => r.row)).toEqual([2, 4, 4]);
    expect(report.skippedRowCount).toBe(2);
    expect(report.skippedRowCount).toBeLessThanOrEqual(report.dataRowCount);
  });
});

describe('tier three — every row imports and something inside it is lost', () => {
  test('a poll file with Option1..Option5 is named as the defect it is', () => {
    // upload-questions.js:301-304 reads ONE pipe-separated `Options` column,
    // matched exactly, with no numbered fallback (getColumnIndex at :262). Every
    // poll set built this way imported with zero options. rejects: a preflight
    // that reports this file clean because all its rows parse.
    const report = preflight(
      csv(
        'Category,Title,Option1,Option2,Option3',
        'Onboarding,How often?,Daily,Weekly,Monthly',
        'Onboarding,How long?,A day,A week,A month'
      ),
      'poll'
    );
    expect(report.blocking).toEqual([]);
    expect(report.gaps.map((g) => g.code)).toContain('poll-options-shape');
    expect(report.gaps[0].detail).toMatch(/all 2 poll questions would import with no options/i);
  });

  test('the same file under a call-and-answer type raises nothing, because nothing is lost', () => {
    // The importer only reads Options for polls. rejects: a gap check that
    // fires on column names rather than on what this import will actually do.
    const report = preflight(
      csv('Category,Title,Option1,Option2', 'Retro,How often?,Daily,Weekly'),
      'call-and-answer'
    );
    expect(report.gaps).toEqual([]);
  });

  test('a poll file with a real Options column is clean', () => {
    const report = preflight(
      csv('Category,Title,Options', 'Onboarding,How often?,Daily|Weekly|Monthly'),
      'poll'
    );
    expect(report.gaps).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('bare image filenames are counted, and absolute URLs are not', () => {
    // toMediaKey (upload-questions.js:66-77) re-keys a bare filename to
    // sets/<setId>/<name> and leaves an http(s) URL or a /-rooted path alone.
    // rejects: warning about every Image value, which would make the warning
    // worthless on the art sets that are the reason the column exists.
    const report = preflight(
      csv(
        'Category,Title,Image',
        'Art,A glance,over-the-shoulder.jpg',
        'Art,A sky,https://example.test/sky.jpg',
        'Art,A park,/assets/art/park.jpg'
      ),
      'call-and-answer'
    );
    const gap = report.gaps.find((g) => g.code === 'image-keys');
    expect(gap.title).toMatch(/^1 Image value /);
    expect(gap.detail).toMatch(/over-the-shoulder\.jpg/);
  });

  test('a trivia CorrectAnswer that names no option column is counted', () => {
    // The importer stores CorrectAnswer as written (upload-questions.js:662),
    // and the format is OptionA..OptionF. rejects: accepting the answer TEXT,
    // which imports, plays, and scores nobody.
    const report = preflight(
      csv(
        'Category,Title,OptionA,OptionB,CorrectAnswer',
        'Tech,Which port?,80,443,OptionB',
        'Tech,Which year?,1991,1993,1991',
        'Tech,Which one?,Yes,No,'
      ),
      'trivia'
    );
    const gap = report.gaps.find((g) => g.code === 'trivia-correct-answer');
    expect(gap.title).toMatch(/^2 trivia questions /);
  });
});

describe('what the form pre-fills, from the quote-aware parse', () => {
  test('the description comes from School when there is one', () => {
    const report = preflight(
      csv('Category,Title,School', 'Retro,Fine,Nakamura Integration'),
      'call-and-answer',
      { fileName: 'retro.csv' }
    );
    expect(report.suggestedDescription).toBe('Questions from Nakamura Integration');
  });

  test('the first data row is the first row that would IMPORT, not the first row in the file', () => {
    // rejects: reading row 2 blindly, which is what the old code did — a file
    // whose first row is skipped filled the description from a row the set will
    // not contain.
    const report = preflight(
      csv('Category,Title,School', ',Skipped,Ghost School', 'Retro,Fine,Real School'),
      'call-and-answer'
    );
    expect(report.suggestedDescription).toBe('Questions from Real School');
  });

  test('a per-question CustomInstruction is picked up through the loose header match', () => {
    // upload-questions.js:315 falls back to any header containing "instruction".
    const report = preflight(
      csv('Category,Title,Custom Instruction', 'Retro,Fine,Answer in one sentence'),
      'call-and-answer'
    );
    expect(report.suggestedCustomInstruction).toBe('Answer in one sentence');
  });
});

describe('the one-line summary', () => {
  test('it states rows, what would import, and categories', () => {
    const report = preflight(GOOD_CALL_AND_ANSWER, 'call-and-answer');
    expect(describePreflight(report)).toBe('2 rows · 2 would import · 1 category');
  });
});
