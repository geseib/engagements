/**
 * WHAT A PLAN-LIMIT REFUSAL SAYS, TO WHOM — utils/planLimitCopy.js
 *
 * The words are the design (docs/design/tenancy-redesign/22-plan-limit-notice.html),
 * so they are pinned here as data, one voice at a time, before any markup: an
 * owner is offered the request, an admin is told only the owner can, a member
 * is told whom to ask by name. The server works out the role (plan-limit.js);
 * this module only turns it into sentences.
 */
import { parseUpgradeRequired, refusalFromAllowance } from '../utils/upgradeRequired';
import {
  planLimitCopy, formatDay, formatShortDate, wantsPlanRequest, withoutPlanRequest,
  BILLING_HREF, REQUEST_HREF,
} from '../utils/planLimitCopy';

const DANA = { name: 'Dana Whitfield', email: 'dana@northwind.example', role: 'owner' };
const TOMAS = { name: 'Tomás Ortega', email: 'tomas@northwind.example', role: 'admin' };

function refusal(kind, resolve, { used = 5, included = 5 } = {}) {
  return parseUpgradeRequired(402, {
    code: 'upgrade_required',
    upgradeRequired: true,
    error: 'The server sentence.',
    limit: { kind, planId: 'personal', used, included },
    upgrade: { planId: 'team', priceCents: 500, priceDisplay: '$5.00' },
    ...(resolve ? { resolve } : {}),
  });
}
const own = (extra = {}) => ({
  role: 'owner', canRequest: true, canViewBilling: true,
  org: { name: 'Amara Reyes', type: 'personal' }, contacts: [], request: null, resetsOn: '2026-10-01', ...extra,
});
const team = (role, extra = {}) => ({
  role, canRequest: role === 'owner', canViewBilling: role !== 'member',
  org: { name: 'Northwind Learning', type: 'team' },
  contacts: role === 'owner' ? [] : role === 'admin' ? [DANA] : [DANA, TOMAS],
  request: null, resetsOn: '2026-10-01', ...extra,
});
const WAITING = { requestedAt: '2026-09-22T10:00:00.000Z', requestedBy: 'Dana Whitfield' };

describe('parsing the resolve block', () => {
  // rejects: dropping the server's answer on the floor in the one parser every screen uses
  test('the refusal carries a normalised resolve', () => {
    const r = refusal('sessions', team('member'));
    expect(r.resolve).toEqual({
      role: 'member', canRequest: false, canViewBilling: false,
      orgName: 'Northwind Learning', orgType: 'team',
      contacts: [DANA, TOMAS], request: null, resetsOn: '2026-10-01',
    });
  });

  // rejects: an older server (no resolve) breaking the parse
  test('a refusal without one parses with resolve null', () => {
    expect(refusal('sessions', null).resolve).toBeNull();
  });

  // rejects: the editor's on-arrival warning being unable to use the same notice
  test('a set allowance reads as a sets refusal', () => {
    const r = refusalFromAllowance({ setsUsed: 5, setsIncluded: 5, mustUpgradeForSet: true, resolve: team('admin') });
    expect(r.kind).toBe('sets');
    expect([r.used, r.included]).toEqual([5, 5]);
    expect(r.resolve.role).toBe('admin');
    expect(refusalFromAllowance({ mustUpgradeForSet: false })).toBeNull();
    expect(refusalFromAllowance(null)).toBeNull();
  });
});

describe('the owner', () => {
  test('sessions: the request, the price, and the date the count starts again', () => {
    const c = planLimitCopy(refusal('sessions', own()));
    expect(c.icon).toBe('Warning');
    expect(c.headline).toBe('You’ve used the 5 sessions included this month.');
    expect(c.outcome).toBe('Nothing was created.');
    // rejects: a count nobody can explain — the owner's 2026-09-23 rule, stated where it bites
    expect(c.why).toBe('A session counts once two of its questions have been answered. A room you already have open keeps going.');
    // rejects: sending the owner to read Plan & usage instead of straight to the request
    expect(c.action).toEqual({ label: 'Request the Team plan', href: REQUEST_HREF, primary: true });
    expect(c.alternative).toBe('$5.00 a month, never refused. Or wait until 1 October, when your 5 sessions start again.');
    expect(c.contacts).toEqual([]);
  });

  test('compact drops the price and keeps the date', () => {
    expect(planLimitCopy(refusal('sessions', own()), { compact: true }).alternative).toBe('or wait until 1 October.');
  });

  test('sets: the way out is deleting one, not waiting', () => {
    const c = planLimitCopy(refusal('sets', own()));
    expect(c.headline).toBe('Your space holds 5 of the 5 question sets it includes.');
    expect(c.outcome).toBe('Nothing was saved.');
    expect(c.why).toBe('A set counts while you keep it. Delete one you no longer use and its place is free straight away.');
    expect(c.action.label).toBe('Request the Team plan');
    // rejects: telling somebody to "wait for the reset" for a level that never resets
    expect(c.alternative).toBe('$5.00 a month, never refused. Or delete a set you no longer use.');
  });

  test('a team owner reads the team name', () => {
    expect(planLimitCopy(refusal('sessions', team('owner'))).headline)
      .toBe('Northwind Learning has used the 5 sessions included this month.');
  });

  // rejects: asking the owner to request a second time
  test('a request already waiting: see it, do not send another', () => {
    const c = planLimitCopy(refusal('sessions', own({ request: WAITING })));
    expect(c.icon).toBe('Clock');
    expect(c.why).toBe('Your request for the Team plan is with Engage — sent 22 Sep, usually decided within a day.');
    expect(c.action).toEqual({ label: 'See your request', href: BILLING_HREF, primary: false });
    expect(c.alternative).toBe('or wait until 1 October.');
  });

  test('the caller names what did not happen', () => {
    expect(planLimitCopy(refusal('sets', own()), { outcome: 'Nothing was copied.' }).outcome).toBe('Nothing was copied.');
  });
});

