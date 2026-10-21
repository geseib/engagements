/**
 * AI GENERATION DRAFTS — what a generation run produced, held on the server
 * until the person who asked accepts it into a version, leaves it, or lets it
 * expire. Design and decisions: docs/design/ai-generation-review/README.md.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The owner added two categories of ten to a set, was told "Close — this keeps
 * running", came back, and found nothing. An "Add questions" run made no set
 * on the server (`appendOnly`) and its items waited on a three-day job row for
 * the open editor to press "Add 20"; nothing in the console pointed back at
 * them. A new-set run, meanwhile, made a real set the moment it finished —
 * counting against the plan's allowance before anybody had read a word.
 *
 * Now every builder run writes INTO A DRAFT, in the library it will be saved
 * into, and nothing touches a set until the draft is accepted:
 *
 *   generating ─► ready ───┬─► accepting ─► accepted   (a new version / a new set)
 *              └► failed   ├─► discarded ─► (restore within 7 days) ─► ready
 *                          └─► (regenerate a category / the rest) ─► generating
 *
 * ── THE ROWS ───────────────────────────────────────────────────────────────
 *
 *   PK <scope>GENDRAFTS        SK DRAFT#<id>    header   (tenant.draftsIndexPk)
 *   PK <scope>GENDRAFT#<id>    SK ITEM#<nnnn>   one item (tenant.draftItemsPk)
 *
 * Sealed under the library's org key (tenant-crypto `draft`, `draftItem`);
 * plaintext in Engage's own library, as every platform row is.
 *
 * ── TTL (owner, 2026-10-21) ────────────────────────────────────────────────
 *
 *   generating / ready / failed   30 days from the last run finishing
 *                                 (a reminder at day 25: notifications.js)
 *   discarded                     7 days — the restore window
 *   accepted                      30 days — the record of what was accepted
 *
 * Items carry the header's ttl and are rewritten with it on every transition.
 * Readers treat `ttl <= now` as gone: DynamoDB deletes up to ~48h late.
 *
 * ── WHO SEES A DRAFT ───────────────────────────────────────────────────────
 *
 * ONLY ITS CREATOR, until it is accepted (owner, 2026-10-21). Every read and
 * write here checks `createdBy` against the caller AND that the caller is
 * acting in the draft's library. Once accepted it is an ordinary set (or
 * version) in that library, and the library's own rules apply.
 */
