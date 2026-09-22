/**
 * SIMULATED INVOICES — one row per organisation per closed month.
 *
 * docs/handoff/billing-experience-2026-09-22.md §2.3; mockups 20 and 21. The
 * owner: "goes through the motion and states (this is not an actual invoice
 * but you would have been charged $x.xx which is a 30% discount or something
 * etc.) ... no emails yet just keep it all in the system itself."
 *
 * ── ROWS ────────────────────────────────────────────────────────────────────
 *
 *   ORG#<org> / INVOICE#<yyyy-mm>        RecordType 'INVOICE', status 'closed',
 *                                        simulated: true, the whole computed
 *                                        document FROZEN inside (plan, usage,
 *                                        lines, discounts, credits, totals,
 *                                        settlement) so it reads the same in a
 *                                        year whatever the ledger does after.
 *   ORGS      / INVOICE#<yyyy-mm>#<org>  pointer, so staff can list a month.
 *
 * ── WHEN ────────────────────────────────────────────────────────────────────
 *
 * `closeInvoice` is called by usage-reconcile.js for the PREVIOUS period on
 * every nightly run. It is a conditional put (attribute_not_exists), so the
 * second and every later night are no-ops — idempotent like the rest of that
 * file. A free month is written too, at $0.00: a $0.00 row is the record of a
 * month; a gap reads as "something is missing".
 *
 * ── THE ONE STRIPE SEAM ─────────────────────────────────────────────────────
 *
 * `settle()` is the only function a real processor would replace. Today it
 * returns { kind: 'simulated', chargedCents: 0, wouldHaveChargedCents }. With
 * Stripe it would create a PaymentIntent and return { kind: 'stripe',
 * paymentIntentId, chargedCents }. The banner text keys off `kind`; nothing
 * else in the system references a processor.
 *
 * CREDITS ARE DRAWN DOWN HERE. `applyAdjustments` reports what each credit
 * would spend; closing the month writes that down as `remainingCents` on the
 * ADJ row and a LEDGER 'CREDIT_APPLIED' row, in the same transaction as the
 * invoice — so a credit is never spent twice and the invoice's "$7.38 carries"
 * is the balance the next month starts from.
 */
const { GetCommand, QueryCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { orgPk, ORGS_INDEX_PK } = require('./tenant');
const { planFor, projectInvoice } = require('./pricing');
const { applyAdjustments, simulationSentence } = require('./pricing-adjust');
const { readUsage, periodBounds } = require('./usage');

const invoiceSk = (period) => `INVOICE#${period}`;
const invoiceNumber = (orgId, period) => `SIM-${String(orgId).replace(/^org_/, '').slice(0, 8).toUpperCase()}-${period}`;

/** The seam. */
function settle(document) {
  return { kind: 'simulated', chargedCents: 0, wouldHaveChargedCents: document.totalCents, settledAt: document.closedAt };
}

async function readAdjustments(db, tableName, orgId) {
  const res = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': orgPk(orgId), ':sk': 'ADJ#' },
  }));
  return res.Items || [];
}

