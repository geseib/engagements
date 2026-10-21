/**
 * PROMPT VERSIONS — what a Workie was, every time it was saved, and which one
 * is live.
 *
 * The owner, 2026-10-21 (docs/design/prompt-versions/): prompts get versions
 * the way question sets have them, the repo's prompt files can be taken as a
 * new version, and any earlier version can be made live again. NOTHING IS EVER
 * DELETED OR OVERWRITTEN: every change of content is a new S3 object at
 * `promptBodyKey(ref, gameType, n)`, and "make live" only moves the row's
 * `version`/`s3Key` pointer. Every reader of a prompt's text — the summary
 * engine (game/get-ai-summary.js `fetchPromptFromS3`), the advisor, the
 * archive export — already reads the ROW's `s3Key`, never a key rebuilt from a
 * version number, so moving the pointer is all "make live" has to do.
 *
 * ── WHERE THE HISTORY LIVES, AND WHY THERE ────────────────────────────────
 *
 * An ARRAY ON THE PROMPT ROW (`versionHistory`), not `AIPROMPTVER#…` rows.
 *
 *   1. It is written IN THE SAME UpdateCommand that moves `version`/`s3Key`,
 *      so the pointer and the record of where it came from cannot disagree —
 *      a separate row is a second write that can fail on its own.
 *   2. The bare `AIPROMPTS` partition is read whole by several readers
 *      (get-ai-summary.js's default Query reads every row in it and filters on
 *      `isDefault`; populate-defaults, the cull script and the archive export
 *      page through it). A new SK family is one more shape each of them has to
 *      be taught to ignore; a field on a row they already read is nothing.
 *   3. It is bounded. An entry is ~250 bytes of metadata — never prose, so
 *      nothing in it needs tenant-crypto — and `MAX_HISTORY` keeps the row far
 *      under DynamoDB's 400 KB item limit. An entry that falls off the front is
 *      not lost content: its S3 object stays, and `listVersions` synthesises it
 *      from the bucket listing exactly as it does for versions saved before
 *      this file existed ("Before version history").
 *
 * The list response strips the array (get-ai-prompts.js) so the library does
 * not carry every prompt's history on every load.
 *
 * ── THE CONTENT HASH ─────────────────────────────────────────────────────
 *
 * Per FIELD, then combined, because the repo files do not all carry the same
 * fields (the quiz Workies have no `outputSections`, the defaults no
 * `angleWeights`): "does the live prompt match the repo?" is asked over the
 * fields that file carries, and only per-field hashes can answer that for any
 * subset. scripts/build-repo-prompts.js requires THIS file, so the hashes in
 * src/src/config/repoPrompts.json and the ones the list returns are computed by
 * one function and cannot drift.
 */
const crypto = require('crypto');
const { normalizeOutputSections, normalizeAngleWeights } = require('./prompt-shape');

/** The parts of a prompt that are its CONTENT — what a version is a version of. */
const CONTENT_FIELDS = ['description', 'instructions', 'outputFormat', 'outputSections', 'angleWeights', 'template'];

/** How a version came to exist. The screen words live in the frontend. */
const HOW = {
  EDIT: 'edit',          // Edited here (the editor's Save, the advisor's rewrite)
  UPLOAD: 'upload',      // Uploaded a file (the workbench's Upload a revised file)
  REPO: 'repo',          // From the repo (the library's Review → Save as version N)
  ARCHIVE: 'archive',    // Imported from the archive
  SEED: 'seed',          // Seeded default (populate-defaults)
  UNKNOWN: 'unknown',    // Before version history
};
const HOW_VALUES = new Set(Object.values(HOW));

/** Bounded history on the row — see the header, point 3. */
const MAX_HISTORY = 200;

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

/** A key-sorted JSON string, so `{a,b}` and `{b,a}` hash alike. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * One field, as the text a hash is taken over. Absent, empty and cleared are
 * the same thing ('' ), because every writer treats them the same: an empty
 * `outputSections` means the default triad, an empty `angleWeights` the house
 * mix. Line endings are folded so a file saved on Windows is not "different".
 */
