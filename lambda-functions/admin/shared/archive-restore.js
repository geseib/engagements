/**
 * PUTTING A BACKUP BACK — into Engage's library, and nowhere else.
 *
 * spec §4.3. Every restore lands in PLATFORM, whatever library the backup came from. A public
 * set comes back as a house copy (D3). An org backup never reaches this module:
 * archive-snapshot.js refusalFor stops it in the handler.
 *
 * A SET THAT EXISTS GETS A NEW VERSION, AND ONLY THEN BECOMES CURRENT (D2). This is the
 * write-content-then-flip sequence upload-questions.js uses for a replace, so a failure part
 * way leaves the live set exactly as it was, and the previous version stays one click away on
 * the versions screen. A set that does not exist is recreated under its ORIGINAL id, so games,
 * prompts and bookmarks that name it find it again.
 *
 * A PROMPT that exists gets a new version of THAT prompt; one that does not is recreated under
 * its id. A restore never changes which prompt is a default (A9).
 */
const { GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const tenant = require('./tenant');
const {
  setRef, setPartition, setMetadataKey, queryPartition, batchPutItems, copyPartition,
  knownVersions, nextVersion, toVersion,
} = require('./set-version');
const { batchDeleteKeys } = require('./ddb-delete');
const { promptKey, promptBodyKey } = require('./prompt-access');
const { resolveLocalPromptId } = require('./archive-prompt-link');
const { normalizeGameType, DEFAULT_GAME_TYPE } = require('./game-types');
const { copyMediaIn } = require('./archive-media');
const snap = require('./archive-snapshot');

const nowIso = (deps) => (deps.now ? deps.now() : new Date().toISOString());

/** The prompt a restored set should name on THIS tier, or '' for none. */
async function resolvePromptLink(deps, envelope) {
  const wanted = String((envelope.metadata && envelope.metadata.promptId) || '').trim();
  if (wanted) {
    const found = await deps.db.send(new GetCommand({
      TableName: deps.tableName, Key: promptKey({ scope: tenant.PLATFORM, promptId: wanted }),
    }));
    if (found && found.Item) return wanted;
  }
  const name = String((envelope.links && envelope.links.promptName) || '').trim();
  if (!name) return '';
  const { items } = await queryPartition(deps.db, deps.tableName, tenant.promptsMetadataPk(tenant.PLATFORM), 'AIPROMPT#');
  return resolveLocalPromptId(name, items).promptId;
}

async function restoreSetSnapshot(deps, envelope, ctx) {
  const { db, tableName } = deps;
  const now = nowIso(deps);
  const from = envelope.exportedFrom || {};
  const setId = String(from.setId || '').trim();
  if (!setId) throw new Error('This backup names no set id, so there is nothing to restore it as.');

  const rows = (Array.isArray(envelope.rows) ? envelope.rows : [])
    .filter((row) => !snap.LIFECYCLE_SKS.includes(String(row && row.SK)));
  if (rows.some((row) => !row || typeof row.SK !== 'string' || row.SK === '')) {
    throw new Error('This backup has a row with no SK, so its structure cannot be rebuilt.');
  }
  const questions = rows.filter((row) => row.SK.startsWith('QUESTION#'));
  if (questions.length === 0) throw new Error('This backup holds no questions, so there is nothing to restore.');
  const categoryCount = rows.filter((row) => row.SK.startsWith('CATEGORY#')).length;
  const hasImages = questions.some((question) => String(question.Image || '').trim() !== '');

  const ref = setRef({ scope: tenant.PLATFORM, setId });
  const found = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(ref) }));
  let existing = found && found.Item;
  const promptId = await resolvePromptLink(deps, envelope);
  const restoredFrom = snap.provenance(envelope, ctx.archiveId);

  // A set that has never been versioned keeps its content in the legacy partition. Snapshot it
  // to v1 first, exactly as a replace does (upload-questions.js), so what this restore
  // supersedes is still a version rather than a partition nothing lists.
  let seed = [];
  let targetVersion = 1;
  if (existing) {
    const versioned = toVersion(existing.activeVersion) !== null || knownVersions(existing).length > 0;
    if (versioned) {
      seed = Array.isArray(existing.versions) ? existing.versions : [];
    } else {
      const legacyPk = setPartition(ref, null);
      const { items: legacyRows } = await queryPartition(db, tableName, legacyPk);
      if (legacyRows.length > 0) {
        await copyPartition(db, tableName, legacyPk, setPartition(ref, 1));
        seed = [{
          version: 1,
          createdAt: existing.createdAt || now,
          questionCount: existing.questionCount || 0,
          categoryCount: existing.categoryCount || 0,
          sourceFile: existing.sourceFile || '',
          note: 'snapshot of the pre-versioning content',
        }];
        existing = { ...existing, versions: seed };
      }
    }
    targetVersion = nextVersion(existing);
  }

  const contentPk = setPartition(ref, targetVersion);
  const items = rows.map((row) => ({ ...row, PK: contentPk }));
  try {
    await batchPutItems(db, tableName, items);
  } catch (error) {
    try {
      await batchDeleteKeys(db, tableName, items.map(({ PK, SK }) => ({ PK, SK })));
    } catch (cleanup) {
      console.error(`⚠️ rollback of ${contentPk} was incomplete: ${cleanup.message}`);
    }
    throw new Error(`Writing v${targetVersion} of "${setId}" failed: ${error.message}. `
      + (existing ? 'The live set is untouched.' : 'Nothing was left behind.'));
  }

  const media = await copyMediaIn(deps.s3, { mediaBucket: deps.mediaBucket, archiveBucket: deps.archiveBucket, media: envelope.media });

  const note = `Restored from archive ${ctx.archiveId}, exported ${envelope.exportedAt} from ${from.tier}`
    + (from.version ? ` (it was v${from.version} there)` : '');
  const versionEntry = {
    version: targetVersion, createdAt: now, questionCount: questions.length, categoryCount,
    sourceFile: `archive:${ctx.archiveId}`, note,
  };
  const settings = snap.settingsFrom(envelope.metadata);
  if (promptId) settings.promptId = promptId; else delete settings.promptId;
  const snapshotActive = typeof (envelope.metadata && envelope.metadata.active) === 'boolean' ? envelope.metadata.active : null;

  if (!existing) {
    const item = {
      ...snap.platformMetadata(envelope.metadata, restoredFrom),
      ...setMetadataKey(ref),
      activeVersion: 1,
      versions: [versionEntry],
      questionCount: questions.length,
      categoryCount,
      hasImages,
      // No recorded status is not permission to publish: an active Engage set is live for every organisation.
      active: snapshotActive === null ? false : snapshotActive,
      restoredAt: now,
      ...(ctx.restoredBy ? { restoredBy: ctx.restoredBy } : {}),
      updatedAt: now,
    };
    if (promptId) item.promptId = promptId; else delete item.promptId;
    await db.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(SK)' }));
    return { kind: 'set', id: setId, name: item.name || setId, mode: 'created', version: 1, active: item.active, wasActive: false, media };
  }

  // THE FLIP. One update carries the pointer, the version list, the counts and the settings,
  // so the live row never names the new version while still holding the old settings.
  const names = { '#versions': 'versions' };
  const values = { ':seed': seed, ':entry': [versionEntry] };
  const sets = ['#versions = list_append(if_not_exists(#versions, :seed), :entry)'];
  const removes = [];
  const assign = (attr, value) => {
    names[`#${attr}`] = attr;
    values[`:${attr}`] = value;
    sets.push(`#${attr} = :${attr}`);
  };
  assign('activeVersion', targetVersion);
  assign('questionCount', questions.length);
  assign('categoryCount', categoryCount);
  assign('hasImages', hasImages);
  assign('updatedAt', now);
  assign('restoredAt', now);
  assign('restoredFrom', restoredFrom);
  if (ctx.restoredBy) assign('restoredBy', ctx.restoredBy);
  for (const attr of snap.SET_SETTINGS) {
    if (Object.prototype.hasOwnProperty.call(settings, attr)) {
      assign(attr, settings[attr]);
    } else {
      names[`#${attr}`] = attr;
      removes.push(`#${attr}`);
    }
  }
  if (snapshotActive !== null) assign('active', snapshotActive);

  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: setMetadataKey(ref),
    UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(SK)',
  }));

  const wasActive = existing.active !== false;
  return {
    kind: 'set', id: setId, name: settings.name || existing.name || setId, mode: 'new-version',
    version: targetVersion, active: snapshotActive === null ? wasActive : snapshotActive, wasActive, media,
  };
}

