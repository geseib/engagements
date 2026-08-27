/**
 * PER-ORGANISATION FIELD ENCRYPTION — the one place that decides what is
 * readable and by whom.
 *
 * docs/design/tenancy-redesign/08-privacy.html is the promise this module has
 * to make true, and it is deliberately a narrow promise:
 *
 *     "Engage staff browsing the database see identifiers and ciphertext, not
 *      your questions. Reading them takes a decryption request that names your
 *      organisation and is recorded. It is not that we cannot — it is that we
 *      cannot do it quietly."
 *
 * READ THAT TWICE BEFORE CHANGING ANYTHING HERE. This is not end-to-end
 * encryption and must never be described as such: we hold the AWS account, so
 * we can always ask KMS for a key. What this module buys is that asking is a
 * DISTINCT, PER-TENANT, LOGGED ACT. A `Scan` of the table returns ciphertext.
 * Turning that ciphertext into sentences requires a `kms:Decrypt` that names
 * one organisation in its encryption context, and CloudTrail records which
 * organisation, by whom, at what time. That record is what the customer-facing
 * "who has read your data" table is built from.
 *
 * ── ENVELOPE ENCRYPTION, AND WHY ONE KMS KEY AND NOT ONE PER ORG ────────────
 *
 * ONE customer-managed KMS key for the whole stack (~$1/month), plus a 256-bit
 * DATA KEY per organisation generated under it. A KMS key per organisation
 * would cost $1/month against a $5/month subscription — 20% of revenue burnt
 * on key storage — and buys nothing this design does not already have, because
 * the isolation comes from the encryption context, not from the key count.
 *
 *   creation   GenerateDataKey(KeyId: <the one CMK>, EncryptionContext:{orgId})
 *              -> plaintext key (used, never stored) + ciphertext blob (stored
 *                 on ORG#<orgId>/METADATA as `dataKeyCiphertext`)
 *   read       Decrypt(blob, EncryptionContext:{orgId}) -> plaintext key,
 *              cached in module scope for the life of the warm container
 *   field      AES-256-GCM with `orgId` as the AAD — node:crypto, no network
 *
 * THE KEY POLICY DOES THE REAL WORK. It denies `kms:Decrypt` unless
 * `kms:EncryptionContext:orgId` is supplied, so there is no such thing as a
 * decrypt that does not name a tenant, and therefore no such thing as an
 * unattributable one. See the integration note for the exact condition block.
 *
 * `orgId` is ALSO the AES-GCM additional authenticated data. That is belt and
 * braces on purpose: even holding a decrypted data key, feeding org A's
 * ciphertext to org B's context fails the GCM tag check and throws. It cannot
 * return plausible-looking wrong plaintext, which is the failure mode that
 * would be worst — a report silently built from another customer's answers.
 *
 * ── THE PASSTHROUGH RULE, WHICH IS NOT AN OVERSIGHT ─────────────────────────
 *
 * `decryptValue` RETURNS ANYTHING THAT IS NOT AN ENVELOPE UNCHANGED, and that
 * is the whole migration strategy. There is no big-bang re-encrypt: every row
 * that exists today is plaintext, a set becomes encrypted the first time it is
 * written, and for as long as that takes the two forms coexist in the same
 * partition, sometimes in the same Query result. A reader that threw on
 * plaintext would take the product down on the day this shipped; a reader that
 * passes it through migrates the estate one save at a time, for free.
 *
 * The envelope is an OBJECT, not a string, precisely so the passthrough test is
 * unambiguous. No customer-authored value is ever `{v:1, iv, tag, ct}`, so
 * "is this already encrypted?" has an exact answer and never a heuristic one.
 *
 * ── THE BOUNDARY IS DATA, NOT CALL SITES ────────────────────────────────────
 *
 * ENCRYPTED_FIELDS below is the single list. Handlers call
 * `encryptItem(orgId, entity, item)` / `decryptItem(orgId, entity, item)` and
 * never name a field. If every call site kept its own list, they would drift,
 * and the way that drift presents is a new field shipping in plaintext with
 * every test still green.
 *
 * DUPLICATED — Lambda bundles are per-directory (CodeUri: lambda-functions/game,
 * .../websocket, .../admin) and there are no layers, so this module is
 * triplicated exactly as tenant.js and set-version.js are. THE THREE COPIES ARE
 * BYTE-IDENTICAL and tests/tenant-crypto.js §8 fails the build if they drift —
 * there is deliberately no "(this file)" marker, because a drift here means one
 * bundle is encrypting a field another bundle is not.
 *   - lambda-functions/game/tenant-crypto.js
 *   - lambda-functions/websocket/tenant-crypto.js
 *   - lambda-functions/admin/shared/tenant-crypto.js
 */

