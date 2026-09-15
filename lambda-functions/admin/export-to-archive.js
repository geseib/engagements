/**
 * BACK UP ENGAGE AND PUBLIC CONTENT TO THE SHARED ARCHIVE — as full-fidelity snapshots.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.2. What used to be
 * written here was a CSV with a fixed column set. Everything it had no column for (poll
 * options, trivia E/F, images, every set setting, the active flag) was lost on every trip.
 * Each item is now one JSON envelope (shared/archive-snapshot.js) copied wholesale from its
 * rows, with the images those rows point at copied beside it (shared/archive-media.js).
 *
 * WHO: Engage staff acting as Engage, via canManageScope(event, PLATFORM), the same interlock
 * that guards writing Engage's library. The route's `admins` gate alone lets an admin standing
 * inside a customer team reach it.
 *
 * WHAT: platform and public content. Organisation content is refused BY NAME before any read,
 * because it is encrypted per organisation and the owner decided not to archive ciphertext.
 * Anything else carrying an encrypted value is refused too, wherever the value sits. A bare id
 * is platform, the house rule (set-version.js setRef), which is what the prompt manager's
 * "Copy to archive" sends.
 *
 * WRITES NOTHING TO THE MAIN TABLE. The `PK: 'ARCHIVE'` rows this used to write were read by
 * nothing; the archive service's own table is the index.
 */
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { setRef, setMetadataKey, resolvePartitionFromMeta, queryPartition } = require('./shared/set-version');
const { promptKey } = require('./shared/prompt-access');
const { promptLinkTag } = require('./shared/archive-prompt-link');
const archive = require('./shared/archive-client');
const snap = require('./shared/archive-snapshot');
const { copyMediaOut } = require('./shared/archive-media');

const db = DynamoDBDocumentClient.from(new DynamoDBClient());
const s3Client = new S3Client({});

/** The archive API is API Gateway in front of Lambda, whose request payload limit is 6 MB. */
const MAX_ITEM_BYTES = 5.5 * 1024 * 1024;
const ORG_REFUSAL = 'Organisation content is not archived: it is encrypted per organisation.';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engage-Org',
};
const respond = (statusCode, body) => ({ statusCode, headers: corsHeaders, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM)) {
    return respond(403, { error: "The archive backs up Engage's library. Switch to Engage (no organisation selected) to use it." });
  }
  let payload;
  try {
    payload = JSON.parse((event && event.body) || '{}');
  } catch {
    return respond(400, { error: 'Request body is not valid JSON.' });
  }
  const { selectedItems, exportType } = payload;
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    return respond(400, { error: 'selectedItems array is required and must not be empty' });
  }
  if (!['questionsets', 'prompts'].includes(exportType)) {
    return respond(400, { error: 'exportType must be either "questionsets" or "prompts"' });
  }

  const results = { successful: [], failed: [], totalRequested: selectedItems.length };
  const tier = snap.currentTier();
  for (const entry of selectedItems) {
    const ref = selectionRef(entry);
    try {
      if (exportType === 'questionsets') await exportSet(ref, tier, results);
      else await exportPrompt(ref, tier, results);
    } catch (error) {
      console.error(`❌ export of ${ref.scope}/${ref.id} failed:`, error);
      results.failed.push({ id: ref.id, scope: ref.scope, error: error.message });
    }
  }
  console.log(`✅ Export completed. Success: ${results.successful.length}, Failed: ${results.failed.length}`);
  return respond(200, { message: `Export completed. ${results.successful.length} items exported successfully.`, results });
};

/** `{scope, id}` from one selection entry. A bare id, or an object with no scope, is platform. */
function selectionRef(entry) {
  if (typeof entry === 'string') return { scope: tenant.PLATFORM, id: entry.trim() };
  if (entry && typeof entry === 'object') {
    return { scope: String(entry.scope || '').trim().toLowerCase() || tenant.PLATFORM, id: String(entry.id || '').trim() };
  }
  return { scope: '', id: '' };
}

const refuse = (results, ref, error) => results.failed.push({ id: ref.id, scope: ref.scope, refused: true, error });

