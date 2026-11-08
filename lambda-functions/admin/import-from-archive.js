/**
 * RESTORE FROM THE SHARED ARCHIVE — into Engage's library, and nowhere else.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.3, §4.4 and §4.8.
 *
 * WHO: canManageScope(event, PLATFORM), checked here. The route's `admins` gate alone let an
 * Engage admin standing inside a customer team restore into the library every organisation
 * reads.
 *
 * WHAT IS DECIDED BY CONTENT, per item. A JSON document with a `schema` is a snapshot
 * (shared/archive-snapshot.js), restored by shared/archive-restore.js under its original id.
 * Anything else was written before snapshots existed: a CSV question set or a
 * `{metadata, prompt}` JSON prompt. Those take the legacy path below, which keeps working with
 * two corrections: no suffixes are added, and a set lands inactive, because the item never
 * recorded whether the set was live.
 *
 * WHAT IT SAYS: per item what happened, which sets are now live for every organisation, and
 * which images could not be brought back, so a restore cannot quietly publish anything. One
 * bad item is reported and the rest carry on.
 *
 * THEN IT CHECKS. Each restored set is read back and its live question and category counts are
 * reported beside the snapshot's (`check` on the entry), so "it worked" is a read, not a claim.
 *
 * PROMPTS GO FIRST. Every item in the batch is downloaded and parsed before anything is written,
 * then restored prompts-before-sets (batchInOrder), so a set whose prompt travels in the same
 * batch links to the copy that has just landed here, not to whatever this tier had before or to
 * nothing. The dry run lists them in the same order.
 *
 * `dryRun: true` ASKS WHAT WOULD HAPPEN, AND WRITES NOTHING. Each item is downloaded and parsed,
 * the set or prompt it names is looked up, and the answer is per item: a new set or a new
 * version of vN, whether that one is live now, its counts, and whether it will be active on
 * arrival. No row, no object and no image is written (tests/archive-import-handler.js §5).
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { queryPartition } = require('./shared/set-version');
const { promptKey, promptBodyKey } = require('./shared/prompt-access');
const { callerUserId } = require('./shared/question-set-access');
const { normalizeGameType, DEFAULT_GAME_TYPE } = require('./shared/game-types');
const { inferPromptType } = require('./shared/prompt-shape');
const promptVersions = require('./shared/prompt-versions');
const { promptNameFromTags, resolveLocalPromptId } = require('./shared/archive-prompt-link');
const archive = require('./shared/archive-client');
const snap = require('./shared/archive-snapshot');
const {
  restoreSetSnapshot, restorePromptSnapshot, snapshotCounts, planSetSnapshot, planPromptSnapshot,
  checkRestoredSet, checkRestoredPrompt,
} = require('./shared/archive-restore');

const db = DynamoDBDocumentClient.from(new DynamoDBClient());
const s3Client = new S3Client({});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engage-Org',
};
const respond = (statusCode, body) => ({ statusCode, headers: corsHeaders, body: JSON.stringify(body) });

/** What the pre-snapshot exporter appended to titles and descriptions, and a restore now strips. */
const TIER_SUFFIX = /\s*\((dev|test|prod|unknown)\)\s*$/i;
const EXPORT_NOTE = /\s*-\s*Exported from (dev|test|prod|unknown) environment\s*$/i;
const LEGACY_TYPES = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];

/**
 * A legacy item whose content parsed as a JSON object is a `{metadata, prompt}` prompt, whatever
 * its row says: the pre-snapshot exporter wrote every set as CSV, which never parses as JSON.
 * Decided by content because the row's ContentType is not always there to ask.
 */
const isLegacyPromptDoc = (doc) => Boolean(doc) && typeof doc === 'object' && !Array.isArray(doc);

/** Is this downloaded item a prompt, snapshot or legacy? */
const isPromptItem = ({ item, parsed }) => parsed.kind === 'prompt'
  || (parsed.kind === 'legacy' && (item.ContentType === 'prompt' || isLegacyPromptDoc(parsed.doc)));

/**
 * Download and parse every item, then put the prompts first, keeping the order asked within each
 * kind. An item that cannot be downloaded or parsed is returned as `{archiveId, error}` in place.
 */
