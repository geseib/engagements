/**
 * /admin/generation-drafts/{proxy+} — the person's AI drafts, in the library
 * they are standing in. Mounted on the upload-questions function
 * (upload-questions.js, isDraftsRoute), because accepting a new-set draft IS
 * an import and the stack is near its resource limit.
 *
 *   GET  list                    my drafts in this library (headers only)
 *   GET  {id}                    one draft and its items, opened
 *   POST {id}/items              { updates: [{ seq, decision?, item? }] }  keep/leave/edit
 *   POST {id}/cancel             stop a run between passes
 *   POST {id}/accept             new set:  { activate, title?, topic? }  → the set is made
 *                                add to a set: { phase: 'claim' | 'complete' | 'release', ... }
 *   POST {id}/discard            leave it (restorable for 7 days)
 *   POST {id}/restore            back to review
 *   POST {id}/undo               after adding to a set: switch it back to the
 *                                version it had before this accept
 *
 * UNDO IS NARROW ON PURPOSE. The version routes are Engage staff's
 * (auth/authorizer.js keeps promote off the host list, and two suites pin
 * it). The owner asked for an accept to be reversible "after, via
 * versioning", and a team's own host is the person who will want it. So this
 * undoes exactly ONE thing — this draft's own accept, by its creator, while
 * the version it wrote is still the live one — by running the promote handler
 * in-process, so its ownership guard, its empty-version probe and its audit
 * entry all still apply. Anything wider stays in Versions, for staff.
 *
 * WHY "ADD TO A SET" IS ACCEPTED IN THREE STEPS. The rows that join an
 * existing set are merged by the set editor (QuestionsPanel.acceptGenerated):
 * re-filing strays into the set's categories, renumbering, and writing the
 * whole working copy back as ONE new version through the importer's replace —
 * the path the round-trip tests guard. Re-implementing that merge here would be
 * a second writer of a set's CSV, the defect generated-set.js note 1 forbids.
 * So the server CLAIMS the accept (once — a double click claims once), the
 * editor saves the version, and the server records it; a failed save releases
 * the claim and the draft is back for review. A claim nobody completes goes
 * stale after five minutes and may be taken again.
 *
 * WHO. Only the draft's creator, acting in the draft's library (owner,
 * 2026-10-21: a draft is private until accepted). Everyone else gets the same
 * 404 as a draft that does not exist.
 *
 * AUDIT. Accept, discard and restore are written to the library's audit log
 * BEFORE they happen (shared/audit-log.js): ids and counts in the detail, the
 * set's name sealed as the title.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const tenant = require('./shared/tenant');
const drafts = require('./shared/generation-drafts');
const { recordAudit, markAuditOutcome } = require('./shared/audit-log');
const { importDraftAsSet } = require('./shared/generated-set');
const { findSetForCaller, requireSetManager } = require('./shared/question-set-access');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: CORS });

let dbClient = null;
const db = () => {
  if (!dbClient) {
    dbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return dbClient;
};
const table = () => process.env.TABLE_NAME;

/** `list` | `<id>` | `<id>/<action>` — from the proxy tail or the raw path. */
function routeOf(event) {
  const tail = String(
    (event && event.pathParameters && event.pathParameters.proxy)
    || String(event?.requestContext?.http?.path || event?.rawPath || '').replace(/^.*\/admin\/generation-drafts\/?/, ''),
  ).replace(/^\/+|\/+$/g, '');
  const [id = '', action = ''] = tail.split('/');
  return { id: decodeURIComponent(id), action };
}

function body(event) {
  try { return JSON.parse((event && event.body) || '{}') || {}; } catch (e) { return null; }
}

/** The audit log's actor: the creator in their library, or Engage staff. */
function actorFor(event, draft) {
  const role = tenant.deleteRole(event, { orgId: draft.orgId, createdBy: draft.createdBy })
    || (draft.orgId ? 'host' : 'platform-admin');
  return tenant.deleteActor(event, role);
}

async function audit(event, draft, action, detail) {
  return recordAudit(db(), {
    orgId: draft.orgId || '',
    action,
    actor: actorFor(event, draft),
    target: { type: 'question-set-draft', id: draft.draftId, title: draft.title || '' },
    detail: { draftId: draft.draftId, ...detail },
  });
}

async function loadMine(event, id) {
  const sub = tenant.callerUserId(event);
  if (!sub) return { response: json(401, { error: 'Sign in again and retry.' }) };
  const lib = drafts.callerLibrary(event);
  if (!lib) return { response: json(404, { error: 'Draft not found or expired.' }) };
  const draft = await drafts.getDraft(db(), table(), lib, id);
  if (!draft || draft.createdBy !== sub) return { response: json(404, { error: 'Draft not found or expired.' }) };
  return { draft, lib, sub };
}

const keptOf = (items) => items.filter((it) => it.decision !== 'leave');

// ── Handlers ──────────────────────────────────────────────────────────────
async function list(event) {
  const sub = tenant.callerUserId(event);
  if (!sub) return json(401, { error: 'Sign in again and retry.' });
  const lib = drafts.callerLibrary(event);
  if (!lib) return json(200, { drafts: [], library: null });
  const rows = await drafts.listDrafts(db(), table(), lib, sub);
  return json(200, {
    library: lib,
    drafts: rows.map((d) => drafts.headerToWire(d)),
  });
}

