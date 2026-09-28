/**
 * A PRESENTATION'S SLIDES IN STORAGE — one PDF per presentation item, in the
 * question-set media bucket (template-clean.yaml, "Question-set MEDIA"), moved
 * by presigned URLs so no slide passes through API Gateway (whose payload stops
 * at 10 MB) or a Lambda. The owner, 27 Sep 2026: "can the presentation show pdf
 * presentation with arrow key forward/backward through the pages?"
 *
 * ── WHERE A DECK LIVES ─────────────────────────────────────────────────────
 *   staging/decks/<org>/<code>/<nonce>.pdf   what a browser uploads to; a
 *                                            one-day lifecycle rule
 *                                            (ExpireStagedDecks) takes any
 *                                            upload nobody attached
 *   decks/<org>/<code>/<nonce>.pdf           an attached deck, copied here by
 *                                            the item route once the file is
 *                                            proven a PDF
 * `<org>` is a one-way tag of the organisation's id (`orgTag`), never the id:
 * a phone that reads the slides sees the key inside its URL, and the public
 * agenda never names the organisation (get-agenda.js). `<nonce>` is fresh per
 * upload, so a replaced deck is a new object and no cache can serve the old
 * one under the new name.
 *
 * ── NOTHING HERE IS PUBLIC ─────────────────────────────────────────────────
 * The media bucket's public read covers `sets/*` (question artwork) and
 * nothing else; a deck is read ONLY through a presigned GET minted after a
 * door: the host's (items.js, through event-store.openEvent), or the public
 * agenda's for an item the host has started (get-agenda.js, `view=deck`).
 * Decks are not app-encrypted per organisation (RATIONALE decision 5 drew them
 * sealed like saved reports); the bucket encrypts at rest, and the reason they
 * are not sealed is that a sealed deck must be opened by a Lambda, whose
 * response stops near 6 MB — a stage showing a 50 MB deck cannot go through it.
 *
 * ── A PRESIGNED PUT IS A WRITE CREDENTIAL ─────────────────────────────────
 * The media route's four bounds (admin/media-upload-urls.js), here:
 *  1. THE KEY is chosen here, never by the caller. ENFORCED BY S3.
 *  2. THE PREFIX: the role may put under `staging/decks/*` and `decks/*` and
 *     nowhere else in the bucket (template-clean.yaml). ENFORCED BY IAM.
 *  3. THE CONTENT TYPE is signed as application/pdf. ENFORCED BY S3.
 *  4. THE SIZE is checked on what the browser declares, and AGAIN on the
 *     object itself before it is attached (`verifyStaged`): a staged object
 *     over the ceiling, or one whose first bytes are not `%PDF-`, is refused
 *     and deleted, and never becomes anybody's deck.
 *
 * The S3 SDK is required on first use, not at load: most of this function's
 * routes never touch a deck, and every event suite loads items.js.
 */
const crypto = require('crypto');
const rules = require('./agenda-rules');

const STAGING_PREFIX = 'staging/decks/';
const DECK_PREFIX = 'decks/';
const UPLOAD_TTL_SECONDS = 15 * 60;
/**
 * A read URL is used once — the stage or a phone fetches the whole file and
 * keeps it — so it need only outlive one slow download on a venue's network.
 */
const READ_TTL_SECONDS = 30 * 60;
/** The PDF header may sit anywhere in a file's first 1024 bytes (ISO 32000 §7.5.2). */
const HEAD_BYTES = 1024;
const MAGIC = Buffer.from('%PDF-', 'latin1');

let client = null;
const sdk = () => require('@aws-sdk/client-s3');
function s3() {
  if (!client) client = new (sdk().S3Client)({});
  return client;
}
const bucket = () => process.env.MEDIA_BUCKET || '';

/** The organisation, as a key segment that does not name it. */
const orgTag = (orgId) => crypto.createHash('sha256').update(`deck:${String(orgId || '')}`).digest('hex').slice(0, 16);

const scope = (orgId, code) => `${orgTag(orgId)}/${code}/`;
const NONCE = '[0-9a-f]{16}\\.pdf';
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** A key an upload for this event was signed for. */
const isStagingKeyFor = (key, orgId, code) => new RegExp(`^${escape(STAGING_PREFIX + scope(orgId, code))}${NONCE}$`)
  .test(String(key || ''));
/** A key an attached deck of this event lives at. */
const isDeckKeyFor = (key, orgId, code) => new RegExp(`^${escape(DECK_PREFIX + scope(orgId, code))}${NONCE}$`)
  .test(String(key || ''));
const deckKeyOf = (stagingKey) => DECK_PREFIX + String(stagingKey).slice(STAGING_PREFIX.length);
/**
 * A deck's id: its nonce, which names one upload and nothing else (not the
 * organisation, not the event). The stage and the builder tell one deck from
 * its replacement by it.
 */
const deckIdOf = (key) => (/([0-9a-f]{16})\.pdf$/.exec(String(key || '')) || [])[1] || '';

/**
 * One presigned PUT for a new deck of this event.
 * @returns {Promise<{key, url, contentType, expiresIn, maxBytes}>}
 */
