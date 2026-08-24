/**
 * POST /admin/question-sets/{setId}/media/uploads
 *
 * Hands the browser one presigned PUT URL per file so a folder of artwork goes
 * straight from the author's disk into the media bucket. Nothing about the
 * image passes through this Lambda or through API Gateway — a 10 MB base64
 * body would not fit API Gateway's 10 MB payload limit anyway, and would cost
 * a Lambda's memory and duration to move bytes it never looks at.
 *
 * ── A PRESIGNED PUT IS A WRITE CREDENTIAL HANDED TO A BROWSER ──────────────
 *
 * Four things bound it, and it is worth being exact about which are enforced
 * by S3 and which are only enforced here:
 *
 *  1. THE KEY — chosen by this handler, never by the caller. The caller sends a
 *     file NAME; `mediaKeyFor` reduces it to a basename over a conservative
 *     alphabet and prefixes `sets/<setId>/`. There is no request field that can
 *     move the object. ENFORCED BY S3: the key is inside the signature.
 *
 *  2. THE PREFIX AND THE BUCKET — the execution role can put objects under
 *     `${MediaBucket}/sets/*` and nothing else (template-clean.yaml). A
 *     presigned URL is the intersection of the signer's own permissions and the
 *     signed request, so even a signing bug cannot produce a URL that writes
 *     the website bucket. ENFORCED BY IAM.
 *
 *  3. THE CONTENT TYPE — signed into the request, from the file's EXTENSION via
 *     the closed `ALLOWED_TYPES` map, never from a caller-supplied `type`
 *     string. The browser must send exactly that header or S3 rejects the
 *     signature. ENFORCED BY S3.
 *
 *  4. THE SIZE — checked against `MAX_BYTES` on the size the caller DECLARES,
 *     and re-checked in the browser before the PUT. NOT ENFORCED BY S3, and
 *     this is the one honest gap: a presigned PUT carries no content-length
 *     condition, so a caller who has already authenticated as a host or admin,
 *     and has already been given a URL for one specific key, could PUT more
 *     bytes to that key than they declared. The upgrade, if that ever matters,
 *     is `createPresignedPost` with a `content-length-range` condition, which
 *     costs a multipart form on the client. Deliberately not taken here: the
 *     residual risk is an authenticated privileged user wasting storage on a
 *     key they were entitled to write, and the bucket's lifecycle rule bounds
 *     the bill.
 *
 * And the same ownership rule as every other set mutation: `requireSetManager`
 * — an admin may load any set's media, a host only the sets they created.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
const {
  MAX_BYTES,
  MAX_FILES_PER_REQUEST,
  URL_TTL_SECONDS,
  contentTypeFor,
  extensionOf,
  mediaKeyFor,
  mediaPrefix,
  safeFileName,
} = require('./shared/set-media');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const reply = (statusCode, payload) => ({ statusCode, headers: CORS, body: JSON.stringify(payload) });

/**
 * Why this file will not be signed for, in words the author can act on.
 * Returns '' when the file is acceptable.
 */
function refusalFor(file) {
  const rawName = file && typeof file === 'object' ? file.name : file;
  const name = safeFileName(rawName);
  if (!name) return 'That file name has no usable characters in it.';

  const extension = extensionOf(name);
  if (!extension) return `"${name}" has no file extension, so there is no way to tell what it is.`;
  if (!contentTypeFor(name)) {
    return `"${name}" is a .${extension} file. Only images are accepted here.`;
  }

  // `size` absent is accepted: a caller that cannot report a size is not
  // thereby granted a bigger upload, because MAX_BYTES was never enforceable
  // by the signature in the first place (see the header). A size that IS
  // reported and is over the ceiling is refused, so the common case — someone
  // dragging in a folder of camera originals — fails here with an explanation
  // instead of failing at S3 with a signature error.
  const size = Number(file && file.size);
  if (Number.isFinite(size) && size > MAX_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return `"${name}" is ${mb} MB. The ceiling is ${MAX_BYTES / (1024 * 1024)} MB.`;
  }
  return '';
}

exports.handler = async (event) => {
  try {
    const setId = event?.pathParameters?.setId;
    if (!setId) return reply(400, { error: 'Set ID is required' });

    const bucket = process.env.MEDIA_BUCKET;
    if (!bucket) {
      console.error('MEDIA_BUCKET is not set on this function');
      return reply(500, { error: 'Image storage is not configured in this environment.' });
    }

    let payload;
    try {
      payload = JSON.parse(event?.body || '{}');
    } catch (e) {
      return reply(400, { error: 'Request body is not valid JSON.' });
    }

    const files = Array.isArray(payload.files) ? payload.files : null;
    if (!files || files.length === 0) {
      return reply(400, { error: 'Send a files array: [{ name, size }].' });
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      return reply(400, {
        error: `${files.length} files in one request. The ceiling is ${MAX_FILES_PER_REQUEST}; `
          + 'upload the folder in batches.',
      });
    }

    // THE SET, AND WHO OWNS IT — read before a single URL is signed.
    // WHICH LIBRARY, THEN WHO. `findSetForCaller` searches only the scopes this
    // caller may READ, so another organisation's set is ABSENT rather than
    // forbidden and this 404s on it. The row carries its own scope and
    // `requireSetManager` reads it — see shared/question-set-access.js.
    const found = await findSetForCaller(
      db, process.env.TABLE_NAME, event, setId, requestedScope(event)
    );
    const setRes = { Item: found && found.item };
    if (!setRes.Item) return reply(404, { error: 'Question set not found' });

    const refusal = requireSetManager(event, setRes.Item, 'upload images to');
    if (refusal) return refusal;

    const uploads = [];
    const rejected = [];
    // Two files reducing to the same key would race, and the second silently
    // wins. Report it instead — the author has two files the CSV cannot tell
    // apart, which is a problem in their folder, not in this request.
    const claimed = new Map();

    for (const file of files) {
      const original = String((file && file.name) || file || '');
      const reason = refusalFor(file);
      if (reason) {
        rejected.push({ name: original, reason });
        continue;
      }
      const key = mediaKeyFor(setId, original);
      if (claimed.has(key)) {
        rejected.push({
          name: original,
          reason: `"${original}" and "${claimed.get(key)}" both become ${key}. Rename one.`,
        });
        continue;
      }
      claimed.set(key, original);

      const contentType = contentTypeFor(original);
      const url = await getSignedUrl(s3, new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }), { expiresIn: URL_TTL_SECONDS });

      uploads.push({
        name: original,
        // The value that belongs in the CSV's Image cell. The importer's
        // toMediaKey is idempotent over it, so a downloaded-and-re-uploaded CSV
        // does not grow the prefix.
        key,
        fileName: safeFileName(original),
        contentType,
        url,
      });
    }

    console.log(`🖼️ signed ${uploads.length} upload URL(s) for set ${setId}, ${rejected.length} refused`);

    return reply(200, {
      setId,
      prefix: mediaPrefix(setId),
      expiresIn: URL_TTL_SECONDS,
      maxBytes: MAX_BYTES,
      uploads,
      rejected,
    });
  } catch (error) {
    console.error('Error signing media upload URLs:', error);
    return reply(500, { error: 'Could not prepare the image upload.' });
  }
};

// Exported for tests.
module.exports.refusalFor = refusalFor;
