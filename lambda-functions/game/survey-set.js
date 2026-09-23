/**
 * THE QUESTION ROWS A SURVEY SESSION PLAYS — read from the pinned set, raw.
 *
 * A survey is served whole: every question of the set the session pinned at
 * create (`gameSetRef` — scope, org, set id — and `QuestionSetVersion`), in the
 * set's own order, SK order (`QUESTION#c001#001`, `…#002`, …). No categories
 * are chosen, nothing is shuffled (create forces randomizeQuestions off for a
 * survey), and no round ever serves one question at a time.
 *
 * "Pinned, active": the version is resolved the way every runtime reader does
 * it (set-version.js resolveSetPartition) — the pin, else the set's
 * activeVersion, else the legacy unversioned partition. The per-question
 * `Active` flag is NOT a filter here: upload-questions.js writes it `false` on
 * every AI-drafted question and nothing in game/ has ever read it, so honouring
 * it would open a generated survey with no questions.
 *
 * WHY THIS FILE HOLDS NO DECRYPTION. start-game.js reads it to count what it is
 * opening, and StartGameFunction carries no KMS grant
 * (tests/kms-grants-match-code.js walks every require). The decrypting reader
 * the phones and the host routes use is survey-questions.js, built on this.
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md.
 */
const { gameSetRef, resolveSetPartition, queryPartition } = require('./set-version');
const { ORG } = require('./tenant');
const { KINDS, normalizeKind } = require('./survey-kinds');

/** A qid is the question's SK without `QUESTION#`: `c001#003`. */
const QUESTION_PREFIX = 'QUESTION#';
const qidOf = (sk) => String(sk || '').slice(QUESTION_PREFIX.length);

/**
 * Can this row be answered at all — is its kind one of the five? `kind` is
 * plaintext on an org set's row (a closed vocabulary, not prose), so this needs
 * no key. A row that fails it is left out of the survey everywhere.
 */
const isAnswerable = (row) => KINDS.includes(normalizeKind(row && (row.kind ?? row.Kind)).kind);

/**
 * The pinned set's question rows, SK-ordered, exactly as stored (an org set's
 * prose is still ciphertext).
 *
 * @param meta the session's METADATA item (QuestionSetId/Scope/Version, orgId)
 * @returns {Promise<{ rows: object[], set: { scope, orgId, setId, pk, version }, setOrgId: string }>}
 *   `setOrgId` is the org whose key the rows are under — '' for platform and
 *   public content, which is never encrypted.
 */
async function readSurveyRows(db, tableName, meta) {
  const ref = gameSetRef(meta);
  if (!ref.setId) return { rows: [], set: { ...ref, pk: null, version: null }, setOrgId: '' };
  const resolved = await resolveSetPartition(db, tableName, ref, meta && meta.QuestionSetVersion);
  const { items } = await queryPartition(db, tableName, resolved.pk, QUESTION_PREFIX);
  const rows = items
    .filter((r) => r && typeof r.SK === 'string' && r.SK.startsWith(QUESTION_PREFIX))
    .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
  return {
    rows,
    set: { scope: resolved.scope, orgId: resolved.orgId, setId: resolved.setId, pk: resolved.pk, version: resolved.version },
    setOrgId: resolved.scope === ORG ? String(resolved.orgId || '') : '',
  };
}

module.exports = { readSurveyRows, isAnswerable, qidOf, QUESTION_PREFIX };