async function presignUpload(orgId, code) {
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const key = `${STAGING_PREFIX}${scope(orgId, code)}${crypto.randomBytes(8).toString('hex')}.pdf`;
  const url = await getSignedUrl(s3(), new (sdk().PutObjectCommand)({
    Bucket: bucket(), Key: key, ContentType: rules.DECK_TYPE,
  }), { expiresIn: UPLOAD_TTL_SECONDS });
  return { key, url, contentType: rules.DECK_TYPE, expiresIn: UPLOAD_TTL_SECONDS, maxBytes: rules.DECK_MAX_BYTES };
}

/** A presigned GET for an attached deck. */
async function presignRead(key) {
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(s3(), new (sdk().GetObjectCommand)({
    Bucket: bucket(), Key: key, ResponseContentType: rules.DECK_TYPE,
  }), { expiresIn: READ_TTL_SECONDS });
}

/** The object's total size, from a ranged GET's `Content-Range: bytes 0-1023/<total>`. */
function totalSize(res) {
  const m = /\/(\d+)\s*$/.exec(String((res && res.ContentRange) || ''));
  if (m) return Number(m[1]);
  return Number(res && res.ContentLength) || 0;
}

async function bodyBytes(res) {
  const body = res && res.Body;
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') return Buffer.from(await body.transformToByteArray());
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(String(body), 'latin1');
}

/**
 * IS THE UPLOADED FILE A PDF, AND NOT TOO BIG — read from the object itself,
 * not from anything the browser said: its first 1024 bytes and its size. A
 * refusal deletes the staged object, so it is never attached later.
 * @returns {Promise<{bytes: number}|{error: string}>}
 */
async function verifyStaged(key) {
  let res;
  try {
    res = await s3().send(new (sdk().GetObjectCommand)({ Bucket: bucket(), Key: key, Range: `bytes=0-${HEAD_BYTES - 1}` }));
  } catch (error) {
    const missing = error && (error.name === 'NoSuchKey' || error.name === 'NotFound'
      || (error.$metadata && error.$metadata.httpStatusCode === 404));
    if (missing) return { error: 'The PDF did not finish uploading. Choose it again.' };
    // A range on an empty object is unsatisfiable (416): an empty file.
    if (error && error.name === 'InvalidRange') {
      await removeObject(key);
      return { error: 'That file is empty. Choose the PDF again.' };
    }
    throw error;
  }
  const bytes = totalSize(res);
  const head = await bodyBytes(res);
  let refusal = '';
  if (bytes > rules.DECK_MAX_BYTES) refusal = `That PDF is ${rules.formatBytes(bytes)}. Slides can be ${rules.formatBytes(rules.DECK_MAX_BYTES)} at most.`;
  else if (!bytes || head.indexOf(MAGIC) < 0) refusal = 'That file is not a PDF. PowerPoint, Keynote and Google Slides all save as PDF.';
  if (refusal) {
    await removeObject(key);
    return { error: refusal };
  }
  return { bytes };
}

/**
 * STAGED → ATTACHED: copied inside the bucket (nothing leaves S3), then the
 * staged copy goes. Returns the attached key.
 */
async function promote(stagingKey) {
  const key = deckKeyOf(stagingKey);
  await s3().send(new (sdk().CopyObjectCommand)({
    Bucket: bucket(),
    Key: key,
    // The key is hex, digits and slashes (isStagingKeyFor), so it is already
    // URL-safe as S3 asks a copy source to be.
    CopySource: `${bucket()}/${stagingKey}`,
    ContentType: rules.DECK_TYPE,
    MetadataDirective: 'REPLACE',
  }));
  await removeObject(stagingKey);
  return key;
}

/** Delete one object. Best effort, never throws: a leftover costs storage, not a room. */
async function removeObject(key) {
  if (!key) return false;
  try {
    await s3().send(new (sdk().DeleteObjectCommand)({ Bucket: bucket(), Key: key }));
    return true;
  } catch (error) {
    console.warn(`⚠️ deck-store: could not delete ${key}: ${error && error.name}`);
    return false;
  }
}

/**
 * A NEW DECK FOR AN ITEM, from what the dialog sent: `{ key, name, pages }`.
 * The key must be a staged upload of THIS event (another organisation's or
 * another event's is the same refusal as none at all), the file behind it a
 * PDF within the ceiling. It comes back attached:
 * `{ value: { Deck: {key, bytes, pages}, DeckName } }`, or `{ error }`.
 */
async function attachDeck(input, { orgId, code }) {
  if (!bucket()) return { error: 'Slides cannot be stored in this environment.' };
  const fields = rules.checkDeckFields(input);
  if (fields.error) return { error: fields.error };
  if (!isStagingKeyFor(fields.value.key, orgId, code)) return { error: 'Choose the PDF again: that upload is not this event’s.' };
  const checked = await verifyStaged(fields.value.key);
  if (checked.error) return { error: checked.error };
  const key = await promote(fields.value.key);
  return {
    value: {
      Deck: { key, bytes: checked.bytes, pages: fields.value.pages },
      DeckName: fields.value.name,
    },
  };
}

module.exports = {
  STAGING_PREFIX, DECK_PREFIX, UPLOAD_TTL_SECONDS, READ_TTL_SECONDS,
  orgTag, isStagingKeyFor, isDeckKeyFor, deckKeyOf, deckIdOf,
  presignUpload, presignRead, verifyStaged, promote, removeObject, attachDeck,
  _reset: () => { client = null; },
};