describe('an admin', () => {
  // rejects: a Request button that plan-requests.js would answer with 403
  test('sessions: only the owner can, named; Plan & usage to read', () => {
    const c = planLimitCopy(refusal('sessions', team('admin')));
    expect(c.headline).toBe('Northwind Learning has used the 5 sessions included this month.');
    expect(c.why).toBe('Only the owner can move Northwind Learning to the Team plan.');
    expect(c.contacts).toEqual([DANA]);
    expect(c.action).toEqual({ label: 'See Plan & usage', href: BILLING_HREF, primary: false });
    expect(c.alternative).toBe('or wait until 1 October.');
  });

  test('sets', () => {
    const c = planLimitCopy(refusal('sets', team('admin')));
    expect(c.headline).toBe('Northwind Learning holds 5 of the 5 question sets it includes.');
    expect(c.why).toBe('Only the owner can move Northwind Learning to the Team plan. Deleting a set frees its place straight away.');
    expect(c.alternative).toBe('');
  });
});

describe('a host or member', () => {
  // rejects: "contact your admin" with no names, or a billing link to a section they do not have
  test('sessions: whom to ask, by name, and no button', () => {
    const c = planLimitCopy(refusal('sessions', team('member')));
    expect(c.why).toBe('Ask an owner or admin to move Northwind Learning to the Team plan. A room already open keeps going.');
    expect(c.contacts).toEqual([DANA, TOMAS]);
    expect(c.action).toBeNull();
    expect(c.alternative).toBe('Or wait until 1 October, when Northwind Learning’s 5 sessions start again.');
  });

  test('sets', () => {
    const c = planLimitCopy(refusal('sets', team('member')));
    expect(c.why).toBe('Ask an owner or admin to move Northwind Learning to the Team plan.');
    expect(c.alternative).toBe('Or delete a set of yours you no longer use.');
  });

  // rejects: sending a member to pester the owner for something already asked
  test('a request already waiting replaces the ask', () => {
    const c = planLimitCopy(refusal('sessions', team('member', { request: WAITING })));
    expect(c.icon).toBe('Clock');
    expect(c.why).toBe('Dana Whitfield asked Engage for the Team plan on 22 Sep.');
    expect(c.contacts).toEqual([]);
  });
});

describe('an older server that sends no resolve', () => {
  // rejects: a blank or broken notice when the block is missing
  test('still says what ran out, and points at Plan & usage', () => {
    const c = planLimitCopy(refusal('sessions', null));
    expect(c.headline).toBe('You’ve used the 5 sessions included this month.');
    expect(c.outcome).toBe('Nothing was created.');
    expect(c.action).toEqual({ label: 'Open Plan & usage', href: BILLING_HREF, primary: false });
  });

  test('missing numbers do not print "undefined"', () => {
    const c = planLimitCopy(parseUpgradeRequired(402, null));
    expect(c.headline).not.toMatch(/undefined|null|NaN/);
  });
});

describe('dates and the deep link', () => {
  test('formatting', () => {
    expect(formatDay('2026-10-01')).toBe('1 October');
    expect(formatDay('2027-01-01')).toBe('1 January');
    expect(formatShortDate('2026-09-22T10:00:00.000Z')).toBe('22 Sep');
    expect(formatDay('')).toBe('');
  });

  // rejects: a Request button that lands on Plan & usage with nothing open
  test('the request link opens the request dialog, once', () => {
    expect(REQUEST_HREF).toBe('/admin?section=billing&request=team');
    expect(wantsPlanRequest('?section=billing&request=team')).toBe(true);
    expect(wantsPlanRequest('?section=billing')).toBe(false);
    expect(withoutPlanRequest('https://x.example/admin?section=billing&request=team'))
      .toBe('https://x.example/admin?section=billing');
  });
});
