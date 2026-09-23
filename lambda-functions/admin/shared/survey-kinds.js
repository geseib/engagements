/**
 * THE FIVE SURVEY QUESTION KINDS — the SERVER's vocabulary for them.
 *
 * The contract is docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md,
 * "THE CONTRACT", and it is binding word for word: field names, defaults,
 * validation wording, the CSV's column order and quoting. The browser keeps
 * its own copy — `src/src/utils/questionRows.js` (the row data, the problems,
 * `rowsToCsv`) and `src/src/config/surveyKinds.js` (what a person reads about a
 * kind) — because Lambda bundles are per-directory and cannot import the
 * frontend's ESM, the same rule `shared/csv.js` and `shared/round-kinds.js`
 * state for theirs. tests/question-set-roundtrip.js holds the two writers
 * byte-identical; tests/survey-kinds.js holds this half to the contract's text.
 *
 * ── WHY A SURVEY IS A BRANCH OF THE ONE CSV, NOT A NEW FORMAT ─────────────
 *
 * Every question set in this product travels through one CSV: the editor's
 * Save, an AI draft, the download and the importer all round-trip through it.
 * Trivia has OptionA..F, a poll has Options,AllowMultiple, and a survey has the
 * twenty fixed columns below. A second format for surveys would be a second
 * writer, and a second writer is how the silent-data-loss defect the roundtrip
 * suite exists for came about in the first place.
 *
 * ── WHAT IS STORED ────────────────────────────────────────────────────────
 *
 * The row fields in the browser ARE the DynamoDB attribute names (lower-case,
 * as the poll branch's `options` / `allowMultiple` already are). A field not
 * relevant to the row's kind is NOT stored and reads back as its empty value —
 * '' / false / null / [] — so a rating row never carries a stray `options` that
 * a later kind change would resurrect. Null integers (`maxPicks`, `rankTop`)
 * are not stored either: in DynamoDB "no value" is an absent attribute.
 *
 * Seven of these fields are prose a person typed, and they are in
 * ENCRYPTED_FIELDS.question in all three tenant-crypto.js copies: options,
 * lowLabel, highLabel, yesLabel, noLabel, followUpPrompt, placeholder. The rest
 * are vocabulary, flags and counts.
 */

const { csvCell, tagsToCsvCell } = require('./csv');

/** In the Add-menu order (mockup 04). The browser's SURVEY_KINDS lists the same five. */
const KINDS = Object.freeze(['rating', 'choice', 'yesno', 'rank', 'text']);

/**
 * Every survey row is filed under this category. Surveys expose no categories,
 * but the importer's 24-bit category mask still needs one, so the editor hides
 * the field and fills it, and the importer fills a blank one.
 */
const SURVEY_CATEGORY = 'Survey';

const SCALES = Object.freeze(['1-5', '1-10', '0-10', 'stars']);
const FOLLOW_UPS = Object.freeze(['', 'yes', 'no', 'any']);
const TEXT_LENGTHS = Object.freeze(['short', 'long']);
const DEFAULT_MAX_LENGTH = Object.freeze({ long: 500, short: 280 });

/**
 * Accepted on IMPORT only — never written. The survey builder's old JSON export
 * (and the old JSON template) spelled kinds this way, and a person holding one
 * of those files should be able to bring it in. `nps` is a rating by another
 * name, always on the 0–10 scale.
 */
const LEGACY_KINDS = Object.freeze({
  multiple_choice: { kind: 'choice' },
  text_entry: { kind: 'text' },
  yes_no: { kind: 'yesno' },
  'yes-no': { kind: 'yesno' },
  ranking: { kind: 'rank' },
  nps: { kind: 'rating', scale: '0-10' },
});

/**
 * THE TWENTY COLUMNS, in the contract's order, with the attribute each one is
 * and how its cell is written. The column is always the attribute with its
 * first letter raised — which is also the "capitalised" spelling the exporter
 * tolerates on a hand-written row.
 */
