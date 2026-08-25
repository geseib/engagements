/**
 * WHAT A PERIOD COSTS — the arithmetic, and nothing else.
 *
 * `docs/design/tenancy-redesign/04-billing.html` is the specification for this
 * file. That screen prints the invoice as four lines that add up, because
 * "nobody trusts a total they cannot reproduce" (RATIONALE.md §3). This module
 * is the reproduction: the API renders it, the console renders it, and they
 * agree because they run the same function rather than two implementations of
 * the same paragraph.
 *
 * ── EVERY AMOUNT IS AN INTEGER NUMBER OF CENTS ─────────────────────────────
 *
 * Not dollars, not a float, not a string with a currency sign in it. `0.1 +
 * 0.2 !== 0.3` in IEEE-754 and a bill is the one place in this codebase where
 * that shows up as a customer email. So: `500`, `25`, `875`. The ONLY place a
 * decimal point exists is `formatCents`, which builds the string by integer
 * division and never touches a fractional Number — `(c - c % 100) / 100` is a
 * division of a multiple of 100, which is exact, where `(c / 100).toFixed(2)`
 * is a rounding of a float that happens to be right for small numbers.
 *
 * `tests/pricing.js` asserts `Number.isInteger` on every amount this module
 * emits, across a sweep of junk and extreme inputs, precisely so that a
 * "helpful" percentage or proration added later cannot slip a float in.
 *
 * ── PURE, AND DEPENDENCY-FREE, ON PURPOSE ──────────────────────────────────
 *
 * No AWS SDK, no clock, no config lookup. It takes a plan and a usage record
 * and returns line items. That is what lets the same file be bundled into a
 * Lambda and imported by the React console; if it ever needs a `require`, the
 * frontend copy stops working and the two numbers drift apart silently.
 *
 * THIS FILE IS DUPLICATED at lambda-functions/admin/shared/pricing.js, byte for
 * byte, because CodeUri is per-directory and there are no Lambda layers — the
 * same arrangement as tenant.js, set-version.js and game-types.js.
 * tests/pricing.js fails the build if the copies drift.
 */

/**
 * The one plan that exists in this phase. Frozen because a caller that mutates
 * the shared plan object changes what every other invoice in that Lambda
 * container costs — a bug that only appears under load, on a warm container.
 *
 * `perSession` and `perSet` are charged on EVERY unit past the allowance; the
 * allowance itself is free rather than discounted, which is why the included
 * units are subtracted from the count instead of the amount.
 */
const TEAM_PLAN = Object.freeze({
  id: 'team',
  name: 'Team plan',
  currency: 'USD',
  base: 500,              // $5.00/month
  includedSessions: 5,
  includedSets: 5,
  perSession: 25,         // $0.25 per session past the allowance
  perSet: 25,             // $0.25 per stored set past the allowance, per month
  // METERED. A Team org is never refused anything; it is billed for it. This
  // flag is the ONE difference that decides whether a handler may say no —
  // see allowanceState below, and PERSONAL_PLAN immediately after it.
  metersOverage: true,
});

/**
 * The plan every account starts on, and the only one that can REFUSE anything.
 *
 * `09-first-run.html` prices exactly two things: "Free while you are the only
 * member", and Team at $5 a month. This is the first half, and the arithmetic
 * of it is not "cheap" — it is a CAP:
 *
 *   TEAM      past the allowance, you are charged $0.25 a unit. Never blocked.
 *   PERSONAL  past the allowance, there is nothing to charge, because there is
 *             no payment method and no invoice. So the 6th session is refused
 *             with an upgrade path instead of being silently given away.
 *
 * `perSession` and `perSet` are 0 rather than absent, so `projectInvoice` on a
 * personal org produces a $0.00 invoice with honest line items instead of NaN.
 * They are not a price — `metersOverage: false` is what says this plan does not
 * meter — and setting them to 25 without flipping that flag would bill a
 * customer who never agreed to be billed.
 *
 * THE ALLOWANCES ARE THE SAME FIVE AND FIVE AS TEAM, deliberately. The upgrade
 * buys metering and members, not a bigger free tier, so a person who upgrades
 * mid-month is not told their first five sessions have moved.
 */
const PERSONAL_PLAN = Object.freeze({
  id: 'personal',
  name: 'Personal',
  currency: 'USD',
  base: 0,                // free
  includedSessions: 5,
  includedSets: 5,
  perSession: 0,
  perSet: 0,
  metersOverage: false,   // <- the flag that makes a refusal possible
});

/**
 * Which plan an organisation row is on. Pure — it takes the row, not an id.
 *
 * ANYTHING UNRECOGNISED IS PERSONAL, INCLUDING ABSENT. `create-org.js` writes
 * `plan: 'free'` and rows written before plans existed carry nothing at all;
 * both are free accounts and both must be capped. Defaulting the other way —
 * treating an unreadable plan as Team — would hand unlimited metered usage to
 * every row with a typo in it, and there is nobody to send the invoice to.
 */
