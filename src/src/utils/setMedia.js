/**
 * QUESTION-SET IMAGES, CLIENT SIDE.
 *
 * The mirror of `lambda-functions/admin/shared/set-media.js`, and it is a
 * mirror on purpose rather than a second opinion: the browser has to decide
 * which of a question's stored values it may look for in the bucket, and it has
 * to predict the key a file will land on so it can write that key into the
 * CSV cell. Both answers must be the SAME answers the importer's `toMediaKey`
 * (upload-questions.js:73) will give, or the panel reports files as missing
 * that are there.
 *
 * `tests/set-media-contract.js` runs this file and the lambda's module against
 * the same table of inputs and fails if they diverge, which is the same
 * arrangement `utils/questionCategories.js` has with the importer.
 *
 * ── THE THREE STORED SHAPES ───────────────────────────────────────────────
 *
 *   https?://…      remote   somebody else's server. The Art set is all of
 *                            these. Never uploaded, never verified, always
 *                            rendered — this is the remote-URL support the
 *                            owner remembers, and it must keep working.
 *   /…              asset    a repo file shipped inside dist/, /assets/art/….
 *   anything else   key      sets/<setId>/<file> in the media bucket. Ours.
 */

/** Extension -> the one content type we will upload it as. Closed set. */
export const ALLOWED_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

/** 12 MB, matching MAX_BYTES in the lambda's shared/set-media.js. */
export const MAX_BYTES = 12 * 1024 * 1024;

/** Files per presign request, matching MAX_FILES_PER_REQUEST in the lambda. */
export const MAX_FILES_PER_REQUEST = 250;

/**
 * The basename over a conservative alphabet. Separator-stripping happens FIRST,
 * so `../../x` and a Windows picker's `C:\folder\x.png` both reduce to `x`
 * before anything else runs.
 */
export function safeFileName(rawName) {
  const base = String(rawName ?? '').split(/[\\/]/).pop().trim();
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.]+/, '');
  if (!cleaned || cleaned === '-') return '';
  return cleaned.toLowerCase();
}

/** Lowercased extension without the dot, '' when there is none. */
export function extensionOf(fileName) {
  const name = safeFileName(fileName);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1);
}

/** The content type this file will be uploaded as, '' when it is not an image. */
export function contentTypeFor(fileName) {
  return ALLOWED_TYPES[extensionOf(fileName)] || '';
}

/** `sets/<setId>/`, trailing slash included. */
export function mediaPrefix(setId) {
  return `sets/${String(setId ?? '').trim()}/`;
}

/** The key a file lands on, '' when the name reduces to nothing. */
export function mediaKeyFor(setId, fileName) {
  const name = safeFileName(fileName);
  if (!name) return '';
  return `${mediaPrefix(setId)}${name}`;
}

/** 'none' | 'remote' | 'asset' | 'key' — see the header. */
export function classifyImage(rawImage) {
  const image = String(rawImage ?? '').trim();
  if (!image) return 'none';
  if (/^https?:\/\//i.test(image)) return 'remote';
  if (image.startsWith('/')) return 'asset';
  return 'key';
}

/** Is this value an object we can look for in the media bucket? */
export const isMediaKey = (rawImage) => classifyImage(rawImage) === 'key';

/**
 * Does this stored value name a file that is NOT in the bucket?
 *
 * `presentKeys` is the set of keys the verification endpoint found. A remote
 * URL and a repo asset are never missing — they are not ours to find — and a
 * question with no image is not missing an image. Getting this wrong in the
 * permissive direction is harmless; getting it wrong in the strict direction
 * paints a red X on every question in the Art set, which works perfectly.
 */
export function isImageMissing(rawImage, presentKeys) {
  if (!isMediaKey(rawImage)) return false;
  const present = presentKeys instanceof Set ? presentKeys : new Set(presentKeys || []);
  return !present.has(String(rawImage).trim());
}

/**
 * Which of a picked folder's files we will even try to upload, and why not for
 * the rest.
 *
 * `<input webkitdirectory>` hands over EVERY file in the tree — .DS_Store, a
 * Thumbs.db, the CSV the author generated the set from, an entire nested
 * folder of source PSDs. Refusing them at the server would be correct and
 * useless: the author would see a list of forty errors and no upload. Non-image
 * files are therefore SKIPPED SILENTLY as a group and counted, while an image
 * that fails a rule (too big, unusable name) is reported individually, because
 * that one the author meant to upload.
 */
export function planFolderUpload(fileList, setId) {
  const files = Array.from(fileList || []);
  const accepted = [];
  const rejected = [];
  let skipped = 0;
  const byKey = new Map();

  for (const file of files) {
    const rawName = file?.webkitRelativePath || file?.name || '';
    const name = safeFileName(rawName);
    const contentType = contentTypeFor(rawName);

    if (!contentType) { skipped += 1; continue; }
    if (!name) {
      rejected.push({ name: String(rawName), reason: 'That file name has no usable characters in it.' });
      continue;
    }
    if (Number(file.size) > MAX_BYTES) {
      rejected.push({
        name: String(rawName),
        reason: `${(file.size / (1024 * 1024)).toFixed(1)} MB — the ceiling is ${MAX_BYTES / (1024 * 1024)} MB.`,
      });
      continue;
    }
    const key = mediaKeyFor(setId, rawName);
    if (byKey.has(key)) {
      rejected.push({
        name: String(rawName),
        reason: `Another file in this folder also becomes ${key}. Rename one of them.`,
      });
      continue;
    }
    byKey.set(key, rawName);
    accepted.push({ file, name, key, contentType, size: Number(file.size) || 0 });
  }

  return { accepted, rejected, skipped, total: files.length };
}