async function batchInOrder(selectedItems) {
  const loaded = [];
  for (const raw of selectedItems) {
    const archiveId = String(raw || '').trim();
    try {
      // eslint-disable-next-line no-await-in-loop
      const { item, content } = await archive.downloadItem(archiveId);
      loaded.push({ archiveId, item, content, parsed: snap.parseArchiveContent(content) });
    } catch (error) {
      loaded.push({ archiveId, error });
    }
  }
  const rank = (entry) => (!entry.error && isPromptItem(entry) ? 0 : 1);
  return loaded.map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
}

exports.handler = async (event) => {
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM)) {
    return respond(403, { error: "Restoring writes Engage's library. Switch to Engage (no organisation selected) to restore from the archive." });
  }
  let payload;
  try {
    payload = JSON.parse((event && event.body) || '{}');
  } catch {
    return respond(400, { error: 'Request body is not valid JSON.' });
  }
  const { selectedItems } = payload;
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    return respond(400, { error: 'selectedItems array is required and must not be empty' });
  }
  if (payload.dryRun === true) return respond(200, await planRestore(selectedItems));

  const deps = {
    db,
    s3: s3Client,
    tableName: process.env.TABLE_NAME,
    promptsBucket: process.env.AI_PROMPTS_BUCKET,
    mediaBucket: process.env.MEDIA_BUCKET,
    archiveBucket: process.env.ARCHIVE_BUCKET,
  };
  const results = { successful: [], failed: [], totalRequested: selectedItems.length };
  const becameActive = [];
  const media = { copied: 0, kept: 0, missing: [], skipped: [], external: [] };

  for (const loaded of await batchInOrder(selectedItems)) {
    const { archiveId } = loaded;
    try {
      if (loaded.error) throw loaded.error;
      const { item, content, parsed } = loaded;

      if (parsed.kind === 'unknown') {
        results.failed.push({ archiveId, refused: true, error: `This backup uses a format this version does not read (${JSON.stringify(parsed.schema)}), so it is not restored.` });
        continue;
      }

      if (parsed.kind === 'legacy') {
        const entry = item.ContentType === 'prompt' || isLegacyPromptDoc(parsed.doc)
          ? await restoreLegacyPrompt(archiveId, item, parsed.doc)
          : await restoreLegacySet(event, archiveId, item, content);
        if (entry.kind === 'set' && entry.id) {
          entry.check = await checkRestoredSet(deps, entry.id, { questions: entry.questionCount ?? null, categories: null });
        }
        if (entry.kind === 'prompt' && entry.id) {
          entry.check = await checkRestoredPrompt(deps, entry.id, { version: entry.version, status: entry.status, name: entry.name });
        }
        results.successful.push(entry);
        continue;
      }

      const refusal = snap.refusalFor(parsed.envelope);
      if (refusal) {
        results.failed.push({ archiveId, refused: true, error: refusal });
        continue;
      }
      const ctx = { archiveId, restoredBy: callerUserId(event) };
      const outcome = parsed.kind === 'set'
        ? await restoreSetSnapshot(deps, parsed.envelope, ctx)
        : await restorePromptSnapshot(deps, parsed.envelope, ctx);
      const { media: restoredMedia, wasActive, ...entry } = outcome;
      const check = parsed.kind === 'set'
        ? await checkRestoredSet(deps, outcome.id, snapshotCounts(parsed.envelope))
        : await checkRestoredPrompt(deps, outcome.id, { version: outcome.version, status: outcome.status, name: outcome.name });
      results.successful.push({ archiveId, ...entry, ...(check ? { check } : {}) });
      if (restoredMedia) {
        media.copied += restoredMedia.copied;
        media.kept += restoredMedia.kept;
        media.missing.push(...restoredMedia.missing);
        media.skipped.push(...restoredMedia.skipped);
        media.external.push(...(restoredMedia.external || []));
      }
      if (outcome.kind === 'set' && outcome.active === true && wasActive !== true) {
        becameActive.push({ id: outcome.id, name: outcome.name });
      }
    } catch (error) {
      console.error(`❌ restore of ${archiveId} failed:`, error);
      results.failed.push({ archiveId, error: error.message });
    }
  }

  console.log(`✅ Restore finished. Restored ${results.successful.length}, not restored ${results.failed.length}`);
  return respond(200, {
    message: `Import completed. ${results.successful.length} items restored.`,
    results,
    becameActive,
    media,
  });
};

/**
 * THE DRY RUN. The same per-item decisions as the restore loop above — unknown schema, legacy,
 * refusal, snapshot — answered with reads only. A legacy item is described from its row, since
 * its restore goes through upload-questions.js, which this must not call.
 */
