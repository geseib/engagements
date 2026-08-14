/**
 * The ONE place a Lambda turns values into CSV text.
 *
 * DUPLICATED ON PURPOSE, and the duplication is named. `src/src/utils/csv.js`
 * is the byte-equivalent ESM original; Lambda bundles are per-directory and
 * cannot import the frontend's ESM module — the same rule
 * `shared/round-kinds.js:63-67` states for the round-kind data and
 * `shared/set-version.js:31-37` states for the version helpers.
 *
 * WHY THE DOUBLING MATTERS. A value containing a double quote interpolated as
 * `"${value}"` is not an error, it is silent corruption: a title like
 *   THE "RIGHT" CALL
 * becomes `"THE "RIGHT" CALL"`, which upload-questions.js's parseCSV reads as
 * three fields, shifting every column after it by two. Commas and newlines
 * inside a quoted cell are already safe (that parser tracks quote state), so
 * the quote is the whole bug — and it is escaped by DOUBLING it, `""`, which is
 * exactly what parseCSV un-doubles on the way back in.
 *
 * Do not "simplify" the doubling. It is the wire format.
 */

const { normalizeTags } = require('./tags');

/** One value → a fully quoted, escaped CSV cell. `null`/`undefined` → `""`. */
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

/** An array of values → one CSV line. */
const csvRow = (values) => values.map(csvCell).join(',');

/**
 * Header line + already-built rows → the whole document.
 * `headers` may be an array of names or a ready-made comma string.
 */
const buildCsv = (headers, rows) => {
  const headerLine = Array.isArray(headers) ? headers.join(',') : String(headers ?? '');
  return [headerLine, ...rows].join('\n');
};

/**
 * Poll options → the single `Options` cell the importer actually reads.
 *
 * THE CONTRACT (upload-questions.js, engagementType 'poll'): one column named
 * exactly `Options`, values separated by `|`, each one `.trim()`ed on the way
 * in. There is no `Option1..Option5` fallback and never was — emitting those
 * columns is how every AI-generated poll set landed with zero options.
 *
 * Empty slots are dropped rather than padded: the importer does not filter, so
 * a padded `a|b|||` becomes the five-element array ['a','b','','',''].
 *
 * A literal `|` inside an option cannot be represented — the importer splits on
 * it unconditionally, with no escape — so it is folded to `/` rather than
 * allowed to silently split one option into two.
 *
 * Returns a RAW string: still pass it through csvRow.
 */
const optionsToCsvCell = (options) =>
  (Array.isArray(options) ? options : [options])
    .map((option) => String(option ?? '').trim())
    .filter((option) => option !== '')
    .map((option) => option.replace(/\|/g, '/'))
    .join('|');

/** `AllowMultiple` as the importer reads it: `.toLowerCase() === 'true'`. */
const allowMultipleToCsvCell = (allowMultiple) => (allowMultiple ? 'true' : 'false');

/**
 * Tags as the importer reads them: NORMALISED, then pipe-separated to match
 * Options. Byte-equivalent to `src/src/utils/tags.js`'s tagsToCsvCell, which is
 * `normalizeTags(tags).join('|')` — normalising here rather than at the reader
 * is what keeps a server-built CSV and a browser-built one identical.
 */
const tagsToCsvCell = (tags) => normalizeTags(tags).join('|');

module.exports = {
  csvCell, csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell, tagsToCsvCell,
};