const FIELDS = Object.freeze([
  ['kind', 'string'], ['required', 'boolean'], ['options', 'list'],
  ['allowMultiple', 'boolean'], ['maxPicks', 'integer'], ['allowOther', 'boolean'],
  ['shuffle', 'boolean'], ['scale', 'string'], ['lowLabel', 'string'], ['highLabel', 'string'],
  ['yesLabel', 'string'], ['noLabel', 'string'], ['unsure', 'boolean'],
  ['followUpWhen', 'string'], ['followUpPrompt', 'string'], ['rankTop', 'integer'],
  ['textLength', 'string'], ['maxLength', 'integer'], ['placeholder', 'string'], ['themes', 'boolean'],
].map(([field, type]) => Object.freeze({ field, type, column: field[0].toUpperCase() + field.slice(1) })));

/** `Kind` … `Themes`. The exporter writes these between CustomInstruction and the optional columns. */
const SURVEY_CSV_COLUMNS = Object.freeze(FIELDS.map((f) => f.column));

/** The whole survey header up to (not including) the optional columns and `,Tags`. */
const SURVEY_CSV_HEADER = ['Category', 'Question#', 'Title', 'Detail_lesson', 'School', 'CustomInstruction',
  ...SURVEY_CSV_COLUMNS].join(',');

const BY_COLUMN = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.column, f])));

/** The value a field reads back as when it is not relevant, or not stored. */
const emptyOf = (type) => (type === 'list' ? [] : ({ string: '', boolean: false, integer: null })[type]);

// ── Reading cells ──────────────────────────────────────────────────────────
//
// TOLERANT ON THE WAY IN, EXACT ON THE WAY OUT. A spreadsheet re-saves `true`
// as `TRUE` and a person types `Stars` or `Long`, so the importer folds case on
// every closed-vocabulary cell; what it STORES, and what the exporter writes,
// is always the contract's lower-case spelling. A value that still matches
// nothing is kept AS TYPED, so the problem message can quote it back.

const TRUTHY = new Set(['true', 'yes', 'y', '1']);

function parseBool(raw, fallback) {
  const s = raw.toLowerCase();
  if (s === '') return fallback;
  return TRUTHY.has(s);
}

