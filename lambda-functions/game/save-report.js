const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { encryptValue } = require('./tenant-crypto');

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { eventTitle, pdfBlob, permanent = false } = body;
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    if (!pdfBlob || !eventTitle) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Event title and PDF blob are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📄 Saving PDF report for game ${gameId}: ${eventTitle}`);

    // Verify game exists
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // ── THE HOLE FIELD ENCRYPTION DOES NOT COVER ─────────────────────────────
    //
    // Encrypting `report.detailedQuestions` in DynamoDB does exactly nothing
    // for a PDF of the same material sitting in REPORTS_BUCKET_NAME. This
    // object is the whole session — every answer, every name, every summary —
    // rendered for printing, and until now it was a plain PDF that any
    // presigned URL, any bucket listing and any staff console read straight
    // off. It is the single largest remaining copy of a customer's content.
    //
    // WHY `encryptValue` AND NOT SSE-KMS UNDER THE TENANT KEY. The obvious
    // move — `ServerSideEncryption: 'aws:kms'` with the tenant CMK — CANNOT
    // WORK HERE. The key policy denies `kms:Decrypt` unless
    // `kms:EncryptionContext:orgId` is supplied (that condition is what makes
    // every decrypt name a tenant in CloudTrail, which is the entire promise),
    // and S3 supplies its OWN encryption context built from the object ARN. So
    // an SSE-KMS put under that key would be refused, and — worse — a put under
    // the default S3 key would look encrypted while binding nothing to a
    // tenant at all.
    //
    // WHAT CHANGES FOR CALLERS, said plainly: the stored object is now the
    // envelope JSON, not a PDF, so `downloadUrl` hands back ciphertext that a
    // browser cannot render. The extension says so — `.pdf.enc`, never `.pdf` —
    // and `encrypted: true` comes back in the response. A viewer must go
    // through a handler that decrypts; there is no such reader today, which is
    // recorded in the hand-off rather than hidden behind a filename that lies.
    //
    // An orgless session (created before tenancy, or by a host with no org) has
    // no data key and keeps writing a real PDF, exactly as it did yesterday.
    const orgId = typeof gameMetadata.Item.orgId === 'string' ? gameMetadata.Item.orgId.trim() : '';

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedTitle = eventTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
    const baseFileName = `${sanitizedTitle}-${timestamp}-${gameId}.pdf${orgId ? '.enc' : ''}`;

    // Add prefix for permanent files
    const fileName = permanent ? `permanent/${baseFileName}` : baseFileName;

    // The base64 string is what gets encrypted, not the decoded bytes:
    // `encryptValue` JSON-serialises its input, and a Buffer does not survive
    // that round trip — it would come back as `{type:'Buffer',data:[…]}`.
    const objectBody = orgId
      ? Buffer.from(JSON.stringify(await encryptValue(orgId, pdfBlob)), 'utf8')
      : Buffer.from(pdfBlob, 'base64');

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.REPORTS_BUCKET_NAME,
      Key: fileName,
      Body: objectBody,
      ContentType: orgId ? 'application/json' : 'application/pdf',
      ContentDisposition: `attachment; filename="${baseFileName}"`,
      Metadata: {
        'permanent': permanent ? 'true' : 'false',
        'game-id': gameId,
        // NOT the event title any more. It is `session.Title` — the same string
        // that is ciphertext on the METADATA row — and S3 object metadata is
        // plaintext, listable, and returned by a HEAD. Writing it here would
        // have re-published in the bucket exactly what the table now hides.
        // The org is recorded instead, because a reader needs to know which
        // key opens the object and the orgId is not a secret (it is the
        // encryption context, which CloudTrail logs by design).
        ...(orgId ? { 'org-id': orgId, 'encrypted': 'org' } : {})
      }
    });

    const uploadResult = await s3Client.send(uploadCommand);
    
    // Generate presigned URL for download (valid for 24 hours)
    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.REPORTS_BUCKET_NAME,
      Key: fileName
    });
    
    // WHICH URL THE CALLER GETS, AND WHY IT DIFFERS.
    //
    // An orgless session still stores a real PDF, so a presigned S3 link works
    // and keeps its 24-hour expiry — nothing changes for it.
    //
    // An org's report is an ENVELOPE in the bucket. A presigned link to that
    // hands a browser ciphertext, and the UI's "Copy Link" is meant to be sent
    // to a colleague — so the link goes through `download-report.js`, which
    // decrypts with the SESSION's key and returns a real PDF. It is a bearer
    // URL exactly as the presigned one was: holding it is the authorisation,
    // which is how sharing a report already worked.
    //
    // The API base is not knowable from inside Lambda, so the route is returned
    // RELATIVE and the console resolves it against its own `window.API_BASE`.
    // Hardcoding a host is how `create-game.js` came to point every join link
    // at the retired eng.dev twin for months.
    const downloadUrl = orgId
      ? `games/${gameId}/report/download?key=${encodeURIComponent(fileName)}`
      : await getSignedUrl(s3Client, getObjectCommand, {
        expiresIn: 24 * 60 * 60 // 24 hours in seconds
      });
    
    console.log(`✅ PDF report saved: ${fileName}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        fileName: fileName,
        downloadUrl: downloadUrl,
        s3Location: `s3://${process.env.REPORTS_BUCKET_NAME}/${fileName}`,
        permanent: permanent,
        gameId: gameId,
        eventTitle: eventTitle,
        // Says what the object actually IS, so no caller has to infer it from
        // an extension. False for an orgless session, which still stores a PDF.
        encrypted: !!orgId,
        // `downloadUrl` is RELATIVE when the report is encrypted (it points at
        // this API), and absolute when it is a presigned S3 link. The console
        // has to resolve it rather than assume.
        downloadUrlIsRelative: !!orgId
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Save report error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to save report: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};