/** The document, computed from the rows as they are now. Pure given its reads. */
async function buildInvoice({ db, tableName, orgId, period, now }) {
  const orgRow = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: orgPk(orgId), SK: 'METADATA' } }))).Item || {};
  const plan = planFor(orgRow);
  const usage = await readUsage(orgId, period, { db, tableName, now });
  const adjustments = await readAdjustments(db, tableName, orgId);
  const list = projectInvoice(plan, usage);
  const adjusted = applyAdjustments(plan, usage, adjustments, period);
  const closedAt = (now || new Date()).toISOString();
  const doc = {
    PK: orgPk(orgId), SK: invoiceSk(period), RecordType: 'INVOICE',
    orgId, period, number: invoiceNumber(orgId, period),
    status: 'closed', simulated: true, closedAt, closedBy: 'reconciler',
    periodBounds: periodBounds(period, now),
    plan: adjusted.plan,
    planId: plan.id,
    orgName: orgRow.name || '',
    usage: { sessionsRun: usage.sessionsRun, setsPeak: usage.setsPeak, setsCurrent: usage.setsCurrent },
    lines: list.lines,
    listCents: adjusted.listCents, listDisplay: adjusted.listDisplay,
    discounts: adjusted.discounts,
    credits: adjusted.credits,
    totalCents: adjusted.totalCents, totalDisplay: adjusted.totalDisplay,
    savingsCents: adjusted.savingsCents, savingsPercent: adjusted.savingsPercent,
    order: adjusted.order,
    sentence: simulationSentence(adjusted),
    // The adjustment rows as they were, so the invoice's tags resolve even
    // if a row is revoked later.
    adjustmentSnapshot: adjustments.map((a) => ({ adjId: a.adjId, SK: a.SK, kind: a.kind, note: a.note || '', createdAt: a.createdAt, createdBy: a.createdBy || '', source: a.source || {}, revokedAt: a.revokedAt || '' })),
  };
  doc.settlement = settle(doc);
  return { doc, adjustments };
}

/**
 * Close `period` for `orgId`. Returns { written: true, doc } or
 * { written: false, reason }. Never throws for "already closed".
 */
async function closeInvoice({ db, tableName, orgId, period, now }) {
  const exists = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: orgPk(orgId), SK: invoiceSk(period) } }))).Item;
  if (exists) return { written: false, reason: 'already-closed', doc: exists };
  const { doc, adjustments } = await buildInvoice({ db, tableName, orgId, period, now });
  const items = [
    { Put: { TableName: tableName, Item: doc, ConditionExpression: 'attribute_not_exists(PK)' } },
    {
      Put: {
        TableName: tableName,
        Item: { PK: ORGS_INDEX_PK, SK: `INVOICE#${period}#${orgId}`, RecordType: 'INVOICE_INDEX', orgId, period, number: doc.number, totalCents: doc.totalCents, listCents: doc.listCents, planId: doc.planId, closedAt: doc.closedAt },
      },
    },
  ];
  // Draw the credits down, and say so in the ledger.
  for (const c of doc.credits) {
    if (!c.appliedCents) continue;
    const row = adjustments.find((a) => a.adjId === c.adjId);
    if (!row) continue;
    items.push({
      Update: {
        TableName: tableName, Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: 'SET remainingCents = :left',
        ConditionExpression: 'remainingCents = :before',
        ExpressionAttributeValues: { ':left': c.remainingAfterCents, ':before': c.appliedCents + c.remainingAfterCents },
      },
    });
    items.push({
      Put: {
        TableName: tableName,
        Item: { PK: orgPk(orgId), SK: `LEDGER#${period}#CREDIT_APPLIED#${c.adjId}`, RecordType: 'LEDGER', kind: 'CREDIT_APPLIED', orgId, period, adjId: c.adjId, appliedCents: c.appliedCents, remainingAfterCents: c.remainingAfterCents, invoice: doc.SK, at: doc.closedAt },
      },
    });
  }
  try {
    await db.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (e && e.name === 'TransactionCanceledException') return { written: false, reason: 'raced' };
    throw e;
  }
  return { written: true, doc };
}

/** What a reader gets: the row minus the raw snapshot keys. */
function publicInvoice(doc) {
  if (!doc) return null;
  const { PK, SK, RecordType, ...rest } = doc;
  return rest;
}

async function listInvoices(db, tableName, orgId) {
  const res = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': orgPk(orgId), ':sk': 'INVOICE#' },
    ScanIndexForward: false,
  }));
  return (res.Items || []).map(publicInvoice);
}

async function getInvoice(db, tableName, orgId, period) {
  const res = await db.send(new GetCommand({ TableName: tableName, Key: { PK: orgPk(orgId), SK: invoiceSk(period) } }));
  return publicInvoice(res.Item || null);
}

module.exports = { closeInvoice, buildInvoice, listInvoices, getInvoice, publicInvoice, invoiceNumber, settle };
