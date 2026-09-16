/**
 * WHAT A BACKUP IS — the snapshot envelope, and the rules for reading one back.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.1. The archive used to
 * hold a CSV with a fixed column set, and every column it lacked was a silent loss: poll
 * options, trivia E and F, images, every set setting, the active flag. An envelope that
 * copies rows WHOLESALE cannot go stale that way. The next attribute anyone adds travels
 * without anyone remembering to add it here.
 *
 * Pure, no AWS calls. export-to-archive.js builds envelopes with it and archive-restore.js
 * reads them back, so the two sides agree by construction.
 */
const { isEnvelope } = require('./tenant-crypto');
const tenant = require('./tenant');

const SET_SCHEMA = 'engage.set/1';
const PROMPT_SCHEMA = 'engage.prompt/1';
const TIERS = ['dev', 'test', 'prod'];

/**
 * Publication-lifecycle rows that share a version's content partition (set-review.js:75-78).
 * A verdict about a version in another library is not content, and restoring one beside the
 * questions would describe a review that never happened here. copy-question-set.js skips them
 * for the same reason.
 */
const LIFECYCLE_SKS = ['REVIEW', 'PUBLISHED'];

/**
 * Attributes that say WHERE a row lives. A platform row carries none of them, and that absence
 * IS the platform marker (prompt-access.js promptOwnerStamp). So a restore into platform drops
 * them and keeps the provenance in `restoredFrom` instead.
 */
const ORG_SHAPED = ['scope', 'orgId', 'sourceOrgId', 'publishedAt'];

/** The set settings a restore makes the live row match: SET when present, REMOVE when not. */
const SET_SETTINGS = [
  'name', 'description', 'customInstruction', 'aiContextInstruction', 'personaId',
  'roundNoun', 'roundKind', 'roundKindBrief', 'engagementType', 'Quickstart',
  'isAIGenerated', 'promptId',
];

/** Where a prompt keeps its text when it has no S3 body (the gen-* rows). */
const ROW_TEXT_FIELDS = ['basePrompt', 'instructions', 'template'];

function currentTier() {
  const tier = String(process.env.ENVIRONMENT || '').trim().toLowerCase();
  return TIERS.includes(tier) ? tier : 'unknown';
}

function withoutKeys(row) {
  const { PK, SK, ...rest } = row || {};
  return rest;
}

/** Content rows as a snapshot stores them: PK dropped (it is rebuilt), SK kept (it IS the structure). */
function snapshotRows(rows) {
  return (rows || [])
    .filter((row) => !LIFECYCLE_SKS.includes(String(row && row.SK)))
    .map(({ PK, ...rest }) => rest);
}

/** The location of every tenant-crypto envelope inside a value. */
function findCiphertext(value, at = '$', found = []) {
  if (isEnvelope(value)) {
    found.push(at);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findCiphertext(item, `${at}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findCiphertext(item, `${at}.${key}`, found);
  }
  return found;
}

function buildSetEnvelope({ tier, scope, setId, version, metadata, rows, media, snapshotId, exportedAt, promptName }) {
  return {
    schema: SET_SCHEMA,
    snapshotId,
    exportedFrom: { tier, scope, setId, version: version == null ? null : version },
    exportedAt,
    metadata: withoutKeys(metadata),
    rows: snapshotRows(rows),
    media: media || [],
    links: promptName ? { promptName } : {},
  };
}

function buildPromptEnvelope({ tier, scope, promptId, metadata, body, exportedAt }) {
  return {
    schema: PROMPT_SCHEMA,
    exportedFrom: { tier, scope, promptId },
    exportedAt,
    metadata: withoutKeys(metadata),
    body: body == null ? null : body,
  };
}

/** Tags the archive item carries, so the admin screen can say what an item is and where it came from. */
function envelopeTags(envelope, extra = []) {
  const from = envelope.exportedFrom || {};
  const id = from.setId || from.promptId;
  return [
    from.tier,
    `schema:${envelope.schema}`,
    `scope:${from.scope}`,
    `source:${from.scope}/${id}`,
    `exportedAt:${envelope.exportedAt}`,
    ...extra,
  ].filter(Boolean);
}

/**
 * Read stored content. A JSON document with a known `schema` is a snapshot. Anything without a
 * `schema` is an item written before snapshots existed (a CSV set, or a `{metadata, prompt}`
 * prompt). A schema this code does not know is `unknown`, never legacy: treating a newer
 * envelope as legacy would hand it to the CSV importer.
 */
function parseArchiveContent(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { kind: 'legacy' }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Object.prototype.hasOwnProperty.call(doc, 'schema')) {
    return { kind: 'legacy', doc };
  }
  if (doc.schema === SET_SCHEMA) return { kind: 'set', envelope: doc };
  if (doc.schema === PROMPT_SCHEMA) return { kind: 'prompt', envelope: doc };
  return { kind: 'unknown', schema: doc.schema };
}

/** Why this envelope must not be restored, or '' when it may be. */
function refusalFor(envelope) {
  const from = (envelope && envelope.exportedFrom) || {};
  if (from.scope === tenant.ORG) {
    return 'Organisation content is not archived: it is encrypted per organisation.';
  }
  if (from.scope !== tenant.PLATFORM && from.scope !== tenant.PUBLIC) {
    return `This backup names a library this product does not have (${JSON.stringify(from.scope)}), so it is not restored.`;
  }
  if (envelope.schema === PROMPT_SCHEMA && from.scope === tenant.PUBLIC) {
    return 'Public prompts are not restored: nothing in this product writes public prompts.';
  }
  const ciphertext = findCiphertext(envelope);
  if (ciphertext.length > 0) {
    const shown = ciphertext.slice(0, 3).join(', ');
    return `This backup contains encrypted values (${shown}${ciphertext.length > 3 ? ', …' : ''}), `
      + 'which cannot be read outside their organisation, so it is not restored.';
  }
  return '';
}

function provenance(envelope, archiveId) {
  const from = envelope.exportedFrom || {};
  const metadata = envelope.metadata || {};
  return {
    archiveId,
    scope: from.scope,
    ...(from.setId ? { setId: from.setId } : {}),
    ...(from.promptId ? { promptId: from.promptId } : {}),
    tier: from.tier,
    exportedAt: envelope.exportedAt,
    ...(metadata.sourceOrgId ? { sourceOrgId: metadata.sourceOrgId } : {}),
  };
}

function platformMetadata(metadata, restoredFrom) {
  const row = withoutKeys(metadata);
  for (const key of ORG_SHAPED) delete row[key];
  delete row.ttl;
  return { ...row, restoredFrom };
}

function settingsFrom(metadata) {
  const settings = {};
  for (const attr of SET_SETTINGS) {
    const value = metadata && metadata[attr];
    if (value !== undefined && value !== null && value !== '') settings[attr] = value;
  }
  return settings;
}

function rowCarriesPromptText(row) {
  return ROW_TEXT_FIELDS.some((field) => typeof (row && row[field]) === 'string' && row[field].trim() !== '');
}

module.exports = {
  SET_SCHEMA, PROMPT_SCHEMA, TIERS, LIFECYCLE_SKS, ORG_SHAPED, SET_SETTINGS,
  currentTier, withoutKeys, snapshotRows, findCiphertext,
  buildSetEnvelope, buildPromptEnvelope, envelopeTags, parseArchiveContent,
  refusalFor, provenance, platformMetadata, settingsFrom, rowCarriesPromptText,
};