async function planRestore(selectedItems) {
  const deps = { db, tableName: process.env.TABLE_NAME };
  const plan = [];
  const failed = [];
  for (const loaded of await batchInOrder(selectedItems)) {
    const { archiveId } = loaded;
    try {
      if (loaded.error) throw loaded.error;
      const { item, parsed } = loaded;
      if (parsed.kind === 'unknown') {
        failed.push({ archiveId, refused: true, error: `This backup uses a format this version does not read (${JSON.stringify(parsed.schema)}), so it would not be restored.` });
        continue;
      }
      if (parsed.kind === 'legacy') {
        const isPrompt = item.ContentType === 'prompt' || isLegacyPromptDoc(parsed.doc);
        const tags = Array.isArray(item.Tags) ? item.Tags : [];
        const countTag = tags.map(String).find((tag) => /^questions:\d+$/.test(tag));
        plan.push(isPrompt
          ? { archiveId, kind: 'prompt', name: String((parsed.doc && parsed.doc.metadata && parsed.doc.metadata.name) || item.Title || '').replace(TIER_SUFFIX, '').trim(), mode: 'created', status: 'draft', legacy: true }
          : { archiveId, kind: 'set', name: String(item.Title || '').replace(TIER_SUFFIX, '').trim(), mode: 'created', active: false, legacy: true, questionCount: countTag ? Number(countTag.slice(10)) : null, categoryCount: null });
        continue;
      }
      const refusal = snap.refusalFor(parsed.envelope);
      if (refusal) {
        failed.push({ archiveId, refused: true, error: refusal });
        continue;
      }
      const entry = parsed.kind === 'set'
        ? await planSetSnapshot(deps, parsed.envelope)
        : await planPromptSnapshot(deps, parsed.envelope);
      plan.push({ archiveId, ...entry });
    } catch (error) {
      failed.push({ archiveId, error: error.message });
    }
  }
  return { dryRun: true, plan, failed, totalRequested: selectedItems.length };
}

/** The environment a legacy item was tagged with. */
function legacyTier(tags) {
  const found = (Array.isArray(tags) ? tags : []).map((tag) => String(tag).toLowerCase()).find((tag) => snap.TIERS.includes(tag));
  return found || 'unknown';
}

/** Re-link a legacy set to a local prompt by the name its tags carry, or '' for none. */
async function legacyPromptLink(archiveId, tags) {
  const wanted = promptNameFromTags(tags);
  if (!wanted) return '';
  const { items } = await queryPartition(db, process.env.TABLE_NAME, tenant.promptsMetadataPk(tenant.PLATFORM), 'AIPROMPT#');
  const { promptId, matched } = resolveLocalPromptId(wanted, items);
  if (matched === 0) console.warn(`⚠️ ${archiveId}: no local prompt named "${wanted}" — restoring unlinked`);
  if (matched > 1) console.warn(`⚠️ ${archiveId}: ${matched} local prompts named "${wanted}"; linked the first (${promptId})`);
  return promptId;
}

/**
 * A CSV question set from before snapshots: through upload-questions.js, as the ADMIN who asked
 * (so the set is owned by them and created in platform), inactive, with its original name.
 * A name that is already taken is refused by upload-questions itself. With no suffix there
 * is no automatic rename, and overwriting a live set from a CSV of unknown age is not a restore.
 */
async function restoreLegacySet(event, archiveId, item, csv) {
  const name = String(item.Title || '').replace(TIER_SUFFIX, '').trim();
  if (!name) throw new Error('This legacy item has no title to name the set with.');
  const tags = Array.isArray(item.Tags) ? item.Tags : [];
  const engagementType = tags.map((tag) => String(tag).toLowerCase()).find((tag) => LEGACY_TYPES.includes(tag)) || 'call-and-answer';
  const promptId = await legacyPromptLink(archiveId, tags);
  const uploadQuestions = require('./upload-questions');
  const response = await uploadQuestions.handler({
    requestContext: event.requestContext,
    body: JSON.stringify({
      fileName: `${name}.csv`,
      fileContent: csv,
      customTitle: name,
      customDescription: String(item.Description || '').replace(EXPORT_NOTE, '').trim(),
      promptId,
      engagementType,
      isAIGenerated: false,
      startInactive: true,
      scope: tenant.PLATFORM,
    }),
  });
  let body = {};
  try { body = JSON.parse(response.body || '{}'); } catch { body = {}; }
  if (response.statusCode !== 200) throw new Error(body.error || `The legacy restore was refused (${response.statusCode}).`);
  return {
    archiveId, kind: 'set', id: body.setId, name: body.setName || name, mode: 'created',
    // The version the import actually wrote, not a hardcoded null. A pre-snapshot
    // CSV carries no version OF ITS OWN — that is what `legacy: true` says — but
    // the set it is restored INTO is created at v1 like any other, and reporting
    // null here told the restore screen otherwise.
    version: body.version ?? null, active: false, legacy: true, questionCount: body.questionCount,
  };
}

