/**
 * GET /admin/question-sets/{setId}/media[?version=N]
 *
 * "Are these images in the right place?" — the owner's words, and the whole
 * scope. It answers whether the OBJECT NAMED BY EACH QUESTION EXISTS, not
 * whether the bytes are a valid image, not whether they decode, not their
 * dimensions. A question pointing at a key with nothing behind it is the defect
 * a room actually sees; a corrupt JPEG is a different and much rarer one.
 *
 * ── ONE LIST, NOT N HEADS ─────────────────────────────────────────────────
 *
 * The obvious implementation is HeadObject per referenced key. This lists the
 * set's prefix once instead, and answers every question from that one listing.
 * A 200-question art set is one or two ListObjectsV2 pages rather than 200
 * round trips inside API Gateway's 30s ceiling, and the listing ALSO yields the
 * other half of "mapped to the questions": files sitting in the bucket that no
 * question references. An author who typed `mona-lisa.jpg` in the CSV and
 * uploaded `mona_lisa.jpg` has one missing image and one unused file, and
 * seeing both together is what makes the typo obvious.
 *
 * ── WHAT IS DELIBERATELY NOT CHECKED ──────────────────────────────────────
 *
 * `remote` (http/https) and `asset` (/-rooted) values are counted and reported
 * but never looked for in the bucket. They are stored verbatim by
 * `toMediaKey` (upload-questions.js:73) and they live somewhere this function
 * has no business reaching: Wikimedia's servers, and `dist/` inside the website
 * bucket. Reporting them as "missing" because they are not in the media bucket
 * would condemn the entire Art set, which works.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { resolvePartitionFromMeta, queryPartition } = require('./shared/set-version');
const { requireSetManager } = require('./shared/question-set-access');
const { classifyImage, mediaPrefix } = require('./shared/set-media');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const reply = (statusCode, payload) => ({ statusCode, headers: CORS, body: JSON.stringify(payload) });

/** Every object key under the set's prefix. Paginated; S3 caps a page at 1000. */
async function listPrefix(bucket, prefix) {
  const keys = new Set();
  let token;
  let pages = 0;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const object of (res.Contents || [])) {
      // A zero-byte object is what a failed or aborted upload leaves behind.
      // It is not an image, and reporting it as present is how a broken picture
      // passes verification.
      if (object.Size > 0) keys.add(object.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    pages += 1;
  } while (token && pages < 20);
  return keys;
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

    const setRes = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` },
    }));
    if (!setRes.Item) return reply(404, { error: 'Question set not found' });

    // Reading a set's media is a management action on that set, gated exactly
    // like editing it: it enumerates the set's questions and its stored file
    // names. Same guard, same wording, no second rule to keep in step.
    const refusal = requireSetManager(event, setRes.Item, 'inspect the images of');
    if (refusal) return refusal;

    // The version the games actually play, unless one is asked for — the same
    // resolution get-question-set-questions.js uses, so the editor's Questions
    // panel and this report are looking at the same rows.
    const resolved = resolvePartitionFromMeta(setId, setRes.Item, event?.queryStringParameters?.version);
    const { items } = await queryPartition(db, process.env.TABLE_NAME, resolved.pk, 'QUESTION#');

    const prefix = mediaPrefix(setId);
    const present = await listPrefix(bucket, prefix);

    const counts = { none: 0, remote: 0, asset: 0, key: 0 };
    const missing = [];
    const referenced = new Set();

    const sorted = [...items].sort((a, b) => (a.QuestionNumber || 0) - (b.QuestionNumber || 0));
    for (const item of sorted) {
      const image = String(item.Image ?? item.image ?? '').trim();
      const kind = classifyImage(image);
      counts[kind] += 1;
      if (kind !== 'key') continue;
      referenced.add(image);
      if (!present.has(image)) {
        missing.push({
          sk: item.SK,
          questionNumber: item.QuestionNumber ?? null,
          title: item.Title || item.title || '(untitled)',
          image,
        });
      }
    }

    // Files in the bucket nothing points at. Reported, never deleted: an author
    // may be part-way through renaming CSV cells, and a verification report
    // that quietly removes their uploads is a data loss with a friendly name.
    const unused = [...present].filter((key) => !referenced.has(key)).sort();

    return reply(200, {
      setId,
      version: resolved.version,
      prefix,
      totalQuestions: items.length,
      counts,
      // The number a badge can render without walking the arrays.
      missingCount: missing.length,
      missing,
      unused,
      // Named so a reader of the JSON knows why their Wikimedia URLs are not
      // in `missing` — this endpoint checked what it could check.
      unverifiable: counts.remote + counts.asset,
    });
  } catch (error) {
    console.error('Error reading question set media:', error);
    return reply(500, { error: 'Could not read the images for this question set.' });
  }
};
