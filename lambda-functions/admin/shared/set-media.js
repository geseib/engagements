/**
 * WHERE A QUESTION'S IMAGE LIVES, AND WHAT MAY BE PUT THERE.
 *
 * One module, required by the presign route, the verification route and the
 * frontend's mirror (`src/src/utils/setMedia.js`), so "what counts as a key"
 * has exactly one definition. `upload-questions.js`'s `toMediaKey()` is the
 * WRITE side of the same contract and predates this file; `classifyImage()`
 * here is its READ side and the two are pinned against each other in
 * tests/set-media-contract.js. Do not fork either.
 *
 * ── THE THREE STORED SHAPES (toMediaKey, upload-questions.js:73) ───────────
 *
 *   https?://…        stored verbatim   a remote URL. The Art set is entirely
 *                                       this: Wikimedia Special:FilePath links.
 *   /…                stored verbatim   a repo asset, e.g. /assets/art/x.jpg,
 *                                       committed and shipped inside dist/.
 *   anything else     sets/<setId>/…    an uploaded file, in the MEDIA BUCKET.
 *
 * Only the third shape is ours to verify or to upload to. The first two are
 * somebody else's bytes and this module deliberately reports them as
 * unverifiable rather than pretending to check them.
 *
 * ── WHY THE BUCKET IS NOT THE WEBSITE BUCKET ──────────────────────────────
 *
 * All three buildspecs publish the frontend with
 *
 *     aws s3 sync dist/ s3://$BUCKET_NAME/ --delete
 *
 * (buildspec-dev.yml:104, buildspec-test.yml:110, buildspec-prod.yml:116).
 * `--delete` removes every object in the destination that is not in `dist/`.
 * An uploaded image under `sets/<setId>/` is not in `dist/` — the repo assets
 * under `/assets/art/` survive only because they ARE committed and therefore
 * ARE in `dist/`. So images written into the website bucket live exactly until
 * the next deploy of that tier and then vanish, silently, mid-season.
 *
 * A `--exclude "sets/*"` on the sync would work — the filter is applied to the
 * destination listing as well as the source, so excluded keys are not
 * candidates for deletion. It was rejected: it is an unremarkable flag in three
 * files that a copy-paste loses, a hand-run `aws s3 sync … --delete` from a
 * laptop ignores entirely, and its failure is invisible until a room is looking
 * at a broken image. A SEPARATE BUCKET cannot be reached by a sync aimed at the
 * website bucket at all, whatever flags it carries.
 *
 * The images stay same-origin regardless, because CloudFront serves `sets/*`
 * from the media bucket under the site's own hostname (template-clean.yaml,
 * MediaBucket + the `sets/*` cache behaviour). That is what lets the stored
 * value keep going straight into `<img src>` — PlayerPage.jsx:1961,2196 and
 * GameHostPage.jsx:4571,4614,5213 — with no resolver and no change to them.
 */

/** Extensions we will hand out a write credential for, and their one type. */
const ALLOWED_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

/**
 * 12 MB. Above a projector's needs and below the point where a browser upload
 * over conference wifi becomes a support call. Enforced on the DECLARED size at
 * presign time — see media-upload-urls.js for what that does and does not buy.
 */
const MAX_BYTES = 12 * 1024 * 1024;

/** How long a handed-out write credential lives. Long enough for a slow phone
 *  upload of a MAX_BYTES file, short enough that a leaked URL is stale. */
const URL_TTL_SECONDS = 900;

/** Files per presign request. A folder of a season's artwork, not a disk. */
const MAX_FILES_PER_REQUEST = 250;

/**
 * The basename, stripped of anything that could climb out of the prefix or
 * confuse a key.
 *
 * Everything up to and including the last `/` or `\` is discarded FIRST, which
 * is what neutralises `../../` and a Windows folder picker's backslashes in one
 * step: after it there is no separator left to traverse with. What remains is
 * reduced to a conservative alphabet; a name that reduces to nothing is
 * rejected by the caller rather than silently renamed, because an author who
 * cannot see which file failed cannot fix the CSV that references it.
 */
function safeFileName(rawName) {
  const base = String(rawName ?? '').split(/[\\/]/).pop().trim();
  // Leading dots would make a hidden object and, with '..', a traversal.
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.]+/, '');
  if (!cleaned || cleaned === '-') return '';
  // Two names differing only in case are two objects in S3 but one file on a
  // Mac. Lowercasing makes the CSV cell and the uploaded object agree.
  return cleaned.toLowerCase();
}

/** The extension, lowercased, without the dot. '' when there is none. */
function extensionOf(fileName) {
  const name = safeFileName(fileName);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1);
}

/** The content type we will sign for this file, or '' when we will not. */
function contentTypeFor(fileName) {
  return ALLOWED_TYPES[extensionOf(fileName)] || '';
}

/**
 * The media prefix for a set. Trailing slash included, so callers concatenate
 * rather than remembering to.
 *
 * The SET id and never the version — media is per-set and shared across
 * versions on purpose (upload-questions.js:60-62), so a CSV edit does not mean
 * re-uploading the artwork.
 */
function mediaPrefix(setId) {
  return `sets/${String(setId ?? '').trim()}/`;
}

/** The key an uploaded file lands on. '' when the name is unusable. */
function mediaKeyFor(setId, fileName) {
  const name = safeFileName(fileName);
  if (!name) return '';
  return `${mediaPrefix(setId)}${name}`;
}

/**
 * What kind of image reference is this, from the point of view of verification?
 *
 *   'none'    no image on this question
 *   'remote'  http(s) URL — somebody else's server, not ours to check
 *   'asset'   /-rooted — shipped inside dist/, not in the media bucket
 *   'key'     sets/<setId>/… — OURS. This is the only one HeadObject can answer.
 *
 * Mirrors toMediaKey's three branches in the same order and with the same
 * tests, because a value that toMediaKey stores verbatim must never be looked
 * for in the bucket.
 */
function classifyImage(rawImage) {
  const image = String(rawImage ?? '').trim();
  if (!image) return 'none';
  if (/^https?:\/\//i.test(image)) return 'remote';
  if (image.startsWith('/')) return 'asset';
  return 'key';
}

/** Is this stored value an object we can look for in the media bucket? */
const isMediaKey = (rawImage) => classifyImage(rawImage) === 'key';

module.exports = {
  ALLOWED_TYPES,
  MAX_BYTES,
  MAX_FILES_PER_REQUEST,
  URL_TTL_SECONDS,
  safeFileName,
  extensionOf,
  contentTypeFor,
  mediaPrefix,
  mediaKeyFor,
  classifyImage,
  isMediaKey,
};
