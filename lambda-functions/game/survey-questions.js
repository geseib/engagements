/**
 * A SURVEY'S QUESTIONS, AS THE PHONE AND THE CHECKS READ THEM.
 *
 * survey-set.js reads the rows of the pinned set; this opens them and puts each
 * into one shape:
 *
 *   { qid, sk, n, kind, required, title, detail, …the fields of its kind }
 *
 *   qid    the SK without `QUESTION#` ('c001#003') — how every answer names
 *          its question, validated against THIS list, never parsed
 *   n      its place in the survey, 1-based
 *
 * The fields of a kind are exactly what shared/survey-kinds.js says that kind
 * carries (`itemFields`), read tolerantly (`surveyFieldsFromItem` — the
 * contract's defaults, lower- or capitalised spellings), so a rating never
 * arrives with a stray `options` and a text question always has a maxLength.
 * A row whose kind is not one of the five cannot be answered and is left out.
 *
 * DECRYPTED WITH THE SET'S ORG, which is not the phone's (a phone has none)
 * and is not assumed to be the session's: the pinned ref is the authority, as
 * it is for get-question.js and get-ai-summary.js. Platform and public content
 * is never encrypted and passes through.
 *
 * CACHED PER CONTAINER for a minute, by the set the session pins. Every answer
 * is checked against its question, so without this every PUT would query the
 * set and ask KMS; a warm container serving a room pays once. A minute bounds
 * how long an edit to a set in place could go unseen, and a versioned set's
 * content partition does not change at all. An empty result is never cached.
 */
const { readSurveyRows, isAnswerable, qidOf } = require('./survey-set');
const { gameSetRef } = require('./set-version');
const { decryptItems } = require('./tenant-crypto');
const { surveyFieldsFromItem, itemFields } = require('./survey-kinds');

const CACHE_MS = 60 * 1000;
const CACHE_MAX = 32;
const cache = new Map();

/** One stored row → the wire shape, or null when it is not a question anyone can answer. */
function shape(row, index) {
  if (!isAnswerable(row)) return null;
  const fields = surveyFieldsFromItem(row);
  return {
    qid: qidOf(row.SK),
    sk: row.SK,
    n: index + 1,
    title: String(row.Title ?? row.title ?? ''),
    detail: String(row.Detail ?? row.detail ?? ''),
    ...itemFields(fields),
  };
}

/**
 * @param meta the session's METADATA item
 * @returns {Promise<{ questions: object[], set: object, setOrgId: string }>}
 */
async function loadSurveyQuestions(db, tableName, meta, { now = Date.now() } = {}) {
  // Keyed by what the SESSION pins, so a warm hit costs no read at all. A pin
  // names one content partition for good; an unpinned (legacy) session
  // follows the set's activeVersion, which a minute's cache can lag.
  const ref = gameSetRef(meta);
  const key = [ref.scope, ref.orgId, ref.setId, (meta && meta.QuestionSetVersion) ?? ''].join('|');
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const { rows, set, setOrgId } = await readSurveyRows(db, tableName, meta);
  const plain = setOrgId ? await decryptItems(setOrgId, 'question', rows) : rows;
  const questions = [];
  for (const row of plain) {
    const q = shape(row, questions.length);
    if (q) questions.push(q);
    else console.warn(`⚠️ survey: ${row.SK} in ${set.pk} is not one of the five kinds — left out`);
  }
  const value = { questions, set, setOrgId };
  if (set.pk && questions.length) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now, value });
  }
  return value;
}

/** Tests that rewrite a set's rows between checks. */
function forgetSurveyQuestions() { cache.clear(); }

/** What a phone is shown about one question: everything but the SK. */
function toWire(question) {
  const { sk, ...wire } = question;
  return wire;
}

module.exports = { loadSurveyQuestions, forgetSurveyQuestions, toWire, shape };