async function getOne(event, id) {
  const { draft, response } = await loadMine(event, id);
  if (response) return response;
  const items = await drafts.listItems(db(), table(), draft);
  return json(200, { draft: drafts.headerToWire(draft), items });
}

async function editItems(event, id) {
  const { draft, response } = await loadMine(event, id);
  if (response) return response;
  if (draft.status !== drafts.STATUS.READY && draft.status !== drafts.STATUS.FAILED) {
    return json(409, { error: 'This draft is not waiting for review, so it cannot be changed now.' });
  }
  const b = body(event);
  if (!b) return json(400, { error: 'Request body is not valid JSON.' });
  const updates = Array.isArray(b.updates) ? b.updates.slice(0, drafts.MAX_ITEMS) : [];
  let changed = 0;
  for (const u of updates) {
    const seq = parseInt(u && u.seq, 10);
    if (!Number.isFinite(seq) || seq < 1) continue;
    const item = u.item && typeof u.item === 'object' && !Array.isArray(u.item) ? u.item : null;
    try {
      if (await drafts.updateItem(db(), table(), draft, seq, { decision: u.decision, item })) changed += 1;
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
    }
  }
  return json(200, { changed });
}

async function cancel(event, id) {
  const { draft, response } = await loadMine(event, id);
  if (response) return response;
  try {
    await drafts.requestCancel(db(), table(), draft);
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') return json(409, { error: 'This draft is not generating.' });
    throw error;
  }
  return json(200, { cancelRequested: true });
}

async function acceptNewSet(event, draft, b) {
  const items = await drafts.listItems(db(), table(), draft);
  const kept = keptOf(items);
  if (!kept.length) return json(400, { error: 'Every question is left out. Keep at least one, or discard the draft.' });
  const activate = b.activate !== false;
  // RECORDED FIRST, as every audited action is: a throw here refuses the accept.
  const auditRef = await audit(event, draft, 'draft.accept', {
    mode: 'new', kept: kept.length, left: items.length - kept.length, activate,
  });
  if (!(await drafts.claimAccept(db(), table(), draft, { auditRef }))) {
    await markAuditOutcome(db(), auditRef, 'refused');
    return json(409, { error: 'This draft is already being accepted, or is no longer waiting for review.' });
  }
  const imported = await importDraftAsSet({
    event,
    draft,
    items: kept.map((it) => it.item),
    activate,
    title: typeof b.title === 'string' ? b.title : '',
    topic: typeof b.topic === 'string' ? b.topic : '',
  });
  if (imported.statusCode !== 200) {
    await drafts.releaseAccept(db(), table(), { ...draft, status: drafts.STATUS.ACCEPTING });
    await markAuditOutcome(db(), auditRef, 'refused');
    return json(imported.statusCode, { ...imported.body, accepted: false });
  }
  const setId = imported.body.setId;
  await drafts.completeAccept(db(), table(), { ...draft, status: drafts.STATUS.ACCEPTING }, {
    setId, version: imported.body.version ?? 1, previousVersion: null, kept: kept.length, left: items.length - kept.length,
  });
  return json(200, {
    accepted: true,
    setId,
    setName: imported.body.setName || draft.title,
    version: imported.body.version ?? 1,
    active: activate,
    kept: kept.length,
    left: items.length - kept.length,
  });
}

async function acceptIntoSet(event, draft, b) {
  const phase = String(b.phase || '');
  // The set must still be one this person may change — at accept time, not
  // only when the run started.
  const found = await findSetForCaller(db(), table(), event, draft.targetSetId, draft.scope);
  if (!found || !found.item) return json(404, { error: 'The set this draft adds to is gone.' });
  const refused = requireSetManager(event, found.item, 'add generated questions to');
  if (refused) return refused;

  if (phase === 'claim') {
    if (draft.status !== drafts.STATUS.READY && draft.status !== drafts.STATUS.ACCEPTING) {
      return json(409, { error: 'This draft is no longer waiting for review.' });
    }
    const items = await drafts.listItems(db(), table(), draft);
    const kept = keptOf(items);
    if (!kept.length) return json(400, { error: 'Every question is left out. Keep at least one, or discard the draft.' });
    // RECORDED FIRST: the version the editor is about to save is the action.
    const auditRef = await audit(event, draft, 'draft.accept', {
      mode: 'append',
      setId: draft.targetSetId,
      fromVersion: found.item.activeVersion ?? null,
      kept: kept.length,
      left: items.length - kept.length,
    });
    if (!(await drafts.claimAccept(db(), table(), draft, { auditRef }))) {
      await markAuditOutcome(db(), auditRef, 'refused');
      return json(409, { error: 'This draft is already being accepted, or is no longer waiting for review.' });
    }
    return json(200, {
      claimed: true,
      items: kept,
      left: items.length - kept.length,
      activeVersion: found.item.activeVersion ?? null,
    });
  }
  if (phase === 'release') {
    if (draft.acceptAudit) await markAuditOutcome(db(), draft.acceptAudit, 'failed');
    await drafts.releaseAccept(db(), table(), draft);
    return json(200, { released: true });
  }
  if (phase === 'complete') {
    if (draft.status !== drafts.STATUS.ACCEPTING) return json(409, { error: 'This draft was not being accepted.' });
    const version = Number.isFinite(Number(b.version)) ? Number(b.version) : null;
    const previousVersion = Number.isFinite(Number(b.previousVersion)) ? Number(b.previousVersion) : null;
    const kept = Math.max(0, parseInt(b.kept, 10) || 0);
    const left = Math.max(0, parseInt(b.left, 10) || 0);
    await drafts.completeAccept(db(), table(), draft, {
      setId: draft.targetSetId, version, previousVersion, kept, left,
    });
    return json(200, { accepted: true, setId: draft.targetSetId, version, previousVersion });
  }
  return json(400, { error: 'Say which step of the accept this is: claim, complete or release.' });
}