const crypto = require('crypto');
const { orgPk } = require('./tenant');

// ── The envelope ───────────────────────────────────────────────────────────
/** Bumped only when the wire format changes. Readers must handle every version
 *  they might meet; there is no rewrite pass. */
const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
/** 96 bits is the GCM-standard nonce length: any other length forces the
 *  implementation through a GHASH derivation step for no benefit. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * How many organisations' plaintext keys one warm container may hold.
 *
 * Bounded because a long-lived container serving a busy platform would
 * otherwise accumulate every tenant's key in memory — the exact concentration
 * this design exists to avoid. 32 is far more than any single container sees in
 * practice (a Lambda invocation serves one request, for one org) while still
 * making the warm-path KMS call rate effectively zero.
 */
const MAX_CACHED_ORGS = 32;

// ── THE PLAINTEXT/CIPHERTEXT BOUNDARY ──────────────────────────────────────
/**
 * A DECISION, WRITTEN DOWN. Every field named here is encrypted; everything
 * else is not, and the "else" is as deliberate as the list.
 *
 * WHAT STAYS PLAINTEXT, AND WHY:
 *
 *   PK / SK              They are the index. An encrypted key cannot be
 *                        queried, and DynamoDB's whole access pattern is
 *                        "Query one partition". Key VALUES are structural
 *                        (`GAME#4821`, `SET#teamretro`), not content.
 *   orgId, createdBy,    Who and when. Needed to answer "whose row is this"
 *   createdAt,           and to enforce access at all — a guard that had to
 *   updatedAt            decrypt before it could check ownership would need
 *                        the key before it knew if the caller may have it.
 *   questionCount,       Counts and flags. The privacy page promises exactly
 *   categoryCount,       this: "Record identifiers, timestamps, and counts —
 *   active, visibility,  the things needed to find a row at all. No content."
 *   engagementType,
 *   hasImages,
 *   activeVersion,
 *   versions[]
 *   category `Name`      THE 24-BIT CATEGORY MASK DEPENDS ON ITS ORDERING.
 *                        HostMask1/2/3 address categories positionally, and
 *                        that position is derived from the stored names. An
 *                        encrypted name reorders the mask and silently
 *                        activates the wrong categories.
 *   anything PUBLIC      Published means public. A PUBLIC# row is a COPY that
 *                        the customer asked to make readable by everyone;
 *                        encrypting it to their org key would make the public
 *                        library unreadable by the public.
 *   correctAnswer        The literal string "OptionA". A pointer, not prose.
 *   PersonaName/Id       Platform configuration. A persona is a VOICE Engage
 *                        curates and stays platform-only by decision —
 *                        tenant.js:personasPk says so in code.
 *   promptId             A pointer, not prose. The Workie it names is scoped
 *                        and encrypted under the `prompt` entity below; the id
 *                        itself is how a row is found at all.
 *
 * An unknown entity THROWS rather than encrypting nothing. A typo'd entity
 * silently returning the item unchanged is how a whole row ships in plaintext.
 */
