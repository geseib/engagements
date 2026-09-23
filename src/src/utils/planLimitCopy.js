/**
 * WHAT A PLAN-LIMIT REFUSAL SAYS, TO WHOM.
 *
 * The sentences of docs/design/tenancy-redesign/22-plan-limit-notice.html, as
 * a pure function of a parsed refusal (utils/upgradeRequired.js). No markup
 * lives here — components/PlanLimitNotice.jsx renders what this returns — so
 * every voice can be pinned as data (__tests__/planLimitCopy.test.js).
 *
 * THE ROLE COMES FROM THE SERVER (`refusal.resolve`, plan-limit.js), never from
 * local state:
 *
 *   owner   the request button; or, with one waiting, a link to see it
 *   admin   "only the owner can", the owner by name, Plan & usage to read
 *   member  whom to ask, owners then admins, by name; no button at all
 *
 * The second way out follows what ran out: SESSIONS are an event and come back
 * on the 1st; SETS are a level and a deletion frees a place at once. So one
 * says "wait until", the other says "delete a set" — never a generic "wait".
 */

export const BILLING_HREF = '/admin?section=billing';
/** Opens Plan & usage with the request dialog already open (AdminPage). */
export const REQUEST_PARAM = 'request';
export const REQUEST_HREF = `${BILLING_HREF}&${REQUEST_PARAM}=team`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-10-01` -> `1 October`, read in UTC like the server's periods. */
export function formatDay(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim();
}

/** An ISO timestamp -> `22 Sep`. */
export function formatShortDate(iso) {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

/** Does this query string ask Plan & usage to open the request dialog? */
export function wantsPlanRequest(search) {
  try {
    return new URLSearchParams(String(search || '')).get(REQUEST_PARAM) === 'team';
  } catch (err) {
    return false;
  }
}

/** The same URL without the request flag, so a reload does not reopen it. */
export function withoutPlanRequest(href) {
  try {
    const url = new URL(String(href));
    url.searchParams.delete(REQUEST_PARAM);
    return url.toString();
  } catch (err) {
    return String(href || '');
  }
}

/** The 1st of next month, for a refusal from a server with no `resetsOn`. */
function nextFirst() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/**
 * @param {object} refusal  what parseUpgradeRequired returned
 * @param {{outcome?: string, compact?: boolean, billingHref?: string, requestHref?: string}} options
 *   outcome  what did NOT happen, in the caller's words ("Nothing was copied.")
 *   compact  a narrow place (Quickstart): drops the price from the way out
 * @returns {{icon: string, headline: string, outcome: string, why: string,
 *   contacts: Array<{name: string, email: string, role: string}>,
 *   action: null | {label: string, href: string, primary: boolean},
 *   alternative: string}}
 */
export function planLimitCopy(refusal, options = {}) {
  const r = refusal || {};
  const resolve = r.resolve || null;
  const billingHref = options.billingHref || BILLING_HREF;
  const requestHref = options.requestHref || REQUEST_HREF;
  const sets = r.kind === 'sets';
  const outcome = options.outcome || (sets ? 'Nothing was saved.' : 'Nothing was created.');

  const personal = !resolve || resolve.orgType === 'personal';
  const orgName = (resolve && resolve.orgName) || 'Your organisation';
  const used = Number.isFinite(r.used) ? r.used : null;
  const included = Number.isFinite(r.included) ? r.included : null;

  // ── The headline: what ran out, in numbers ────────────────────────────────
  let headline;
  if (sets) {
    const holds = used != null && included != null
      ? `holds ${used} of the ${included} question sets it includes.`
      : 'holds all the question sets it includes.';
    headline = `${personal ? 'Your space' : orgName} ${holds}`;
  } else {
    const allowance = included != null ? `the ${included} sessions` : 'the sessions';
    headline = personal
      ? `You’ve used ${allowance} included this month.`
      : `${orgName} has used ${allowance} included this month.`;
  }

  const day = formatDay((resolve && resolve.resetsOn) || nextFirst());
  const waiting = resolve && resolve.request;
  const price = (r.upgrade && r.upgrade.priceDisplay) ? `${r.upgrade.priceDisplay} a month, never refused. ` : '';

  const out = {
    icon: waiting ? 'Clock' : 'Warning',
    headline,
    outcome,
    why: '',
    contacts: [],
    action: null,
    alternative: '',
  };

  // ── An older server: no role to go on. Say what ran out; point at billing.
  if (!resolve) {
    out.action = { label: 'Open Plan & usage', href: billingHref, primary: false };
    out.alternative = sets ? 'or delete a set you no longer use.' : `or wait until ${day}.`;
    return out;
  }

  const sent = waiting ? formatShortDate(waiting.requestedAt) : '';

  if (resolve.role === 'owner') {
    if (waiting) {
      out.why = `Your request for the Team plan is with Engage — sent ${sent}, usually decided within a day.`;
      out.action = { label: 'See your request', href: billingHref, primary: false };
      out.alternative = sets ? 'or delete a set you no longer use.' : `or wait until ${day}.`;
      return out;
    }
    out.why = sets
      ? 'A set counts while you keep it. Delete one you no longer use and its place is free straight away.'
      : 'A session counts once two of its questions have been answered. A room you already have open keeps going.';
    out.action = { label: 'Request the Team plan', href: requestHref, primary: true };
    if (options.compact) {
      out.alternative = sets ? 'or delete a set you no longer use.' : `or wait until ${day}.`;
    } else {
      out.alternative = sets
        ? `${price}Or delete a set you no longer use.`
        : `${price}Or wait until ${day}, when your ${included != null ? `${included} ` : ''}sessions start again.`;
    }
    return out;
  }

  const asked = waiting ? `${waiting.requestedBy || 'An owner'} asked Engage for the Team plan on ${sent}.` : '';

  if (resolve.role === 'admin') {
    out.why = waiting
      ? asked
      : sets
        ? `Only the owner can move ${orgName} to the Team plan. Deleting a set frees its place straight away.`
        : `Only the owner can move ${orgName} to the Team plan.`;
    out.contacts = waiting ? [] : resolve.contacts;
    out.action = resolve.canViewBilling ? { label: 'See Plan & usage', href: billingHref, primary: false } : null;
    out.alternative = sets ? '' : `or wait until ${day}.`;
    return out;
  }

  // A host or member: no billing section, so no button — the way out is people.
  out.why = waiting
    ? asked
    : sets
      ? `Ask an owner or admin to move ${orgName} to the Team plan.`
      : `Ask an owner or admin to move ${orgName} to the Team plan. A room already open keeps going.`;
  out.contacts = waiting ? [] : resolve.contacts;
  out.alternative = sets
    ? 'Or delete a set of yours you no longer use.'
    : `Or wait until ${day}, when ${orgName}’s ${included != null ? `${included} ` : ''}sessions start again.`;
  return out;
}

export default planLimitCopy;
