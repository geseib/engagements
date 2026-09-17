/**
 * THE PUBLISHED SURFACE OF A SET — one definition, three readers.
 *
 * The check judges this, the record hashes this, and publish copies the rows
 * this is drawn from. Before this module the check read title + body only:
 * `answerDetails` was read off a row that stores `AnswerDetails`, so the reveal
 * never reached the guardrail, and options, per-question instructions, the set
 * prose and the category names shipped to the public library unjudged while
 * 05-share-review.html said "reads the whole set". Spec §4.1.
 *
 * A snapshot holds WHOLE plaintext rows (minus partition keys) because publish
 * copies whole rows; `questionText`/`setText` read only the fields a person
 * could see, so ids and keys are never sent to a model.
 */
const crypto = require('crypto');

/** Question fields a room can see. Case is the row's case. */
const QUESTION_FIELDS = Object.freeze([
  'Title', 'Detail', 'AnswerDetails', 'CustomInstructions',
  'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF', 'options',
]);
/** The editable set prose (`edit-question-set.js` OPTIONAL_FIELDS that are text). */
const SET_FIELDS = Object.freeze([
  'name', 'description', 'customInstruction', 'aiContextInstruction', 'roundKindBrief',
]);

const asText = (v) => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
  if (typeof v === 'object') return '';
  return String(v).trim();
};

function questionText(row) {
  return QUESTION_FIELDS.map((f) => asText(row && row[f])).filter(Boolean).join('\n');
}
function setText(meta, categories = []) {
  const prose = SET_FIELDS.map((f) => asText(meta && meta[f]));
  const names = (categories || []).map((c) => asText(c && c.Name));
  return [...prose, ...names].filter(Boolean).join('\n');
}
function stripKeys(row) {
  if (!row || typeof row !== 'object') return row;
  const { PK, ...rest } = row; // eslint-disable-line no-unused-vars
  return rest;
}
const bySk = (a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0);

function buildSnapshot({ source, version, meta, categories = [], questions = [], checkedAt }) {
  return {
    source: { scope: source.scope, orgId: source.orgId || '', setId: source.setId },
    version: version === undefined ? null : version,
    checkedAt: checkedAt || new Date().toISOString(),
    meta: stripKeys(meta),
    categories: categories.map(stripKeys).sort(bySk),
    questions: questions.map(stripKeys).sort(bySk),
  };
}
/** Deterministic JSON: keys sorted at every level. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
const pick = (row, fields) => Object.fromEntries(fields.filter((f) => row && f in row).map((f) => [f, row[f]]));

/** sha256 over the JUDGED surface, so an edit to a reveal changes it and a re-check date does not. */
function contentHash(snapshot) {
  const judged = {
    set: pick(snapshot.meta || {}, SET_FIELDS),
    categories: (snapshot.categories || []).map((c) => ({ SK: c.SK, Name: c.Name })).sort(bySk),
    questions: (snapshot.questions || []).map((q) => ({ SK: q.SK, ...pick(q, QUESTION_FIELDS) })).sort(bySk),
  };
  return crypto.createHash('sha256').update(canonical(judged)).digest('hex');
}
const snapshotHasImages = (snapshot) => (snapshot.questions || []).some((q) => asText(q.Image) !== '');

module.exports = {
  QUESTION_FIELDS, SET_FIELDS, questionText, setText, stripKeys, buildSnapshot, contentHash, snapshotHasImages, canonical,
};