const ENCRYPTED_FIELDS = Object.freeze({
  /** Question-set metadata row: PK=<scope>SETS, SK=SET#<id>. */
  set: Object.freeze([
    'name',
    'description',
    'customInstruction',
    'aiContextInstruction',
    // Customer-authored prose describing what the round is FOR. It was missing
    // from the first cut of this list purely because the approved boundary
    // named the four fields above; it is the same kind of content as
    // `customInstruction` and belongs with it.
    'roundKindBrief',
  ]),

  /** An AI prompt — a Workie: PK=<scope>AIPROMPTS, SK=AIPROMPT#<id>.
   *
   *  ORG SCOPE ONLY, like every other entity here — platform and public prompts
   *  are deliberately plaintext, for the reason upload-questions.js gives about
   *  the shared libraries: encrypting content the whole product depends on
   *  would make it unreadable, and there is no org to key it to.
   *
   *  `name` and `description` are the same two strings the `set` entity above
   *  encrypts. The template fields are the prose the customer wrote, and a
   *  Workie IS that prose — the row is the mirror of the S3 body, which
   *  create-ai-prompt.js encrypts separately because a partition does not reach
   *  a bucket.
   *
   *  `category` and `status` STAY PLAINTEXT and that is not an oversight:
   *  get-ai-prompts.js pushes both into a FilterExpression as equality matches,
   *  and an encrypted value cannot be matched by an equality filter. Same
   *  argument as the category `Name` note above. `gameType`, `promptType`,
   *  `s3Key`, `version`, `isDefault` and `questionSetIds` are vocabulary,
   *  pointers and flags — the "identifiers, timestamps and counts" the privacy
   *  page already concedes are visible, and neither is ever pushed into a
   *  FilterExpression (get-ai-prompts.js's buildQuery reads `category` and
   *  `status` only), so encrypting them would cost nothing and buys nothing.
   *
   *  `defaultSettings` AND `tags` ARE ENCRYPTED, and were wrongly filed under
   *  "vocabulary... and model configuration" here until review caught it.
   *  `defaultSettings` is not a fixed shape: AIGenerationPromptEditor.jsx
   *  writes `mustHaveCategories`, `sampleCategories`, `contextPlaceholder` and
   *  `audiencePlaceholder` into it, and those are typed by the author, not
   *  chosen from a list — a live row was found in testing holding
   *  `"mustHaveCategories":"Layoffs, Attrition, Reorg"` in the clear, two
   *  attributes below an encrypted `name`. `tags` is the same shape: a caller
   *  types free text into an "Add tags…" field (AIPromptManager.jsx,
   *  AIGenerationPromptEditor.jsx) — not a controlled vocabulary, and nothing
   *  like the fixed `category`/`status` values above. Both were already inside
   *  the encrypted S3 envelope — create-ai-prompt.js wraps the whole
   *  `promptContent` document, and both fields are on it — so leaving the row
   *  plaintext meant the identical text was ciphertext in the bucket and
   *  readable two attributes away in the table.
   *
   *  `template` and `instructions` are absent because they are not on the row:
   *  create-ai-prompt.js writes those only to the S3 body. */
  prompt: Object.freeze([
    'name',
    'description',
    'basePrompt',
    'contextTemplate',
    'audienceTemplate',
    'categoryTemplate',
    'outputFormat',
    'outputSections',
    'scenario',
    'defaultSettings',
    'tags',
  ]),

  /** A question: PK=<scope>SET#<id>[#v<n>], SK=QUESTION#<cat>#<num>.
   *  Note optionA..optionF are lower-case in the table and Title/Detail are
   *  capitalised — that asymmetry is real, see admin/upload-questions.js:842. */
  question: Object.freeze([
    'Title',
    'Detail',
    'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF',
    'AnswerDetails',
    'CustomInstructions',
  ]),

  /** A category row. EMPTY ON PURPOSE — see the `Name` note above. Present as
   *  an entity so a call site that reaches for it gets an empty list rather
   *  than a throw, and so this decision is visible where the others are. */
  category: Object.freeze([]),

  /** The SESSION BRIEF: PK=GAME#<4-digit>, SK=METADATA.
   *
   *  ADDED AFTER THE FIRST CUT, because leaving it out was an inconsistency
   *  that would have shipped: `report.gameTitle` and `report.hostName` are in
   *  the ENCRYPT column above, and they are THE SAME TWO STRINGS as `Title` and
   *  `HostName` here. The identical sentence would have been ciphertext in the
   *  report row and readable in the session row, in the same table.
   *
   *  A session title is exactly the kind of thing the privacy page promises is
   *  not browsable — "Q3 Restructure Retro" names the meeting, and often the
   *  problem. `AIContext` and `Details` are free text a host wrote about their
   *  own organisation.
   *
   *  NOTE FOR WHOEVER WIRES THIS: `GET /games/{gameId}` is PUBLIC — RootPage
   *  checks a typed code against it before anyone has signed in — so that
   *  handler has to decrypt on an unauthenticated path. It can: the row carries
   *  `orgId`. The point of encrypting a value participants are shown anyway is
   *  that the threat is a scan of the table, not the person in the room.
   *
   *  `AccessCode` stays plaintext: it is a lookup key, and `Visibility`,
   *  `Started` and `ScoringConfig` are flags and configuration. */
  session: Object.freeze([
    'Title',
    'HostName',
    'Details',
    'AIContext',
  ]),

  /** A participant's answer: SK=QUESTION#<num>#ANSWER#<player> (or ROUND#…).
   *  The single most sensitive thing in the table — what a named person said
   *  in a retrospective. */
  answer: Object.freeze([
    'Answer',
    // THE WAVELENGTH BRANCH STORES THE SAME SUBMISSION TWICE. `Answer` is the
    // raw text; `ProcessedWords` is the normalised word array written beside it
    // (websocket/message.js:469), and `get-results` reads `ProcessedWords`
    // FIRST. Encrypting only `Answer` left the participant's actual words
    // readable at rest and made the other field decorative.
    'ProcessedWords',
  ]),

  /** A ballot: SK=QUESTION#<num>#VOTE#<player>. `Votes` is a MAP, not a
   *  string; encryptValue JSON-serialises it, so it round-trips as a map. */
  vote: Object.freeze(['Votes']),

  /** SK=QUESTION#<num>#AISummary. `DebugInfo` carries the FULL PROMPT, which
   *  embeds the participants' answers verbatim — it is the most content-dense
   *  attribute in the table and is easy to forget. */
  aiSummary: Object.freeze([
    'Summary',
    'SummaryText',
    'DiscussionQuestions',
    'NextSteps',
    'FullResponse',
    'MarkdownResponse',
    'DebugInfo',
  ]),

  /** SK=REPORT. `gameStats` and `scoringConfig` stay plaintext (counts and
   *  configuration); everything that quotes a person does not. */
  report: Object.freeze([
    'gameTitle',
    'hostName',
    'playerPerformance',
    'detailedQuestions',
    'questionSummaries',
    'questionSetData',
  ]),

  /** The derived tally: SK=QUESTION#<nnn>#RESULTS.
   *
   *  ADDED AFTER REVIEW, because without it the answer rows above were being
   *  encrypted into a row that quoted them back in the clear. The wavelength
   *  branch writes `answers[].answer` — the participant's literal submission —
   *  plus their word list, the question and the whole word analysis
   *  (get-results.js:1077-1089). Encrypting `Answer` and leaving this alone
   *  protects nothing: the same sentence is one Query away.
   *
   *  `Winners` is a list of player NAMES, and anonymity is a product feature
   *  here — `anonymity.js` exists so the room does not see who said what until
   *  the host reveals. A name list at rest outlives that choice.
   *
   *  `VoteTallies`, `MaxVotes`, `TotalVotes` and `CompletedAt` stay plaintext:
   *  counts and a timestamp, which is what the privacy page already concedes
   *  is visible. */
  results: Object.freeze([
    'Winners',
    'answers',
    'question',
    'wordAnalysis',
  ]),

  /** An AI generation job: PK=AIJOBS, SK=AIJOB#<id>. `request` is where a
   *  PASTED SOURCE DOCUMENT lands — a customer paste of arbitrary internal
   *  material — and `items` is the generated content before it becomes a set. */
  job: Object.freeze(['request', 'items', 'meta']),

  /** A comment on one section of a round's report:
   *  SK=COMMENT#<nnn>#<anchorKind>#<anchorRef>#<commentId>.
   *
   *  Customer-authored prose, written by a named person, about a named
   *  person's response. It is the same class of content as `answer` and it
   *  lives in the same partition.
   *
   *  `AnchorExcerpt` IS THE ONE THAT IS EASY TO MISS. It is a verbatim slice of
   *  the material being commented on — an answer, or a line of the AI summary —
   *  copied onto this row at write time so that a comment stays readable in the
   *  SESSION report, where the round it belongs to is not on screen beside it.
   *  That makes it a SECOND COPY of content the boundary already protects one
   *  copy of, in a different row, and encrypting `Text` alone would leave the
   *  participant's actual words readable at rest while the commentary about
   *  them was ciphertext. Exactly the shape of the `Answer`/`ProcessedWords`
   *  mistake recorded above. `AnchorLabel` joins them because for a response
   *  anchor it carries a participant's name once the round is attributed.
   *
   *  `PlayerName` STAYS PLAINTEXT, as it does on `answer` — identifiers and
   *  counts are conceded visible, content is not.
   *
   *  `AnchorKind`, `AnchorRef` and `QuestionNumber` stay plaintext because they
   *  are COORDINATES, not content: `create-report.js` groups every comment in a
   *  session by round and section in one pass, and it must not have to ask KMS
   *  a question to do it. */
  comment: Object.freeze(['Text', 'AnchorExcerpt', 'AnchorLabel']),
});

