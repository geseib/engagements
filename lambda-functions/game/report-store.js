/**
 * THE STORED REPORT, ONE ROW PER ROUND (owner, 15 Oct: "im worried about long
 * sessions creating really long reports and those not working").
 *
 * The report used to be ONE item, `GAME#<id> / REPORT`, holding every round.
 * DynamoDB caps an item at 400 KB, encryption inflates the quoted text, and a
 * round costs about 10 KB with four people (measured on dev, 15 Oct), so a
 * 30-person session failed at about nine rounds: the Put threw, create-report
 * answered 500, and the feedback round (which builds the report first) never
 * opened.
 *
 * THE KEYS, chosen for the three ways the report is read, all in the session's
 * own partition:
 *
 *   GAME#<id> / REPORT          the head: everything but the rounds, plus
 *                               `ReportRounds` (the round numbers, in order)
 *                               and `ReportLayout: 'rounds-v1'`
 *   GAME#<id> / REPORT#R#001    one round (`Round`: a detailedQuestions entry)
 *   GAME#<id> / REPORT#R#002    …
 *
 *   the whole report  one GetItem on the head, then one paged Query,
 *                     begins_with(SK, 'REPORT#R#'), for the rounds in round
 *                     order; it reads only report rows
 *   one round         one GetItem on REPORT#R#nnn (the feedback round)
 *   the head          one GetItem on REPORT
 *
 * A head written before this layout carries `detailedQuestions` itself; every
 * reader here accepts it, so older sessions' reports read as they always did.
 *
 * Encryption: the head as `report` (as before), each round row as
 * `reportRound` (its `Round`), both under the session's org.
 */
const { GetCommand, PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { encryptItem, decryptItem } = require('./tenant-crypto');

const HEAD_SK = 'REPORT';
const ROUND_PREFIX = 'REPORT#R#';
const LAYOUT = 'rounds-v1';
const PUT_CONCURRENCY = 8;

const pad = (n) => String(n).replace(/\D/g, '').padStart(3, '0');
const roundSk = (questionNumber) => `${ROUND_PREFIX}${pad(questionNumber)}`;
const pkOf = (gameId) => `GAME#${gameId}`;

const seal = (orgId, entity, item) => (orgId ? encryptItem(orgId, entity, item) : item);
const open = (orgId, entity, item) => (orgId && item ? decryptItem(orgId, entity, item) : item);

async function queryAll(db, params) {
  const out = [];
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new QueryCommand({ ...params, ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}) }));
    out.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/**
 * Write the report: every round row first, then the head that names them, so
 * a reader never finds a head pointing at a round not yet written. Round rows
 * from an earlier write that this report no longer has are removed.
 *
 * @param {object} report  the report data (`detailedQuestions` and the rest)
 * @param {number} ttl     epoch seconds, on every row
 */
async function writeReport(db, { table, gameId, orgId = '', report, ttl }) {
  const { detailedQuestions = [], ...rest } = report || {};
  const rounds = Array.isArray(detailedQuestions) ? detailedQuestions : [];
  const numbers = rounds.map((q) => pad(q.questionNumber));

  const rows = rounds.map((q) => ({
    PK: pkOf(gameId), SK: roundSk(q.questionNumber), GameId: gameId, QuestionNumber: pad(q.questionNumber), Round: q, ttl,
  }));
  for (let i = 0; i < rows.length; i += PUT_CONCURRENCY) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(rows.slice(i, i + PUT_CONCURRENCY).map(async (row) => db.send(new PutCommand({
      TableName: table, Item: await seal(orgId, 'reportRound', row),
    }))));
  }

  const head = {
    PK: pkOf(gameId), SK: HEAD_SK, ...rest, ReportLayout: LAYOUT, ReportRounds: numbers, ttl,
  };
  await db.send(new PutCommand({ TableName: table, Item: await seal(orgId, 'report', head) }));

  // A round this report no longer has (a re-numbered or removed round): gone.
  const existing = await queryAll(db, {
    TableName: table,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pkOf(gameId), ':sk': ROUND_PREFIX },
    ProjectionExpression: 'PK, SK',
  });
  const keep = new Set(numbers.map(roundSk));
  // Only round rows are ever removed here, whatever the read returned.
  const stale = existing.filter((r) => String(r.SK).startsWith(ROUND_PREFIX) && !keep.has(r.SK));
  await Promise.all(stale.map((r) => db.send(new DeleteCommand({
    TableName: table, Key: { PK: r.PK, SK: r.SK },
  }))));
  return { rounds: numbers.length };
}

/**
 * The whole stored report, assembled, or null: one GetItem on the head, then,
 * for a report in round rows, one paged Query over just those rows
 * (begins_with REPORT#R#, in round order). A report from before the round
 * rows is the head alone and costs the one read.
 */
async function readReport(db, { table, gameId, orgId = '' }) {
  const res = await db.send(new GetCommand({ TableName: table, Key: { PK: pkOf(gameId), SK: HEAD_SK } }));
  if (!res.Item) return null;
  const head = await open(orgId, 'report', res.Item);
  if (head.ReportLayout !== LAYOUT) return head;
  const items = await queryAll(db, {
    TableName: table,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pkOf(gameId), ':sk': ROUND_PREFIX },
  });
  const byNumber = new Map();
  for (const r of items) {
    if (!String(r.SK).startsWith(ROUND_PREFIX)) continue;
    // eslint-disable-next-line no-await-in-loop
    const row = await open(orgId, 'reportRound', r);
    byNumber.set(pad(row.QuestionNumber || String(r.SK).slice(ROUND_PREFIX.length)), row.Round);
  }
  const order = Array.isArray(head.ReportRounds) ? head.ReportRounds : [...byNumber.keys()].sort();
  const detailedQuestions = order.map((n) => byNumber.get(pad(n))).filter(Boolean);
  const { ReportLayout, ReportRounds, ...rest } = head;
  return { ...rest, detailedQuestions };
}

/** The head alone (title, round noun, totals; no rounds), or null: one GetItem. */
async function readReportHead(db, { table, gameId, orgId = '' }) {
  const res = await db.send(new GetCommand({ TableName: table, Key: { PK: pkOf(gameId), SK: HEAD_SK } }));
  return res.Item ? open(orgId, 'report', res.Item) : null;
}

/** One round of the stored report (a detailedQuestions entry), or null. */
async function readReportRound(db, { table, gameId, orgId = '', questionNumber }) {
  const res = await db.send(new GetCommand({ TableName: table, Key: { PK: pkOf(gameId), SK: roundSk(questionNumber) } }));
  if (res.Item) return (await open(orgId, 'reportRound', res.Item)).Round || null;
  // A report from before the round rows: the round is inside the head.
  const headRes = await db.send(new GetCommand({ TableName: table, Key: { PK: pkOf(gameId), SK: HEAD_SK } }));
  if (!headRes.Item) return null;
  const head = await open(orgId, 'report', headRes.Item);
  const list = Array.isArray(head.detailedQuestions) ? head.detailedQuestions : [];
  return list.find((q) => pad(q.questionNumber) === pad(questionNumber)) || null;
}

module.exports = {
  writeReport, readReport, readReportHead, readReportRound, roundSk, HEAD_SK, ROUND_PREFIX, LAYOUT,
};
