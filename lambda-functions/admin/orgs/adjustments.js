/**
 * ADJUSTMENTS AND DISCOUNT CODES — the ledger behind a team's bill.
 *
 * docs/handoff/billing-experience-2026-09-22.md §2.2; mockups 16–19. The
 * owner: "a way for engage admins to give credits, set subscription special
 * rates, etc for a team. and finally a x month free tier or x month discount.
 * all of this would need to be super transparent."
 *
 * ── ROWS ────────────────────────────────────────────────────────────────────
 *
 *   ORG#<org> / ADJ#<isoTs>#<adjId>   RecordType 'ADJUSTMENT' — append-only.
 *       kind, amount/units/rate/percentOff/fixedOffCents, validFrom, validTo,
 *       remainingCents (CREDIT_CENTS), source {type, by, code?}, note,
 *       createdAt, createdBy; revokedAt/revokedBy/revokeNote added later,
 *       never removed. A revoked row stays: the invoice it touched points at it.
 *   ORGS      / CODE#<CODE>            the code: terms, window, counter.
 *   ORG#<org> / CODEUSE#<CODE>         one redemption per team, conditional.
 *
 * ── ROUTES ──────────────────────────────────────────────────────────────────
 *
 *   GET    /orgs/{orgId}/adjustments                       org admin+  the ledger, read-only
 *   GET    /platform/orgs/{orgId}/adjustments              staff
 *   POST   /platform/orgs/{orgId}/adjustments              staff       grant (note required)
 *   POST   /platform/orgs/{orgId}/adjustments/{adjId}/revoke  staff    (note required)
 *   GET    /platform/codes                                 staff
 *   POST   /platform/codes                                 staff       create
 *   POST   /platform/codes/{code}/retire                   staff
 *
 * Redemption has no route of its own: a code is named on a plan request and
 * redeemed by `redeemCode()` when the request is APPROVED (plan-requests.js),
 * so a declined request never burns a use. Validation for the request dialog
 * is `checkCode()`, exposed through GET /platform/codes for staff and read
 * on approval — the customer sees the code's terms on the strip afterwards.
 */
const { QueryCommand, GetCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');
const { periodOf } = require('../shared/usage');
const { offerWindow, isActive } = require('../shared/pricing-adjust');

const KINDS = ['CREDIT_CENTS', 'CREDIT_UNITS', 'RATE_OVERRIDE', 'OFFER'];
const NOTE_MAX = 600;
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const PERIOD_RE = /^\d{4}-\d{2}$/;
const cents = (v) => Math.max(0, Math.trunc(Number(v) || 0));

function requirePlatformAdmin(event) {
  if (!tenant.isPlatformAdmin(event)) return G.fail(403, 'This is an Engage staff screen.');
  return null;
}

/* ------------------------------------------------------------- the ledger --- */

async function listAdjustments(orgId) {
  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.orgPk(orgId), ':sk': 'ADJ#' },
    ScanIndexForward: false,
  }));
  return res.Items || [];
}

/** The row as either side sees it, plus its status for `period`. */
function publicAdjustment(row, period) {
  const status = row.revokedAt ? 'revoked'
    : (isActive(row, period) ? 'active'
      : (row.validFrom && period < row.validFrom ? 'upcoming' : 'ended'));
  return {
    adjId: row.adjId, kind: row.kind,
    amountCents: row.amountCents, remainingCents: row.remainingCents,
    units: row.units, rate: row.rate,
    percentOff: row.percentOff, fixedOffCents: row.fixedOffCents,
    validFrom: row.validFrom || '', validTo: row.validTo || '',
    source: row.source || {}, note: row.note || '',
    createdAt: row.createdAt, createdBy: row.createdBy || '', createdByEmail: row.createdByEmail || '',
    revokedAt: row.revokedAt || '', revokedBy: row.revokedBy || '', revokeNote: row.revokeNote || '',
    status,
  };
}

async function readLedger(event, orgId, staff) {
  if (staff) {
    const denied = requirePlatformAdmin(event);
    if (denied) return denied;
  } else {
    const auth = await G.authorizeOrg(event, orgId, 'admin');
    if (auth.denied) return auth.denied;
  }
  const period = periodOf(new Date());
  const rows = await listAdjustments(orgId);
  return G.json(200, { period, adjustments: rows.map((r) => publicAdjustment(r, period)) });
}

