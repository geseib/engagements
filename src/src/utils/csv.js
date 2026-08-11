/**
 * The ONE place that turns values into CSV text.
 *
 * Every generator in the admin UI used to build rows by hand with bare
 * `"${value}"` interpolation. That is fine right up until a value contains a
 * double quote — and then it is silent corruption, not an error: a title like
 *   THE "RIGHT" CALL
 * interpolates to `"THE "RIGHT" CALL"`, which the importer's parser reads as
 * three fields, shifting every column after it by two. Commas and newlines
 * inside a quoted cell are already safe (the importer's parseCSV tracks quote
 * state), so the quote is the whole bug — but it has to be escaped by DOUBLING
 * it, `""`, which is exactly what that parser un-doubles on the way back in.
 *
 * The importer is lambda-functions/admin/upload-questions.js — see
 * parseCSV() there. Do not "simplify" the doubling: it is the wire format.
 */

/** One value → a fully quoted, escaped CSV cell. `null`/`undefined` → `""`. */
export const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

/** An array of values → one CSV line. */
export const csvRow = (values) => values.map(csvCell).join(',');

/**
 * Header line + already-built rows → the whole document.
 * `headers` may be an array of names or a ready-made comma string.
 */
export const buildCsv = (headers, rows) => {
  const headerLine = Array.isArray(headers) ? headers.join(',') : String(headers ?? '');
  return [headerLine, ...rows].join('\n');
};

/**
 * Poll options → the single `Options` cell the importer actually reads.
 *
 * THE CONTRACT (lambda-functions/admin/upload-questions.js, engagementType
 * 'poll'): one column named exactly `Options`, values separated by `|`, each
 * one `.trim()`ed on the way in. There is no `Option1..Option5` fallback and
 * never was — emitting those columns is how every AI-generated poll set landed
 * with zero options.
 *
 * Empty slots are dropped rather than padded: the importer does not filter, so
 * a padded `a|b|||` becomes the five-element array ['a','b','','',''].
 *
 * A literal `|` inside an option cannot be represented — the importer splits on
 * it unconditionally, with no escape — so it is folded to `/` rather than
 * allowed to silently split one option into two.
 *
 * Returns a RAW string (like tagsToCsvCell): still pass it through csvRow.
 */
export const optionsToCsvCell = (options) =>
  (Array.isArray(options) ? options : [options])
    .map((option) => String(option ?? '').trim())
    .filter((option) => option !== '')
    .map((option) => option.replace(/\|/g, '/'))
    .join('|');

/** `AllowMultiple` as the importer reads it: `.toLowerCase() === 'true'`. */
export const allowMultipleToCsvCell = (allowMultiple) => (allowMultiple ? 'true' : 'false');

export default csvCell;
