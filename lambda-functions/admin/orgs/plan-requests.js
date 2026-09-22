/**
 * PLAN REQUESTS — how a team gets past free.
 *
 * Until this file there was no way: every organisation is created `free`
 * (create-org.js) and nothing anywhere changed the plan
 * (docs/handoff/billing-experience-2026-09-22.md §1.5). The owner: "for now im
 * ok with it being a request to the engage level admins, where as in the
 * future it could be a stripe payment."
 *
 * So an owner ASKS, Engage DECIDES, and the decision is RECORDED — all in the
 * system, no email. Mockups: docs/design/tenancy-redesign/13, 14, 15.
 *
 * ── ROWS ────────────────────────────────────────────────────────────────────
 *
 *   ORG#<org> / PLANREQ#<isoTs>#<reqId>          the request, forever
 *   ORGS      / PLANREQ#<status>#<isoTs>#<org>   the platform queue pointer;
 *                                                 moved on decision
 *   ORG#<org> / LEDGER#<period>#PLAN_CHANGE#<reqId>  written on approval, so
 *                                                 the plan history and the
 *                                                 invoice can point at it
 *
 * Both partitions come from tenant.js — nothing here writes a bare literal
 * (tests/no-global-partition-literals.js).
 *
 * ── STATE MACHINE ───────────────────────────────────────────────────────────
 *
 *   requested → approved | declined   (platform admin, note REQUIRED)
 *   requested → withdrawn             (the owner, while still requested)
 *
 * Terminal rows are never edited. A declined team may request again at once
 * (owner's decision, handoff §2.7 Q1). A discount code named on the request
 * is VALIDATED now and APPLIED only on approval, by step 3's ledger — a code
 * burned on a request that is then declined would be a use for nothing.
 * Until step 3 exists the code is carried on the row and shown, not applied.
 *
 * ── ROUTES ──────────────────────────────────────────────────────────────────
 *
 *   POST   /orgs/{orgId}/plan-requests             owner       ask
 *   GET    /orgs/{orgId}/plan-requests             admin+      history
 *   DELETE /orgs/{orgId}/plan-requests/{reqId}     owner       withdraw
 *   GET    /platform/plan-requests?status=         Engage staff queue
 *   POST   /platform/plan-requests/{orgId}/{reqId}/decide  Engage staff
 */
const { QueryCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');
const { periodOf } = require('../shared/usage');
const { redeemCodeItems } = require('./adjustments');

const STATUSES = ['requested', 'approved', 'declined', 'withdrawn'];
const PLANS = ['free', 'team'];
const NOTE_MAX = 600;
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

const reqSk = (ts, reqId) => `PLANREQ#${ts}#${reqId}`;
const queueSk = (status, ts, orgId) => `PLANREQ#${status}#${ts}#${orgId}`;

function requirePlatformAdmin(event) {
  if (!tenant.isPlatformAdmin(event)) return G.fail(403, 'This is an Engage staff screen.');
  return null;
}

/** What either side may see of a request. */
function publicRequest(row) {
  if (!row) return null;
  return {
    reqId: row.reqId,
    orgId: row.orgId,
    fromPlan: row.fromPlan,
    toPlan: row.toPlan,
    status: row.status,
    note: row.note || '',
    code: row.code || '',
    requestedBy: row.requestedBy,
    requestedByEmail: row.requestedByEmail || '',
    requestedAt: row.requestedAt,
    decidedBy: row.decidedBy || '',
    decidedByEmail: row.decidedByEmail || '',
    decidedAt: row.decidedAt || '',
    decisionNote: row.decisionNote || '',
    withdrawnAt: row.withdrawnAt || '',
    codeApplied: row.codeApplied || '',
    codeAdjId: row.codeAdjId || '',
  };
}

async function listFor(orgId) {
  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.orgPk(orgId), ':sk': 'PLANREQ#' },
    ScanIndexForward: false,
  }));
  return (res.Items || []).map(publicRequest);
}

async function getRequest(orgId, reqId) {
  // The SK carries the timestamp, which the caller does not hold; a Query on
  // the prefix and a find is cheap — an org has a handful of these, ever.
  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.orgPk(orgId), ':sk': 'PLANREQ#' },
  }));
  return (res.Items || []).find((r) => r.reqId === reqId) || null;
}

/* ------------------------------------------------------------ the owner --- */