async function restorePromptSnapshot(deps, envelope, ctx) {
  const { db, tableName } = deps;
  const now = nowIso(deps);
  const from = envelope.exportedFrom || {};
  const promptId = String(from.promptId || '').trim();
  if (!promptId) throw new Error('This backup names no prompt id, so there is nothing to restore it as.');

  const metadata = envelope.metadata || {};
  const hasBody = Boolean(envelope.body) && typeof envelope.body === 'object';
  if (!hasBody && !snap.rowCarriesPromptText(metadata)) {
    throw new Error(`This backup of prompt ${promptId} has no body and no text on its row, so restoring it would create an empty prompt.`);
  }
  if (hasBody && !deps.promptsBucket) {
    throw new Error('AI_PROMPTS_BUCKET is not set on the import function, so the prompt body cannot be stored. '
      + 'This is a deployment fault, not a problem with this backup (template-clean.yaml, AdminImportFromArchiveFunction).');
  }

  const ref = { scope: tenant.PLATFORM, promptId };
  const found = await db.send(new GetCommand({ TableName: tableName, Key: promptKey(ref) }));
  const existing = found && found.Item;
  const gameType = normalizeGameType(metadata.gameType) || DEFAULT_GAME_TYPE;
  const numeric = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  // A version number neither tier has used, so no body key from either history is overwritten.
  const version = Math.max(numeric(existing && existing.version), numeric(metadata.version)) + 1;
  const isDefault = existing ? existing.isDefault === true : false;
  const status = metadata.status || 'draft';

  let s3Key;
  if (hasBody) {
    s3Key = promptBodyKey(ref, gameType, version);
    const body = { ...envelope.body, id: promptId, version, gameType, isDefault, status, updatedAt: now };
    await deps.s3.send(new PutObjectCommand({
      Bucket: deps.promptsBucket,
      Key: s3Key,
      Body: JSON.stringify(body, null, 2),
      ContentType: 'application/json',
      Metadata: { promptId, gameType, version: String(version), status: String(status) },
    }));
  }

  const row = {
    ...snap.platformMetadata(metadata, snap.provenance(envelope, ctx.archiveId)),
    ...promptKey(ref),
    promptId,
    gameType,
    version,
    isDefault,
    status,
    updatedAt: now,
    restoredAt: now,
    ...(ctx.restoredBy ? { restoredBy: ctx.restoredBy } : {}),
  };
  if (s3Key) row.s3Key = s3Key; else delete row.s3Key;
  await db.send(new PutCommand({ TableName: tableName, Item: row }));
  return { kind: 'prompt', id: promptId, name: row.name || promptId, mode: existing ? 'new-version' : 'created', version, status, isDefault };
}

module.exports = { restoreSetSnapshot, restorePromptSnapshot, resolvePromptLink };