function canonicalField(field, value) {
  if (field === 'outputSections') {
    if (!Array.isArray(value) || value.length === 0) return '';
    const sections = normalizeOutputSections(value)
      || value.map((s) => ({ heading: String((s && s.heading) || '').trim(), guidance: String((s && s.guidance) || '').trim() }));
    return stableStringify(sections);
  }
  if (field === 'angleWeights') {
    const check = normalizeAngleWeights(value);
    const weights = check.ok ? check.weights : value;
    if (!weights || typeof weights !== 'object' || Object.keys(weights).length === 0) return '';
    return stableStringify(weights);
  }
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').trim();
  return stableStringify(value);
}

const fieldHash = (field, value) => sha(`${field}\n${canonicalField(field, value)}`);

/** `{ field: hash }` over `fields` (default: every content field). */
function fieldHashes(doc, fields = CONTENT_FIELDS) {
  const out = {};
  for (const f of fields) out[f] = fieldHash(f, doc ? doc[f] : undefined);
  return out;
}

/** One hash over `fields`, order-independent. */
function contentHash(doc, fields = CONTENT_FIELDS) {
  const hashes = fieldHashes(doc, fields);
  return sha(Object.keys(hashes).sort().map((f) => `${f}:${hashes[f]}`).join('\n'));
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The version number an `s3Key` names — `…/v7.json` → 7 — or 0. */
function versionFromKey(key) {
  const m = /\/v(\d+)\.json$/.exec(String(key || ''));
  return m ? Number(m[1]) : 0;
}

/**
 * The next version number, never one already used. `version` on its own is NOT
 * enough once "make live" exists: making v1 live sets `version` to 1 while v2
 * and v3 still exist, and `version + 1` would mint a second v2 over the first.
 * `latestVersion` is written by every save from here on; the history and the
 * live key cover rows written before it.
 */
function nextVersionNumber(row, knownKeys = []) {
  const history = Array.isArray(row && row.versionHistory) ? row.versionHistory : [];
  return Math.max(
    num(row && row.version),
    num(row && row.latestVersion),
    versionFromKey(row && row.s3Key),
    ...history.map((e) => num(e && e.version)),
    ...knownKeys.map(versionFromKey),
  ) + 1;
}

/** The caller's email, for "By". Never prose, never a secret. */
function callerEmail(event) {
  const authorizer = (event && event.requestContext && event.requestContext.authorizer) || {};
  const lambda = authorizer.lambda || {};
  const claims = (authorizer.jwt && authorizer.jwt.claims) || authorizer.claims || {};
  const raw = lambda.email ?? claims.email ?? '';
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** One history entry. `by` falls back to the caller's id, then to nothing. */
function historyEntry({ version, s3Key, savedAt, by, how, hash, repo }) {
  return {
    version: num(version),
    s3Key,
    savedAt,
    by: by || null,
    how: HOW_VALUES.has(how) ? how : HOW.EDIT,
    ...(hash ? { hash } : {}),
    ...(repo && repo.key ? {
      repoKey: String(repo.key),
      ...(repo.path ? { repoPath: String(repo.path) } : {}),
      ...(repo.commitDate ? { repoCommitDate: String(repo.commitDate) } : {}),
    } : {}),
  };
}

/** The row's history with `entry` added, bounded. Never mutates. */
function appendHistory(history, entry) {
  const list = Array.isArray(history) ? history.filter((e) => e && num(e.version) !== num(entry.version)) : [];
  list.push(entry);
  return list.length > MAX_HISTORY ? list.slice(list.length - MAX_HISTORY) : list;
}

/**
 * What an S3 object with no history entry can honestly say about itself.
 * A v1 written by the seeder or the archive importer is recognisable from the
 * row those two wrote; anything else is "Before version history".
 */
function guessedOrigin(row, version) {
  if (num(version) === 1) {
    if (row && (row.importedFrom || String(row.promptId || '').startsWith('imported-'))) {
      return { how: HOW.ARCHIVE, by: 'admin import' };
    }
    if (row && row.createdBy === 'system') return { how: HOW.SEED, by: 'seed' };
  }
  return { how: HOW.UNKNOWN, by: null };
}

/**
 * Every version of one prompt, newest first: the row's history, plus every
 * `v<n>.json` object under the prompt's prefix that the history does not name
 * (saved before history existed, or fallen off the bounded front). `objects` is
 * `[{ Key, LastModified }]` from ListObjectsV2; pass `null` when the listing
 * failed and the history alone is shown.
 */
function listVersions(row, objects) {
  const byVersion = new Map();
  const history = Array.isArray(row && row.versionHistory) ? row.versionHistory : [];
  const listed = Array.isArray(objects) ? objects : null;
  const listedKeys = listed ? new Set(listed.map((o) => o.Key)) : null;

  for (const e of history) {
    if (!e || !num(e.version)) continue;
    byVersion.set(num(e.version), {
      ...e,
      version: num(e.version),
      recorded: true,
      ...(listedKeys && e.s3Key && !listedKeys.has(e.s3Key) ? { missing: true } : {}),
    });
  }
  for (const o of listed || []) {
    const v = versionFromKey(o.Key);
    if (!v || byVersion.has(v)) continue;
    const savedAt = o.LastModified ? new Date(o.LastModified).toISOString() : null;
    byVersion.set(v, { version: v, s3Key: o.Key, savedAt, ...guessedOrigin(row, v), recorded: false });
  }
  // The live version is always in the list, even when the listing failed and
  // nothing recorded it.
  const liveV = num(row && row.version) || versionFromKey(row && row.s3Key);
  if (row && row.s3Key && liveV && !byVersion.has(liveV)) {
    byVersion.set(liveV, {
      version: liveV, s3Key: row.s3Key, savedAt: row.updatedAt || row.createdAt || null,
      ...guessedOrigin(row, liveV), recorded: false,
    });
  }
  return [...byVersion.values()]
    .map((e) => ({ ...e, live: Boolean(row && row.s3Key) && e.s3Key === row.s3Key }))
    .sort((a, b) => b.version - a.version);
}

/** The S3 directory every version of this prompt lives in — `…/<promptId>/`. */
function versionPrefixes(row, promptBodyKeyFn, ref) {
  const out = new Set();
  if (row && row.s3Key && /\/v\d+\.json$/.test(row.s3Key)) out.add(row.s3Key.replace(/v\d+\.json$/, ''));
  if (promptBodyKeyFn && ref && row && row.gameType) {
    out.add(promptBodyKeyFn(ref, row.gameType, 1).replace(/v1\.json$/, ''));
  }
  return [...out];
}

/** Every object under those prefixes, all pages. Throws on a failed listing. */
async function listVersionObjects(s3Client, ListObjectsV2Command, bucket, prefixes) {
  const objects = [];
  for (const Prefix of prefixes) {
    let ContinuationToken;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix, ContinuationToken }));
      for (const o of (page && page.Contents) || []) {
        if (/\/v\d+\.json$/.test(o.Key) && !objects.some((x) => x.Key === o.Key)) objects.push(o);
      }
      ContinuationToken = page && page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }
  return objects;
}