/**
 * A `{metadata, prompt}` prompt from before snapshots: a DRAFT copy under a new id, with its
 * body written to S3 the way create-ai-prompt.js writes one. Unchanged from the importer this
 * replaces, apart from the suffixes it no longer adds.
 */
async function restoreLegacyPrompt(archiveId, item, doc) {
  const { metadata = {}, prompt } = doc || {};
  if (!prompt || typeof prompt !== 'object') throw new Error('This legacy prompt item has no prompt body.');
  if (!process.env.AI_PROMPTS_BUCKET) {
    throw new Error('AI_PROMPTS_BUCKET is not set on the import function, so the prompt body cannot be stored. '
      + 'This is a deployment fault, not a problem with this archive item. Redeploy with AI_PROMPTS_BUCKET and an '
      + 'S3 write policy (template-clean.yaml, AdminImportFromArchiveFunction).');
  }
  const promptId = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const now = new Date().toISOString();
  const gameType = normalizeGameType(metadata.gameType) || DEFAULT_GAME_TYPE;
  const promptType = metadata.promptType || inferPromptType(prompt);
  const name = String(metadata.name || item.Title || '').replace(TIER_SUFFIX, '').trim() || promptId;

  // Everything the item carried, minus the two legacy aliases older exports added. They
  // duplicate instructions and outputFormat, and are promoted into them when those are absent.
  const { systemPrompt, userPrompt, ...bodyFields } = prompt;
  const body = {
    ...bodyFields,
    id: promptId, version: 1, name, gameType, promptType, isDefault: false, status: 'draft', createdAt: now, updatedAt: now,
    ...(bodyFields.instructions === undefined && systemPrompt ? { instructions: systemPrompt } : {}),
    ...(bodyFields.outputFormat === undefined && userPrompt ? { outputFormat: userPrompt } : {}),
  };
  const ref = { scope: tenant.PLATFORM, promptId };
  const s3Key = promptBodyKey(ref, gameType, 1);
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.AI_PROMPTS_BUCKET,
    Key: s3Key,
    Body: JSON.stringify(body, null, 2),
    ContentType: 'application/json',
    Metadata: { promptId, gameType, version: '1', status: 'draft' },
  }));
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      ...promptKey(ref),
      promptId,
      name,
      description: metadata.description || '',
      gameType,
      promptType,
      category: metadata.category || 'imported',
      status: 'draft',
      isDefault: false,
      ...(body.scenario && { scenario: body.scenario }),
      ...(body.scenarioType && { scenarioType: body.scenarioType }),
      ...(body.basePrompt && { basePrompt: body.basePrompt }),
      ...(body.contextTemplate && { contextTemplate: body.contextTemplate }),
      ...(body.audienceTemplate && { audienceTemplate: body.audienceTemplate }),
      ...(body.categoryTemplate && { categoryTemplate: body.categoryTemplate }),
      ...(body.outputFormat && { outputFormat: body.outputFormat }),
      ...(body.outputSections && { outputSections: body.outputSections }),
      ...(body.defaultSettings && { defaultSettings: body.defaultSettings }),
      questionSetIds: [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      s3Key,
      version: 1,
      latestVersion: 1,
      versionHistory: [promptVersions.historyEntry({
        version: 1, s3Key, savedAt: now, by: 'admin import', how: promptVersions.HOW.ARCHIVE,
        hash: promptVersions.contentHash(body),
      })],
      createdAt: now,
      updatedAt: now,
      importedFrom: { archiveId, originalId: metadata.promptId, importedAt: now, sourceEnvironment: legacyTier(item.Tags) },
    },
  }));
  return { archiveId, kind: 'prompt', id: promptId, name, mode: 'created', version: 1, status: 'draft', isDefault: false, legacy: true };
}