/*
  NAME THE EM DASH, BECAUSE THE ARCHIVE SERVICE CANNOT.

  On 2026-08-15 the four TRIVIA prompts for the demo quiz sets each failed this
  export with a flat 500 "Failed to upload archive item" while the four
  call-and-answer prompts in the same batch succeeded. The trivia prompts are
  named "Workie — <thing>" (U+2014 EM DASH); the others "Workie - <thing>"
  (ASCII hyphen). The archive service puts the title in S3 user metadata, which
  is an HTTP header, and Node throws ERR_INVALID_CHAR on any character outside
  /[\t\x20-\x7e\x80-\xff]/ — which an em dash is — before the request leaves the
  process. See the long note in lambda-functions/archive/upload-archive.js,
  where it is actually fixed.

  This exporter cannot fix that: the archive service is a separately deployed,
  SHARED stack (scripts/deploy-archive.sh, engage2-archive-service) that all
  three tiers talk to, so a patched exporter can still meet an unpatched
  archive. What it can do is stop the diagnosis costing another afternoon —
  when an upload fails and the title carries a character known to break that
  path, say so, with the character and its code point.

  Deliberately NOT a pre-flight rejection and NOT a sanitiser. Refusing the
  export would block a legitimate title, and rewriting the title would silently
  alter what the user wrote. This only annotates a failure that already happened.
*/
function describeTitleHazard(title) {
  // Node's own rule, from lib/_http_common.js checkInvalidHeaderChar. Matching
  // it exactly rather than testing for "> U+00FF" so that a stray newline or
  // control character — which breaks the request in precisely the same way and
  // is far harder to see in a title — is named too.
  const offenders = [...String(title || '')]
    .filter(ch => /[^\t\x20-\x7e\x80-\xff]/.test(ch))
    .map(ch => `${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
  if (offenders.length === 0) return '';
  const unique = [...new Set(offenders)];
  return ` — NOTE: the title contains ${unique.join(', ')}, which Node refuses to put in an HTTP header. `
    + `The archive service copies the title into S3 user metadata, and user metadata is sent as the `
    + `x-amz-meta-* request headers, so this throws ERR_INVALID_CHAR inside the SDK and surfaces as `
    + `exactly this 500. If that is the cause, the fix is in lambda-functions/archive/upload-archive.js `
    + `and the archive service needs redeploying (scripts/deploy-archive.sh) — the title itself is fine.`;
}

async function upload(item, label) {
  const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
  if (bytes > MAX_ITEM_BYTES) {
    throw new Error(`${label} is ${(bytes / 1048576).toFixed(1)} MB as a snapshot, over the archive service's `
      + '6 MB request limit, so it was not archived.');
  }
  try {
    return await archive.uploadItem(item);
  } catch (error) {
    throw new Error(`Archive upload failed for ${label}: ${error.message}${describeTitleHazard(item.title)}`);
  }
}

async function exportSet(ref, tier, results) {
  if (ref.scope === tenant.ORG) return refuse(results, ref, ORG_REFUSAL);
  if (ref.scope !== tenant.PLATFORM && ref.scope !== tenant.PUBLIC) return refuse(results, ref, `Unknown library ${JSON.stringify(ref.scope)}.`);
  if (!ref.id) return refuse(results, ref, 'No set id was given.');

  const sref = setRef({ scope: ref.scope, setId: ref.id });
  const found = await db.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: setMetadataKey(sref) }));
  const meta = found && found.Item;
  if (!meta) {
    results.failed.push({ id: ref.id, scope: ref.scope, error: `Question set not found in the ${ref.scope} library` });
    return undefined;
  }

  const resolved = resolvePartitionFromMeta(sref, meta, null);
  /*
    QUERY, PAGINATED: every row of the resolved partition, following LastEvaluatedKey to the
    end. This was once a Scan with a filter, which read one 1 MB page of the whole table and
    silently exported nothing for a set whose rows sat outside it
    (tests/export-to-archive-read.js). queryPartition is the shared paginated read.
  */
  const { items: rows } = await queryPartition(db, process.env.TABLE_NAME, resolved.pk);
  const questionCount = rows.filter((row) => String(row.SK).startsWith('QUESTION#')).length;
  if (questionCount === 0) {
    results.failed.push({
      id: ref.id,
      scope: ref.scope,
      error: `No questions found in partition ${resolved.pk}. The set metadata says `
        + `${meta.questionCount ?? 'an unknown number of'} questions, so this is a read problem, not an empty set.`,
    });
    return undefined;
  }

  const ciphertext = snap.findCiphertext({ metadata: meta, rows });
  if (ciphertext.length > 0) {
    return refuse(results, ref, `This set carries encrypted values (${ciphertext.slice(0, 3).join(', ')}), `
      + 'which cannot be read outside their organisation, so it is not archived.');
  }

  let promptName = '';
  if (meta.promptId) {
    const linked = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME, Key: promptKey({ scope: tenant.PLATFORM, promptId: meta.promptId }),
    }));
    promptName = linked && linked.Item && typeof linked.Item.name === 'string' ? linked.Item.name : '';
  }

  const snapshotId = crypto.randomUUID();
  const { media, missing } = await copyMediaOut(s3Client, {
    mediaBucket: process.env.MEDIA_BUCKET, archiveBucket: process.env.ARCHIVE_BUCKET, snapshotId, rows,
  });
  const envelope = snap.buildSetEnvelope({
    tier, scope: ref.scope, setId: ref.id, version: resolved.version, metadata: meta, rows, media,
    snapshotId, exportedAt: new Date().toISOString(), promptName,
  });
  const item = {
    title: meta.name || ref.id,
    description: meta.description || '',
    content: JSON.stringify(envelope),
    contentType: 'questionset',
    category: meta.engagementType || 'general',
    fileName: `${ref.id}.snapshot.json`,
    tags: snap.envelopeTags(envelope, [
      meta.engagementType || 'call-and-answer',
      `questions:${questionCount}`,
      ...(meta.isAIGenerated ? ['ai-generated'] : []),
      ...(promptName ? [promptLinkTag(promptName)] : []),
    ]),
  };
  const uploaded = await upload(item, `"${meta.name}" (${ref.id})`);
  results.successful.push({
    id: ref.id, scope: ref.scope, name: meta.name, archiveId: uploaded.archiveId, snapshotId,
    questionsCount: questionCount, media: { copied: media.length, missing },
  });
  return undefined;
}