const {
  PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const tenant = require('./tenant');
const { encryptItem, decryptItem } = require('./tenant-crypto');
const notifications = require('./notifications');

const STATUS = Object.freeze({
  GENERATING: 'generating',
  READY: 'ready',
  FAILED: 'failed',
  ACCEPTING: 'accepting',
  ACCEPTED: 'accepted',
  DISCARDED: 'discarded',
});

const DAY_SECONDS = 24 * 60 * 60;
const READY_DAYS = 30;
const DISCARD_RESTORE_DAYS = 7;
const ACCEPTED_KEEP_DAYS = 30;
/** An accept claimed and never completed (a closed tab) may be taken again. */
const ACCEPT_CLAIM_STALE_MS = 5 * 60 * 1000;
const MAX_ITEMS = 100;
/** A pasted source document rides in the request; capped so a header fits a row. */
const REQUEST_FIELD_MAX = 20000;

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const nowSeconds = (now = new Date()) => Math.floor(now.getTime() / 1000);
const daysFrom = (now, days) => nowSeconds(now) + days * DAY_SECONDS;
const seqKey = (seq) => `ITEM#${String(seq).padStart(4, '0')}`;
const isDraftId = (id) => /^[A-Za-z0-9_-]{6,64}$/.test(clean(id));

// ── Where ─────────────────────────────────────────────────────────────────
/**
 * THE LIBRARY THIS CALLER IS WRITING INTO, or null. The console's switcher
 * decides it (X-Engage-Org); the builder states it and lets the person change
 * it, which changes the header the request carries — never a field in the
 * body that could name a library the caller does not stand in.
 */
function callerLibrary(event) {
  const orgId = tenant.callerOrgId(event);
  if (orgId) {
    return tenant.canManageScope(event, tenant.ORG, orgId) ? { scope: tenant.ORG, orgId } : null;
  }
  if (tenant.canManageScope(event, tenant.PLATFORM, '')) return { scope: tenant.PLATFORM, orgId: '' };
  // THE INTERNAL-INVOCATION SEAM, the same one createSetRef keeps
  // (question-set-access.js): no groups AND no org is not a signed-in person —
  // the authorizer puts `groups` on every request it lets through — but a
  // script or a suite calling the handler directly, which has always written
  // Engage's library. A real host with no library is refused above.
  if (tenant.callerGroups(event).length === 0) return { scope: tenant.PLATFORM, orgId: '' };
  return null;
}

/** The library a worker writes into, from the caller recorded on its job row. */
function libraryOfCaller(caller) {
  return caller && caller.orgId ? { scope: tenant.ORG, orgId: caller.orgId } : { scope: tenant.PLATFORM, orgId: '' };
}

const headerKey = (lib, draftId) => ({ PK: tenant.draftsIndexPk(lib.scope, lib.orgId), SK: `DRAFT#${draftId}` });
const libOf = (draft) => ({ scope: draft.scope, orgId: draft.orgId || '' });

async function seal(lib, entity, fields) {
  return lib.orgId ? encryptItem(lib.orgId, entity, fields) : fields;
}
async function open(lib, entity, row) {
  return lib.orgId && row ? decryptItem(lib.orgId, entity, row) : row;
}

/**
 * The request as stored: the builder's brief, minus anything absurdly long —
 * and minus `batchGuidance`, which is ONE RUN'S instruction and by standing
 * decision is never stored on any row (shared/batch-guidance.js). A
 * regenerate is sent its own guidance by the browser, or none.
 */
function trimRequest(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (k === 'draftId' || k === 'regenerate' || k === '__workerMode' || k === 'batchGuidance') continue;
    if (typeof v === 'string') out[k] = v.length > REQUEST_FIELD_MAX ? v.slice(0, REQUEST_FIELD_MAX) : v;
    else out[k] = v;
  }
  return out;
}

// ── Header ────────────────────────────────────────────────────────────────
async function createDraft(db, table, {
  draftId, lib, kind, engagementType, mode, appendMode = '', target = null,
  requested, request, title, creator, jobId, tokensPerItem = 0, now = new Date(),
}) {
  const at = now.toISOString();
  const sealed = await seal(lib, 'draft', {
    title: String(title || '').slice(0, 200),
    request: trimRequest(request),
    warnings: [],
    error: '',
  });
  const item = {
    ...headerKey(lib, draftId),
    RecordType: 'GENDRAFT',
    draftId,
    scope: lib.scope,
    orgId: lib.orgId || '',
    kind,
    engagementType,
    mode,
    ...(appendMode ? { appendMode } : {}),
    ...(target ? { targetSetId: target.setId, targetVersion: target.version ?? null } : {}),
    status: STATUS.GENERATING,
    requested,
    produced: 0,
    nextSeq: 1,
    batch: 1,
    jobId,
    tokensPerItem,
    usage: { inputTokens: 0, outputTokens: 0 },
    createdBy: creator.sub,
    ...(creator.name ? { createdByName: creator.name } : {}),
    createdAt: at,
    updatedAt: at,
    ttl: daysFrom(now, READY_DAYS),
    ...sealed,
  };
  await db.send(new PutCommand({
    TableName: table,
    Item: item,
    ConditionExpression: 'attribute_not_exists(SK)',
  }));
  return open(lib, 'draft', item);
}

async function getDraft(db, table, lib, draftId, { now = new Date() } = {}) {
  if (!isDraftId(draftId)) return null;
  const res = await db.send(new GetCommand({ TableName: table, Key: headerKey(lib, draftId), ConsistentRead: true }));
  const row = res && res.Item;
  if (!row || (Number(row.ttl) && Number(row.ttl) <= nowSeconds(now))) return null;
  return open(lib, 'draft', row);
}