/** Build one ADJ row from a staff grant body. Returns { row } or { error }. */
function buildGrant(body, orgId, by, byEmail, now) {
  const kind = G.clean(body.kind).toUpperCase();
  if (!KINDS.includes(kind)) return { error: `kind must be one of: ${KINDS.join(', ')}.` };
  const note = G.clean(body.note).slice(0, NOTE_MAX);
  if (!note) return { error: 'A reason is required — the customer reads it.' };
  const thisPeriod = periodOf(new Date(now));
  const validFrom = G.clean(body.validFrom) || thisPeriod;
  if (!PERIOD_RE.test(validFrom)) return { error: 'validFrom must look like 2026-09.' };
  const row = {
    PK: tenant.orgPk(orgId), SK: `ADJ#${now}#${G.randomBase58(10)}`,
    RecordType: 'ADJUSTMENT', orgId, adjId: '', kind, validFrom, note,
    source: { type: 'platform_admin', by },
    createdAt: now, createdBy: by, createdByEmail: byEmail,
  };
  row.adjId = row.SK.split('#')[2];
  if (kind === 'CREDIT_CENTS') {
    const amount = cents(body.amountCents);
    if (!amount) return { error: 'A credit needs an amount in cents.' };
    row.amountCents = amount; row.remainingCents = amount;
    // Open-ended: a credit lives until spent.
  } else if (kind === 'CREDIT_UNITS') {
    const units = { sessions: cents(body.units && body.units.sessions), sets: cents(body.units && body.units.sets) };
    if (!units.sessions && !units.sets) return { error: 'Extra allowance needs sessions or sets.' };
    row.units = units;
    Object.assign(row, window(body, validFrom));
  } else if (kind === 'RATE_OVERRIDE') {
    const r = body.rate || {};
    const rate = {};
    if (r.baseCents != null) rate.baseCents = cents(r.baseCents);
    if (r.perSessionCents != null) rate.perSessionCents = cents(r.perSessionCents);
    if (r.perSetCents != null) rate.perSetCents = cents(r.perSetCents);
    if (!Object.keys(rate).length) return { error: 'A special rate needs a base, per-session or per-set price.' };
    row.rate = rate;
    Object.assign(row, window(body, validFrom));
  } else if (kind === 'OFFER') {
    if (body.percentOff != null) {
      const pct = cents(body.percentOff);
      if (pct < 1 || pct > 100) return { error: 'percentOff must be 1–100.' };
      row.percentOff = pct;
    } else if (body.fixedOffCents != null) {
      const fixed = cents(body.fixedOffCents);
      if (!fixed) return { error: 'fixedOffCents must be a positive amount.' };
      row.fixedOffCents = fixed;
    } else {
      return { error: 'An offer is a percentage or a fixed amount off.' };
    }
    Object.assign(row, window(body, validFrom));
  }
  return { row };
}

/** validFrom/validTo from `months` (X months from validFrom) or an explicit validTo. */
function window(body, validFrom) {
  if (body.months != null) return offerWindow(validFrom, body.months);
  const validTo = G.clean(body.validTo);
  if (validTo && !PERIOD_RE.test(validTo)) return { validFrom, validTo: validFrom };
  return { validFrom, ...(validTo ? { validTo } : {}) };
}

async function grant(event, orgId) {
  const denied = requirePlatformAdmin(event);
  if (denied) return denied;
  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');
  const org = await G.getOrgMetadata(orgId);
  if (!org) return G.fail(404, 'No such organisation.');
  const now = new Date().toISOString();
  const built = buildGrant(body, orgId, G.callerSub(event), G.callerEmail(event), now);
  if (built.error) return G.fail(400, built.error);
  await G.db.send(new TransactWriteCommand({
    TransactItems: [{ Put: { TableName: G.tableName(), Item: built.row, ConditionExpression: 'attribute_not_exists(PK)' } }],
  }));
  return G.json(201, { adjustment: publicAdjustment(built.row, periodOf(new Date(now))) });
}

