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
 *
 * A RESTORE NEVER WRITES INTO A VERSION PARTITION THAT ALREADY HOLDS ROWS. `nextVersion` reads
 * only the metadata row, and the partition it names can already hold rows: a replace whose
 * flip failed leaves them there on purpose (upload-questions.js), and a failed flip or create
 * here does the same. A batch write only overwrites the SKs it names, so writing into such a
 * partition and flipping to it would make live the UNION of two writes. Each content partition
 * is therefore the first EMPTY version number at or after the predicted one, and images are
 * copied before any row is written. Debris is stepped over, never deleted or overwritten.
 */
const { GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const tenant = require('./tenant');
const {
  setRef, setPartition, setMetadataKey, queryPartition, batchPutItems,
  knownVersions, nextVersion, toVersion, firstEmptyVersion,
} = require('./set-version');
const { batchDeleteKeys } = require('./ddb-delete');
const { promptKey, promptBodyKey } = require('./prompt-access');
const promptVersions = require('./prompt-versions');
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

  // Images first, before any row is written. copyMediaIn never overwrites an object that is
  // already there, so a media fault (a missing bucket, AccessDenied — deployment faults, which
  // it rethrows) costs at most an orphaned copy, never a half-written version.
  const media = await copyMediaIn(deps.s3, { mediaBucket: deps.mediaBucket, archiveBucket: deps.archiveBucket, media: envelope.media });

  // A set that has never been versioned keeps its content in the legacy partition. Snapshot it
  // to a version first (v1, unless v1 already holds debris), exactly as a replace does
  // (upload-questions.js), so what this restore supersedes is still a version rather than a
  // partition nothing lists.
  let seed = [];
  let targetVersion;
  if (existing) {
    const versioned = toVersion(existing.activeVersion) !== null || knownVersions(existing).length > 0;
    if (versioned) {
      seed = Array.isArray(existing.versions) ? existing.versions : [];
    } else {
      const legacyPk = setPartition(ref, null);
      const { items: legacyRows } = await queryPartition(db, tableName, legacyPk);
      // EXCEPT THE REVIEW AND PUBLISHED ROWS, which are not content. A set that was checked or
      // shared before it was ever versioned carries them in this same legacy partition
      // (set-review.js resolves a legacy ref's review/published key to the unsuffixed
      // partition), and copying them onto the snapshot would misdescribe it: the snapshot's own
      // REVIEW row is per-version, and a stray PUBLISHED marker would claim it was already
      // shared. copy-question-set.js and upload-questions.js's own legacy-replace path skip
      // them for the same reason.
      const publishableLegacyRows = legacyRows.filter((row) => !snap.LIFECYCLE_SKS.includes(String(row.SK)));
      if (publishableLegacyRows.length > 0) {
        const legacyVersion = await firstEmptyVersion(db, tableName, ref, 1);
        const legacyCopies = publishableLegacyRows.map((row) => ({ ...row, PK: setPartition(ref, legacyVersion) }));
        await batchPutItems(db, tableName, legacyCopies);
        seed = [{
          version: legacyVersion,
          createdAt: existing.createdAt || now,
          questionCount: existing.questionCount || 0,
          categoryCount: existing.categoryCount || 0,
          sourceFile: existing.sourceFile || '',
          note: 'snapshot of the pre-versioning content',
        }];
        existing = { ...existing, versions: seed };
      }
    }
    targetVersion = await firstEmptyVersion(db, tableName, ref, nextVersion(existing));
  } else {
    targetVersion = await firstEmptyVersion(db, tableName, ref, 1);
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
      activeVersion: targetVersion,
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
    return { kind: 'set', id: setId, name: item.name || setId, mode: 'created', version: targetVersion, active: item.active, wasActive: false, media };
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
    } else if (!snap.SET_SETTINGS_NEVER_REMOVED.includes(attr)) {
      // An attribute the snapshot has no value for is REMOVED, because the
      // snapshot is the description: a backup with no personaId describes a set
      // that had none. The exemptions are the filing — every envelope already
      // in the archive predates it, and taking a live set off its shelf on that
      // evidence would drop it out of every filter (archive-snapshot.js).
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
  // A version number neither tier has used, so no body key from either history is overwritten —
  // including one made live again here (prompt-versions.js nextVersionNumber).
  const version = Math.max(
    existing ? promptVersions.nextVersionNumber(existing) - 1 : 0,
    numeric(metadata.version),
  ) + 1;
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
  // THIS TIER'S HISTORY, never the other tier's: a history carried in the
  // backup names s3 keys in another bucket. The restore is one more version.
  delete row.versionHistory;
  if (s3Key) {
    row.latestVersion = version;
    row.versionHistory = promptVersions.appendHistory(existing && existing.versionHistory, promptVersions.historyEntry({
      version, s3Key, savedAt: now, by: 'admin import', how: promptVersions.HOW.ARCHIVE,
      hash: promptVersions.contentHash(envelope.body),
    }));
  }
  await db.send(new PutCommand({ TableName: tableName, Item: row }));
  return { kind: 'prompt', id: promptId, name: row.name || promptId, mode: existing ? 'new-version' : 'created', version, status, isDefault };
}

/*
  ── WHAT A RESTORE WOULD DO, AND WHAT IT DID ─────────────────────────────────
  The admin screen asks both questions (docs/design/archive-promotion/REVIEW.md, improvements
  2 and 3): before the confirm, "new set, or a new version of the live one, and how big";
  after it, "is what landed the size of what was backed up". Both are READS. A plan never
  writes, and that is pinned by tests/archive-import-handler.js §5, which counts every write.
*/

/** The question and category counts a set snapshot carries, lifecycle rows excluded. */
function snapshotCounts(envelope) {
  const rows = (Array.isArray(envelope && envelope.rows) ? envelope.rows : [])
    .filter((row) => row && typeof row.SK === 'string' && !snap.LIFECYCLE_SKS.includes(row.SK));
  return {
    questions: rows.filter((row) => row.SK.startsWith('QUESTION#')).length,
    categories: rows.filter((row) => row.SK.startsWith('CATEGORY#')).length,
  };
}

/** The version a metadata row says is live: activeVersion, else the highest recorded, else null. */
function currentVersionOf(meta) {
  const active = toVersion(meta && meta.activeVersion);
  if (active) return active;
  const known = knownVersions(meta);
  return known.length ? known[known.length - 1] : null;
}

/** What restoreSetSnapshot would do with this envelope. Reads one row; writes nothing. */
async function planSetSnapshot(deps, envelope) {
  const from = envelope.exportedFrom || {};
  const setId = String(from.setId || '').trim();
  if (!setId) throw new Error('This backup names no set id, so there is nothing to restore it as.');
  const counts = snapshotCounts(envelope);
  if (counts.questions === 0) throw new Error('This backup holds no questions, so there is nothing to restore.');
  const found = await deps.db.send(new GetCommand({ TableName: deps.tableName, Key: setMetadataKey(setRef({ scope: tenant.PLATFORM, setId })) }));
  const existing = found && found.Item;
  const snapshotActive = typeof (envelope.metadata && envelope.metadata.active) === 'boolean' ? envelope.metadata.active : null;
  const currentlyActive = existing ? existing.active !== false : null;
  // The same rule restoreSetSnapshot applies: the snapshot's status if it has one; otherwise a
  // new set lands inactive and an existing one keeps the status it has.
  const active = snapshotActive !== null ? snapshotActive : (existing ? currentlyActive : false);
  const settings = snap.settingsFrom(envelope.metadata);
  return {
    kind: 'set',
    id: setId,
    name: settings.name || (existing && existing.name) || setId,
    mode: existing ? 'new-version' : 'created',
    currentVersion: existing ? currentVersionOf(existing) : null,
    currentlyActive,
    active,
    questionCount: counts.questions,
    categoryCount: counts.categories,
  };
}

/** What restorePromptSnapshot would do with this envelope. Reads one row; writes nothing. */
async function planPromptSnapshot(deps, envelope) {
  const from = envelope.exportedFrom || {};
  const promptId = String(from.promptId || '').trim();
  if (!promptId) throw new Error('This backup names no prompt id, so there is nothing to restore it as.');
  const metadata = envelope.metadata || {};
  const found = await deps.db.send(new GetCommand({ TableName: deps.tableName, Key: promptKey({ scope: tenant.PLATFORM, promptId }) }));
  const existing = found && found.Item;
  return {
    kind: 'prompt',
    id: promptId,
    name: metadata.name || (existing && existing.name) || promptId,
    mode: existing ? 'new-version' : 'created',
    currentVersion: existing ? (toVersion(existing.version) || null) : null,
    status: metadata.status || 'draft',
  };
}

/**
 * Re-read a set this request just restored and count what is live. `expected` is
 * `{questions, categories}`; a null expectation is not compared (a legacy CSV records no
 * category count). Never throws: a failed read is reported as the check's own error.
 */
async function checkRestoredSet(deps, setId, expected) {
  try {
    const ref = setRef({ scope: tenant.PLATFORM, setId });
    const found = await deps.db.send(new GetCommand({ TableName: deps.tableName, Key: setMetadataKey(ref) }));
    const meta = found && found.Item;
    if (!meta) return { questions: { expected: expected.questions, found: 0 }, categories: { expected: expected.categories, found: 0 }, matches: false, error: 'The set is not there after the restore.' };
    const version = toVersion(meta.activeVersion);
    const { items } = await queryPartition(deps.db, deps.tableName, setPartition(ref, version));
    const live = {
      questions: items.filter((row) => String(row.SK).startsWith('QUESTION#')).length,
      categories: items.filter((row) => String(row.SK).startsWith('CATEGORY#')).length,
    };
    const same = (key) => expected[key] === null || expected[key] === undefined || expected[key] === live[key];
    return {
      version,
      questions: { expected: expected.questions ?? null, found: live.questions },
      categories: { expected: expected.categories ?? null, found: live.categories },
      matches: same('questions') && same('categories'),
    };
  } catch (error) {
    return { matches: false, error: `The check could not read the set back: ${error.message}` };
  }
}

module.exports = {
  restoreSetSnapshot, restorePromptSnapshot, resolvePromptLink,
  snapshotCounts, planSetSnapshot, planPromptSnapshot, checkRestoredSet,
};
