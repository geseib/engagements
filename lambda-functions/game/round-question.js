/**
 * THE ONE WAY TO READ A ROUND'S QUESTION — set rounds and host-written rounds.
 *
 * Copied identically into lambda-functions/game/ and lambda-functions/websocket/
 * (a Lambda package is rooted at its CodeUri, so `require('../game/…')` would
 * throw MODULE_NOT_FOUND in the deployed bundle). tests/round-question-readers.js
 * holds the two copies equal and fails if any file reads a round's question
 * through `REF.SourceQuestionId` without coming through here.
 *
 * ── WHY THIS EXISTS (docs/design/impromptu-ask README §5, risk 1) ──────────
 *
 * Until the impromptu ask, every round was a row of the question set: the
 * round's `GAME#<id> / QUESTION#nnn#REF` named a `SourceQuestionId` and seven
 * readers each resolved the set partition and fetched it themselves. A host can
 * now write a question of their own mid-session; it lives on the SESSION
 * (`GAME#<id> / OWNQ#<ownId>`), never in the set, and its REF says so with
 * `Source: 'host'` and `SourceQuestionId: 'OWNQ#<ownId>'`. A reader that still
 * went to the set would find nothing and every phone would show "Source
 * question not found". So the knowledge of where a round's question lives is
 * here, once.
 *
 * ── WHAT A HOST-WRITTEN ROW HOLDS ──────────────────────────────────────────
 *
 *   Title               the question (≤200)
 *   Detail              a line for the room (≤400, optional)
 *   Background          the host's note for Workie (≤400, optional) — the
 *                       field the read already treats as "never shown to
 *                       players" (get-ai-summary.js withholdBackground)
 *   CustomInstructions  the fixed task, OWN_TASK, so `resolveTask` never falls
 *                       through to the set's lesson task
 *   OrgId               the session's org, plaintext: the row is sealed with
 *                       the existing `question` entity under it
 *   Status              queued | asked | removed
 *
 * The shapes returned match a set row's, so a caller that projects `Title`,
 * `Detail`, `CustomInstructions` reads an own round with no branch of its own.
 */
const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { refSetRef, resolveSetPartition } = require('./set-version');
const { ORG } = require('./tenant');
const { decryptItem } = require('./tenant-crypto');

/** The SK prefix of a host-written question on the session's partition. */
const OWN_PREFIX = 'OWNQ#';
/** How an own question is spelled in the running order (queue-order.js). */
const OWN_KEY_PREFIX = 'own:';
/** The REF's Source for a host-written round. */
const OWN_SOURCE = 'host';

/** The task line under a host-written question (README D6), never the set's. */
const OWN_TASK = 'Answer in a sentence or two.';

/** What Workie is told when there is no lesson text behind the question (D7). */
const OWN_NO_LESSON = 'The host wrote this question during the session; there is no lesson text behind it.';

const LIMITS = Object.freeze({ title: 200, detail: 400, note: 400 });

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/** 'own:abc' → 'abc'; anything else → ''. */
const ownIdOfKey = (key) => {
  const k = String(key ?? '').trim();
  return k.startsWith(OWN_KEY_PREFIX) ? k.slice(OWN_KEY_PREFIX.length) : '';
};
const isOwnQueueKey = (key) => Boolean(ownIdOfKey(key));
const ownQueueKey = (ownId) => `${OWN_KEY_PREFIX}${ownId}`;
const ownSk = (ownId) => `${OWN_PREFIX}${ownId}`;
const ownRowKey = (gameId, ownId) => ({ PK: `GAME#${gameId}`, SK: ownSk(ownId) });

/** A REF (or a RESULTS row standing in for one) that names a host-written question. */
const isOwnRef = (ref) => Boolean(ref) && (
  ref.Source === OWN_SOURCE || String(ref.SourceQuestionId || '').startsWith(OWN_PREFIX)
);

/** Open an OWNQ row with the org it records; an orgless session's row is plaintext. */
async function openOwnRow(item) {
  if (!item) return null;
  const orgId = clean(item.OrgId);
  return orgId ? decryptItem(orgId, 'question', item) : item;
}

/** One host-written question, decrypted, or null. */
async function readOwnQuestion(db, table, gameId, ownId) {
  if (!ownId) return null;
  const res = await db.send(new GetCommand({ TableName: table, Key: ownRowKey(gameId, ownId) }));
  return openOwnRow(res && res.Item);
}