// ── Plumbing seams (tests, and callers that already hold the org row) ───────
/**
 * How the module finds an organisation's wrapped data key.
 *
 * The default reads `ORG#<orgId>` / `METADATA` itself, so an ordinary call site
 * needs nothing but an orgId. The seam exists because several handlers have
 * ALREADY read that row and should not pay for a second GetItem — and because
 * tests can supply blobs without a DynamoDB in the room.
 */
let ciphertextLoader = null;

function setCiphertextLoader(fn) {
  ciphertextLoader = typeof fn === 'function' ? fn : null;
}

let docClient = null;
function defaultDocClient() {
  if (docClient) return docClient;
  // Required lazily: bundles that never touch tenant crypto should not pay the
  // cold-start cost of constructing a DynamoDB client they will not use.
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
  docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return docClient;
}

async function defaultCiphertextLoader(orgId) {
  const { GetCommand } = require('@aws-sdk/lib-dynamodb');
  const res = await defaultDocClient().send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: orgPk(orgId), SK: 'METADATA' },
    ProjectionExpression: 'dataKeyCiphertext',
  }));
  return res?.Item?.dataKeyCiphertext || '';
}

let kmsClient = null;
function kms() {
  if (kmsClient) return kmsClient;
  // Lazy for the same reason, and so that a bundle which has not yet added
  // @aws-sdk/client-kms fails at the moment it needs a key — loudly, naming
  // the missing dependency — rather than at require time in every handler.
  const { KMSClient } = require('@aws-sdk/client-kms');
  kmsClient = new KMSClient({});
  return kmsClient;
}

