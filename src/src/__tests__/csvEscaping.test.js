/**
 * utils/csv.js — the one escaping helper every CSV generator now routes through.
 *
 * The round-trip proof lives in pollCsvImportContract.test.jsx, which feeds this
 * output to the real importer. These are the unit-level edges that a round-trip
 * would be a clumsy way to pin down. Each test names what it rejects.
 */
import { csvCell, csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell } from '../utils/csv';

describe('csvCell', () => {
  // Rejects: dropping the `.replace(/"/g, '""')` — the whole point of the file.
  test('doubles embedded quotes', () => {
    expect(csvCell('THE "RIGHT" CALL')).toBe('"THE ""RIGHT"" CALL"');
  });

  // Rejects: an implementation that escapes commas or newlines as well. The
  // importer's parser tracks quote state, so a quoted cell already carries them
  // verbatim; escaping them again would corrupt the value on the way back.
  test('leaves commas and newlines alone inside the quotes', () => {
    expect(csvCell('a, b\nc')).toBe('"a, b\nc"');
  });

  // Rejects: `String(value)` without a null guard, which writes the literal
  // text "undefined" into the cell — which is what BuilderPage used to emit for
  // any absent field.
  test('null and undefined become an empty cell, not the word', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(false)).toBe('"false"');
  });
});

describe('csvRow / buildCsv', () => {
  // Rejects: joining rows with something other than a bare newline, or emitting
  // unquoted cells.
  test('a row is comma-joined quoted cells', () => {
    expect(csvRow(['a', 1, null])).toBe('"a","1",""');
  });

  // Rejects: an implementation that quotes the header line — the importer reads
  // headers with an exact case-insensitive name match after stripping quotes,
  // but every generator has always emitted them bare.
  test('accepts a ready-made header string or an array', () => {
    expect(buildCsv('A,B', ['"1","2"'])).toBe('A,B\n"1","2"');
    expect(buildCsv(['A', 'B'], ['"1","2"'])).toBe('A,B\n"1","2"');
  });
});

describe('optionsToCsvCell', () => {
  // Rejects: joining on a comma, or on ', ' — the importer splits on `|` only.
  test('joins on a pipe', () => {
    expect(optionsToCsvCell(['Yes', 'No'])).toBe('Yes|No');
  });

  // Rejects: restoring the emitters' pad-to-five loop, or dropping the filter.
  test('drops blank and whitespace-only options instead of padding', () => {
    expect(optionsToCsvCell(['Yes', '', '  ', null, undefined, 'No'])).toBe('Yes|No');
    expect(optionsToCsvCell([])).toBe('');
  });

  // Rejects: removing the pipe folding. The importer has no escape for `|`, so
  // an unfolded one silently becomes two options.
  test('folds a literal pipe so one option cannot become two', () => {
    expect(optionsToCsvCell(['yes|no'])).toBe('yes/no');
  });

  // Rejects: `options.join(...)` straight off the poll object, which throws on
  // a poll the AI returned without an options array.
  test('tolerates a missing options array', () => {
    expect(optionsToCsvCell(undefined)).toBe('');
    expect(optionsToCsvCell(null)).toBe('');
  });
});

describe('allowMultipleToCsvCell', () => {
  // Rejects: interpolating the raw value, which writes "undefined" for a poll
  // with no allowMultiple flag. The importer compares lowercased to 'true', so
  // anything else is false — but "undefined" in the cell is still a lie in the
  // downloaded file.
  test('always emits the literal true or false', () => {
    expect(allowMultipleToCsvCell(true)).toBe('true');
    expect(allowMultipleToCsvCell(false)).toBe('false');
    expect(allowMultipleToCsvCell(undefined)).toBe('false');
  });
});