async function revoke(event, orgId, adjId) {
  const denied = requirePlatformAdmin(event);
  if (denied) return denied;
  const body = G.parseBody(event) || {};
  const revokeNote = G.clean(body.note).slice(0, NOTE_MAX);
  if (!revokeNote) return G.fail(400, 'A reason is required — the customer reads it.');
  const row = (await listAdjustments(orgId)).find((r) => r.adjId === adjId);
  if (!row) return G.fail(404, 'No such adjustment.');
  if (row.revokedAt) return G.fail(409, 'Already revoked.');
  const now = new Date().toISOString();
  await G.db.send(new UpdateCommand({
    TableName: G.tableName(),
    Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: 'SET revokedAt = :at, revokedBy = :by, revokeNote = :note',
    ConditionExpression: 'attribute_not_exists(revokedAt)',
    ExpressionAttributeValues: { ':at': now, ':by': G.callerSub(event), ':note': revokeNote },
  }));
  return G.json(200, { adjustment: publicAdjustment({ ...row, revokedAt: now, revokedBy: G.callerSub(event), revokeNote }, periodOf(new Date(now))) });
}

/* ---------------------------------------------------------------- codes --- */

const codeSk = (code) => `CODE#${code}`;

function publicCode(row) {
  return {
    code: row.code, percentOff: row.percentOff, fixedOffCents: row.fixedOffCents, months: row.months || null,
    validUntil: row.validUntil || '', maxUses: row.maxUses, uses: row.uses || 0,
    note: row.note || '', createdAt: row.createdAt, createdBy: row.createdBy || '',
    retiredAt: row.retiredAt || '',
    status: row.retiredAt ? 'retired'
      : (row.validUntil && row.validUntil < new Date().toISOString().slice(0, 10)) ? 'expired'
        : (row.maxUses && (row.uses || 0) >= row.maxUses) ? 'exhausted' : 'active',
  };
}

async function getCode(code) {
  const res = await G.db.send(new GetCommand({ TableName: G.tableName(), Key: { PK: tenant.ORGS_INDEX_PK, SK: codeSk(code) } }));
  return res.Item || null;
}

/** Can `code` be redeemed today? { ok, code (public), reason }. */
async function checkCode(code) {
  const c = G.clean(code).toUpperCase();
  if (!CODE_RE.test(c)) return { ok: false, reason: 'That does not look like a discount code.' };
  const row = await getCode(c);
  if (!row) return { ok: false, reason: `There is no code ${c}.` };
  const pub = publicCode(row);
  if (pub.status !== 'active') return { ok: false, reason: `${c} is ${pub.status}.`, code: pub };
  return { ok: true, code: pub };
}

