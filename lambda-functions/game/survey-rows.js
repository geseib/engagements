/**
 * THE ROWS A SURVEY SESSION WRITES, and the reads both of its handlers share.
 *
 *   SURVEY#RESP#<respondent>  one person's answers (survey-answers.js)
 *   SURVEY#DONE#<player>      Who finished only: a name and started/finished,
 *                             with no link to any answer row
 *   SURVEY#RESULTS            frozen at close (survey-host.js)
 *
 * EVERY ONE IS STAMPED `Session` = METADATA.CreatedAt, and every reader keeps
 * only its own session's rows. A four-digit code is reused once its reservation
 * expires (start + 7 days), DynamoDB deletes up to ~48h late, and results live
 * 30 days in the same `GAME#<id>` partition — so without the stamp a new
 * survey on a reused code would count the last one's answers
 * (IMPLEMENTATION-phase-2.md §5.1).
 *
 * The live counts (`progressFor`) read the PLAINTEXT `Answered` and `Complete`
 * of every row and never the encrypted `Answers`: counts only, no KMS call.
 */
const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const RESP_PREFIX = 'SURVEY#RESP#';
const DONE_PREFIX = 'SURVEY#DONE#';
const RESULTS_SK = 'SURVEY#RESULTS';

/** Anonymous and Who finished: minted by the phone, `r_` + 22 base64url (128 bits). */
const RESPONDENT_ID = /^r_[A-Za-z0-9_-]{22}$/;

const isSurvey = (meta) => Boolean(meta && meta.GameType === 'survey');
const sessionOf = (meta) => String((meta && meta.CreatedAt) || '');
const orgOf = (meta) => (meta && typeof meta.orgId === 'string' ? meta.orgId.trim() : '');

/** METADATA and STATE, together; STATE strongly, because it is the gate. */
async function readSession(db, tableName, gameId) {
  const [meta, state] = await Promise.all([
    db.send(new GetCommand({ TableName: tableName, Key: { PK: `GAME#${gameId}`, SK: 'METADATA' } })),
    db.send(new GetCommand({ TableName: tableName, Key: { PK: `GAME#${gameId}`, SK: 'STATE' }, ConsistentRead: true })),
  ]);
  return { meta: meta && meta.Item, state: state && state.Item };
}

/** Every row under a prefix of this session's partition, page by page, strongly read. */
async function queryAll(db, tableName, gameId, prefix, extra = {}) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ...extra,
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': prefix, ...(extra.ExpressionAttributeValues || {}) },
      ConsistentRead: true,
      ExclusiveStartKey,
    }));
    items.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * The `surveyProgress` payload: how many people have started (answered
 * something, or sent), how many have sent, and how many have answered each
 * question. Counts only — no respondent id, no name, no answer ever enters it.
 */
async function progressFor(db, tableName, gameId, meta, questions) {
  const session = sessionOf(meta);
  const rows = (await queryAll(db, tableName, gameId, RESP_PREFIX, {
    ProjectionExpression: '#answered, #complete, #session',
    ExpressionAttributeNames: { '#answered': 'Answered', '#complete': 'Complete', '#session': 'Session' },
  })).filter((r) => r.Session === session);
  const answered = new Map(questions.map((q) => [q.qid, 0]));
  for (const r of rows) {
    for (const qid of Array.isArray(r.Answered) ? r.Answered : []) {
      if (answered.has(qid)) answered.set(qid, answered.get(qid) + 1);
    }
  }
  const hasAnswers = (r) => Array.isArray(r.Answered) && r.Answered.length > 0;
  return {
    gameId,
    started: rows.filter((r) => hasAnswers(r) || r.Complete === true).length,
    finished: rows.filter((r) => r.Complete === true).length,
    perQuestion: questions.map((q) => ({ qid: q.qid, answered: answered.get(q.qid) })),
    at: new Date().toISOString(),
  };
}

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});

module.exports = {
  RESP_PREFIX, DONE_PREFIX, RESULTS_SK, RESPONDENT_ID,
  isSurvey, sessionOf, orgOf, readSession, queryAll, progressFor, respond,
};
