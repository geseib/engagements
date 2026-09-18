// lambda-functions/admin/moderation-get.js
/**
 * GET /admin/moderation/{sk} — one queued set, opened (spec §6.1, §10.5).
 *
 * The pointer says WHY it is here; the org's REVIEW row says what the check
 * found (findings with the sentence 06 promised); the S3 snapshot is WHAT was
 * judged — and what approve will publish, byte for byte. Uncertain questions
 * come first: a reviewer's job is the handful the check could not decide, not
 * a re-read of the set.
 *
 * Stage 5 (spec §8) adds the access-log write here — opening a snapshot is the
 * moment the organisation's log names the reviewer. The seam is marked below.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { queueKey } = require('./shared/moderation-queue');
const { readReview } = require('./shared/set-review');
const { readReviewLog } = require('./shared/review-log');
const { readSnapshot } = require('./shared/snapshot-store');
const { questionText } = require('./shared/publishable');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = () => process.env.TABLE_NAME;
const BUCKET = () => process.env.AI_PROMPTS_BUCKET || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

/** The three shapes of §3.2, and the ref each names. Anything else is refused. */
function parseSk(raw) {
  const sk = String(raw || '').trim();
  let m = /^([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)#v(\d+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'org', orgId: m[1], setId: m[2] }, version: Number(m[3]) };
  m = /^PUBLIC#([A-Za-z0-9_-]+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'public', orgId: '', setId: m[1] }, version: 0 };
  m = /^PLATFORM#([A-Za-z0-9_-]+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'platform', orgId: '', setId: m[1] }, version: 0 };
  return null;
}

const bareId = (sk) => String(sk || '').replace(/^QUESTION#/, '');
const categoryId = (sk) => String(sk || '').replace(/^CATEGORY#/, '');

/** Uncertain (any finding) first, in set order within each group. */
function shapeSnapshot(snapshot, findings) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const byQuestion = new Map();
  for (const f of findings) {
    if (!f || !f.questionId || f.questionId === '(set)') continue;
    if (!byQuestion.has(f.questionId)) byQuestion.set(f.questionId, []);
    byQuestion.get(f.questionId).push(f);
  }
  const questions = (snapshot.questions || []).map((q) => ({
    questionId: bareId(q.SK),
    category: q.Category || q.category || '',
    title: q.Title || q.title || '',
    text: questionText(q),
    findings: byQuestion.get(bareId(q.SK)) || [],
  }));
  const uncertain = questions.filter((q) => q.findings.length);
  const rest = questions.filter((q) => !q.findings.length);
  return {
    meta: {
      name: (snapshot.meta && (snapshot.meta.name || snapshot.meta.Name)) || '',
      description: (snapshot.meta && (snapshot.meta.description || snapshot.meta.Description)) || '',
      engagementType: (snapshot.meta && snapshot.meta.engagementType) || '',
    },
    categories: (snapshot.categories || []).map((c) => ({ id: categoryId(c.SK), name: c.Name || c.name || '' })),
    questions: [...uncertain, ...rest],
  };
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'The moderation queue is for Engage staff acting as Engage.' });
  }
  let raw = event.pathParameters?.sk || '';
  try { raw = decodeURIComponent(raw); } catch { /* keep as sent; parseSk refuses it */ }
  const parsed = parseSk(raw);
  if (!parsed) return json(400, { error: 'That is not a queue entry.' });
  try {
    const row = await db.send(new GetCommand({ TableName: TABLE(), Key: queueKey(parsed.sk) }));
    if (!row || !row.Item) return json(404, { error: 'Nothing is waiting under that entry — it may already be decided.' });
    const pointer = { ...row.Item, sk: row.Item.SK };
    delete pointer.PK; delete pointer.SK;
    const review = parsed.ref.scope === 'org' ? await readReview(db, TABLE(), parsed.ref, parsed.version) : { status: 'unreviewed' };
    const findings = Array.isArray(review.findings) ? review.findings : [];
    const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
    const log = await readReviewLog(db, TABLE(), parsed.ref);
    // Stage 5 (spec §8): append the ORG#<orgId>#ACCESS row and the `access`
    // log event here — idempotent per reviewer / set / day.
    return json(200, {
      pointer,
      review: {
        status: review.status || 'unreviewed',
        findings,
        reasons: Array.isArray(review.reasons) ? review.reasons : [],
        checkedAt: review.checkedAt || null,
        note: review.note || '',
        contentHash: review.contentHash || '',
        declaredNotice: review.declaredNotice || null,
      },
      snapshot: shapeSnapshot(snapshot, findings),
      setFindings: findings.filter((f) => f && f.questionId === '(set)'),
      log,
    });
  } catch (error) {
    console.error('❌ moderation get failed:', error);
    return json(500, { error: `Could not open that entry: ${error.message}` });
  }
};
