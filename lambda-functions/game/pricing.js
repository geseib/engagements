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
 * THREE PLANS (the owner, 27 Sep 2026): "there is the free tier and the
 * standard tier for individuals (should not be team plan) and there is create
 * an organization and thats where you should also get approval with assuming
 * in the future a pay per usage billing capacity" — and "all events cost money
 * (for now this is just calcuated and not actually billed)".
 *
 *   FREE          a person's own space, capped: PERSONAL_PLAN below.
 *   STANDARD      a person's own space, paid: $5 a month, five and five
 *                 included, $0.25 a unit past them. These are the numbers the
 *                 Team plan carried until today — the upgrade a person makes
 *                 is to Standard, never to a team plan.
 *   ORGANISATION  a team, approved by Engage when it is created, and pure pay
 *                 per use: no monthly fee, nothing included, $0.25 every
 *                 session and every stored set. Stored as `plan: 'team'` —
 *                 rows and requests already carry that id, so it stays; only
 *                 the name and the arithmetic changed.
 *
 * AN EVENT IS $2.00 on either paid plan, and Free cannot run one. It is
 * counted once, when the event first goes live (websocket/events/run.js), so
 * an agenda drafted and never run costs nothing. Every amount is simulated.
 *
 * Frozen because a caller that mutates the shared plan object changes what
 * every other invoice in that Lambda container costs — a bug that only appears
 * under load, on a warm container.
 *
 * `perSession` and `perSet` are charged on EVERY unit past the allowance; the
 * allowance itself is free rather than discounted, which is why the included
 * units are subtracted from the count instead of the amount.
 */
const PER_EVENT_CENTS = 200;  // $2.00 an event, on every paid plan

const STANDARD_PLAN = Object.freeze({
  id: 'standard',
  name: 'Standard plan',
  currency: 'USD',
  base: 500,              // $5.00/month
  includedSessions: 5,
  includedSets: 5,
  perSession: 25,         // $0.25 per session past the allowance
  perSet: 25,             // $0.25 per stored set past the allowance, per month
  includedEvents: 0,
  perEvent: PER_EVENT_CENTS,
  // METERED. A paid space is never refused anything; it is billed for it. This
  // flag is the ONE difference that decides whether a handler may say no —
  // see allowanceState below, and PERSONAL_PLAN immediately after it.
  metersOverage: true,
  allowsEvents: true,
});

const TEAM_PLAN = Object.freeze({
  id: 'team',
  name: 'Organisation plan',
  currency: 'USD',
  base: 0,                // no monthly fee: pay for what you use
  includedSessions: 0,
  includedSets: 0,
  perSession: 25,         // $0.25 every session
  perSet: 25,             // $0.25 every stored set, per month
  includedEvents: 0,
  perEvent: PER_EVENT_CENTS,
  metersOverage: true,
  allowsEvents: true,
});

/**
 * The plan every account starts on, and the only one that can REFUSE anything.
 *
 * The arithmetic of Free is not "cheap" — it is a CAP:
 *
 *   PAID      past the allowance, you are charged $0.25 a unit. Never blocked.
 *   FREE      past the allowance, there is nothing to charge, because there is
 *             no payment method and no invoice. So the 6th session is refused
 *             with an upgrade path instead of being silently given away.
 *
 * A TEAM IS ON FREE TOO until Engage approves its Organisation plan: creating
 * an organisation files that request (orgs/create-org.js), and the team works
 * inside these limits meanwhile.
 *
 * `perSession` and `perSet` are 0 rather than absent, so `projectInvoice` on a
 * personal org produces a $0.00 invoice with honest line items instead of NaN.
 * They are not a price — `metersOverage: false` is what says this plan does not
 * meter — and setting them to 25 without flipping that flag would bill a
 * customer who never agreed to be billed.
 *
 * THE ALLOWANCES ARE THE SAME FIVE AND FIVE AS STANDARD, deliberately. The
 * upgrade buys metering and events, not a bigger free tier, so a person who
 * upgrades mid-month is not told their first five sessions have moved.
 */
const PERSONAL_PLAN = Object.freeze({
  id: 'personal',
  name: 'Free',
  currency: 'USD',
  base: 0,                // free
  includedSessions: 5,
  includedSets: 5,
  perSession: 0,
  perSet: 0,
  includedEvents: 0,
  perEvent: 0,
  metersOverage: false,   // <- the flag that makes a refusal possible
  allowsEvents: false,    // events are a paid feature (create-event.js refuses)
});

/**
 * Which plan an organisation row is on. Pure — it takes the row, not an id.
 *
 * ANYTHING UNRECOGNISED IS FREE, INCLUDING ABSENT. `create-org.js` writes
 * `plan: 'free'` and rows written before plans existed carry nothing at all;
 * both are free accounts and both must be capped. Defaulting the other way —
 * treating an unreadable plan as a paid one — would hand unlimited metered
 * usage to every row with a typo in it, and there is nobody to send the
 * invoice to.
 */
function planFor(org) {
  const raw = org && typeof org.plan === 'string' ? org.plan.trim().toLowerCase() : '';
  if (raw === 'team') return TEAM_PLAN;
  if (raw === 'standard') return STANDARD_PLAN;
  return PERSONAL_PLAN;
}

/**
 * THE PAID PLAN THIS ORGANISATION WOULD MOVE TO. A person's own space upgrades
 * to Standard; a team to the Organisation plan. Read off the row's `type`,
 * because a free team and a free personal space are on the same plan and are
 * offered different ones.
 */
function upgradePlanFor(org) {
  const type = org && typeof org.type === 'string' ? org.type.trim().toLowerCase() : '';
  return type === 'team' ? TEAM_PLAN : STANDARD_PLAN;
}