/**
 * A `repoSource` as stored on the row: which repo file, the hash of what was
 * taken (over the fields that file carries), and per-field hashes so the
 * library can tell "edited here since" for any subset without a hash function
 * of its own.
 */
function repoSourceFor({ key, path, commitDate, fields }, content, { takenAt, version } = {}) {
  const carried = (Array.isArray(fields) && fields.length ? fields : CONTENT_FIELDS)
    .filter((f) => CONTENT_FIELDS.includes(f));
  return {
    key: String(key),
    ...(path ? { path: String(path) } : {}),
    ...(commitDate ? { commitDate: String(commitDate) } : {}),
    fields: carried,
    hash: contentHash(content, carried),
    fieldHashes: fieldHashes(content, carried),
    ...(takenAt ? { takenAt } : {}),
    ...(version ? { version: num(version) } : {}),
  };
}

/*
  THE REPO'S PROMPT FILES, by key. A key is the file's repo-relative path, and
  for the built-in defaults (one JSON holding all nineteen) the path plus
  `#<gameType>/<category>` — the two keys populate-defaults.js iterates, which
  are the seeded identity that survives a rename of nothing.
*/
const DEFAULTS_REPO_PATH = 'lambda-functions/admin/default-ai-prompts.json';
const defaultsRepoKey = (gameType, categoryKey) => `${DEFAULTS_REPO_PATH}#${gameType}/${categoryKey}`;

module.exports = {
  DEFAULTS_REPO_PATH,
  defaultsRepoKey,
  CONTENT_FIELDS,
  HOW,
  MAX_HISTORY,
  canonicalField,
  fieldHash,
  fieldHashes,
  contentHash,
  versionFromKey,
  nextVersionNumber,
  callerEmail,
  historyEntry,
  appendHistory,
  listVersions,
  versionPrefixes,
  listVersionObjects,
  repoSourceFor,
};