/** The one customer-managed key for the whole stack. Set by the template. */
function kmsKeyId() {
  const id = process.env.TENANT_KMS_KEY_ID || process.env.KMS_KEY_ID || '';
  if (!id) throw new Error('tenant-crypto: TENANT_KMS_KEY_ID is not set');
  return id;
}

// ── The data-key cache ─────────────────────────────────────────────────────
/**
 * orgId -> Promise<Buffer>. THE PROMISE, not the resolved key, so that two
 * concurrent encrypts for the same org share ONE KMS round trip instead of
 * racing into two. A rejected promise is evicted, so a transient KMS failure
 * does not poison the container for the rest of its life.
 */
const keyCache = new Map();

function cacheGet(orgId) {
  if (!keyCache.has(orgId)) return null;
  // Refresh recency: Map iterates in insertion order, so re-inserting makes
  // this the youngest entry and the eviction below a true LRU.
  const p = keyCache.get(orgId);
  keyCache.delete(orgId);
  keyCache.set(orgId, p);
  return p;
}

function cachePut(orgId, promise) {
  keyCache.set(orgId, promise);
  while (keyCache.size > MAX_CACHED_ORGS) {
    const oldest = keyCache.keys().next().value;
    keyCache.delete(oldest);
  }
  promise.catch(() => { if (keyCache.get(orgId) === promise) keyCache.delete(orgId); });
  return promise;
}