async function exportPrompt(ref, tier, results) {
  if (ref.scope === tenant.ORG) return refuse(results, ref, ORG_REFUSAL);
  if (ref.scope === tenant.PUBLIC) return refuse(results, ref, 'Public prompts are not archived: nothing in this product writes public prompts.');
  if (ref.scope !== tenant.PLATFORM) return refuse(results, ref, `Unknown library ${JSON.stringify(ref.scope)}.`);
  if (!ref.id) return refuse(results, ref, 'No prompt id was given.');
  const promptId = ref.id;

  const found = await db.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: promptKey({ scope: tenant.PLATFORM, promptId }) }));
  const prompt = found && found.Item;
  if (!prompt) {
    results.failed.push({ id: promptId, scope: ref.scope, error: 'AI prompt not found' });
    return undefined;
  }

  /*
    A PROMPT IS A TWO-STORE RECORD: the row, and the body in AI_PROMPTS_BUCKET at `s3Key`. An
    unreadable body is a named failure, never an archived empty shell (338af103). The one
    exception is a prompt whose text lives ON the row (the gen-* rows, written without an
    s3Key). The row IS that prompt, so it is archived with `body: null`.
  */
  let body = null;
  if (prompt.s3Key) {
    if (!process.env.AI_PROMPTS_BUCKET) {
      results.failed.push({
        id: promptId, name: prompt.name, step: 'config',
        error: 'AI_PROMPTS_BUCKET is not set on the export function, so no prompt body can be read. '
          + 'This is a deployment fault, not a problem with this prompt: every prompt in this run will '
          + 'fail the same way. Redeploy with AI_PROMPTS_BUCKET and an S3 read policy on the AI prompts '
          + 'bucket (template-clean.yaml, AdminExportToArchiveFunction).',
      });
      return undefined;
    }
    try {
      const response = await s3Client.send(new GetObjectCommand({ Bucket: process.env.AI_PROMPTS_BUCKET, Key: prompt.s3Key }));
      body = JSON.parse(await response.Body.transformToString());
      if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
        throw new Error(`body parsed to ${JSON.stringify(body)} — no fields`);
      }
    } catch (s3Error) {
      results.failed.push({
        id: promptId, name: prompt.name, step: 's3-read-body',
        error: `Could not read the prompt body at s3://${process.env.AI_PROMPTS_BUCKET}/${prompt.s3Key} `
          + `(${s3Error.name}: ${s3Error.message}). The DynamoDB pointer exists but its body does not, `
          + 'so this is a read problem, not an empty prompt — archiving it would have stored a hollow '
          + 'record and called it a success.',
      });
      return undefined;
    }
  } else if (!snap.rowCarriesPromptText(prompt)) {
    results.failed.push({
      id: promptId, name: prompt.name, step: 's3-read-body',
      error: `Prompt ${promptId} ("${prompt.name}") has no s3Key on its DynamoDB row and no text on the row itself, `
        + 'so there is nothing to archive. Archiving it would store an empty prompt and report success. '
        + 'This is a broken record, not an empty prompt.',
    });
    return undefined;
  }

  const ciphertext = snap.findCiphertext({ metadata: prompt, body });
  if (ciphertext.length > 0) {
    return refuse(results, ref, `This prompt carries encrypted values (${ciphertext.slice(0, 3).join(', ')}), `
      + 'which cannot be read outside their organisation, so it is not archived.');
  }

  const envelope = snap.buildPromptEnvelope({
    tier, scope: tenant.PLATFORM, promptId, metadata: prompt, body, exportedAt: new Date().toISOString(),
  });
  const item = {
    title: prompt.name || promptId,
    description: prompt.description || '',
    content: JSON.stringify(envelope, null, 2),
    contentType: 'prompt',
    category: prompt.gameType || 'general',
    fileName: `${promptId}.snapshot.json`,
    tags: snap.envelopeTags(envelope, [
      prompt.gameType || 'general',
      prompt.category || 'uncategorized',
      prompt.status || 'active',
      ...(prompt.isDefault ? ['default'] : []),
    ]),
  };
  const uploaded = await upload(item, `"${prompt.name}" (${promptId})`);
  results.successful.push({ id: promptId, scope: tenant.PLATFORM, name: prompt.name, archiveId: uploaded.archiveId, gameType: prompt.gameType });
  return undefined;
}
