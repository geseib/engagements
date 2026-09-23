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
 * ── WHY THIS ROUTE IS PUBLIC, AND WHY THE LINK IS NOT ENOUGH ──────────────
 *
 * It stays public because sharing a report with somebody who has no account is
 * the feature. It was a bearer URL — holding the link was the authorisation —
 * and that was a hole, not a continuation of the presigned link it replaced: a
 * presigned URL carries a signature nobody can guess, and this key is
 * `<sanitised title>-<date>-<gameId>.pdf.enc`, which everyone in the room knows
 * all of. Anyone there could build the link and read the whole session.
 *
 * So the link is now one of TWO items. The other is the passkey save-report.js
 * minted for this report and gave the host (report-passkey.js), presented in
 * the `X-Report-Passkey` header — a header, not the query string, so it is not
 * in a link somebody forwards, in browser history, or in an access log. It is
 * checked against the salted hash on the object BEFORE the body is read. A
 * report saved before passkeys existed has no hash and opens for nobody here;
 * its team still opens it from Reports (download-saved-report.js).
 *
 * What it must NOT do is become an oracle. No passkey, a wrong passkey, an
 * object that is not there and an object belonging to a session that no longer
 * exists all answer the same 404, and the key is never echoed back in an error.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { decryptValue, isEnvelope } = require('./tenant-crypto');
const { verifyPasskey } = require('./report-passkey');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const NOT_FOUND = {
  statusCode: 404,
  headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  // One sentence for every refusal, so a mistyped passkey and a report that
  // does not exist cannot be told apart — and the recipient still learns what
  // to check.
  body: JSON.stringify({ error: 'No report matches that link and passkey.' }),
};

/*
  BYTES, NOT TEXT. This used `transformToString()`, which decodes as UTF-8: fine
  for an envelope (JSON), but a plain PDF is binary and invalid sequences were
  replaced on the way through, so an orgless report arrived corrupt. Every
  share link comes through here now, orgless ones included.
*/
async function bytesOf(stream) {
  if (typeof stream.transformToByteArray === 'function') return Buffer.from(await stream.transformToByteArray());
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/** HTTP API lowercases header names; a test or another integration may not. */
function headerOf(event, name) {
  const headers = event.headers || {};
  const want = name.toLowerCase();
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === want);
  return hit ? headers[hit] : '';
}

/** Let go of a body we have decided not to read, so the socket is released. */
function discard(stream) {
  try { if (stream && typeof stream.destroy === 'function') stream.destroy(); } catch { /* nothing to free */ }
}

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const key = (event.queryStringParameters || {}).key;
    const passkey = headerOf(event, 'x-report-passkey');
    if (!gameId || !key || !passkey) return NOT_FOUND;

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
    // The passkey before a single byte of the body. S3 hands user metadata
    // back lower-cased and without the x-amz-meta- prefix.
    const stored = obj.Metadata || {};
    if (!(await verifyPasskey(passkey, stored['passkey-salt'], stored['passkey-hash']))) {
      discard(obj.Body);
      return NOT_FOUND;
    }
    const bytes = await bytesOf(obj.Body);

    // A report saved before tenancy, or by an orgless session, is a real PDF
    // already — `isEnvelope` tells them apart exactly rather than by guessing
    // from the extension, which a caller controls.
    let pdfBase64;
    let parsed = null;
    // A PDF begins `%PDF-`; only something that could be JSON is parsed.
    if (bytes[0] === 0x7b) {
      try { parsed = JSON.parse(bytes.toString('utf8')); } catch { /* not JSON after all */ }
    }

    if (parsed && isEnvelope(parsed)) {
      if (!orgId) return NOT_FOUND;   // ciphertext with no key: unreadable, say so as absence
      pdfBase64 = await decryptValue(orgId, parsed);
    } else {
      pdfBase64 = bytes.toString('base64');
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
