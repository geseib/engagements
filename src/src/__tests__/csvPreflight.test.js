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

  test('JSON content is blocked for every type but survey', () => {
    // The same gate fires on a leading [ or { even for a .csv name and a
    // call-and-answer type. rejects: gating only on the selected type — and,
    // since surveys phase 1, rejects opening the JSON door any wider than the
    // one type whose builder used to export it (upload-questions.js converts
    // survey JSON and still refuses it for everything else).
    const report = preflight('[{"title":"x"}]', 'call-and-answer');
    expect(report.blocking.map((b) => b.code)).toContain('json-content');
    const trivia = preflight('{"questions":[]}', 'trivia', { fileName: 'quiz.json' });
    expect(trivia.blocking.map((b) => b.code)).toContain('json-content');
    expect(trivia.blocking[0].detail).toMatch(/only a survey/i);
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

/**
 * SURVEYS CAN BE IMPORTED NOW (surveys phases 0+1, C2).
 *
 * The survey-unsupported block is gone: upload-questions.js reads a survey CSV
 * with a Kind column (Track A, A2) and converts the survey JSON the old
 * builder exported. What the importer would SKIP is reported here in the
 * contract's own words — docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md,
 * "THE CONTRACT", Validation — so the preflight table and the importer's
 * skippedRows say the same thing about the same row.
 */
const SURVEY_HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Kind,Required,'
  + 'Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,YesLabel,NoLabel,'
  + 'Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes,Tags';
const SURVEY_COLUMNS = SURVEY_HEADER.split(',');
/** One survey row, every cell quoted as the contract writes them. */
const surveyRow = (fields) => SURVEY_COLUMNS
  .map((column) => `"${String(fields[column] ?? '').replace(/"/g, '""')}"`)
  .join(',');
const surveyCsv = (...rows) => [SURVEY_HEADER, ...rows.map(surveyRow)].join('\n');

const EVERY_KIND = [
  { Category: 'Survey', Title: 'How useful was it?', Kind: 'rating', Scale: '1-5', LowLabel: 'Not useful', HighLabel: 'Very useful' },
  { Category: 'Survey', Title: 'Which part?', Kind: 'choice', Options: 'Demo|Stories|Roadmap', AllowMultiple: 'true', MaxPicks: '2' },
  { Category: 'Survey', Title: 'Was the length right?', Kind: 'yesno', Unsure: 'true', FollowUpWhen: 'no', FollowUpPrompt: 'What would you cut?' },
  { Category: 'Survey', Title: 'Rank the topics', Kind: 'rank', Options: 'A|B|C|D|E', RankTop: '3' },
  { Category: 'Survey', Title: 'What was best?', Kind: 'text', TextLength: 'long', MaxLength: '500' },
];

describe('surveys — a file with a Kind column', () => {
  test('one row of every kind preflights clean', () => {
    // rejects: the old survey-unsupported block, and any rule stricter than
    // the contract's.
    const report = preflight(surveyCsv(...EVERY_KIND), 'survey');
    expect(report.blocking).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.gaps).toEqual([]);
    expect(report.importedCount).toBe(5);
    expect(report.categories).toEqual(['Survey']);
  });

  test('no Kind column stops the import and says what a survey row needs', () => {
    // Every row would be skipped as "needs a kind" and the importer would
    // answer "No valid questions". rejects: reporting that as five skipped
    // rows instead of the one missing column it is.
    const report = preflight(csv('Category,Title', 'Survey,How was it?'), 'survey');
    expect(report.ok).toBe(false);
    expect(report.blocking.map((b) => b.code)).toContain('survey-no-kind');
    expect(report.blocking.find((b) => b.code === 'survey-no-kind').title).toMatch(/no Kind column/i);
  });

  test.each([
    ['no kind', { Kind: '' }, 'needs a kind'],
    ['an unknown kind', { Kind: 'slider' }, "unknown kind 'slider'"],
    ['a choice with one option', { Kind: 'choice', Options: 'Only' }, 'needs at least two options'],
    ['a choice with nine options', { Kind: 'choice', Options: 'a|b|c|d|e|f|g|h|i' }, 'has more than eight options'],
    ['more picks than options', { Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true', MaxPicks: '5' }, "can't allow 5 picks from 3 options"],
    ['one pick of several', { Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true', MaxPicks: '1' }, "can't allow 1 picks from 3 options"],
    ['a ranking of two', { Kind: 'rank', Options: 'a|b' }, 'needs at least three items'],
    ['a ranking of eight', { Kind: 'rank', Options: 'a|b|c|d|e|f|g|h' }, 'has more than seven items'],
    ['ranking the top of all', { Kind: 'rank', Options: 'a|b|c', RankTop: '3' }, "can't rank the top 3 of 3"],
    ['an unknown scale', { Kind: 'rating', Scale: '1-7' }, "unknown scale '1-7'"],
    ['an unknown follow-up', { Kind: 'yesno', FollowUpWhen: 'maybe' }, "unknown follow-up 'maybe'"],
    ['a follow-up with no question', { Kind: 'yesno', FollowUpWhen: 'no', FollowUpPrompt: '' }, 'needs the follow-up question'],
    ['an unknown length', { Kind: 'text', TextLength: 'medium' }, "unknown length 'medium'"],
    ['an answer limit past 2000', { Kind: 'text', MaxLength: '5000' }, 'answer limit must be 20–2000 characters'],
    ['an answer limit under 20', { Kind: 'text', MaxLength: '10' }, 'answer limit must be 20–2000 characters'],
  ])('%s is skipped, in the importer’s words', (_label, fields, reason) => {
    // rejects: preflight wording that differs from the contract's — the
    // operator would read one reason here and another in the import report.
    const report = preflight(surveyCsv(EVERY_KIND[0], { Category: 'Survey', Title: 'The bad one', ...fields }), 'survey');
    expect(report.skipped).toEqual([
      expect.objectContaining({ row: 3, problem: reason, result: 'Row skipped' }),
    ]);
    expect(report.importedCount).toBe(1);
  });

  test('two problems on one row are both named, joined as the importer joins them', () => {
    const report = preflight(surveyCsv({ Category: 'Survey', Title: 'Too many', Kind: 'rank', Options: 'a|b|c|d|e|f|g|h', RankTop: '9' }, EVERY_KIND[4]), 'survey');
    expect(report.skipped[0].problem).toBe("has more than seven items; can't rank the top 9 of 8");
  });

  test('a picks limit only counts when several may be picked', () => {
    // MaxPicks is a field of "pick several" alone; with one pick it is not
    // stored, so it cannot be a reason to skip the row.
    const report = preflight(surveyCsv({ Category: 'Survey', Title: 'One pick', Kind: 'choice', Options: 'a|b', AllowMultiple: 'false', MaxPicks: '7' }), 'survey');
    expect(report.skipped).toEqual([]);
  });

  test('the old spellings the builder exported are read, as the importer reads them', () => {
    const report = preflight(surveyCsv(
      { Category: 'Survey', Title: 'A', Kind: 'multiple_choice', Options: 'x|y' },
      { Category: 'Survey', Title: 'B', Kind: 'text_entry' },
      { Category: 'Survey', Title: 'C', Kind: 'yes_no' },
      { Category: 'Survey', Title: 'D', Kind: 'ranking', Options: 'x|y|z' },
      { Category: 'Survey', Title: 'E', Kind: 'nps', Scale: 'whatever — nps is 0-10' },
      { Category: 'Survey', Title: 'F', Kind: 'Rating' },
    ), 'survey');
    expect(report.skipped).toEqual([]);
    expect(report.importedCount).toBe(6);
  });

  test('a survey row with no Category still imports, filed under Survey', () => {
    // The importer fills Survey in (A2): surveys expose no categories. rejects:
    // reporting "Missing Category" for a row that will import.
    const report = preflight(surveyCsv({ ...EVERY_KIND[0], Category: '' }), 'survey');
    expect(report.skipped).toEqual([]);
    expect(report.importedCount).toBe(1);
    expect(report.categories).toEqual(['Survey']);
  });

  test('a row with no Title is still skipped, as every type’s is', () => {
    const report = preflight(surveyCsv(EVERY_KIND[0], { ...EVERY_KIND[1], Title: '' }), 'survey');
    expect(report.skipped).toEqual([expect.objectContaining({ row: 3, problem: 'Missing Title' })]);
  });

  test('a file whose every row would be skipped is blocked', () => {
    const report = preflight(surveyCsv({ Category: 'Survey', Title: 'x', Kind: 'slider' }), 'survey');
    expect(report.ok).toBe(false);
    expect(report.blocking.map((b) => b.code)).toContain('no-usable-rows');
  });

  test('the survey-unsupported block is gone', () => {
    const report = preflight(surveyCsv(...EVERY_KIND), 'survey');
    expect(report.blocking.map((b) => b.code)).not.toContain('survey-unsupported');
    expect(report.ok).toBe(true);
  });
});

describe('surveys — the JSON the old builder exported', () => {
  const EXPORT = JSON.stringify({
    title: 'Q3 feedback',
    questions: [
      { question: 'How useful?', type: 'rating', scale: { type: '1-10' } },
      { question: 'Anything else?', type: 'text_entry', textType: 'email' },
    ],
  });

  test('is accepted for a survey, and counted', () => {
    // rejects: the json-content block for survey. upload-questions.js converts
    // this shape (legacySurveyJsonToCsv) before it reads a single row.
    const report = preflight(EXPORT, 'survey', { fileName: 'survey-Q3.json' });
    expect(report.blocking).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.dataRowCount).toBe(2);
    expect(report.importedCount).toBe(2);
    expect(describePreflight(report)).toBe('2 rows · 2 would import · 1 category');
  });

  test('a file that is not JSON at all says so', () => {
    const report = preflight('{"title": "cut off', 'survey', { fileName: 'survey.json' });
    expect(report.ok).toBe(false);
    expect(report.blocking.map((b) => b.code)).toEqual(['survey-json-unreadable']);
  });

  test('JSON with no questions in it has nothing to import', () => {
    const report = preflight('{"title":"Empty","questions":[]}', 'survey', { fileName: 'empty.json' });
    expect(report.ok).toBe(false);
    expect(report.blocking.map((b) => b.code)).toEqual(['survey-json-empty']);
  });
});

describe('survey preflight agrees with the importer (integration of surveys phase 1)', () => {
  // The importer (upload-questions.js via shared/survey-kinds.js) files a
  // survey row with no Category under "Survey", so a survey file needs no
  // Category column at all — the preflight must not block what imports.
  test('a survey file with no Category column is not blocked', () => {
    const csv = 'Title,Kind,Options\n"Best part?","text",""\n';
    const report = preflight(csv, 'survey');
    expect(report.blocking).toEqual([]);
    expect(report.importedCount).toBe(1);
  });

  test('a trivia file with no Category column is still blocked', () => {
    const report = preflight('Title,OptionA\n"Q","a"\n', 'trivia');
    expect(report.blocking.map((b) => b.code)).toContain('missing-columns');
  });

  // The importer reads true/yes/y/1 as true; with "yes" it validates MaxPicks,
  // so the preflight must too — or it passes a row the importer will skip.
  test('AllowMultiple "yes" still has its MaxPicks checked', () => {
    const csv = 'Category,Title,Kind,Options,AllowMultiple,MaxPicks\n"Survey","Q","choice","a|b|c","yes","9"\n';
    const report = preflight(csv, 'survey');
    expect(report.skipped.map((s) => s.problem).join(' ')).toMatch(/can't allow 9 picks from 3 options/);
  });
});

describe('survey scale spellings the importer accepts (review finding)', () => {
  // The importer's foldScale reads "1–5" (the en dash the product prints) and
  // "1 - 5"; a preflight that only lower-cases warned about rows that import.
  test.each(['1–5', '1 - 5', '0–10', 'Stars'])('scale %s is not flagged', (scale) => {
    const csv = `Category,Title,Kind,Scale\n"Survey","Q","rating","${scale}"\n`;
    expect(preflight(csv, 'survey').skipped).toEqual([]);
  });
});
