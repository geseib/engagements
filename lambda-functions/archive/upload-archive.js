const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({});

/*
  S3 USER METADATA IS AN HTTP HEADER, AND ONE EM DASH IN A TITLE 500ed THE UPLOAD.

  Reported 2026-08-15: exporting AI prompts to the archive, the four TRIVIA
  prompts for the demo quiz sets each came back

      500 "Failed to upload archive item"

  while the four call-and-answer prompts in the same batch went through. It has
  nothing to do with trivia. The trivia prompts are named "Workie — <thing>"
  with U+2014 EM DASH; the call-and-answer ones are "Workie - <thing>" with an
  ASCII hyphen. That single character was the entire difference, and it arrived
  in a batch of prompt files written the same morning.

  `Metadata` on a PutObjectCommand is transmitted verbatim as the `x-amz-meta-*`
  REQUEST HEADERS. Node's http layer validates every header value against
  checkInvalidHeaderChar — /[^\t\x20-\x7e\x80-\xff]/ — and throws

      TypeError [ERR_INVALID_CHAR]: Invalid character in header content ["x-amz-meta-title"]

  before a single byte reaches S3. Measured against this repo's SDK
  (@aws-sdk/client-s3 3.1107.0) the boundary is exact: U+007E passes, U+007F
  throws, U+00A0 through U+00FF pass, U+0100 and everything above it — em dash,
  curly quotes, emoji — throws. The throw lands in the handler's catch below,
  which reports a generic 500 naming no field, no character and no record.

  Note the direction of the payload sizes, because the obvious guess is wrong
  and it is wrong BACKWARDS: the four that failed carry ~4.0-4.4 KB of prompt
  body, the four that succeeded ~6.5-7.3 KB. The failures are the SMALL ones.

  A title is free text a human typed, so it will carry em dashes, curly quotes
  and accents forever; sanitising the callers is whack-a-mole. Encode it here,
  once, at the only place that puts it in a header. Printable US-ASCII passes
  through untouched so the common case stays readable to anyone browsing the
  bucket; anything else becomes an RFC 2047 encoded-word, which is the standard
  way to carry non-ASCII text in a header and is reversible, rather than
  transliterated or dropped.

  Why not simply allow \x80-\xff through, since Node does? Because S3 documents
  user-defined metadata as US-ASCII. Those bytes happen to survive today via an
  undocumented path (the SDK puts them on the wire UTF-8-encoded, so they at
  least match what SigV4 signed), and a fix for a header bug should not rest on
  that.

  Nothing in this repo ever reads x-amz-meta-title — the authoritative title is
  the DynamoDB `Title` attribute written below, which is what get-archive-item.js
  returns. So this value only has to be safe and recognisable, never parsed.
*/
const METADATA_VALUE_MAX_SOURCE_BYTES = 512;

function truncateUtf8(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  // Cut on a character boundary. Slicing mid-sequence and decoding yields
  // U+FFFD, which would then be base64'd and preserved as garbage forever.
  // Written as an escape, not a literal replacement character, so the guard
  // cannot be silently destroyed by a re-encoding of this file.
  return buf.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '');
}

function toHeaderSafeMetadataValue(value) {
  // S3 caps ALL user metadata at 2 KB of keys plus values combined, so bound the
  // source BEFORE encoding — truncating base64 afterwards produces a value that
  // cannot be decoded at all.
  const text = truncateUtf8(String(value == null ? '' : value), METADATA_VALUE_MAX_SOURCE_BYTES);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

exports.toHeaderSafeMetadataValue = toHeaderSafeMetadataValue;

exports.handler = async (event) => {
  /*
    WHICH RECORD, WHICH STEP, AND WHY.

    This handler used to answer every internal failure with a flat
    500 {"error":"Failed to upload archive item"} — no title, no step, no
    exception name. That message is the reason the em-dash bug above survived a
    reproduction: the caller could see four records fail and four succeed and
    had nothing to correlate. `step` is updated as the handler advances so the
    catch can say where it died even for an exception nobody predicted.
  */
  let step = 'parse-request';
  let title;
  let archiveId;
  try {
    // Parse the request body
    const body = JSON.parse(event.body || '{}');
    const { description, content, contentType, category, tags, fileName } = body;
    ({ title } = body);

    if (!title || !content || !contentType) {
      /*
        SAY WHICH ONE. The old text named all three unconditionally, so an
        empty CSV produced by a failed read (338af103) read as "all three
        fields are wrong" when two of them were fine. Naming the empty field
        is the difference between a five-minute fix and an afternoon.
      */
      const missing = [
        !title && 'title',
        !content && 'content',
        !contentType && 'contentType'
      ].filter(Boolean);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Missing or empty: ${missing.join(', ')}. `
            + `Received title=${JSON.stringify(title || '')}, `
            + `contentType=${JSON.stringify(contentType || '')}, `
            + `content length=${content ? String(content).length : 0}.`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📤 Uploading archive item: ${title}`);

    // Generate unique ID for the archive item
    archiveId = uuidv4();
    const timestamp = new Date().toISOString();

    // Determine file extension based on content type
    const fileExtension = contentType === 'questionset' ? '.csv' : 
                         contentType === 'document' ? '.txt' : 
                         contentType === 'template' ? '.json' : '.txt';
    
    // Create S3 key for content storage
    const s3Key = `archive/${contentType}/${archiveId}${fileExtension}`;
    
    // Upload content to S3
    step = 's3-put-content';
    await s3.send(new PutObjectCommand({
      Bucket: process.env.ARCHIVE_BUCKET_NAME,
      Key: s3Key,
      Body: content,
      ContentType: 'text/plain',
      Metadata: {
        archiveId: archiveId,
        // Free text. MUST go through toHeaderSafeMetadataValue — see the note
        // at the top of this file; a raw em dash here throws ERR_INVALID_CHAR
        // and becomes an unexplained 500.
        title: toHeaderSafeMetadataValue(title),
        uploadedAt: timestamp
      }
    }));
    
    console.log(`✅ Content uploaded to S3: ${s3Key}`);
    
    // Store metadata in DynamoDB
    const archiveItem = {
      PK: 'ARCHIVE',
      SK: `ITEM#${archiveId}`,
      ArchiveId: archiveId,
      Title: title,
      Description: description || '',
      ContentType: contentType,
      Category: category || 'general',
      Tags: tags || [],
      FileName: fileName || `${title}${fileExtension}`,
      S3Key: s3Key,
      FileSize: Buffer.byteLength(content, 'utf8'),
      UploadedBy: event.requestContext?.authorizer?.claims?.sub || 'anonymous',
      CreatedAt: timestamp,
      UpdatedAt: timestamp,
      Version: 1,
      Status: 'active'
    };
    
    step = 'dynamodb-put-metadata';
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: archiveItem
    }));
    
    console.log(`✅ Metadata stored in DynamoDB for archive ID: ${archiveId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        archiveId: archiveId,
        item: archiveItem,
        message: 'Archive item uploaded successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error(`Upload archive error at step "${step}" for title ${JSON.stringify(title || '')}:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `Failed to upload archive item at step "${step}"`,
        step,
        title: title || null,
        archiveId: archiveId || null,
        // Both, because they carry different halves of the identity: AWS
        // service faults land in `name` (ValidationException, AccessDenied)
        // while Node's own faults land in `code` (ERR_INVALID_CHAR — the em
        // dash bug, whose `name` is only the useless "TypeError").
        exception: error.name,
        code: error.code || null,
        details: error.message
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};