/**
 * WHAT THIS FILE WILL DO TO YOUR CSV, BEFORE IT IS SENT.
 *
 * Grounded in docs/design/admin-redesign/06-csv-errors.html and RATIONALE.md §9
 * ("CSV validation happens before the round trip"). Wave D part two, Q5.
 *
 * WHAT IT REPLACES. `AdminPage.handleFileSelect` read the file, then did
 *
 *     const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
 *
 * — a naive split that mis-parses any quoted comma, which is most real files —
 * and used the result only to auto-fill the description box. Everything else was
 * discovered by the server, after the write: `upload-questions.js` returns
 * `skippedRowCount` and the first fifty `skippedRows` with reasons, and the only
 * place that has ever surfaced is one clause appended to a SUCCESS message.
 *
 * Nothing here is a new endpoint or a new rule. Every verdict below is
 * `parseCsv()` — the same quote-aware reader the replace preview already uses —
 * plus the importer's own published behaviour, cited line by line against
 * `lambda-functions/admin/upload-questions.js`.
 *
 * THREE TIERS, AND THEY ARE NOT THE SAME KIND OF THING:
 *
 *   1. `blocking` — the server answers 400 and writes nothing.
 *   2. `skipped`  — the import succeeds and quietly contains fewer questions
 *                   than the file has rows.
 *   3. `gaps`     — every row imports and something inside it is lost. This is
 *                   the tier that has cost the most: an AI-generated poll set
 *                   imports "successfully" with zero options on every question.
 *
 * NOT HERE, DELIBERATELY: the auto-fix actions mockup 06 draws ("Treat `Prompt`
 * as Title", "Merge into `Options`"). Those rewrite the operator's file in the
 * browser before sending it, which is a feature of its own — the plan's Part 5
 * names it. This module reports; it never repairs.
 */

import { parseCsv } from './questionSetEditing';
import { normalizeGameType } from '../config/gameTypes';

/* ---------------------------------------------------------------- columns -- */

/** `getColumnIndex` at upload-questions.js:262 — exact, case-insensitive. */
const exact = (headers, name) =>
  headers.findIndex((h) => h.toLowerCase() === String(name).toLowerCase());

/** The loose second pass at upload-questions.js:307-336, per column. */
function resolveColumns(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  const loose = (test) => lower.findIndex(test);

  let category = exact(headers, 'Category');
  if (category === -1) category = loose((h) => h.includes('category'));

  let title = exact(headers, 'Title');
  if (title === -1) title = loose((h) => h.includes('title') && !h.includes('#'));

  let image = exact(headers, 'Image');
  if (image === -1) {
    image = loose((h) => h.includes('image') || h.includes('artwork') || h.includes('picture'));
  }

  let school = exact(headers, 'School');
  if (school === -1) school = loose((h) => h.includes('school'));

  let customInstruction = exact(headers, 'CustomInstruction');
  if (customInstruction === -1) customInstruction = loose((h) => h.includes('instruction'));

  return {
    category,
    title,
    image,
    school,
    customInstruction,
    // Engagement-type columns are matched EXACTLY and have no fallback
    // (upload-questions.js:290-304). That absence is the whole of gap G3.
    options: exact(headers, 'Options'),
    allowMultiple: exact(headers, 'AllowMultiple'),
    correctAnswer: exact(headers, 'CorrectAnswer'),
    difficulty: exact(headers, 'Difficulty'),
    optionLetters: ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => exact(headers, `Option${l}`)),
    optionNumbers: [1, 2, 3, 4, 5].map((n) => exact(headers, `Option${n}`)),
  };
}

/* ----------------------------------------------------------------- quotes -- */

/**
 * The parsed-row number where an unterminated quote opens, or null.
 *
 * `parseCsv` cannot report this — it closes the field at end-of-input, which is
 * the right thing for a reader and useless for a report. The consequence is
 * worth stating precisely, because it is NOT "this row is skipped": everything
 * after the stray quote is swallowed into one field of that row, so every row
 * below it disappears from the import entirely. Mockup 06 labels row 23
 * "Row skipped — malformed"; the truth is worse and the copy says so.
 *
 * Row numbers are the importer's: it loops from index 1 and reports `i + 1`, so
 * the first data row is row 2.
 */
export function unterminatedQuoteRow(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  let inQuotes = false;
  let row = 1;
  let openedAt = 0;

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
    } else if (char === '"') {
      inQuotes = true;
      openedAt = row;
    } else if (char === '\n') {
      row += 1;
    }
  }
  return inQuotes ? openedAt : null;
}

