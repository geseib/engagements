/**
 * THE READER FOR AN ENCRYPTED SAVED REPORT.
 *
 * `save-report.js` writes the report body to S3 as an ENVELOPE, not a PDF —
 * field encryption in DynamoDB does nothing for a PDF sitting in a bucket, and
 * a report is the densest thing in the product: every participant's answer,
 * quoted, with their name against it.
 *
 * SSE-KMS is not an option under the tenant key. The key policy denies
 * `kms:Decrypt` unless an `orgId` encryption context is supplied — that
 * condition is the whole promise, because it makes CloudTrail a per-tenant read
 * log — and S3 supplies its own context built from the object ARN. A put under
 * that key is refused; a put under the default S3 key looks encrypted while
 * binding nothing to a tenant.
 *
 * So the body is encrypted in the application, and this exists because encrypted
 * bytes behind a presigned URL are not a feature. The UI offers "Download Now"
 * and "Copy Link" (GameReport.jsx) — a link somebody sends a colleague. Without
 * a reader that link hands over an unreadable blob, which is a broken button
 * dressed as a security improvement.
 *
 * ── WHY THIS ROUTE IS PUBLIC ───────────────────────────────────────────────
 *
 * It is a bearer URL, exactly as the presigned S3 link it replaces was: holding
 * it is the authorisation. That is a deliberate continuation of how sharing a
 * report already worked, not a new hole — the key names a sanitised title, a
 * date and the four-digit game id, and it is handed out only to whoever pressed
 * Save. Making it authenticated would break sharing the report with the room,
 * which is the feature.
 *
 * What it must NOT do is become an oracle. An object that is not there and an
 * object belonging to a session that no longer exists answer the same 404, and
 * the key is never echoed back in an error.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { decryptValue, isEnvelope } = require('./tenant-crypto');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const NOT_FOUND = {
  statusCode: 404,
  headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: 'That report is not available.' }),
};

async function bodyOf(stream) {
  if (typeof stream.transformToString === 'function') return stream.transformToString();
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const key = (event.queryStringParameters || {}).key;
    if (!gameId || !key) return NOT_FOUND;

    // THE KEY MUST BELONG TO THIS GAME. `key` is a query parameter, so without
    // this a caller could name any object in the bucket — including another
    // organisation's report — and have this handler decrypt it for them. The
    // filename `save-report.js` builds always ends `-<gameId>.pdf[.enc]`, and
    // the only other freedom is the `permanent/` prefix.
    const expected = new RegExp(`-${gameId}\\.pdf(\\.enc)?$`);
    if (!expected.test(key) || key.includes('..')) return NOT_FOUND;
    if (key.includes('/') && !key.startsWith('permanent/')) return NOT_FOUND;

    // The org comes from the SESSION, never from the caller: this route is
    // public and its callers are anonymous.
    const meta = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId',
    }));
    if (!meta.Item) return NOT_FOUND;
    const orgId = typeof meta.Item.orgId === 'string' ? meta.Item.orgId.trim() : '';

    const obj = await s3.send(new GetObjectCommand({
      Bucket: process.env.REPORTS_BUCKET_NAME,
      Key: key,
    }));
    const raw = await bodyOf(obj.Body);

    // A report saved before tenancy, or by an orgless session, is a real PDF
    // already — `isEnvelope` tells them apart exactly rather than by guessing
    // from the extension, which a caller controls.
    let pdfBase64;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* a plain PDF, not JSON */ }

    if (parsed && isEnvelope(parsed)) {
      if (!orgId) return NOT_FOUND;   // ciphertext with no key: unreadable, say so as absence
      pdfBase64 = await decryptValue(orgId, parsed);
    } else {
      pdfBase64 = Buffer.from(raw, 'utf8').toString('base64');
    }

    const filename = key.replace(/^permanent\//, '').replace(/\.enc$/, '');
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      // HTTP APIs return binary this way; without the flag the bytes are
      // delivered as UTF-8 text and the PDF is corrupt on arrival.
      isBase64Encoded: true,
      body: pdfBase64,
    };
  } catch (error) {
    // Never distinguish "no such object" from "cannot decrypt" to a caller.
    console.error('Download report error:', error);
    return NOT_FOUND;
  }
};
