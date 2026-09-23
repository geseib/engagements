/**
 * ADJUSTMENTS APPLIED TO A LIST PRICE — the arithmetic behind every discount
 * the console shows and every simulated invoice writes.
 *
 * docs/handoff/billing-experience-2026-09-22.md §2.2. The owner's asks:
 * credits, special rates, discount codes, X months free or discounted — and
 * "all of this would need to be super transparent". So this module is PURE
 * (no AWS, no clock but the `period` it is handed), it is the ONE place the
 * order of application lives, and it hands back every step as a line the
 * screen can print with the row it came from.
 *
 * ── THE ORDER, stated once and printed on every screen ──────────────────────
 *
 *   1. The EFFECTIVE PLAN: the plan, with any active RATE_OVERRIDE's prices
 *      swapped in and any active CREDIT_UNITS added to the allowances.
 *   2. The LIST price: projectInvoice(effectivePlan, usage).
 *   3. PERCENT off: the single LARGEST active percentage — a code, an offer —
 *      never two stacked (owner's decision, §2.7 Q2).
 *   4. FIXED amounts off, all of them, in the order granted.
 *   5. DOLLAR CREDITS, oldest first, never below $0.00; what a credit does not
 *      spend this month carries to the next.
 *
 * ── ROWS IT READS (ORG#<org> / ADJ#<isoTs>#<adjId>) ───────────────────────
 *
 *   kind: CREDIT_CENTS   amountCents, remainingCents
 *         CREDIT_UNITS   units: { sessions?, sets? }
 *         RATE_OVERRIDE  rate: { baseCents?, perSessionCents?, perSetCents? }
 *         CODE_REDEMPTION | OFFER   percentOff? | fixedOffCents?
 *   validFrom / validTo: period ids 'yyyy-mm', inclusive; validTo absent = open
 *   revokedAt: set = ignored from then on (the row stays for history)
 *
 * Copied byte-for-byte into lambda-functions/game/pricing-adjust.js and
 * lambda-functions/websocket/pricing-adjust.js, exactly as pricing.js is
 * handled: the frontend imports the game copy, and usage.js — itself in all
 * three bundles — gates on `effectivePlan`, so the allowance the refusal
 * counts is the allowance the bill prints. tests/pricing-adjust.js holds the
 * three copies identical.
 */
const pricing = require('./pricing');

const { projectInvoice, formatCents } = pricing;

const toCount = (v) => Math.max(0, Math.trunc(Number(v) || 0));
const PERIOD_RE = /^\d{4}-\d{2}$/;

/** Is `adj` in force for `period`? Revoked rows are not, whatever their dates. */
function isActive(adj, period) {
  if (!adj || adj.revokedAt) return false;
  if (!PERIOD_RE.test(String(period))) return false;
  const from = String(adj.validFrom || '');
  const to = String(adj.validTo || '');
  if (from && PERIOD_RE.test(from) && period < from) return false;
  if (to && PERIOD_RE.test(to) && period > to) return false;
  return true;
}

