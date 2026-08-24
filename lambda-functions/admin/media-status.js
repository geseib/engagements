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
 * `asset` (/-rooted) values are counted and reported but never looked for in
 * the bucket — they live in `dist/` inside the website bucket, shipped by the
 * build, and a report reaching in there would be checking the deploy rather
 * than the set.
 *
 * ── REMOTE URLS ARE NOW CHECKED TOO ───────────────────────────────────────
 *
 * This header used to say remote (http/https) values were "never looked for",
 * and the Art set is why that stopped being good enough: an AI-drafted CSV
 * pointed 26 of 60 questions at Wikimedia files that do not exist, the import
 * said nothing (remote was stored verbatim, unverified by design), and the
 * blanks were discovered on a projector mid-round. A dead link is the same
 * defect to a room as a missing bucket key, so it belongs in the same report.
 *
 * Checked with HEAD (falling back to a 1-byte ranged GET on hosts that refuse
 * HEAD), a short per-request timeout, bounded concurrency, and a hard cap —
 * this must finish inside API Gateway's ceiling, and a slow art host degrades
 * to "unchecked", never to a hung report. A timeout is reported as
 * unreachable rather than dead: to an author, "replace it" and "try again"
 * are different advice.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { resolvePartitionFromMeta, queryPartition } = require('./shared/set-version');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
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

/* ── remote URL verification ─────────────────────────────────────────────── */

/** Per-request timeout. Wikimedia answers a HEAD in well under a second. */
const REMOTE_TIMEOUT_MS = 3500;
/** Concurrent checks. 60 URLs at 12 wide is five waves — seconds, not the ceiling. */
const REMOTE_CONCURRENCY = 12;
/** Hard cap. Past this the rest report as unchecked rather than risk the 30s budget. */
const REMOTE_CHECK_CAP = 120;

/**
 * One URL's verdict: 'ok' | 'dead' | 'unreachable'.
 *
 * 'dead' is a server that answered and said no (404 and friends) — replace the
 * link. 'unreachable' is no answer inside the timeout — maybe the host, maybe
 * the moment; try again before rewriting anything. Redirects are followed, so
 * a Special:FilePath 301 is judged by where it lands.
 */
async function checkRemote(url) {
  const attempt = async (method, extraHeaders) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: extraHeaders,
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await attempt('HEAD');
    // A host that refuses HEAD has not said the FILE is absent. One more try,
    // asking for a single byte so a dead link cannot cost a whole download.
    if (status === 405 || status === 501) {
      status = await attempt('GET', { Range: 'bytes=0-0' });
    }
    return status < 400 ? { verdict: 'ok', status } : { verdict: 'dead', status };
  } catch (e) {
    return { verdict: 'unreachable', status: 0 };
  }
}

/** All verdicts, `REMOTE_CONCURRENCY` at a time, capped at `REMOTE_CHECK_CAP`. */
async function checkRemotes(entries) {
  const toCheck = entries.slice(0, REMOTE_CHECK_CAP);
  const results = new Array(toCheck.length);
  let next = 0;
  const worker = async () => {
    while (next < toCheck.length) {
      const i = next;
      next += 1;
      results[i] = await checkRemote(toCheck[i].image);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(REMOTE_CONCURRENCY, toCheck.length) }, worker,
  ));
  return {
    checked: toCheck.map((entry, i) => ({ ...entry, ...results[i] })),
    unchecked: entries.length - toCheck.length,
  };
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

    // WHICH LIBRARY, THEN WHO. `findSetForCaller` searches only the scopes this
    // caller may READ, so another organisation's set is ABSENT rather than
    // forbidden and this 404s on it. The row carries its own scope and
    // `requireSetManager` reads it — see shared/question-set-access.js.
    const found = await findSetForCaller(
      db, process.env.TABLE_NAME, event, setId, requestedScope(event)
    );
    const setRes = { Item: found && found.item };
    if (!setRes.Item) return reply(404, { error: 'Question set not found' });

    // Reading a set's media is a management action on that set, gated exactly
    // like editing it: it enumerates the set's questions and its stored file
    // names. Same guard, same wording, no second rule to keep in step.
    const refusal = requireSetManager(event, setRes.Item, 'inspect the images of');
    if (refusal) return refusal;

    // The version the games actually play, unless one is asked for — the same
    // resolution get-question-set-questions.js uses, so the editor's Questions
    // panel and this report are looking at the same rows.
    const resolved = resolvePartitionFromMeta(found.ref, setRes.Item, event?.queryStringParameters?.version);
    const { items } = await queryPartition(db, process.env.TABLE_NAME, resolved.pk, 'QUESTION#');

    const prefix = mediaPrefix(setId);
    const present = await listPrefix(bucket, prefix);

    const counts = { none: 0, remote: 0, asset: 0, key: 0 };
    const missing = [];
    const referenced = new Set();

    const remoteEntries = [];
    const sorted = [...items].sort((a, b) => (a.QuestionNumber || 0) - (b.QuestionNumber || 0));
    for (const item of sorted) {
      const image = String(item.Image ?? item.image ?? '').trim();
      const kind = classifyImage(image);
      counts[kind] += 1;
      if (kind === 'remote') {
        remoteEntries.push({
          sk: item.SK,
          questionNumber: item.QuestionNumber ?? null,
          title: item.Title || item.title || '(untitled)',
          image,
        });
      }
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

    // The dead-link half of the report — see the header for why remote joined.
    const { checked: remoteChecked, unchecked: remoteUnchecked } = await checkRemotes(remoteEntries);
    const deadRemote = remoteChecked.filter((r) => r.verdict !== 'ok');

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
      /*
        Remote links, verified live. `deadRemote` rows carry a `verdict` —
        'dead' (the server answered and said no: replace the link) or
        'unreachable' (no answer inside the timeout: try again first) — and
        the HTTP status where there was one. `remoteUnchecked` counts URLs
        past the safety cap, so silence past it cannot read as "all fine".
      */
      deadRemoteCount: deadRemote.length,
      deadRemote,
      remoteChecked: remoteChecked.length,
      remoteUnchecked,
      // Only /-rooted repo assets remain unverifiable — remote is checked now.
      unverifiable: counts.asset,
    });
  } catch (error) {
    console.error('Error reading question set media:', error);
    return reply(500, { error: 'Could not read the images for this question set.' });
  }
};