/* -------------------------------------------------------------- the check -- */

const cell = (row, index) => (index >= 0 ? String(row[index] ?? '').trim() : '');
const isBlankRow = (row) => row.every((f) => String(f).trim() === '');
const excerpt = (row, max = 60) => {
  const joined = row.map((f) => String(f).trim()).join(',');
  return joined.length <= max ? joined : `${joined.slice(0, max - 1)}…`;
};

const EMPTY = {
  ok: false,
  headers: [],
  dataRowCount: 0,
  skippedRowCount: 0,
  importedCount: 0,
  categories: [],
  blocking: [],
  skipped: [],
  gaps: [],
  suggestedDescription: '',
  suggestedCustomInstruction: '',
};

/**
 * Everything the console can know about a file without sending it.
 *
 * @param {string} text        the file, as read by FileReader
 * @param {string} engagementType  the type the operator has selected
 * @param {object} [meta]      { fileName } — only used for the description hint
 */
export function preflight(text, engagementType, meta = {}) {
  const type = normalizeGameType(engagementType);
  const fileName = meta.fileName || '';
  const source = String(text ?? '');
  const blocking = [];
  const skipped = [];
  const gaps = [];

  /*
    THE SURVEY GATE IS A THREE-WAY OR (upload-questions.js:150-161): the selected
    type, a .json filename, OR content that merely starts with [ or {. All three
    answer 400. The console has been offering Survey in two selects, enabling the
    Upload button, and admitting the problem only in a sentence beside the file
    picker — see OPEN-QUESTIONS #3, decided as "label it".
  */
  if (engagementType === 'survey') {
    blocking.push({
      code: 'survey-unsupported',
      title: 'Survey sets cannot be imported.',
      detail:
        'The importer rejects every survey upload, and no game session plays a survey. '
        + 'Nothing would be created. Pick another engagement type, or use the survey '
        + 'builder to export JSON for use elsewhere.',
    });
  } else if (/^\s*[[{]/.test(source) || /\.json$/i.test(fileName)) {
    blocking.push({
      code: 'json-content',
      title: 'This looks like JSON, not CSV.',
      detail:
        'The importer refuses any file whose name ends in .json or whose content starts '
        + 'with [ or {, whatever engagement type is selected.',
    });
  }

  if (!source.trim()) {
    return {
      ...EMPTY,
      blocking: [
        ...blocking,
        { code: 'empty-file', title: 'That file is empty.', detail: 'There is nothing to read.' },
      ],
    };
  }

  const rows = parseCsv(source);
  const headers = (rows[0] || []).map((h) => h.trim());
  const body = rows.slice(1).filter((r) => !isBlankRow(r));

  if (!body.length) {
    return {
      ...EMPTY,
      headers,
      blocking: [
        ...blocking,
        {
          code: 'header-only',
          title: 'That file has a header row and no questions.',
          detail: 'The importer answers "No valid questions found in CSV".',
        },
      ],
    };
  }

  const col = resolveColumns(headers);

  /*
    THE ONE 400 THAT NAMES ITSELF (upload-questions.js:343-355). Category and
    Title are both required, and both get a loose fallback first — which is why
    a header called "Prompt" does NOT satisfy Title: the fallback matches any
    header CONTAINING "title", and "Prompt" contains neither.
  */
  const missing = [];
  if (col.title === -1) missing.push('Title');
  if (col.category === -1) missing.push('Category');
  if (missing.length) {
    blocking.push({
      code: 'missing-columns',
      title: `There is no ${missing.join(' column and no ')} column.`,
      detail:
        'A question needs a Title and a Category; everything else is optional. The importer '
        + 'matches the name exactly, then falls back to any header containing "title" or '
        + `"category". Headers found: ${headers.join(', ') || '(none)'}.`,
    });
  }

  const unterminated = unterminatedQuoteRow(source);
  if (unterminated !== null) {
    skipped.push({
      row: unterminated,
      problem: 'Unbalanced quote',
      excerpt: excerpt(body[Math.max(0, unterminated - 2)] || []),
      result: 'this row swallows the rest of the file',
    });
  }

  /* ------------------------------------------------------ row by row, as the
     importer walks them: `values.length < 2` first, then Title + Category. */

  const categories = [];
  let importedCount = 0;
  const bareImages = [];
  let triviaWithoutAnswer = 0;
  let firstImported = null;

  body.forEach((row, index) => {
    const reportedRow = index + 2; // it loops from 1 and reports i + 1
    if (row.length < 2) {
      skipped.push({
        row: reportedRow,
        problem: 'Only one field',
        excerpt: excerpt(row),
        result: 'Row skipped — too few columns',
      });
      return;
    }

    const category = cell(row, col.category);
    const title = cell(row, col.title);
    if (!title || !category) {
      const absent = [!category && 'Category', !title && 'Title'].filter(Boolean).join(' + ');
      skipped.push({
        row: reportedRow,
        problem: `Missing ${absent}`,
        excerpt: excerpt(row),
        result: 'Row skipped',
      });
      return;
    }

    importedCount += 1;
    if (!firstImported) firstImported = row;
    if (!categories.includes(category)) categories.push(category);

    const image = cell(row, col.image);
    if (image && !/^https?:\/\//i.test(image) && !image.startsWith('/')) {
      bareImages.push(image.split('/').pop());
    }

    if (type === 'trivia') {
      const answer = cell(row, col.correctAnswer);
      if (!answer || !/^option[a-f]$/i.test(answer)) triviaWithoutAnswer += 1;
    }
  });

  if (!importedCount && !blocking.some((b) => b.code === 'missing-columns')) {
    blocking.push({
      code: 'no-usable-rows',
      title: 'Every row would be skipped.',
      detail:
        'The importer answers "No valid questions found in CSV" and writes nothing. '
        + 'The rows below say why.',
    });
  }

  /* ------------------------------------------------------------- tier three */

  if (type === 'poll' && importedCount) {
    const numbered = col.optionNumbers.filter((i) => i >= 0).length;
    if (col.options === -1) {
      gaps.push({
        code: 'poll-options-shape',
        title: 'Poll options are in the wrong shape.',
        detail: numbered
          ? `This file has Option1…Option${numbered} columns. The importer reads a single `
            + 'Options column with values separated by |, and ignores the numbered ones. '
            + `All ${importedCount} poll questions would import with no options at all.`
          : 'There is no Options column. The importer reads a single Options column with '
            + `values separated by |, so all ${importedCount} poll questions would import `
            + 'with nothing to vote on.',
      });
    }
  }

  if (bareImages.length) {
    const shown = bareImages.slice(0, 3).join(', ');
    gaps.push({
      code: 'image-keys',
      title: `${bareImages.length} Image value${bareImages.length === 1 ? '' : 's'} `
        + 'point at files that are not there yet.',
      detail:
        'A bare filename becomes the set-scoped key sets/<setId>/<filename>. The import '
        + 'succeeds either way; the picture is missing until the file is uploaded on the '
        + `set's Media tab. ${shown}${bareImages.length > 3 ? ', …' : ''}`,
    });
  }

  if (triviaWithoutAnswer) {
    gaps.push({
      code: 'trivia-correct-answer',
      title: `${triviaWithoutAnswer} trivia question${triviaWithoutAnswer === 1 ? '' : 's'} `
        + 'would import with no correct answer.',
      detail:
        'CorrectAnswer has to name a column — OptionA through OptionF. Anything else, '
        + 'including the answer text itself, is stored as written and scores nobody.',
    });
  }

  /* ---------------------------------------------- what the form can pre-fill */

  const school = cell(firstImported || [], col.school);
  const firstCategory = cell(firstImported || [], col.category);
  const suggestedDescription = school
    ? `Questions from ${school}`
    : firstCategory
      ? `${firstCategory} questions and more`
      : fileName
        ? `Imported from ${fileName}`
        : '';

  /*
    IN FILE ORDER. The unbalanced-quote entry is discovered before the row walk
    and would otherwise sit above row 2 in the table. A row can legitimately
    appear twice — an unterminated quote AND a missing Title are both true of
    the same line — so this sorts rather than deduplicates, and the count in the
    report header is of DISTINCT rows, never of entries.
  */
  skipped.sort((a, b) => a.row - b.row);

  return {
    ok: blocking.length === 0,
    headers,
    dataRowCount: body.length,
    skippedRowCount: new Set(skipped.map((row) => row.row)).size,
    importedCount,
    categories,
    blocking,
    skipped,
    gaps,
    suggestedDescription,
    suggestedCustomInstruction: cell(firstImported || [], col.customInstruction),
  };
}

/** One line for the header of the report: what this file is, before any verdict. */
export function describePreflight(report) {
  if (!report) return '';
  const rows = `${report.dataRowCount} row${report.dataRowCount === 1 ? '' : 's'}`;
  const cats = report.categories.length;
  return `${rows} · ${report.importedCount} would import · ${cats} categor${cats === 1 ? 'y' : 'ies'}`;
}

export default preflight;
