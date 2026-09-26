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
const { toVersion } = require('./shared/set-version');
const { questionText, SET_FIELDS } = require('./shared/publishable');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = () => process.env.TABLE_NAME;
const BUCKET = () => process.env.AI_PROMPTS_BUCKET || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

/**
 * The three shapes of §3.2, and the ref each names. Anything else is refused.
 *
 * `#v(0|[1-9]\d*)`: a version is one-based, but `v0` is the one reserved
 * spelling for "no version" — moderation-queue.js's `queueSk` writes exactly
 * `#v0` for an unversioned org set (a legacy set with no `#v<n>` partition —
 * set-version.js's permanently supported, never-migrated read state), and
 * `setPartition(ref, null)`, which `toVersion(0)` resolves to below, is that
 * same LEGACY UNVERSIONED partition. `v01` is refused on the same reasoning:
 * one spelling per version (and per "no version" — `v0`, not `v00`), so two
 * queue skus cannot name one row.
 *
 * A set that has SINCE been versioned still answers a `v0` request: the legacy
 * partition is a distinct, permanently addressable location that coexists
 * with any numbered version added later (set-version.js never deletes or
 * migrates it), so `v0` keeps naming exactly that row and never a numbered
 * one — resolved, not refused, and never confused with `v1`/`v2`/….
 */
function parseSk(raw) {
  const sk = String(raw || '').trim();
  let m = /^([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)#v(0|[1-9]\d*)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'org', orgId: m[1], setId: m[2] }, version: m[3] === '0' ? null : Number(m[3]) };
  m = /^PUBLIC#([A-Za-z0-9_-]+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'public', orgId: '', setId: m[1] }, version: 0 };
  m = /^PLATFORM#([A-Za-z0-9_-]+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'platform', orgId: '', setId: m[1] }, version: 0 };
  return null;
}

const bareId = (sk) => String(sk || '').replace(/^QUESTION#/, '');
const categoryId = (sk) => String(sk || '').replace(/^CATEGORY#/, '');

/**
 * ONE ROW'S TEXT FIELD, in the row's own case. Metadata rows written before the
 * lowercase spelling settled carry `Name`/`Description`; everything else is
 * lowercase. A non-string (an array, an object, a stray number) reads as '',
 * because this feeds a reviewer's screen and `String({})` is not text.
 */
function metaText(meta, field) {
  const capitalised = field.charAt(0).toUpperCase() + field.slice(1);
  const value = (meta[field] === undefined || meta[field] === null || meta[field] === '')
    ? meta[capitalised] : meta[field];
  return typeof value === 'string' ? value : '';
}

/**
 * THE SET'S OWN TEXT, ALL OF IT — all five SET_FIELDS, not three.
 *
 * `publishable.contentHash` judges those five and the check raises `'(set)'`
 * findings against them, so projecting only name/description/engagementType
 * left a finding about `customInstruction`, `aiContextInstruction` or
 * `roundKindBrief` with NOTHING on screen to read it against: the reviewer was
 * told the set's own text was flagged and shown text that could not have been
 * the cause. Absent fields come back as '' so the shape never varies.
 */
function shapeMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const out = {};
  for (const field of SET_FIELDS) out[field] = metaText(m, field);
  // Not a SET_FIELD (the check does not judge it) — the dialog's header prints it.
  out.engagementType = metaText(m, 'engagementType');
  return out;
}

/**
 * The review log, as a record rather than as rows: `PK`/`SK` are storage and
 * are never part of the answer, the same whitelist discipline
 * `moderation-list.js` applies to the pointer. Everything an event recorded
 * survives — the log's `data` bag is deliberately open — but the partition key
 * that would tell a caller how to go looking for other partitions does not.
 */
const shapeLog = (rows) => (rows || []).map(({ PK, SK, ...rest }) => rest); // eslint-disable-line no-unused-vars

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
    meta: shapeMeta(snapshot.meta),
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
    /*
      WHERE THE CHECK'S OWN ACCOUNT IS.

      An org row names its version in the key, so the REVIEW row is at the key
      the sk parses to. ENGAGE'S OWN SET names no version there — `PLATFORM#
      <setId>` is the whole shape §3.2 reserves — so the version comes off the
      pointer, which `upsertQueueRow` records on every row whatever keys it. A
      `0` there is the unversioned partition, which is where most of Engage's
      library still lives, and `toVersion` turns it back into the null that
      `setPartition` reads as "no `#v` suffix".

      A PUBLIC# row is left alone: its REVIEW row belongs to the organisation
      the listing came from, is reached through that organisation's ref rather
      than this key, and is read on the score card instead.
    */
    const scope = parsed.ref.scope;
    const reviewVersion = scope === 'platform' ? toVersion(pointer.version) : parsed.version;
    const review = scope === 'org' || scope === 'platform'
      ? await readReview(db, TABLE(), parsed.ref, reviewVersion)
      : { status: 'unreviewed' };
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
      log: shapeLog(log),
    });
  } catch (error) {
    console.error('❌ moderation get failed:', error);
    return json(500, { error: `Could not open that entry: ${error.message}` });
  }
};