async function listCodes(event) {
  const denied = requirePlatformAdmin(event);
  if (denied) return denied;
  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.ORGS_INDEX_PK, ':sk': 'CODE#' },
  }));
  return G.json(200, { codes: (res.Items || []).map(publicCode).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}

async function createCode(event) {
  const denied = requirePlatformAdmin(event);
  if (denied) return denied;
  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');
  const code = G.clean(body.code).toUpperCase();
  if (!CODE_RE.test(code)) return G.fail(400, 'A code is 3–32 letters, digits and dashes.');
  const row = {
    PK: tenant.ORGS_INDEX_PK, SK: codeSk(code), RecordType: 'CODE', code,
    maxUses: cents(body.maxUses) || null, uses: 0,
    validUntil: G.clean(body.validUntil) || '',
    months: body.months != null ? Math.max(1, cents(body.months)) : null,
    note: G.clean(body.note).slice(0, NOTE_MAX),
    createdAt: new Date().toISOString(), createdBy: G.callerSub(event), createdByEmail: G.callerEmail(event),
  };
  if (body.percentOff != null) {
    const pct = cents(body.percentOff);
    if (pct < 1 || pct > 100) return G.fail(400, 'percentOff must be 1–100.');
    row.percentOff = pct;
  } else if (body.fixedOffCents != null) {
    const fixed = cents(body.fixedOffCents);
    if (!fixed) return G.fail(400, 'fixedOffCents must be a positive amount.');
    row.fixedOffCents = fixed;
  } else {
    return G.fail(400, 'A code gives a percentage or a fixed amount off.');
  }
  if (row.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(row.validUntil)) return G.fail(400, 'validUntil must look like 2026-12-31.');
  try {
    await G.db.send(new TransactWriteCommand({
      TransactItems: [{ Put: { TableName: G.tableName(), Item: row, ConditionExpression: 'attribute_not_exists(PK)' } }],
    }));
  } catch (e) {
    if (e && e.name === 'TransactionCanceledException') return G.fail(409, `${code} already exists. Retire it to reuse the name.`);
    throw e;
  }
  return G.json(201, { code: publicCode(row) });
}

async function retireCode(event, code) {
  const denied = requirePlatformAdmin(event);
  if (denied) return denied;
  const c = G.clean(code).toUpperCase();
  const row = await getCode(c);
  if (!row) return G.fail(404, 'No such code.');
  if (row.retiredAt) return G.fail(409, 'Already retired.');
  const now = new Date().toISOString();
  await G.db.send(new UpdateCommand({
    TableName: G.tableName(), Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: 'SET retiredAt = :at, retiredBy = :by',
    ExpressionAttributeValues: { ':at': now, ':by': G.callerSub(event) },
  }));
  return G.json(200, { code: publicCode({ ...row, retiredAt: now }) });
}

/**
 * REDEEM, on approval of a plan request. Returns the TransactItems to add to
 * the approval's own transaction, so the plan change and the redemption are
 * one write — or `{ error }` when the code cannot be redeemed, which the
 * approver sees before deciding. `uses < maxUses` and one-per-team are both
 * conditions, so a race loses loudly rather than over-redeeming.
 */
async function redeemCodeItems({ orgId, code, reqId, by, now }) {
  const check = await checkCode(code);
  if (!check.ok) return { error: check.reason };
  const c = check.code;
  const period = periodOf(new Date(now));
  const adj = {
    PK: tenant.orgPk(orgId), SK: `ADJ#${now}#${G.randomBase58(10)}`,
    RecordType: 'ADJUSTMENT', orgId, kind: 'CODE_REDEMPTION', code: c.code,
    ...(c.percentOff != null ? { percentOff: c.percentOff } : { fixedOffCents: c.fixedOffCents }),
    ...(c.months ? offerWindow(period, c.months) : { validFrom: period }),
    source: { type: 'code', code: c.code, by, reqId },
    note: `Code ${c.code}, applied when the plan request was approved.`,
    createdAt: now, createdBy: by,
  };
  adj.adjId = adj.SK.split('#')[2];
  const table = G.tableName();
  return {
    adjustment: adj,
    items: [
      { Put: { TableName: table, Item: adj, ConditionExpression: 'attribute_not_exists(PK)' } },
      {
        Put: {
          TableName: table,
          Item: { PK: tenant.orgPk(orgId), SK: `CODEUSE#${c.code}`, RecordType: 'CODEUSE', orgId, code: c.code, adjId: adj.adjId, at: now },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Update: {
          TableName: table, Key: { PK: tenant.ORGS_INDEX_PK, SK: codeSk(c.code) },
          UpdateExpression: 'ADD #uses :one',
          ConditionExpression: c.maxUses ? '#uses < :max' : 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#uses': 'uses' },
          ExpressionAttributeValues: { ':one': 1, ...(c.maxUses ? { ':max': c.maxUses } : {}) },
        },
      },
    ],
  };
}

/* -------------------------------------------------------------- routing --- */

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return G.handlePreflight();
  const path = String(event?.rawPath || '');
  const p = event?.pathParameters || {};
  try {
    if (/\/platform\/codes(?:\/|$)/.test(path)) {
      if (method === 'GET') return await listCodes(event);
      if (method === 'POST' && p.code) return await retireCode(event, p.code);
      if (method === 'POST') return await createCode(event);
      return G.fail(404, 'Endpoint not found');
    }
    if (!p.orgId) return G.fail(400, 'orgId is required.');
    const staff = /\/platform\//.test(path);
    if (method === 'GET') return await readLedger(event, p.orgId, staff);
    if (method === 'POST' && staff && p.adjId) return await revoke(event, p.orgId, p.adjId);
    if (method === 'POST' && staff) return await grant(event, p.orgId);
    return G.fail(404, 'Endpoint not found');
  } catch (error) {
    console.error('adjustments error:', error);
    return G.fail(500, 'Something went wrong with that request.');
  }
};

exports.listAdjustments = listAdjustments;
exports.publicAdjustment = publicAdjustment;
exports.checkCode = checkCode;
exports.redeemCodeItems = redeemCodeItems;
exports.KINDS = KINDS;