function planFor(org) {
  const raw = org && typeof org.plan === 'string' ? org.plan.trim().toLowerCase() : '';
  return raw === 'team' ? TEAM_PLAN : PERSONAL_PLAN;
}

/**
 * A quantity, coerced to a non-negative integer.
 *
 * Counters arrive from DynamoDB, where an attribute can be absent, a string, or
 * (after a bad migration) a float. Every one of those must become a number we
 * can multiply by 25 and still have an integer. `Math.trunc` rather than
 * `Math.round` so a fractional count can never round a customer UP into a
 * charge they did not incur.
 */
function toCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

/**
 * `$8.75`. Integer arithmetic only — see the header.
 * Negative amounts are not expected and are not silently hidden: the sign is
 * printed, so a credit shows up as a credit rather than as a large charge.
 */
function formatCents(cents) {
  const n = Number.isFinite(Number(cents)) ? Math.trunc(Number(cents)) : 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = (abs - (abs % 100)) / 100;   // exact: abs - abs%100 is a multiple of 100
  const remainder = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${remainder}`;
}

/**
 * One metered line. `count` is what was used, `included` is free, and every
 * unit past that costs `unitCents`.
 *
 * The two `detail` phrasings are lifted from the mockup, which prints
 * "2 stored, 5 included" for a line inside its allowance and
 * "15 over the included 5, at $0.25" for one past it. The screen says the
 * quantity the charge came from, in both states, so the reader can check it.
 */
function meteredLine(key, label, noun, count, included, unitCents) {
  const used = toCount(count);
  const free = toCount(included);
  const unit = toCount(unitCents);
  const billable = Math.max(0, used - free);
  return {
    key,
    label,
    detail: billable > 0
      ? `${billable} over the included ${free}, at ${formatCents(unit)}`
      : `${used} ${noun}, ${free} included`,
    quantity: used,
    included: free,
    billable,
    unitCents: unit,
    amountCents: billable * unit,
  };
}

/**
 * The invoice for a period, as the billing screen draws it.
 *
 * @param {object} plan   TEAM_PLAN, or a plan shaped like it.
 * @param {object} usage  { sessionsRun, setsPeak } — see usage.js.
 *
 * SETS ARE BILLED ON THE PEAK, NOT THE CURRENT COUNT. "Storage is charged on
 * the highest number of sets you held at once this period, not the number at
 * the end. A set you created and deleted still counted." — that sentence is
 * printed on 04-billing.html, so it is the rule, and `setsPeak` is the field
 * that carries it. Passing `setsCurrent` here would under-bill and, worse,
 * contradict a promise already made in writing to the customer.
 *
 * The mockup's worked example — 2 sets, 20 sessions — must come to exactly
 * 875 cents: 500 + 0 + 15*25. tests/pricing.js pins that number.
 */
function projectInvoice(plan, usage) {
  const p = plan || TEAM_PLAN;
  const u = usage || {};

  const lines = [
    {
      key: 'base',
      label: p.name || 'Team plan',
      detail: 'the monthly subscription',
      quantity: 1,
      included: 0,
      billable: 1,
      unitCents: toCount(p.base),
      amountCents: toCount(p.base),
    },
    meteredLine('sets', 'Question sets', 'stored',
      u.setsPeak, p.includedSets, p.perSet),
    meteredLine('sessions', 'Sessions', 'run',
      u.sessionsRun, p.includedSessions, p.perSession),
  ];

  // Integers all the way down, so the sum is exact rather than nearly exact.
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    planId: p.id || 'team',
    currency: p.currency || 'USD',
    lines: lines.map((line) => ({ ...line, amountDisplay: formatCents(line.amountCents) })),
    totalCents,
    totalDisplay: formatCents(totalCents),
  };
}

/**
 * WHAT IS LEFT, AND WHETHER ANYTHING MUST BE REFUSED.
 *
 * @param {object} plan   PERSONAL_PLAN or TEAM_PLAN — `planFor(orgRow)`.
 * @param {object} usage  a `readUsage()` record: { sessionsRun, setsCurrent }.
 *
 * ── SESSIONS ARE COUNTED ON THE LEDGER, SETS ON WHAT IS HELD RIGHT NOW ─────
 *
 * `sessionsRun` is an event count — a session that ran cannot un-run, so the
 * period's count is the right number to compare against the allowance.
 *
 * Sets are the opposite and the difference matters. THE INVOICE BILLS
 * `setsPeak`, because 04-billing.html promises "a set you created and deleted
 * still counted". THIS GATE READS `setsCurrent`, because a person holding two
 * sets who deleted three earlier in the month must be able to create a third.
 * Gating on the peak would make deletion useless and turn a storage allowance
 * into a permanent quota of lifetime creations. Two numbers, two jobs; a reader
 * who conflates them either over-bills or refuses somebody with empty shelves.
 *
 * ── `null` MEANS UNLIMITED, AND IS NOT A NUMBER TO COMPARE ─────────────────
 *
 * On a metered plan `sessionsLeft` and `setsLeft` are `null`, because a Team
 * org has no cap and `0` is a very different statement from "no limit". The
 * numbers are for the screen. HANDLERS MUST BRANCH ON `mustUpgradeForSession` /
 * `mustUpgradeForSet`, which are false on every metered plan by construction.
 */
function allowanceState(plan, usage) {
  const p = plan || PERSONAL_PLAN;
  const u = usage || {};
  const meters = p.metersOverage === true;

  const sessionsUsed = toCount(u.sessionsRun);
  const sessionsIncluded = toCount(p.includedSessions);
  const setsUsed = toCount(u.setsCurrent);
  const setsIncluded = toCount(p.includedSets);

  const sessionsLeft = meters ? null : Math.max(0, sessionsIncluded - sessionsUsed);
  const setsLeft = meters ? null : Math.max(0, setsIncluded - setsUsed);

  const mustUpgradeForSession = !meters && sessionsUsed >= sessionsIncluded;
  const mustUpgradeForSet = !meters && setsUsed >= setsIncluded;

  // A sentence, not a token, because it is what the refusal says out loud and
  // what a support thread will quote. Both limits reached is one sentence, not
  // two: the reader is being told to upgrade once.
  let reason = '';
  if (mustUpgradeForSession && mustUpgradeForSet) {
    reason = `A personal organisation includes ${sessionsIncluded} sessions and `
      + `${setsIncluded} stored question sets, and both are used up.`;
  } else if (mustUpgradeForSession) {
    reason = `A personal organisation includes ${sessionsIncluded} sessions, `
      + `and ${sessionsUsed} have been run this month.`;
  } else if (mustUpgradeForSet) {
    reason = `A personal organisation includes ${setsIncluded} stored question sets, `
      + `and ${setsUsed} are stored.`;
  }

  return {
    planId: p.id || 'personal',
    planName: p.name || 'Personal',
    metersOverage: meters,
    sessionsUsed,
    sessionsIncluded,
    sessionsLeft,
    setsUsed,
    setsIncluded,
    setsLeft,
    mustUpgradeForSession,
    mustUpgradeForSet,
    mustUpgrade: mustUpgradeForSession || mustUpgradeForSet,
    reason,
  };
}

/**
 * 402 PAYMENT REQUIRED — the status a refusal-for-money carries.
 *
 * NOT 403. A 403 means "you may not", and every console in this codebase draws
 * it as a permission error with nothing to click. This is "not yet, and here is
 * the button", which is a different screen; giving it its own status is what
 * lets the front end tell the two apart without string-matching an error
 * message that a copy edit will one day change.
 */
const UPGRADE_REQUIRED_STATUS = 402;

/**
 * The BODY of a refusal, shaped so the console can act on it without parsing
 * prose. Pure — the caller wraps it in its own headers, because the two call
 * sites (websocket/create-game.js, admin/upload-questions.js) already have
 * their own CORS blocks and must not grow a second one.
 *
 * `error` is present and human because every existing client in this repo
 * reads `body.error` and shows it; a refusal that renders as "undefined" while
 * carrying a beautiful machine-readable payload is still a broken screen.
 *
 * @param {'sessions'|'sets'} kind
 */
function upgradeRequired(kind, state, upgradePlan) {
  const s = state || {};
  const up = upgradePlan || TEAM_PLAN;
  const isSets = kind === 'sets';
  const action = isSets
    ? 'This organisation cannot store another question set yet.'
    : 'This organisation cannot start another session yet.';
  return {
    // An UPGRADE, not a failure — said in the first sentence, because the
    // sentence is what the person reads.
    error: `${action} ${s.reason || ''} Upgrade to the ${up.name} `
      + `(${formatCents(toCount(up.base))} a month) to keep going.`.replace(/\s+/g, ' ').trim(),
    code: 'upgrade_required',
    upgradeRequired: true,
    limit: {
      kind: isSets ? 'sets' : 'sessions',
      planId: s.planId || PERSONAL_PLAN.id,
      used: isSets ? toCount(s.setsUsed) : toCount(s.sessionsUsed),
      included: isSets ? toCount(s.setsIncluded) : toCount(s.sessionsIncluded),
    },
    upgrade: {
      planId: up.id,
      name: up.name,
      priceCents: toCount(up.base),
      priceDisplay: formatCents(toCount(up.base)),
      includedSessions: toCount(up.includedSessions),
      includedSets: toCount(up.includedSets),
      overageCents: toCount(up.perSession),
      overageDisplay: formatCents(toCount(up.perSession)),
    },
  };
}

module.exports = {
  TEAM_PLAN, PERSONAL_PLAN, planFor,
  projectInvoice, allowanceState, upgradeRequired, UPGRADE_REQUIRED_STATUS,
  formatCents, toCount,
};