/** A plan by its stored id — 'team', 'standard', anything else is Free. */
function planById(id) {
  return planFor({ plan: id });
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
  // Nothing included (the Organisation plan, and every event): each unit is
  // charged, so "over the included 0" would be arithmetic nobody asked for.
  let detail;
  if (free === 0 && unit > 0) detail = `${used} ${noun}, at ${formatCents(unit)} each`;
  else if (billable > 0) detail = `${billable} over the included ${free}, at ${formatCents(unit)}`;
  else detail = `${used} ${noun}, ${free} included`;
  return {
    key,
    label,
    detail,
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
 * @param {object} plan   STANDARD_PLAN, TEAM_PLAN, or a plan shaped like them.
 * @param {object} usage  { sessionsRun, setsPeak, eventsRun } — see usage.js.
 *
 * AN EVENTS LINE on every plan that allows events, even at none run: the
 * screen says what an event costs before the first one is on the bill.
 *
 * SETS ARE BILLED ON THE PEAK, NOT THE CURRENT COUNT. "Storage is charged on
 * the highest number of sets you held at once this period, not the number at
 * the end. A set you created and deleted still counted." — that sentence is
 * printed on 04-billing.html, so it is the rule, and `setsPeak` is the field
 * that carries it. Passing `setsCurrent` here would under-bill and, worse,
 * contradict a promise already made in writing to the customer.
 *
 * The mockup's worked example — 2 sets, 20 sessions — must come to exactly
 * 875 cents: 500 + 0 + 15*25. It was drawn for the $5 plan, which is Standard
 * now; tests/pricing.js pins that number on STANDARD_PLAN.
 */
function projectInvoice(plan, usage) {
  const p = plan || STANDARD_PLAN;
  const u = usage || {};
  const payPerUse = p.metersOverage === true && toCount(p.base) === 0;

  const lines = [
    {
      key: 'base',
      label: p.name || 'Standard plan',
      detail: payPerUse ? 'no monthly fee — you pay for what you use' : 'the monthly subscription',
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
    ...(p.allowsEvents === true
      ? [meteredLine('events', 'Events', 'run', u.eventsRun, p.includedEvents, p.perEvent)]
      : []),
  ];

  // Integers all the way down, so the sum is exact rather than nearly exact.
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    planId: p.id || 'standard',
    currency: p.currency || 'USD',
    lines: lines.map((line) => ({ ...line, amountDisplay: formatCents(line.amountCents) })),
    totalCents,
    totalDisplay: formatCents(totalCents),
  };
}

/**
 * WHAT IS LEFT, AND WHETHER ANYTHING MUST BE REFUSED.
 *
 * @param {object} plan   PERSONAL_PLAN, STANDARD_PLAN or TEAM_PLAN — `planFor(orgRow)`.
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
 * On a metered plan `sessionsLeft` and `setsLeft` are `null`, because a paid
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
    reason = `The free plan includes ${sessionsIncluded} sessions and `
      + `${setsIncluded} stored question sets, and both are used up.`;
  } else if (mustUpgradeForSession) {
    reason = `The free plan includes ${sessionsIncluded} sessions, `
      + `and ${sessionsUsed} have been run this month.`;
  } else if (mustUpgradeForSet) {
    reason = `The free plan includes ${setsIncluded} stored question sets, `
      + `and ${setsUsed} are stored.`;
  }

  return {
    planId: p.id || 'personal',
    planName: p.name || 'Free',
    metersOverage: meters,
    allowsEvents: p.allowsEvents === true,
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
 * WHICH PLAN IS OFFERED: the caller's `upgradePlan`, else the state's
 * `upgradePlanId` (usage.js readAllowance sets it from the org's type — a
 * person's space is offered Standard, a team the Organisation plan), else
 * Standard.
 *
 * @param {'sessions'|'sets'|'events'} kind
 */
function priceSentence(up) {
  const base = toCount(up.base);
  return base > 0
    ? `${formatCents(base)} a month`
    : `no monthly fee, ${formatCents(toCount(up.perSession))} a session`;
}

function upgradeRequired(kind, state, upgradePlan) {
  const s = state || {};
  const up = upgradePlan || (s.upgradePlanId ? planById(s.upgradePlanId) : null) || STANDARD_PLAN;
  const isSets = kind === 'sets';
  const isEvents = kind === 'events';
  let action = 'This organisation cannot start another session yet.';
  if (isSets) action = 'This organisation cannot store another question set yet.';
  if (isEvents) action = 'Events are part of the paid plans, and this space is on Free.';
  const why = isEvents ? '' : (s.reason || '');
  return {
    // An UPGRADE, not a failure — said in the first sentence, because the
    // sentence is what the person reads.
    error: (`${action} ${why} Upgrade to the ${up.name} `
      + `(${priceSentence(up)}) to keep going.`).replace(/\s+/g, ' ').trim(),
    code: 'upgrade_required',
    upgradeRequired: true,
    limit: {
      kind: isEvents ? 'events' : (isSets ? 'sets' : 'sessions'),
      planId: s.planId || PERSONAL_PLAN.id,
      used: isEvents ? 0 : (isSets ? toCount(s.setsUsed) : toCount(s.sessionsUsed)),
      included: isEvents ? 0 : (isSets ? toCount(s.setsIncluded) : toCount(s.sessionsIncluded)),
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
      perEventCents: toCount(up.perEvent),
      perEventDisplay: formatCents(toCount(up.perEvent)),
    },
  };
}

module.exports = {
  TEAM_PLAN, STANDARD_PLAN, PERSONAL_PLAN, PER_EVENT_CENTS, planFor, planById, upgradePlanFor,
  projectInvoice, allowanceState, upgradeRequired, UPGRADE_REQUIRED_STATUS,
  formatCents, toCount,
};