/**
 * FORGET an organisation's key. Called after the org is deleted (the wrapped
 * blob is destroyed, which is what makes every remaining copy of its content
 * unreadable — see "Delete this organisation" on the privacy page) and by
 * tests. Omit the argument to clear the whole cache.
 */
function forgetOrg(orgId) {
  if (orgId === undefined) keyCache.clear();
  else keyCache.delete(clean(orgId));
}

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function requireOrgId(orgId) {
  const id = clean(orgId);
  // A blank orgId would encrypt everybody under one AAD and defeat the whole
  // design, so it throws rather than defaulting — the same rule tenant.js
  // applies to a blank org in a partition key.
  if (!id) throw new Error('tenant-crypto: an orgId is required');
  return id;
}

/** The plaintext data key for an org, from cache or from KMS. */
function dataKey(orgId) {
  const id = requireOrgId(orgId);
  const hit = cacheGet(id);
  if (hit) return hit;
  return cachePut(id, (async () => {
    const load = ciphertextLoader || defaultCiphertextLoader;
    const blob = clean(await load(id));
    if (!blob) {
      // Either the org was created before this module existed and has no key
      // yet, or its key has been destroyed. Both must be loud: silently
      // writing plaintext for a tenant that believes it is encrypted is worse
      // than failing the request.
      throw new Error(`tenant-crypto: org ${id} has no dataKeyCiphertext`);
    }
    const { DecryptCommand } = require('@aws-sdk/client-kms');
    const res = await kms().send(new DecryptCommand({
      CiphertextBlob: Buffer.from(blob, 'base64'),
      // THE BINDING. The key policy denies Decrypt without this, so there is
      // no decrypt that does not name a tenant in CloudTrail.
      EncryptionContext: { orgId: id },
    }));
    const key = Buffer.from(res.Plaintext);
    if (key.length !== KEY_BYTES) {
      throw new Error(`tenant-crypto: expected a ${KEY_BYTES}-byte data key, got ${key.length}`);
    }
    return key;
  })());
}

/**
 * Mint an organisation's data key. Called ONCE, when the org is created; the
 * returned base64 blob is what goes on ORG#<orgId>/METADATA as
 * `dataKeyCiphertext`. The plaintext is seeded into the cache so the creating
 * request does not immediately turn round and Decrypt what it just generated.
 */
async function createOrgDataKey(orgId) {
  const id = requireOrgId(orgId);
  const { GenerateDataKeyCommand } = require('@aws-sdk/client-kms');
  const res = await kms().send(new GenerateDataKeyCommand({
    KeyId: kmsKeyId(),
    KeySpec: 'AES_256',
    EncryptionContext: { orgId: id },
  }));
  const key = Buffer.from(res.Plaintext);
  cachePut(id, Promise.resolve(key));
  return Buffer.from(res.CiphertextBlob).toString('base64');
}

// ── Field crypto ───────────────────────────────────────────────────────────
/**
 * Is this value already an envelope?
 *
 * Deliberately exact — a numeric version and three base64 strings. Anything
 * else is customer plaintext and is left alone.
 *
 * It matches ANY version, not just the current one, so that an envelope this
 * bundle cannot read is recognised as an envelope and THROWS in decryptValue.
 * If it only matched v1, a v2 envelope written by a newer bundle would fall
 * through the passthrough rule and land in a report as `{v:2,iv:…}`.
 */
function isEnvelope(value) {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.v === 'number'
    && typeof value.iv === 'string'
    && typeof value.tag === 'string'
    && typeof value.ct === 'string';
}

/**
 * Values that are not worth encrypting and are not content: absent, null, or
 * the empty string. `Detail: ''` is written on most rows by the importer;
 * encrypting it would replace "this field is blank" with 60 bytes of noise on
 * every question in the estate and break every reader that does `x.Detail ||
 * fallback`. Blank leaks nothing — the privacy page already promises that the
 * SHAPE of a row is visible.
 */
function isSkippable(value) {
  return value === undefined || value === null || value === '';
}

