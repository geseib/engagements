const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { encryptValue, encryptItem } = require('./tenant-crypto');
const { reportsIndexPk, callerMayDriveSession } = require('./tenant');
const { generatePasskey, hashPasskey } = require('./report-passkey');

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

    /*
      WHOSE SESSION IS THIS? This route was PUBLIC: a four-digit code and no
      identity put an object in the reports bucket and a REPORT# row in the
      owning org's Reports list, its Title encrypted under that org's key. It
      carries the Cognito authorizer now (template-clean.yaml, SaveReportEvent)
      and this asks the same question create-report.js does, 404 rather than
      403 for the reason tenant.callerMayDriveSession gives.

      NO IDENTITY IS REFUSED HERE TOO, as comments.js's feature route does.
      `callerMayDriveSession` passes a caller with no groups — the participant
      journey is never gated — so on its own it would let anyone save against
      an orgless session the day this route lost its authorizer. A saved report
      is never a participant's act.

      Everything below — the S3 put and the index row — sits after this, so a
      refused caller writes nothing.
    */
    const authorizer = event?.requestContext?.authorizer;
    const identity = authorizer?.jwt?.claims || authorizer?.lambda;
    if (!gameMetadata.Item || !identity || !callerMayDriveSession(event, gameMetadata.Item)) {
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

    // The second item a shared link needs (report-passkey.js). Only its salted
    // hash is stored, on the object it opens; the passkey itself goes back to
    // the host in this response and is never written or logged anywhere.
    const passkey = generatePasskey();
    const passkeyHash = await hashPasskey(passkey);

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.REPORTS_BUCKET_NAME,
      Key: fileName,
      Body: objectBody,
      ContentType: orgId ? 'application/json' : 'application/pdf',
      ContentDisposition: `attachment; filename="${baseFileName}"`,
      // The bucket's 90-day rule is filtered on this tag so it cannot reach
      // `permanent/` (S3 lifecycle has no "every prefix but one"). A tagged
      // PutObject also needs s3:PutObjectTagging, which S3CrudPolicy does NOT
      // grant — the template adds it explicitly. Without it this line made
      // every standard save AccessDenied (tests/s3-tagging-permission.js).
      ...(permanent ? {} : { Tagging: 'retention=standard' }),
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
        ...(orgId ? { 'org-id': orgId, 'encrypted': 'org' } : {}),
        // What download-report.js checks a presented passkey against. A salted
        // scrypt hash, not the passkey: this metadata is readable by anyone who
        // can list the bucket.
        'passkey-salt': passkeyHash.salt,
        'passkey-hash': passkeyHash.hash
      }
    });

    const uploadResult = await s3Client.send(uploadCommand);
    
    // THE SHARE LINK, FOR EVERY REPORT, GOES THROUGH download-report.js.
    //
    // An org's report is an ENVELOPE in the bucket, so a presigned S3 link would
    // hand a browser ciphertext; an orgless session's was a presigned link to a
    // plain PDF. Both now share one route, because that route is where the
    // passkey is checked, and a presigned link would be a way around it. The
    // link alone opens nothing: the recipient also needs `passkey`, which the
    // host gives out separately.
    //
    // The API base is not knowable from inside Lambda, so the route is returned
    // RELATIVE and the console resolves it against its own `window.API_BASE`.
    // Hardcoding a host is how `create-game.js` came to point every join link
    // at the retired eng.dev twin for months.
    const downloadUrl = `games/${gameId}/report/download?key=${encodeURIComponent(fileName)}`;

    // How long the link and passkey work. download-report.js reads the org off
    // the session's METADATA row, so the public route opens a report exactly as
    // long as that row lives — its `ttl` (session-ttl.js), not the object's 90
    // or 365 days. After that the team opens it from Reports instead.
    const sessionTtl = Number(gameMetadata.Item.ttl);
    const shareUntil = Number.isFinite(sessionTtl) && sessionTtl > 0
      ? new Date(sessionTtl * 1000).toISOString()
      : null;

    /*
      THE ROW THAT OUTLIVES THE SESSION. The session's rows expire (7 days
      from start, session-ttl.js) and this was the only record of the report —
      a key in one HTTP response. The list a person will find it in reads this
      partition: per org, or the platform's for an orgless session.

      Its own `ttl` matches the bucket rule for its prefix (template
      ReportsBucket: 90 days, `permanent/` 365), so the row never lists a
      report the bucket has already deleted, give or take DynamoDB's lag.
    */
    const savedAt = new Date().toISOString();
    const retentionDays = permanent ? 365 : 90;
    const reportRow = {
      PK: reportsIndexPk(orgId),
      // A short random tail after the timestamp: two saves of one session in
      // the same millisecond would otherwise be one row, and the second would
      // silently overwrite the first (seen in tests/report-index-row.js).
      SK: `REPORT#${gameId}#${savedAt}#${crypto.randomBytes(3).toString('hex')}`,
      gameId,
      Title: eventTitle,
      ...(orgId ? { orgId } : {}),
      s3Key: fileName,
      encrypted: !!orgId,
      permanent: !!permanent,
      savedAt,
      expiresAt: new Date(Date.parse(savedAt) + retentionDays * 86400000).toISOString(),
      ttl: Math.floor(Date.parse(savedAt) / 1000) + retentionDays * 86400,
    };
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: orgId ? await encryptItem(orgId, 'reportIndex', reportRow) : reportRow,
    }));

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
        // `downloadUrl` is always RELATIVE now (it points at this API). Kept
        // so a console that still branches on it resolves it correctly.
        downloadUrlIsRelative: true,
        // Shown to the host once, here, and nowhere else. Lose it and the
        // report is saved again for a new one; the team still has Reports.
        passkey,
        shareUntil
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