async function accept(event, id) {
  const { draft, response } = await loadMine(event, id);
  if (response) return response;
  const b = body(event);
  if (!b) return json(400, { error: 'Request body is not valid JSON.' });
  if (draft.mode === 'append') return acceptIntoSet(event, draft, b);
  return acceptNewSet(event, draft, b);
}

async function discard(event, id) {
  const { draft, response } = await loadMine(event, id);
  if (response) return response;
  if (draft.status !== drafts.STATUS.READY && draft.status !== drafts.STATUS.FAILED) {
    return json(409, { error: 'Only a draft waiting for review can be discarded.' });
  }
  const ref = await audit(event, draft, 'draft.discard', { produced: Number(draft.produced) || 0 });
  if (!(await drafts.discard(db(), table(), draft))) {
    await markAuditOutcome(db(), ref, 'failed');
    return json(409, { error: 'Only a draft waiting for review can be discarded.' });
  }
  return json(200, { discarded: true, restorableDays: drafts.DISCARD_RESTORE_DAYS });
}

async function undo(event, id) {
  const { draft, response } = await loadMine(event, id);
  if (response) return response;
  if (draft.status !== drafts.STATUS.ACCEPTED || draft.mode !== 'append') {
    return json(409, { error: 'Only an accepted addition to a set can be undone here.' });
  }
  if (draft.undoneAt) return json(409, { error: 'This accept was already undone.' });
  const previous = Number(draft.previousVersion);
  if (!Number.isFinite(previous) || previous < 1) {
    return json(409, { error: 'There is no earlier version to go back to.' });
  }
  const found = await findSetForCaller(db(), table(), event, draft.targetSetId, draft.scope);
  if (!found || !found.item) return json(404, { error: 'The set this draft added to is gone.' });
  if (Number(found.item.activeVersion) !== Number(draft.acceptedVersion)) {
    return json(409, {
      error: `The set has moved on since (it is on version ${found.item.activeVersion}). Use its Versions to go back.`,
    });
  }
  // eslint-disable-next-line global-require
  const { handler: promote } = require('./promote-set-version');
  const res = await promote({
    requestContext: { authorizer: event.requestContext && event.requestContext.authorizer, http: { method: 'POST' } },
    pathParameters: { setId: draft.targetSetId, version: String(previous) },
    queryStringParameters: { scope: draft.scope },
  });
  let out = {};
  try { out = JSON.parse(res.body || '{}'); } catch (e) { out = {}; }
  if (res.statusCode !== 200) return json(res.statusCode, out);
  await drafts.markUndone(db(), table(), draft);
  return json(200, { undone: true, setId: draft.targetSetId, activeVersion: previous });
}

async function restore(event, id) {
  const { draft, response } = await loadMine(event, id);
  if (response) return response;
  if (draft.status !== drafts.STATUS.DISCARDED) return json(409, { error: 'Only a discarded draft can be restored.' });
  const ref = await audit(event, draft, 'draft.restore', {});
  if (!(await drafts.restore(db(), table(), draft))) {
    await markAuditOutcome(db(), ref, 'failed');
    return json(409, { error: 'Only a discarded draft can be restored.' });
  }
  return json(200, { restored: true });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  try {
    const { id, action } = routeOf(event);
    if (method === 'GET' && id === 'list') return await list(event);
    if (!id || id === 'list') return json(404, { error: 'Not found.' });
    if (method === 'GET' && !action) return await getOne(event, id);
    if (method === 'POST') {
      if (action === 'items') return await editItems(event, id);
      if (action === 'cancel') return await cancel(event, id);
      if (action === 'accept') return await accept(event, id);
      if (action === 'discard') return await discard(event, id);
      if (action === 'restore') return await restore(event, id);
      if (action === 'undo') return await undo(event, id);
    }
    return json(404, { error: 'Not found.' });
  } catch (error) {
    console.error('❌ generation-drafts:', error);
    return json(500, { error: `Something went wrong with that draft: ${error.message}` });
  }
};

/** For tests. */
exports.setDb = (client) => { dbClient = client; };
exports.routeOf = routeOf;