async function listDrafts(db, table, lib, sub, { now = new Date() } = {}) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': tenant.draftsIndexPk(lib.scope, lib.orgId), ':sk': 'DRAFT#' },
      ExclusiveStartKey,
    }));
    items.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  const t = nowSeconds(now);
  const mine = items.filter((r) => r.createdBy === sub && !(Number(r.ttl) && Number(r.ttl) <= t));
  const out = [];
  for (const row of mine) out.push(await open(lib, 'draft', row));
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** A conditional status move. Returns false when the draft was not in `from`. */
async function transition(db, table, draft, { from, to, set = {}, now = new Date() }) {
  const names = { '#status': 'status' };
  const values = { ':to': to, ':now': now.toISOString() };
  const sets = ['#status = :to', 'updatedAt = :now'];
  Object.entries(set).forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    sets.push(`#f${i} = :v${i}`);
  });
  const froms = Array.isArray(from) ? from : [from];
  const cond = froms.map((_, i) => `#status = :from${i}`).join(' OR ');
  froms.forEach((f, i) => { values[`:from${i}`] = f; });
  try {
    await db.send(new UpdateCommand({
      TableName: table,
      Key: headerKey(libOf(draft), draft.draftId),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: cond,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return true;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

// ── Items ─────────────────────────────────────────────────────────────────
async function putItems(db, table, draft, items, { startSeq, batch, ttl }) {
  const lib = libOf(draft);
  let seq = startSeq;
  for (const item of items) {
    const sealed = await seal(lib, 'draftItem', { item });
    await db.send(new PutCommand({
      TableName: table,
      Item: {
        PK: tenant.draftItemsPk(lib.scope, lib.orgId, draft.draftId),
        SK: seqKey(seq),
        RecordType: 'GENDRAFT_ITEM',
        seq,
        batch,
        decision: 'keep',
        edited: false,
        ttl,
        ...sealed,
      },
    }));
    seq += 1;
  }
  return seq;
}

async function listItems(db, table, draft) {
  const lib = libOf(draft);
  const rows = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': tenant.draftItemsPk(lib.scope, lib.orgId, draft.draftId), ':sk': 'ITEM#' },
      ExclusiveStartKey,
    }));
    rows.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  const out = [];
  for (const row of rows) {
    const opened = await open(lib, 'draftItem', row);
    out.push({
      seq: Number(opened.seq),
      batch: Number(opened.batch) || 1,
      decision: opened.decision === 'leave' ? 'leave' : 'keep',
      edited: opened.edited === true,
      item: opened.item && typeof opened.item === 'object' ? opened.item : {},
    });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

async function updateItem(db, table, draft, seq, { decision, item }) {
  const lib = libOf(draft);
  const sets = [];
  const names = {};
  const values = {};
  if (decision === 'keep' || decision === 'leave') {
    sets.push('#decision = :d'); names['#decision'] = 'decision'; values[':d'] = decision;
  }
  if (item && typeof item === 'object') {
    const sealed = await seal(lib, 'draftItem', { item });
    sets.push('#item = :item', '#edited = :t');
    names['#item'] = 'item';
    names['#edited'] = 'edited';
    values[':item'] = sealed.item;
    values[':t'] = true;
  }
  if (!sets.length) return false;
  await db.send(new UpdateCommand({
    TableName: table,
    Key: { PK: tenant.draftItemsPk(lib.scope, lib.orgId, draft.draftId), SK: seqKey(seq) },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(SK)',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  return true;
}

async function deleteItems(db, table, draft, seqs) {
  const lib = libOf(draft);
  for (const seq of seqs) {
    await db.send(new DeleteCommand({
      TableName: table,
      Key: { PK: tenant.draftItemsPk(lib.scope, lib.orgId, draft.draftId), SK: seqKey(seq) },
    }));
  }
}

/** Items live exactly as long as their header. */
async function setItemsTtl(db, table, draft, ttl) {
  const lib = libOf(draft);
  const items = await listItems(db, table, draft);
  for (const it of items) {
    await db.send(new UpdateCommand({
      TableName: table,
      Key: { PK: tenant.draftItemsPk(lib.scope, lib.orgId, draft.draftId), SK: seqKey(it.seq) },
      UpdateExpression: 'SET #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':ttl': ttl },
    }));
  }
}

// ── What the browser sees ─────────────────────────────────────────────────
function headerToWire(draft, { now = new Date() } = {}) {
  const t = nowSeconds(now);
  const ttl = Number(draft.ttl) || 0;
  return {
    draftId: draft.draftId,
    status: draft.status,
    scope: draft.scope,
    orgId: draft.orgId || '',
    kind: draft.kind,
    engagementType: draft.engagementType,
    mode: draft.mode,
    appendMode: draft.appendMode || '',
    targetSetId: draft.targetSetId || '',
    targetVersion: draft.targetVersion ?? null,
    title: typeof draft.title === 'string' ? draft.title : '',
    requested: Number(draft.requested) || 0,
    produced: Number(draft.produced) || 0,
    warnings: Array.isArray(draft.warnings) ? draft.warnings : [],
    error: typeof draft.error === 'string' ? draft.error : '',
    promptSource: draft.promptSource || null,
    usage: draft.usage || { inputTokens: 0, outputTokens: 0 },
    tokensPerItem: Number(draft.tokensPerItem) || 0,
    regenerating: draft.regenerating || null,
    cancelRequested: draft.cancelRequested === true,
    topic: draft.request && draft.request.setMetadata && typeof draft.request.setMetadata.topic === 'string'
      ? draft.request.setMetadata.topic : '',
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    readyAt: draft.readyAt || null,
    decidedAt: draft.decidedAt || null,
    acceptedSetId: draft.acceptedSetId || '',
    acceptedVersion: draft.acceptedVersion ?? null,
    previousVersion: draft.previousVersion ?? null,
    keptCount: draft.keptCount ?? null,
    undoneAt: draft.undoneAt || null,
    leftCount: draft.leftCount ?? null,
    expiresAt: ttl ? new Date(ttl * 1000).toISOString() : null,
    daysLeft: ttl ? Math.max(0, Math.ceil((ttl - t) / DAY_SECONDS)) : null,
  };
}

// ── The notification ──────────────────────────────────────────────────────
const NOUNS = { trivia: 'questions', poll: 'poll questions', survey: 'survey questions' };
const nounFor = (engagementType) => NOUNS[engagementType] || 'questions';

function draftLink(draft) {
  return {
    type: 'draft',
    draftId: draft.draftId,
    orgId: draft.orgId || '~platform',
    ...(draft.targetSetId ? { setId: draft.targetSetId } : {}),
  };
}

async function notifyCreator(db, draft, { status, produced, requested, ttl, now = new Date() }) {
  const noun = nounFor(draft.engagementType);
  let kind = notifications.KINDS.DRAFT_READY;
  let title = `${produced} ${noun} ready to review`;
  if (status === STATUS.FAILED) {
    kind = notifications.KINDS.DRAFT_FAILED;
    title = 'Generation failed — nothing to review';
  } else if (requested > 0 && produced < requested) {
    kind = notifications.KINDS.DRAFT_PARTIAL;
    title = `${produced} of ${requested} ${noun} ready to review`;
  }
  const body = draft.mode === 'append'
    ? `To add to “${draft.title || draft.targetSetId}”. Nothing changes in the set until you accept.`
    : `A new set, “${draft.title || 'untitled'}”. It is saved only when you accept.`;
  return notifications.notify(db, {
    sub: draft.createdBy,
    key: `draft#${draft.draftId}`,
    kind,
    orgId: draft.orgId || '',
    scope: draft.scope,
    title,
    body,
    link: draftLink(draft),
    expiresAt: ttl,
  }, { now });
}

// ── The POST: start a run into a draft, or regenerate part of one ─────────
/**
 * Called by a generation POST BEFORE its job row is written. Returns:
 *
 *   null                              this request does not draft (a legacy
 *                                     `appendOnly` call with no target, or a
 *                                     handler that never drafts)
 *   { response }                      a refusal to return as is
 *   { draftId, payload, requested }   run THIS payload into THIS draft
 *
 * The run's payload is not always the request's: a regenerate is rebuilt from
 * the brief stored on the draft, so it can ask for one category or the
 * remainder without the browser holding — or being trusted with — the whole
 * original request.
 */
async function prepareDraftRun({
  db, table, event, payload, kind, engagementType, jobId, tokensPerItem, maxCount = MAX_ITEMS,
  findSetForCaller, requireSetManager, setScopeOf, setOrgOf, json,
}) {
  const sub = tenant.callerUserId(event);
  if (!sub) return { response: json(401, { error: 'Sign in again and retry.' }) };

  // ── Regenerate part of an existing draft ──
  if (payload && payload.draftId) {
    const lib = callerLibrary(event);
    if (!lib) return { response: json(403, { error: 'Switch to the library this draft belongs to, then try again.' }) };
    const draft = await getDraft(db, table, lib, payload.draftId);
    if (!draft || draft.createdBy !== sub) return { response: json(404, { error: 'Draft not found or expired.' }) };
    const items = await listItems(db, table, draft);
    const regen = payload.regenerate && typeof payload.regenerate === 'object' ? payload.regenerate : {};
    const base = draft.request || {};
    let runPayload;
    let regenerating;
    if (clean(regen.category)) {
      const category = clean(regen.category).slice(0, 120);
      const inCategory = items.filter((it) => clean(it.item.category) === category).length;
      const count = Math.min(Math.max(parseInt(regen.count, 10) || inCategory || 1, 1), maxCount);
      runPayload = {
        ...base,
        count,
        numberOfCategories: 1,
        mustHaveCategories: category,
        category,
        customPrompt: `${clean(base.customPrompt)}\n\nWrite ONLY for the category "${category}", and use exactly that category name.`.trim(),
        appendOnly: true,
        setMetadata: undefined,
      };
      regenerating = { type: 'category', category, count };
    } else {
      const remaining = Math.max(0, (Number(draft.requested) || 0) - items.length);
      const count = Math.min(Math.max(parseInt(regen.count, 10) || remaining || 1, 1), maxCount);
      runPayload = { ...base, count, appendOnly: true, setMetadata: undefined };
      regenerating = { type: 'remaining', count };
    }
    // This regenerate's own guidance, if the person gave one; never the
    // original batch's, which was not kept (shared/batch-guidance.js).
    delete runPayload.batchGuidance;
    if (typeof payload.batchGuidance === 'string') runPayload.batchGuidance = payload.batchGuidance;
    const replaced = regenerating.type === 'category'
      ? items.filter((it) => clean(it.item.category) === regenerating.category).length
      : 0;
    if (items.length - replaced + regenerating.count > MAX_ITEMS) {
      return { response: json(400, { error: `A draft holds at most ${MAX_ITEMS} questions.` }) };
    }
    const moved = await transition(db, table, draft, {
      from: [STATUS.READY, STATUS.FAILED],
      to: STATUS.GENERATING,
      set: {
        jobId,
        regenerating,
        batch: (Number(draft.batch) || 1) + 1,
        cancelRequested: false,
        ttl: daysFrom(new Date(), READY_DAYS),
      },
    });
    if (!moved) return { response: json(409, { error: 'This draft is not waiting for review, so it cannot be regenerated now.' }) };
    await notifications.resolve(db, sub, `draft#${draft.draftId}`);
    return { draftId: draft.draftId, payload: runPayload, requested: regenerating.count, lib };
  }

  // ── A new run ──
  const appendTo = payload && payload.appendTo && typeof payload.appendTo === 'object' ? payload.appendTo : null;
  // A legacy `appendOnly` call names no set, so there is nothing to draft for:
  // its items go back to the editor that asked, exactly as before.
  if (payload && payload.appendOnly === true && !(appendTo && appendTo.setId)) return null;

  const count = Math.min(Math.max(parseInt(payload && payload.count, 10) || 1, 1), maxCount);
  const creator = { sub, name: clean(event?.requestContext?.authorizer?.lambda?.username) };
  if (appendTo && appendTo.setId) {
    const found = await findSetForCaller(db, table, event, clean(appendTo.setId), clean(appendTo.scope));
    if (!found || !found.item) return { response: json(404, { error: 'That set was not found in the library you are in.' }) };
    const refused = requireSetManager(event, found.item, 'add generated questions to');
    if (refused) return { response: refused };
    const lib = { scope: setScopeOf(found.item), orgId: setOrgOf(found.item) || '' };
    if (lib.scope === tenant.PUBLIC) return { response: json(403, { error: 'A public set is changed through the set it was published from.' }) };
    let name = found.item.name;
    if (lib.orgId) {
      try { name = (await decryptItem(lib.orgId, 'set', { name })).name; } catch (e) { name = ''; }
    }
    const draftId = jobId;
    await createDraft(db, table, {
      draftId, lib, kind, engagementType, mode: 'append',
      appendMode: appendTo.mode === 'new' ? 'new' : 'existing',
      target: { setId: clean(appendTo.setId), version: found.item.activeVersion ?? null },
      requested: count, request: { ...payload, appendOnly: true, setMetadata: undefined },
      title: typeof name === 'string' ? name : '', creator, jobId, tokensPerItem,
    });
    return { draftId, payload: { ...payload, appendOnly: true }, requested: count, lib };
  }

  const lib = callerLibrary(event);
  if (!lib) {
    return {
      response: json(403, {
        error: 'Choose where this will be saved — your space, a team, or (for Engage staff) Engage — before generating.',
        code: 'no_destination',
      }),
    };
  }
  const draftId = jobId;
  await createDraft(db, table, {
    draftId, lib, kind, engagementType, mode: 'new',
    requested: count, request: payload,
    title: clean(payload && payload.setMetadata && payload.setMetadata.title) || clean(payload && payload.customTitle),
    creator, jobId, tokensPerItem,
  });
  return { draftId, payload, requested: count, lib };
}

// ── The worker: write into the draft as passes land ───────────────────────
/**
 * Open the draft a worker is writing into. `caller` is workerCaller's answer,
 * which carries the job row's `draftId`. Returns null when the job drafts
 * nothing; throws when it should and the draft is gone, so the worker fails
 * the job rather than quietly doing something else with the items.
 */
async function openDraftRun({ db, table, caller, now = () => new Date() }) {
  if (!caller || !caller.draftId) return null;
  const lib = libraryOfCaller(caller);
  const draft = await getDraft(db, table, lib, caller.draftId);
  if (!draft) throw new Error('The draft this run was writing into is gone (discarded or expired).');
  const existing = await listItems(db, table, draft);
  const regenerating = draft.regenerating && typeof draft.regenerating === 'object' ? draft.regenerating : null;
  const replacing = regenerating && regenerating.type === 'category'
    ? existing.filter((it) => clean(it.item.category) === regenerating.category)
    : [];
  const replacingSeqs = new Set(replacing.map((it) => it.seq));
  const seedTitles = existing
    .filter((it) => !replacingSeqs.has(it.seq))
    .map((it) => clean(it.item.title))
    .filter(Boolean);
  const batch = Number(draft.batch) || 1;
  let nextSeq = Math.max(Number(draft.nextSeq) || 1, ...existing.map((it) => it.seq + 1), 1);
  let written = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  const forceCategory = (item) => (regenerating && regenerating.type === 'category'
    ? { ...item, category: regenerating.category }
    : item);

  return {
    draft,
    seedTitles,
    regenerating,
    addUsage(u) {
      if (!u || typeof u !== 'object') return;
      usage.inputTokens += Number(u.input_tokens ?? u.inputTokens) || 0;
      usage.outputTokens += Number(u.output_tokens ?? u.outputTokens) || 0;
    },
    /** Write whatever `produced` holds that has not been written yet. */
    async progress(produced) {
      const fresh = produced.slice(written).map(forceCategory);
      if (!fresh.length) return;
      nextSeq = await putItems(db, table, draft, fresh, { startSeq: nextSeq, batch, ttl: Number(draft.ttl) });
      written = produced.length;
      await db.send(new UpdateCommand({
        TableName: table,
        Key: headerKey(lib, draft.draftId),
        UpdateExpression: 'SET #n = :n, #u = :now, #p = :p',
        ExpressionAttributeNames: { '#n': 'nextSeq', '#u': 'updatedAt', '#p': 'produced' },
        ExpressionAttributeValues: {
          ':n': nextSeq,
          ':now': now().toISOString(),
          ':p': existing.length - replacing.length + written,
        },
      }));
    },
    /** Has the person pressed Stop? Read between passes, never mid-call. */
    async cancelled() {
      const res = await db.send(new GetCommand({ TableName: table, Key: headerKey(lib, draft.draftId), ConsistentRead: true }));
      return Boolean(res && res.Item && res.Item.cancelRequested === true);
    },
    /**
     * The run is over. The draft goes to `ready` when it holds anything at all
     * and `failed` when it holds nothing; the creator is notified either way.
     * A category regenerate that produced nothing keeps the old category.
     */
    async finish({ produced, warnings = [], error = null, promptSource = null, stoppedByRequest = false }) {
      await this.progress(produced);
      if (replacing.length && written > 0) {
        await deleteItems(db, table, draft, replacing.map((it) => it.seq));
      }
      const total = existing.length - (written > 0 ? replacing.length : 0) + written;
      const at = now();
      const ttl = daysFrom(at, READY_DAYS);
      const status = total > 0 ? STATUS.READY : STATUS.FAILED;
      const prior = Array.isArray(draft.warnings) ? draft.warnings : [];
      const allWarnings = [...prior, ...warnings].slice(-20);
      if (stoppedByRequest) allWarnings.push(`Stopped at your request after ${written}.`);
      const errText = error ? String(error.message || error) : (status === STATUS.FAILED ? 'Nothing was produced.' : '');
      const sealed = await seal(lib, 'draft', { warnings: allWarnings, error: errText });
      const prevUsage = draft.usage || {};
      const names = {
        '#status': 'status', '#ttl': 'ttl', '#warnings': 'warnings', '#error': 'error',
        '#produced': 'produced', '#readyAt': 'readyAt', '#updatedAt': 'updatedAt', '#usage': 'usage',
        '#cancel': 'cancelRequested', '#regen': 'regenerating',
      };
      await db.send(new UpdateCommand({
        TableName: table,
        Key: headerKey(lib, draft.draftId),
        UpdateExpression: 'SET #status = :s, #produced = :p, #readyAt = :at, #updatedAt = :at, #ttl = :ttl, '
          + '#warnings = :w, #error = :e, #usage = :u, #cancel = :f REMOVE #regen',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: {
          ':s': status,
          ':p': total,
          ':at': at.toISOString(),
          ':ttl': ttl,
          ':w': sealed.warnings,
          ':e': sealed.error,
          ':u': {
            inputTokens: (Number(prevUsage.inputTokens) || 0) + usage.inputTokens,
            outputTokens: (Number(prevUsage.outputTokens) || 0) + usage.outputTokens,
          },
          ':f': false,
        },
      }));
      if (promptSource && typeof promptSource === 'object') {
        await db.send(new UpdateCommand({
          TableName: table,
          Key: headerKey(lib, draft.draftId),
          UpdateExpression: 'SET #ps = :ps',
          ExpressionAttributeNames: { '#ps': 'promptSource' },
          ExpressionAttributeValues: { ':ps': promptSource },
        }));
      }
      await setItemsTtl(db, table, draft, ttl);
      await notifyCreator(db, draft, {
        status,
        produced: total,
        requested: regenerating ? total : Number(draft.requested) || 0,
        ttl,
        now: at,
      });
      return { status, total };
    },
  };
}

/**
 * The worker never started (the dispatch failed). A draft that already held
 * questions goes back to review; one that held none is failed, with why.
 * Never throws — the POST is already answering with the dispatch error.
 */
async function abandonRun(db, table, lib, draftId, message) {
  try {
    const draft = await getDraft(db, table, lib, draftId);
    if (!draft || draft.status !== STATUS.GENERATING) return;
    const back = (Number(draft.produced) || 0) > 0 ? STATUS.READY : STATUS.FAILED;
    const sealed = await seal(lib, 'draft', { error: String(message || '') });
    await transition(db, table, draft, { from: STATUS.GENERATING, to: back, set: { error: sealed.error } });
  } catch (error) {
    console.error(`⚠️ Draft ${draftId}: could not record a failed start: ${error.message}`);
  }
}

// ── The person's decisions ────────────────────────────────────────────────
async function requestCancel(db, table, draft) {
  await db.send(new UpdateCommand({
    TableName: table,
    Key: headerKey(libOf(draft), draft.draftId),
    UpdateExpression: 'SET #cancel = :t',
    ConditionExpression: '#status = :g',
    ExpressionAttributeNames: { '#status': 'status', '#cancel': 'cancelRequested' },
    ExpressionAttributeValues: { ':t': true, ':g': STATUS.GENERATING },
  }));
}

/**
 * TAKE THE ACCEPT, ONCE. ready → accepting, or a stale `accepting` (a tab that
 * claimed and never came back) taken again. A double click claims once; the
 * second press is told the draft is already being accepted.
 */
async function claimAccept(db, table, draft, { now = new Date(), auditRef = null } = {}) {
  const set = {
    acceptClaimedAt: now.toISOString(),
    ...(auditRef ? { acceptAudit: { PK: auditRef.PK, SK: auditRef.SK, indexed: auditRef.indexed === true } } : {}),
  };
  if (draft.status === STATUS.ACCEPTING) {
    const claimed = Date.parse(draft.acceptClaimedAt || '') || 0;
    if (now.getTime() - claimed < ACCEPT_CLAIM_STALE_MS) return false;
    return transition(db, table, draft, { from: STATUS.ACCEPTING, to: STATUS.ACCEPTING, set, now });
  }
  return transition(db, table, draft, { from: STATUS.READY, to: STATUS.ACCEPTING, set, now });
}

async function releaseAccept(db, table, draft, { now = new Date() } = {}) {
  return transition(db, table, draft, { from: STATUS.ACCEPTING, to: STATUS.READY, now });
}

async function completeAccept(db, table, draft, {
  setId, version, previousVersion, kept, left, now = new Date(),
}) {
  const ttl = daysFrom(now, ACCEPTED_KEEP_DAYS);
  const ok = await transition(db, table, draft, {
    from: STATUS.ACCEPTING,
    to: STATUS.ACCEPTED,
    set: {
      decidedAt: now.toISOString(),
      acceptedSetId: setId,
      acceptedVersion: version ?? null,
      previousVersion: previousVersion ?? null,
      keptCount: kept,
      leftCount: left,
      ttl,
    },
    now,
  });
  if (ok) {
    await setItemsTtl(db, table, draft, ttl);
    await notifications.resolve(db, draft.createdBy, `draft#${draft.draftId}`);
  }
  return ok;
}

async function discard(db, table, draft, { now = new Date() } = {}) {
  const ttl = daysFrom(now, DISCARD_RESTORE_DAYS);
  const ok = await transition(db, table, draft, {
    from: [STATUS.READY, STATUS.FAILED],
    to: STATUS.DISCARDED,
    set: { decidedAt: now.toISOString(), statusBeforeDiscard: draft.status, ttl },
    now,
  });
  if (ok) {
    await setItemsTtl(db, table, draft, ttl);
    await notifications.resolve(db, draft.createdBy, `draft#${draft.draftId}`);
  }
  return ok;
}

/** Back to review, with at least a week left to decide in. */
async function restore(db, table, draft, { now = new Date() } = {}) {
  const readyUntil = Date.parse(draft.readyAt || draft.createdAt || '') / 1000 + READY_DAYS * DAY_SECONDS;
  const ttl = Math.max(Number.isFinite(readyUntil) ? Math.floor(readyUntil) : 0, daysFrom(now, DISCARD_RESTORE_DAYS));
  const back = draft.statusBeforeDiscard === STATUS.FAILED ? STATUS.FAILED : STATUS.READY;
  const ok = await transition(db, table, draft, { from: STATUS.DISCARDED, to: back, set: { ttl }, now });
  if (ok) {
    await setItemsTtl(db, table, draft, ttl);
    await notifyCreator(db, { ...draft, status: back }, {
      status: back, produced: Number(draft.produced) || 0, requested: Number(draft.requested) || 0, ttl, now,
    });
  }
  return ok;
}

/** Record that an accepted addition was switched back (admin/generation-drafts.js, undo). */
async function markUndone(db, table, draft, { now = new Date() } = {}) {
  return transition(db, table, draft, {
    from: STATUS.ACCEPTED, to: STATUS.ACCEPTED, set: { undoneAt: now.toISOString() }, now,
  });
}

module.exports = {
  markUndone,
  STATUS,
  READY_DAYS,
  DISCARD_RESTORE_DAYS,
  ACCEPTED_KEEP_DAYS,
  ACCEPT_CLAIM_STALE_MS,
  MAX_ITEMS,
  callerLibrary,
  libraryOfCaller,
  createDraft,
  getDraft,
  listDrafts,
  listItems,
  updateItem,
  deleteItems,
  headerToWire,
  prepareDraftRun,
  openDraftRun,
  abandonRun,
  requestCancel,
  claimAccept,
  releaseAccept,
  completeAccept,
  discard,
  restore,
  notifyCreator,
  nounFor,
};