async function createRequest(event, orgId) {
  const auth = await G.authorizeOrg(event, orgId, 'owner');
  if (auth.denied) return auth.denied;
  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');

  const org = await G.getOrgMetadata(orgId);
  if (!org) return G.fail(404, 'No such organisation.');
  const fromPlan = PLANS.includes(org.plan) ? org.plan : 'free';
  const toPlan = G.clean(body.toPlan).toLowerCase() || 'team';
  if (!PLANS.includes(toPlan)) return G.fail(400, `Plan must be one of: ${PLANS.join(', ')}.`);
  if (toPlan === fromPlan) return G.fail(400, `This organisation is already on the ${toPlan} plan.`);

  const note = G.clean(body.note).slice(0, NOTE_MAX);
  const code = G.clean(body.code).toUpperCase();
  if (code && !CODE_RE.test(code)) return G.fail(400, 'That does not look like a discount code.');

  // ONE OPEN REQUEST AT A TIME. A second row would be two things for staff to
  // decide about one org, and two answers to reconcile.
  const open = (await listFor(orgId)).find((r) => r.status === 'requested');
  if (open) return G.fail(409, 'A request is already waiting. Withdraw it to send another.');

  const now = new Date().toISOString();
  const reqId = G.randomBase58(10);
  const sub = G.callerSub(event);
  const row = {
    PK: tenant.orgPk(orgId),
    SK: reqSk(now, reqId),
    RecordType: 'PLANREQ',
    reqId, orgId, fromPlan, toPlan,
    status: 'requested',
    note, code,
    requestedBy: sub,
    requestedByEmail: G.callerEmail(event),
    requestedAt: now,
  };
  await G.db.send(new TransactWriteCommand({
    TransactItems: [
      { Put: { TableName: G.tableName(), Item: row, ConditionExpression: 'attribute_not_exists(PK)' } },
      {
        Put: {
          TableName: G.tableName(),
          Item: {
            PK: tenant.ORGS_INDEX_PK, SK: queueSk('requested', now, orgId),
            RecordType: 'PLANREQ_QUEUE', orgId, reqId, orgName: org.name || '', toPlan, code, requestedAt: now,
          },
        },
      },
    ],
  }));
  return G.json(201, { request: publicRequest(row) });
}

async function withdraw(event, orgId, reqId) {
  const auth = await G.authorizeOrg(event, orgId, 'owner');
  if (auth.denied) return auth.denied;
  const row = await getRequest(orgId, reqId);
  if (!row) return G.fail(404, 'No such request.');
  if (row.status !== 'requested') return G.fail(409, `That request was already ${row.status}.`);
  const now = new Date().toISOString();
  await moveRequest(row, { status: 'withdrawn', withdrawnAt: now, withdrawnBy: G.callerSub(event) });
  return G.json(200, { request: publicRequest({ ...row, status: 'withdrawn', withdrawnAt: now }) });
}

/** Set the terminal state on the row and move its queue pointer, atomically. */
async function moveRequest(row, patch, extraItems = []) {
  const names = {}; const values = {}; const sets = [];
  Object.entries(patch).forEach(([k, v], i) => {
    names[`#f${i}`] = k; values[`:v${i}`] = v; sets.push(`#f${i} = :v${i}`);
  });
  values[':requested'] = 'requested';
  names['#status'] = 'status';
  await G.db.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: G.tableName(),
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: `SET ${sets.join(', ')}`,
          // Two staff deciding at once: the second one loses, loudly.
          ConditionExpression: '#status = :requested',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      },
      { Delete: { TableName: G.tableName(), Key: { PK: tenant.ORGS_INDEX_PK, SK: queueSk('requested', row.requestedAt, row.orgId) } } },
      {
        Put: {
          TableName: G.tableName(),
          Item: {
            PK: tenant.ORGS_INDEX_PK, SK: queueSk(patch.status, row.requestedAt, row.orgId),
            RecordType: 'PLANREQ_QUEUE', orgId: row.orgId, reqId: row.reqId, toPlan: row.toPlan, code: row.code || '',
            requestedAt: row.requestedAt, decidedAt: patch.decidedAt || patch.withdrawnAt || '',
          },
        },
      },
      ...extraItems,
    ],
  }));
}

async function listMine(event, orgId) {
  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;
  const org = await G.getOrgMetadata(orgId);
  return G.json(200, { plan: (org && org.plan) || 'free', requests: await listFor(orgId) });
}

/* --------------------------------------------------------------- Engage --- */

async function listQueue(event) {
  const denied = requirePlatformAdmin(event);
  if (denied) return denied;
  const status = G.clean(event?.queryStringParameters?.status) || 'requested';
  if (!STATUSES.includes(status) && status !== 'all') return G.fail(400, `status must be one of: ${STATUSES.join(', ')}, all.`);
  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.ORGS_INDEX_PK, ':sk': status === 'all' ? 'PLANREQ#' : `PLANREQ#${status}#` },
    ScanIndexForward: false,
  }));
  const pointers = res.Items || [];
  // The pointer carries what the table shows; the full row is one Get away
  // and is fetched so the queue can show the note and the decision.
  const rows = await Promise.all(pointers.map(async (p) => {
    const full = await getRequest(p.orgId, p.reqId);
    const org = await G.getOrgMetadata(p.orgId);
    return {
      ...publicRequest(full || p),
      orgName: (org && org.name) || p.orgName || p.orgId,
      orgType: org ? G.orgType(org) : '',
      orgPlan: (org && org.plan) || 'free',
    };
  }));
  return G.json(200, { requests: rows });
}