/**
 * THE RESOLVER. `ref` is the round's REF row (or a row carrying the same
 * fields). Returns:
 *
 *   question   the decrypted row (set row or OWNQ row), or null when absent
 *   own        true for a host-written round
 *   resolved   the set partition resolveSetPartition chose — for an own round
 *              a set-less stand-in ({ pk: null, scope: '', metadata: null })
 *              so `resolved.metadata?.x` reads as "the set says nothing"
 *   setOrgId   the org the set row was opened with ('' for platform/public/own)
 *   sourceQuestionId, setId
 *
 * Never throws for a missing row; a DynamoDB or KMS failure propagates, as the
 * readers' own reads always did.
 */
async function readRoundQuestion(db, table, gameId, ref) {
  const row = ref || {};
  const sourceQuestionId = row.SourceQuestionId || null;

  if (isOwnRef(row)) {
    const ownId = String(sourceQuestionId || '').slice(OWN_PREFIX.length);
    const question = await readOwnQuestion(db, table, gameId, ownId);
    return {
      question,
      own: true,
      resolved: { pk: null, scope: '', orgId: '', metadata: null, version: null },
      setOrgId: '',
      sourceQuestionId,
      setId: null,
    };
  }

  const setId = row.SetId || null;
  const resolved = await resolveSetPartition(db, table, refSetRef(row, setId), row.SetVersion);
  let question = null;
  if (sourceQuestionId && resolved && resolved.pk) {
    const res = await db.send(new GetCommand({ TableName: table, Key: { PK: resolved.pk, SK: sourceQuestionId } }));
    question = (res && res.Item) || null;
  }
  const setOrgId = resolved && resolved.scope === ORG ? String(resolved.orgId || '') : '';
  if (question && setOrgId) question = await decryptItem(setOrgId, 'question', question);
  return { question, own: false, resolved, setOrgId, sourceQuestionId, setId };
}

/** Read the round's REF, then its question. `{ ref: null }` when there is no REF. */
async function readRoundByNumber(db, table, gameId, paddedRound) {
  const refRes = await db.send(new GetCommand({
    TableName: table,
    Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${paddedRound}#REF` },
  }));
  const ref = (refRes && refRes.Item) || null;
  if (!ref) return { ref: null, question: null, own: false, resolved: null, setOrgId: '', sourceQuestionId: null, setId: null };
  return { ref, ...(await readRoundQuestion(db, table, gameId, ref)) };
}

/**
 * The host-written question as the HOST's surfaces show it (queue, rail,
 * Remote, report). The note is the host's own words and is included; nothing
 * that reaches a participant is built from this.
 */
const ownForHost = (row) => (row ? {
  ownId: String(row.SK || '').slice(OWN_PREFIX.length) || row.OwnId || '',
  key: ownQueueKey(String(row.SK || '').slice(OWN_PREFIX.length) || row.OwnId || ''),
  title: clean(row.Title),
  detail: clean(row.Detail),
  note: clean(row.Background),
  status: row.Status || 'queued',
  createdAt: row.CreatedAt || null,
  updatedAt: row.UpdatedAt || null,
  placement: row.Placement || null,
  placedAtRound: Number.isInteger(row.PlacedAtRound) ? row.PlacedAtRound : null,
  placedAfterRound: Number.isInteger(row.PlacedAfterRound) ? row.PlacedAfterRound : null,
  createdByName: clean(row.CreatedByName),
  askedRound: row.AskedRound || null,
} : null);

/**
 * Every host-written question of a session that has not been removed, for the
 * HOST's surfaces only (the queue route, the host door, up-next). Paged, as a
 * session partition can pass a 1 MB page.
 */
async function listOwnQuestions(db, table, gameId) {
  const rows = [];
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await db.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': OWN_PREFIX },
      ExclusiveStartKey,
    }));
    rows.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  const out = [];
  for (const item of rows) {
    if (item.Status === 'removed') continue;
    // eslint-disable-next-line no-await-in-loop
    out.push(ownForHost(await openOwnRow(item)));
  }
  return out.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

module.exports = {
  listOwnQuestions,
  OWN_PREFIX,
  OWN_KEY_PREFIX,
  OWN_SOURCE,
  OWN_TASK,
  OWN_NO_LESSON,
  LIMITS,
  ownIdOfKey,
  isOwnQueueKey,
  ownQueueKey,
  ownSk,
  ownRowKey,
  isOwnRef,
  openOwnRow,
  readOwnQuestion,
  readRoundQuestion,
  readRoundByNumber,
  ownForHost,
};