/**
 * Encrypt one value. JSON is the plaintext, so maps, arrays, numbers and
 * booleans round-trip as themselves rather than as their string forms — which
 * matters for `Votes` (a map) and `DiscussionQuestions` (an array).
 *
 * Already-encrypted values pass through: re-encrypting on a partial update
 * would produce an envelope inside an envelope and a decrypt that returns
 * JSON to a caller expecting a sentence.
 */
async function encryptValue(orgId, value) {
  const id = requireOrgId(orgId);
  if (isSkippable(value) || isEnvelope(value)) return value;
  const key = await dataKey(id);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  // THE AAD. Not secret — authenticated. It is what makes org A's ciphertext
  // fail rather than mis-decrypt under org B's key.
  cipher.setAAD(Buffer.from(id, 'utf8'));
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
    cipher.final(),
  ]);
  return {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/**
 * Decrypt one value, or return it untouched if it is not an envelope.
 *
 * THROWS on a failed tag check. It must: GCM's whole job is to tell tampering
 * and a wrong key apart from success, and a decrypt that fell back to "return
 * something" would hand a report a plausible sentence from nowhere.
 */
async function decryptValue(orgId, value) {
  if (!isEnvelope(value)) return value; // pre-migration plaintext — see header
  const id = requireOrgId(orgId);
  if (value.v !== ENVELOPE_VERSION) {
    throw new Error(`tenant-crypto: unknown envelope version ${value.v}`);
  }
  const key = await dataKey(id);
  const decipher = crypto.createDecipheriv(
    ALGORITHM, key, Buffer.from(value.iv, 'base64'), { authTagLength: TAG_BYTES },
  );
  decipher.setAAD(Buffer.from(id, 'utf8'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(value.ct, 'base64')),
    decipher.final(), // throws on a tag mismatch: wrong org, wrong key, tampering
  ]);
  return JSON.parse(plain.toString('utf8'));
}

function fieldsFor(entity) {
  const fields = ENCRYPTED_FIELDS[entity];
  // Fail loudly on an unknown entity. Returning [] would ship the whole row in
  // plaintext and look like it worked, which is the failure this file exists
  // to prevent — the same argument tenant.js makes for an unknown scope.
  if (!fields) {
    throw new Error(`tenant-crypto: unknown entity ${JSON.stringify(entity)}`);
  }
  return fields;
}

/**
 * Encrypt every ENCRYPT-column field of an item, returning a NEW object.
 *
 * Never mutates its argument: handlers routinely build an item, write it, and
 * then return parts of the same object to the caller. Mutating in place would
 * ship `{v:1,iv,…}` to the browser.
 */
async function encryptItem(orgId, entity, item) {
  const id = requireOrgId(orgId);
  const fields = fieldsFor(entity);
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  for (const f of fields) {
    if (!(f in out)) continue;
    out[f] = await encryptValue(id, out[f]);
  }
  return out;
}

/** The inverse. A field that is still plaintext passes straight through. */
async function decryptItem(orgId, entity, item) {
  const id = requireOrgId(orgId);
  const fields = fieldsFor(entity);
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  for (const f of fields) {
    if (!(f in out)) continue;
    try {
      out[f] = await decryptValue(id, out[f]);
    } catch (e) {
      // Name the field. "Unsupported state or unable to authenticate data" on
      // its own has cost people whole afternoons.
      throw new Error(`tenant-crypto: cannot decrypt ${entity}.${f} for ${id}: ${e.message}`);
    }
  }
  return out;
}

/** Query results come back as arrays; this is the only reason it exists. */
async function decryptItems(orgId, entity, items) {
  if (!Array.isArray(items)) return items;
  const out = [];
  for (const item of items) out.push(await decryptItem(orgId, entity, item));
  return out;
}

module.exports = {
  ENCRYPTED_FIELDS, ENVELOPE_VERSION, MAX_CACHED_ORGS,
  isEnvelope,
  encryptValue, decryptValue,
  encryptItem, decryptItem, decryptItems,
  createOrgDataKey, forgetOrg,
  setCiphertextLoader,
};