/** 'yyyy-mm' plus n months. */
function addMonths(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + toCount(n), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The plan with rate overrides and unit credits folded in. */
function effectivePlan(plan, adjustments, period) {
  const p = { ...(plan || pricing.TEAM_PLAN) };
  const active = (adjustments || []).filter((a) => isActive(a, period));
  active.filter((a) => a.kind === 'RATE_OVERRIDE' && a.rate).forEach((a) => {
    if (a.rate.baseCents != null) p.base = toCount(a.rate.baseCents);
    if (a.rate.perSessionCents != null) p.perSession = toCount(a.rate.perSessionCents);
    if (a.rate.perSetCents != null) p.perSet = toCount(a.rate.perSetCents);
  });
  active.filter((a) => a.kind === 'CREDIT_UNITS' && a.units).forEach((a) => {
    p.includedSessions = toCount(p.includedSessions) + toCount(a.units.sessions);
    p.includedSets = toCount(p.includedSets) + toCount(a.units.sets);
  });
  return p;
}

/** What one adjustment is, in words a screen can print. */
function describe(adj) {
  const src = adj.source || {};
  const who = src.type === 'code' ? `code ${src.code || adj.code || ''}`.trim() : 'from Engage';
  switch (adj.kind) {
    case 'CREDIT_CENTS': return `Credit ${formatCents(toCount(adj.amountCents))} · ${who}`;
    case 'CREDIT_UNITS': {
      const u = adj.units || {};
      const parts = [];
      if (u.sessions) parts.push(`${toCount(u.sessions)} extra sessions`);
      if (u.sets) parts.push(`${toCount(u.sets)} extra sets`);
      return `${parts.join(', ') || 'Extra allowance'} · ${who}`;
    }
    case 'RATE_OVERRIDE': {
      const r = adj.rate || {};
      const parts = [];
      if (r.baseCents != null) parts.push(`${formatCents(toCount(r.baseCents))} base`);
      if (r.perSessionCents != null) parts.push(`${formatCents(toCount(r.perSessionCents))} a session`);
      if (r.perSetCents != null) parts.push(`${formatCents(toCount(r.perSetCents))} a set`);
      return `Special rate · ${parts.join(', ')} · ${who}`;
    }
    case 'CODE_REDEMPTION':
    case 'OFFER': {
      const what = adj.percentOff != null
        ? `${toCount(adj.percentOff)}% off`
        : `${formatCents(toCount(adj.fixedOffCents))} off`;
      const span = adj.validFrom && adj.validTo && adj.validFrom !== adj.validTo
        ? ` · ${adj.validFrom} to ${adj.validTo}`
        : (adj.validFrom && adj.validFrom === adj.validTo ? ` · ${adj.validFrom}` : '');
      return `${what} · ${who}${span}`;
    }
    default: return `${adj.kind || 'Adjustment'} · ${who}`;
  }
}

/**
 * THE BILL FOR ONE PERIOD, with every step shown.
 *
 * Returns { period, plan (effective), listCents, lines, discounts[], credits[],
 * totalCents, savingsCents, savingsPercent, order (the rule in words),
 * creditsRemaining: { adjId: cents } } — displays included.
 *
 * `credits[]` carries `appliedCents` and `remainingAfterCents` per credit so
 * an invoice can name what it drew and what is left, and the reconciler can
 * write CREDIT_APPLIED rows from the same numbers.
 */
function applyAdjustments(plan, usage, adjustments, period) {
  const adjs = Array.isArray(adjustments) ? adjustments : [];
  const active = adjs.filter((a) => isActive(a, period));
  const eff = effectivePlan(plan, active, period);
  const invoice = projectInvoice(eff, usage);
  const listCents = invoice.totalCents;
  let running = listCents;

  // 3. one percent, the largest
  const percents = active.filter((a) => (a.kind === 'CODE_REDEMPTION' || a.kind === 'OFFER') && a.percentOff != null);
  const discounts = [];
  if (percents.length) {
    const best = percents.reduce((m, a) => (toCount(a.percentOff) > toCount(m.percentOff) ? a : m));
    const off = Math.min(running, Math.round(running * Math.min(100, toCount(best.percentOff)) / 100));
    if (off > 0) {
      discounts.push({ adjId: best.adjId, kind: best.kind, label: describe(best), amountCents: off, amountDisplay: formatCents(off), percent: toCount(best.percentOff) });
      running -= off;
    }
    percents.filter((a) => a !== best).forEach((a) => {
      discounts.push({ adjId: a.adjId, kind: a.kind, label: describe(a), amountCents: 0, amountDisplay: formatCents(0), percent: toCount(a.percentOff), notApplied: 'a larger percentage applied instead' });
    });
  }
  // 4. fixed amounts, as granted
  active.filter((a) => (a.kind === 'CODE_REDEMPTION' || a.kind === 'OFFER') && a.percentOff == null && a.fixedOffCents != null)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .forEach((a) => {
      const off = Math.min(running, toCount(a.fixedOffCents));
      discounts.push({ adjId: a.adjId, kind: a.kind, label: describe(a), amountCents: off, amountDisplay: formatCents(off) });
      running -= off;
    });
  // 5. dollar credits, oldest first, floor at zero, remainder carries
  const credits = [];
  const creditsRemaining = {};
  active.filter((a) => a.kind === 'CREDIT_CENTS')
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .forEach((a) => {
      const available = toCount(a.remainingCents != null ? a.remainingCents : a.amountCents);
      const applied = Math.min(running, available);
      const left = available - applied;
      credits.push({ adjId: a.adjId, label: describe(a), appliedCents: applied, appliedDisplay: formatCents(applied), remainingAfterCents: left, remainingAfterDisplay: formatCents(left) });
      creditsRemaining[a.adjId] = left;
      running -= applied;
    });

  const totalCents = Math.max(0, running);
  const savingsCents = listCents - totalCents;
  return {
    period,
    plan: { id: eff.id, name: eff.name, base: eff.base, perSession: eff.perSession, perSet: eff.perSet, includedSessions: eff.includedSessions, includedSets: eff.includedSets },
    lines: invoice.lines,
    listCents,
    listDisplay: formatCents(listCents),
    discounts,
    credits,
    totalCents,
    totalDisplay: formatCents(totalCents),
    savingsCents,
    savingsDisplay: formatCents(savingsCents),
    savingsPercent: listCents > 0 ? Math.round((savingsCents / listCents) * 100) : 0,
    creditsRemaining,
    order: 'The largest percentage first, then any fixed amount, then credits — never below $0.00. Anything left of a credit carries to the next month.',
  };
}

/** The sentence every simulated invoice carries. */
function simulationSentence(result) {
  const base = `This is a simulation. No card was charged. You would have been charged ${result.totalDisplay}`;
  if (result.savingsCents > 0) {
    return `${base} — a ${result.savingsPercent}% discount from the list price of ${result.listDisplay}.`;
  }
  return `${base}.`;
}

/** An OFFER row's validity from "X months from `period`". */
function offerWindow(period, months) {
  const n = Math.max(1, toCount(months));
  return { validFrom: period, validTo: addMonths(period, n - 1) };
}

module.exports = {
  isActive, addMonths, effectivePlan, describe, applyAdjustments, simulationSentence, offerWindow,
};