/** Digits → a number; blank → null; anything else stays the raw string, for the message. */
function parseInteger(raw) {
  if (raw === '') return null;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

/** `1 – 5`, `1–5`, `1-5` are one scale. The en dash is what the UI prints. */
function foldScale(raw) {
  const s = raw.toLowerCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
  return SCALES.includes(s) ? s : raw;
}

function foldEnum(raw, allowed) {
  const s = raw.toLowerCase();
  return allowed.includes(s) ? s : raw;
}

/** Pipe-separated, like the poll's Options. Blank entries drop out: "a||b|" is two options, not four. */
function parseList(raw) {
  return raw === '' ? [] : raw.split('|').map((s) => s.trim()).filter(Boolean);
}

/**
 * A raw Kind cell → `{ kind }` (plus `scale` for `nps`), or `{ error }` in the
 * contract's wording. Case and surrounding space are ignored; an unknown kind is
 * quoted back as it was typed.
 */
function normalizeKind(raw) {
  const typed = String(raw ?? '').trim();
  if (!typed) return { error: 'needs a kind' };
  const key = typed.toLowerCase();
  if (KINDS.includes(key)) return { kind: key };
  if (LEGACY_KINDS[key]) return { ...LEGACY_KINDS[key] };
  return { error: `unknown kind '${typed}'` };
}

/**
 * The fields that matter for this row — decided by the kind, and for two fields
 * by a switch on the same row: MaxPicks only once several may be picked, and
 * FollowUpPrompt only once there is a follow-up.
 */
function relevantFields(f) {
  const keep = ['kind', 'required'];
  switch (f.kind) {
    case 'choice':
      keep.push('options', 'allowMultiple', 'allowOther', 'shuffle');
      if (f.allowMultiple === true) keep.push('maxPicks');
      break;
    case 'rank':
      keep.push('options', 'rankTop');
      break;
    case 'rating':
      keep.push('scale', 'lowLabel', 'highLabel');
      break;
    case 'yesno':
      keep.push('yesLabel', 'noLabel', 'unsure', 'followUpWhen');
      if (String(f.followUpWhen ?? '') !== '') keep.push('followUpPrompt');
      break;
    case 'text':
      keep.push('textLength', 'maxLength', 'placeholder', 'themes');
      break;
    default:
      break;
  }
  return new Set(keep);
}

/**
 * The full, normalised field object for one row, given `get(columnName)` →
 * the cell's text. Every field in the contract table is present: relevant ones
 * hold the cell's value or the table's default, the rest hold their empty value.
 *
 * Nothing here decides whether the row is VALID — `validateSurvey` does, and an
 * out-of-vocabulary value is kept as typed precisely so it can be reported.
 */
function surveyFieldsFromCells(get) {
  const raw = (column) => String((typeof get === 'function' ? get(column) : '') ?? '').trim();
  const kindCell = raw('Kind');
  const normal = normalizeKind(kindCell);

  const f = {};
  for (const { field, type } of FIELDS) f[field] = emptyOf(type);
  f.kind = normal.kind || kindCell;
  f.required = parseBool(raw('Required'), false);

  switch (f.kind) {
    case 'choice':
      f.options = parseList(raw('Options'));
      f.allowMultiple = parseBool(raw('AllowMultiple'), false);
      f.maxPicks = f.allowMultiple ? parseInteger(raw('MaxPicks')) : null;
      f.allowOther = parseBool(raw('AllowOther'), false);
      f.shuffle = parseBool(raw('Shuffle'), false);
      break;
    case 'rank':
      f.options = parseList(raw('Options'));
      f.rankTop = parseInteger(raw('RankTop'));
      break;
    case 'rating': {
      const scale = raw('Scale');
      f.scale = normal.scale || (scale === '' ? '1-5' : foldScale(scale));
      f.lowLabel = raw('LowLabel');
      f.highLabel = raw('HighLabel');
      break;
    }
    case 'yesno':
      f.yesLabel = raw('YesLabel');
      f.noLabel = raw('NoLabel');
      f.unsure = parseBool(raw('Unsure'), false);
      f.followUpWhen = foldEnum(raw('FollowUpWhen'), FOLLOW_UPS);
      f.followUpPrompt = f.followUpWhen ? raw('FollowUpPrompt') : '';
      break;
    case 'text': {
      const length = raw('TextLength');
      f.textLength = length === '' ? 'long' : foldEnum(length, TEXT_LENGTHS);
      const max = raw('MaxLength');
      f.maxLength = max === ''
        ? (DEFAULT_MAX_LENGTH[f.textLength] || DEFAULT_MAX_LENGTH.long)
        : parseInteger(max);
      f.placeholder = raw('Placeholder');
      f.themes = parseBool(raw('Themes'), true);
      break;
    }
    default:
      break;
  }
  return f;
}

const isSet = (v) => v !== null && v !== undefined && v !== '';
const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * What is wrong with this row, in the CONTRACT'S WORDS — the importer's skip
 * reason and the browser's `rowProblems` say the same thing, so what the
 * preflight warns about is exactly what an import would skip. [] means fine.
 *
 * Title and Category are not checked here: they apply to every engagement type
 * and the importer checks them itself ("needs a title"); a blank survey
 * Category is filled with `Survey`, never refused.
 */
function validateSurvey(fields) {
  const f = fields || {};
  const kind = String(f.kind ?? '').trim();
  if (!kind) return ['needs a kind'];
  if (!KINDS.includes(kind)) return [`unknown kind '${kind}'`];

  const problems = [];
  const options = Array.isArray(f.options) ? f.options : [];
  const count = options.length;

  if (kind === 'choice') {
    if (count < 2) problems.push('needs at least two options');
    else if (count > 8) problems.push('has more than eight options');
    if (f.allowMultiple === true && isSet(f.maxPicks) && !inRange(f.maxPicks, 2, count)) {
      problems.push(`can't allow ${f.maxPicks} picks from ${count} options`);
    }
  } else if (kind === 'rank') {
    if (count < 3) problems.push('needs at least three items');
    else if (count > 7) problems.push('has more than seven items');
    if (isSet(f.rankTop) && !inRange(f.rankTop, 1, count - 1)) {
      problems.push(`can't rank the top ${f.rankTop} of ${count}`);
    }
  } else if (kind === 'rating') {
    if (!SCALES.includes(f.scale)) problems.push(`unknown scale '${f.scale}'`);
  } else if (kind === 'yesno') {
    const when = String(f.followUpWhen ?? '');
    if (!FOLLOW_UPS.includes(when)) problems.push(`unknown follow-up '${when}'`);
    else if (when !== '' && !String(f.followUpPrompt ?? '').trim()) problems.push('needs the follow-up question');
  } else if (kind === 'text') {
    if (!TEXT_LENGTHS.includes(f.textLength)) problems.push(`unknown length '${f.textLength}'`);
    if (!inRange(f.maxLength, 20, 2000)) problems.push('answer limit must be 20–2000 characters');
  }
  return problems;
}

/**
 * The attributes a question item carries for this row: `kind`, `required`, and
 * the fields relevant to the kind — nothing else. Call it on a row that passed
 * `validateSurvey`. A null integer is left off rather than stored as NULL.
 */
function itemFields(fields) {
  const f = fields || {};
  const keep = relevantFields(f);
  const out = {};
  for (const { field } of FIELDS) {
    if (!keep.has(field)) continue;
    const v = f[field];
    if (v === null || v === undefined) continue;
    out[field] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

// ── Writing cells ──────────────────────────────────────────────────────────

const isTrue = (v) => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

/** One value → the text of its cell, before quoting. */
function cellText(value, type) {
  switch (type) {
    case 'boolean':
      return isTrue(value) ? 'true' : 'false';
    case 'integer':
      if (Number.isInteger(value)) return String(value);
      return typeof value === 'string' && /^\d+$/.test(value.trim()) ? value.trim() : '';
    case 'list':
      // A `|` inside an option cannot be represented — the importer splits on
      // it with no escape — so it is folded to `/`, as shared/csv.js does for
      // polls; left alone it turned one option into two. utils/questionRows.js
      // folds identically, so the two writers stay byte-identical.
      return Array.isArray(value)
        ? value.map((v) => String(v ?? '').trim()).filter(Boolean).map((v) => v.replace(/\|/g, '/')).join('|')
        : String(value ?? '').trim();
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

/**
 * The twenty quoted cells for one question, from its stored attributes
 * (lower-case, tolerant of the capitalised spelling). Every cell is
 * double-quoted with `"` doubled, like the poll branch. Strings are written as
 * stored, booleans as "true"/"false", integers as digits or "", and Options
 * pipe-joined. A field not relevant to the row's kind is written as its empty
 * value — "", "false" or "" — whatever the row happens to carry.
 */
function surveyCsvCells(q) {
  const item = q || {};
  const read = (field, column) => (item[field] !== undefined && item[field] !== null ? item[field] : item[column]);
  const typed = {};
  for (const { field, column } of FIELDS) typed[field] = read(field, column);
  const keep = relevantFields({
    kind: String(typed.kind ?? '').trim(),
    allowMultiple: isTrue(typed.allowMultiple),
    followUpWhen: String(typed.followUpWhen ?? '').trim(),
  });
  return FIELDS.map(({ field, type }) => csvCell(cellText(keep.has(field) ? typed[field] : undefined, type)));
}

/**
 * The full field object for a contract-shaped ITEM (a generated question, a
 * converted legacy question): typed values in, the same normalisation a CSV row
 * gets. An absent value becomes a blank cell, so the table's default applies —
 * a text item with no `themes` gets themes ON, not "false".
 */
function surveyFieldsFromItem(item) {
  const src = item || {};
  return surveyFieldsFromCells((column) => {
    const { field, type } = BY_COLUMN[column];
    const v = src[field] !== undefined && src[field] !== null ? src[field] : src[column];
    return v === undefined || v === null ? '' : cellText(v, type);
  });
}

/**
 * A complete survey CSV — the contract header, then `,Tags` — from
 * contract-shaped items. The generator's `setCreation.toCsv` and the legacy
 * JSON import both come through here, so a draft set and an imported one are
 * the same shape.
 *
 * Written the way download-question-set.js writes a survey set (a newline after
 * every row, `Question#` bare, category-relative numbering), so a set made from
 * this CSV downloads as this CSV — provided it carries no set-level instruction,
 * which the importer copies onto every row that has none of its own.
 */
function itemsToSurveyCsv(items, { category } = {}) {
  const list = Array.isArray(items) ? items : [];
  const counters = {};
  let csv = `${SURVEY_CSV_HEADER},Tags\n`;
  for (const item of list) {
    const q = item || {};
    const cat = String(category || q.category || q.Category || SURVEY_CATEGORY);
    counters[cat] = (counters[cat] || 0) + 1;
    const common = [
      csvCell(cat),
      String(counters[cat]),
      csvCell(q.title ?? q.Title ?? ''),
      csvCell(q.detail ?? q.Detail ?? q.questionDetail ?? ''),
      csvCell(q.school ?? q.School ?? ''),
      csvCell(q.customInstructions ?? q.customInstruction ?? q.CustomInstructions ?? ''),
    ];
    csv += [...common, ...surveyCsvCells(surveyFieldsFromItem(q)), csvCell(tagsToCsvCell(q.tags ?? q.Tags))].join(',')
      + '\n';
  }
  return csv;
}

/**
 * The textType the old builder offered → the contract's two lengths. Only
 * `long` was ever long; `email` and `number` asked for one short line.
 */
function legacyTextLength(textType) {
  const t = String(textType ?? '').trim().toLowerCase();
  if (t === 'long') return 'long';
  if (t === 'short' || t === 'email' || t === 'number') return 'short';
  return '';
}

/** One question of the old JSON → a contract-shaped item. Unknown kinds stay as typed, to be skipped with a reason. */
function legacyQuestionToItem(q) {
  const src = q && typeof q === 'object' ? q : {};
  const typedKind = String(src.kind ?? src.type ?? '').trim();
  const normal = normalizeKind(typedKind);
  const scaleObj = src.scale && typeof src.scale === 'object' ? src.scale : null;
  const scale = normal.scale || (scaleObj ? scaleObj.type : src.scale) || '';
  const options = Array.isArray(src.options)
    ? src.options.map((o) => (o && typeof o === 'object' ? (o.label ?? o.text ?? o.value ?? '') : o))
    : src.options;
  return {
    category: SURVEY_CATEGORY,
    title: String(src.question ?? src.title ?? src.text ?? src.prompt ?? '').trim(),
    detail: String(src.detail ?? src.description ?? '').trim(),
    kind: normal.kind || typedKind,
    required: src.required === true,
    options,
    allowMultiple: src.allowMultiple,
    maxPicks: src.maxPicks,
    allowOther: src.allowOther,
    shuffle: src.shuffle,
    scale,
    lowLabel: (scaleObj && scaleObj.lowLabel) ?? src.lowLabel,
    highLabel: (scaleObj && scaleObj.highLabel) ?? src.highLabel,
    yesLabel: src.yesLabel,
    noLabel: src.noLabel,
    unsure: src.unsure,
    followUpWhen: src.followUpWhen,
    followUpPrompt: src.followUpPrompt,
    rankTop: src.rankTop,
    textLength: src.textLength ?? legacyTextLength(src.textType),
    maxLength: src.maxLength,
    placeholder: src.placeholder,
    themes: src.themes,
    tags: src.tags,
  };
}

/**
 * The survey builder's old JSON export — `{ title, description, questions: [
 * { question, type, scale: { type, lowLabel, highLabel }, options,
 * allowMultiple, textType, placeholder, required, tags } ] }`, which is also
 * the shape the old JSON template had — as a contract CSV the importer reads
 * like any other. A bare array of questions is accepted too.
 *
 * THROWS with a sentence a person can act on when the file is not that; the
 * importer answers 400 with it. Individual bad questions do not throw: they
 * come out as rows the importer skips with the contract's reason, so one odd
 * question does not cost the other nineteen.
 */
function legacySurveyJsonToCsv(jsonText) {
  let doc;
  try {
    doc = JSON.parse(String(jsonText ?? ''));
  } catch (e) {
    throw new Error(`This survey file is not valid JSON (${e.message}). Export it again, or use the survey CSV template.`);
  }
  const questions = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.questions) ? doc.questions : null);
  if (!questions) {
    throw new Error('This JSON file has no "questions" list, so it is not a survey export. '
      + 'Expected { "title": …, "questions": [ … ] } — or use the survey CSV template.');
  }
  if (questions.length === 0) throw new Error('This survey file has no questions in it.');
  return itemsToSurveyCsv(questions.map(legacyQuestionToItem), { category: SURVEY_CATEGORY });
}

module.exports = {
  KINDS,
  SURVEY_CATEGORY,
  SURVEY_CSV_COLUMNS,
  SURVEY_CSV_HEADER,
  SCALES,
  FOLLOW_UPS,
  TEXT_LENGTHS,
  normalizeKind,
  surveyFieldsFromCells,
  surveyFieldsFromItem,
  validateSurvey,
  itemFields,
  surveyCsvCells,
  itemsToSurveyCsv,
  legacySurveyJsonToCsv,
};