async function decide(event, orgId, reqId) {
  const denied = requirePlatformAdmin(event);
  if (denied) return denied;
  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');
  const decision = G.clean(body.decision).toLowerCase();
  if (!['approved', 'declined'].includes(decision)) return G.fail(400, 'decision must be approved or declined.');
  // THE NOTE IS THE CUSTOMER'S. It is quoted on their screen and kept in their
  // history with the reviewer's name — a decision with no words is a wall.
  const decisionNote = G.clean(body.note).slice(0, NOTE_MAX);
  if (!decisionNote) return G.fail(400, 'A note to the customer is required — they read it.');

  const row = await getRequest(orgId, reqId);
  if (!row) return G.fail(404, 'No such request.');
  if (row.status !== 'requested') return G.fail(409, `That request was already ${row.status}.`);

  const now = new Date().toISOString();
  const by = G.callerSub(event);
  const patch = { status: decision, decidedAt: now, decidedBy: by, decidedByEmail: G.callerEmail(event), decisionNote };

  const extra = [];
  if (decision === 'approved') {
    // The plan changes on BOTH org rows (create-org.js writes both), and a
    // ledger row says when and why — the row the invoice will point at.
    for (const key of [
      { PK: tenant.orgPk(orgId), SK: 'METADATA' },
      { PK: tenant.ORGS_INDEX_PK, SK: tenant.orgPk(orgId) },
    ]) {
      extra.push({
        Update: {
          TableName: G.tableName(), Key: key,
          UpdateExpression: 'SET #plan = :plan, planChangedAt = :now',
          ExpressionAttributeNames: { '#plan': 'plan' },
          ExpressionAttributeValues: { ':plan': row.toPlan, ':now': now },
        },
      });
    }
    /*
      THE CODE IS REDEEMED HERE, IN THE SAME TRANSACTION as the plan change —
      never on the request, so a declined request burns no use. A code that
      cannot be redeemed (retired, expired, exhausted, already used by this
      team) refuses the approval with the reason: the approver decides again
      with the code cleared, rather than the customer discovering on their
      invoice that the discount they were promised never landed.
    */
    if (row.code && !body.dropCode) {
      const redeemed = await redeemCodeItems({ orgId, code: row.code, reqId, by, now });
      if (redeemed.error) {
        return G.fail(409, `${redeemed.error} Approve with dropCode: true to approve without it, or decline and say why.`);
      }
      extra.push(...redeemed.items);
      patch.codeApplied = row.code;
      patch.codeAdjId = redeemed.adjustment.adjId;
    }
    extra.push({
      Put: {
        TableName: G.tableName(),
        Item: {
          PK: tenant.orgPk(orgId), SK: `LEDGER#${periodOf(new Date(now))}#PLAN_CHANGE#${reqId}`,
          RecordType: 'LEDGER', kind: 'PLAN_CHANGE', orgId, reqId,
          fromPlan: row.fromPlan, toPlan: row.toPlan, code: row.code || '',
          at: now, by, note: decisionNote,
        },
      },
    });
  }
  try {
    await moveRequest(row, patch, extra);
  } catch (e) {
    if (e && e.name === 'TransactionCanceledException') return G.fail(409, 'Somebody decided this request a moment ago.');
    throw e;
  }
  return G.json(200, { request: publicRequest({ ...row, ...patch }), plan: decision === 'approved' ? row.toPlan : row.fromPlan });
}

/* -------------------------------------------------------------- routing --- */

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return G.handlePreflight();
  const path = String(event?.rawPath || '');
  const p = event?.pathParameters || {};
  try {
    if (/\/platform\/plan-requests(?:\/|$)/.test(path)) {
      if (method === 'GET') return await listQueue(event);
      if (method === 'POST' && p.orgId && p.reqId) return await decide(event, p.orgId, p.reqId);
      return G.fail(404, 'Endpoint not found');
    }
    if (!p.orgId) return G.fail(400, 'orgId is required.');
    if (method === 'POST') return await createRequest(event, p.orgId);
    if (method === 'GET') return await listMine(event, p.orgId);
    if (method === 'DELETE' && p.reqId) return await withdraw(event, p.orgId, p.reqId);
    return G.fail(404, 'Endpoint not found');
  } catch (error) {
    console.error('plan-requests error:', error);
    return G.fail(500, 'Something went wrong with that request.');
  }
};

exports.STATUSES = STATUSES;
exports.publicRequest = publicRequest;
