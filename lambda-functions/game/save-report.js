const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { encryptValue, encryptItem, decryptItems } = require('./tenant-crypto');
const { reportsIndexPk, callerMayDriveSession } = require('./tenant');
const { generatePasskey, hashPasskey, normalizePasskey } = require('./report-passkey');

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

    const indexPk = reportsIndexPk(orgId);
    const retentionDays = permanent ? 365 : 90;
    const extension = `.pdf${orgId ? '.enc' : ''}`;

    /*
      ONE REPORT PER SESSION. The owner, 2026-09-23: "creating the report again
      doesn't overwrite it for the same session it creates a new line item.
      Probably wasteful." It did: every save wrote a new REPORT#<game>#<when>
      row and, on another day or the other retention, a new object — and the
      Reports list kept every one. The list's own mockup had taken "a second
      save of one session is a second row" as a decision; the owner reversed it.

      So a save REPLACES what the session already has, and it does so without
      breaking anything the host may already have shared:
        - the PASSKEY is kept. It was given out with the link, and a new one
          would silently lock out everybody who has it.
        - the OBJECT is overwritten in place when the retention is the same, so
          the link stays the same too. Switching between 90 days and a year
          needs the other key (the lifecycle rules are a tag and a prefix), so
          that save moves it and the old link stops; the dialog shows the new.
      The previous rows — this format's one, and any number of the old
      timestamped ones — are removed after the new row is written, with any
      object the new one did not overwrite. A failure there costs a leftover
      row, never the report that was just saved.

      `begins_with('REPORT#<game>')` also matches a longer game id with the
      same prefix, hence the exact gameId filter.
    */
    const previousRes = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': indexPk, ':sk': `REPORT#${gameId}` },
    }));
    const previousRows = (previousRes.Items || []).filter((r) => String(r.gameId) === String(gameId));
    const previous = (orgId ? await decryptItems(orgId, 'reportIndex', previousRows) : previousRows)
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));

    const keptPasskey = previous.map((r) => r.passkey).find((k) => normalizePasskey(k));
    const passkey = keptPasskey || generatePasskey();

    const sameRetention = previous.find((r) => r.s3Key
      && !!r.permanent === !!permanent
      && String(r.s3Key).endsWith(extension)
      && String(r.s3Key).startsWith('permanent/') === !!permanent);

    // Generate filename — or keep the one this session already has.
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedTitle = eventTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
    const fileName = sameRetention
      ? sameRetention.s3Key
      : `${permanent ? 'permanent/' : ''}${sanitizedTitle}-${timestamp}-${gameId}${extension}`;
    const baseFileName = fileName.replace(/^permanent\//, '');

    // The base64 string is what gets encrypted, not the decoded bytes:
    // `encryptValue` JSON-serialises its input, and a Buffer does not survive
    // that round trip — it would come back as `{type:'Buffer',data:[…]}`.
    const objectBody = orgId
      ? Buffer.from(JSON.stringify(await encryptValue(orgId, pdfBlob)), 'utf8')
      : Buffer.from(pdfBlob, 'base64');

    // The second item a shared link needs (report-passkey.js). The object
    // carries only a salted hash of it — S3 metadata is readable by anyone who
    // can list the bucket. The passkey itself is kept on the index row below,
    // encrypted under the org's key, so the team can find it again in Reports.
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


    /*
      THE ROW THAT OUTLIVES THE SESSION. The session's rows expire (7 days
      from start, session-ttl.js) and this was the only record of the report —
      a key in one HTTP response. The list a person will find it in reads this
      partition: per org, or the platform's for an orgless session.

      Its own `ttl` matches the bucket rule for its prefix (template
      ReportsBucket: 90 days, `permanent/` 365), so the row never lists a
      report the bucket has already deleted, give or take DynamoDB's lag. An
      overwrite restarts the object's clock, and this row's with it.

      ONE ROW PER SESSION: the sort key is the session, nothing else, so a
      second save is a PUT over the first.

      `passkey` is on the row so the team can find the link and passkey again
      (the owner: "no way to get the link and passkey back"). Under an org it
      is encrypted with the org's key (tenant-crypto `reportIndex`) — the same
      key that encrypts the report itself, so reading it opens nothing that
      decrypting the report would not. An orgless session's report is a plain
      PDF in the bucket and its row is plaintext; the passkey is too.
    */
    const savedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(savedAt) + retentionDays * 86400000).toISOString();
    const reportSk = `REPORT#${gameId}`;
    const reportRow = {
      PK: indexPk,
      SK: reportSk,
      gameId,
      Title: eventTitle,
      ...(orgId ? { orgId } : {}),
      s3Key: fileName,
      encrypted: !!orgId,
      permanent: !!permanent,
      passkey,
      savedAt,
      expiresAt,
      ttl: Math.floor(Date.parse(savedAt) / 1000) + retentionDays * 86400,
    };
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: orgId ? await encryptItem(orgId, 'reportIndex', reportRow) : reportRow,
    }));

    // Now the session's earlier saves: every other row, and every object the
    // new one did not overwrite. After the new row, never before it.
    let replaced = 0;
    for (const old of previous) {
      try {
        if (old.SK !== reportSk) {
          await db.send(new DeleteCommand({ TableName: process.env.TABLE_NAME, Key: { PK: indexPk, SK: old.SK } }));
          replaced += 1;
        }
        if (old.s3Key && old.s3Key !== fileName) {
          await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.REPORTS_BUCKET_NAME, Key: old.s3Key }));
        }
      } catch (err) {
        console.error(`Save report: could not remove an earlier save (${old.SK}):`, err.message);
      }
    }

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
        // The second item the link needs. The same one as the session's
        // earlier save, if it had one; the team finds it again in Reports.
        passkey,
        // How long the link and passkey work: as long as the report is kept.
        // download-report.js reads the org off the object, not the session, so
        // this is the object's 90 or 365 days, not the session's record.
        shareUntil: expiresAt,
        // How many earlier saves of this session this one replaced.
        replaced
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