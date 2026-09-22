/**
 * GET /reports/download?key=… — a saved report, by a signed-in member.
 *
 * download-report.js (the public bearer route) reads the SESSION's METADATA
 * for the org, which is exactly the row that expires. This route reads the
 * caller's org instead and requires the key to be one of THEIR index rows, so
 * a report can be opened for as long as its row exists — and an org cannot
 * name another org's key, because the lookup is under the caller's own
 * partition.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { callerOrgId, reportsIndexPk } = require('./tenant');
const { decryptValue, isEnvelope } = require('./tenant-crypto');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const NOT_FOUND = { statusCode: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Report not found' }) };

async function bodyOf(stream) {
  if (typeof stream?.transformToString === 'function') return stream.transformToString('utf8');
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

exports.handler = async (event) => {
  try {
    const key = String((event.queryStringParameters || {}).key || '');
    if (!key || key.includes('..')) return NOT_FOUND;
    const orgId = callerOrgId(event);

    // Only a key this caller's partition lists. The rows are few; a Query and
    // a find is simpler than a GSI for something read from one screen.
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': reportsIndexPk(orgId) },
      ProjectionExpression: 's3Key',
    }));
    if (!(res.Items || []).some((r) => r.s3Key === key)) return NOT_FOUND;

    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.REPORTS_BUCKET_NAME, Key: key }));
    const raw = await bodyOf(obj.Body);
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* a plain PDF */ }
    let pdfBase64;
    if (parsed && isEnvelope(parsed)) {
      if (!orgId) return NOT_FOUND;
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
      isBase64Encoded: true,
      body: pdfBase64,
    };
  } catch (error) {
    console.error('Download saved report error:', error);
    return NOT_FOUND;
  }
};
