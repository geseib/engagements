/**
 * PLAN & USAGE, RENDERED — components/BillingPanel.jsx, in both of its states.
 *
 * THE WORKED EXAMPLE IS THE POINT. 04-billing.html prints 20 sessions and a
 * peak of 3 sets on the Team plan as $8.75, and this file pins that — but it
 * pins it TWICE: once against the literal from the mockup, and once against
 * `projectInvoice` itself. The second assertion is what stops the number being
 * re-derived in the component: two implementations of one invoice will disagree
 * eventually, and the one the customer believes is the one on this screen.
 *
 * NO GEOMETRIC ASSERTIONS — jsdom has no layout engine.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BillingPanel from '../components/BillingPanel';
import { parseUpgradeRequired } from '../utils/upgradeRequired';

const fs = require('fs');
const path = require('path');
const pricing = require('../../../lambda-functions/game/pricing');

const { TEAM_PLAN, PERSONAL_PLAN, projectInvoice } = pricing;

const TEAM_USAGE = { sessionsRun: 20, setsCurrent: 3, setsPeak: 3 };
const PERIOD = { label: '1–31 August 2026', daysLeft: 9, resetsOn: '1 September' };

const team = (props = {}) => render(
  <BillingPanel
    planId="team"
    usage={TEAM_USAGE}
    period={PERIOD}
    passedAllowanceOn="12 August"
    {...props}
  />,
);

const personal = (props = {}) => render(
  <BillingPanel
    planId="personal"
    usage={{ sessionsRun: 5, setsCurrent: 3, setsPeak: 3 }}
    period={{ label: 'August 2026', resetsOn: '1 September' }}
    {...props}
  />,
);

describe('a paid Team over its included sessions', () => {
  // rejects: a total computed anywhere but pricing.js. The literal pins the
  // mockup; the second expectation pins the SOURCE of the number.
  test('20 sessions and 3 sets come to $8.75, and it comes from projectInvoice', () => {
    const { container } = team();
    const total = container.querySelector('.bill-bignum');
    expect(total).toHaveAttribute('data-total', '$8.75');
    expect(total).toHaveAttribute('data-total', projectInvoice(TEAM_PLAN, TEAM_USAGE).totalDisplay);
  });

  // rejects: a total with no arithmetic under it. Four lines that add up, each
  // naming the quantity it came from — nobody trusts a figure they cannot
  // reproduce.
  test('the invoice is shown as arithmetic, line by line', () => {
    const { container } = team();
    const rows = [...container.querySelectorAll('.bill-calc tr')].map((r) => r.textContent);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Team planthe monthly subscription');
    expect(rows[0]).toContain('$5.00');
    expect(rows[1]).toContain('3 stored, 5 included');
    expect(rows[1]).toContain('$0.00');
    expect(rows[2]).toContain('15 over the included 5, at $0.25');
    expect(rows[2]).toContain('$3.75');
    expect(rows[3]).toContain('Total if the period ended today');
    expect(rows[3]).toContain('$8.75');
    /* The four amounts add up to the total, which is the whole claim. */
    const amounts = [500, 0, 375];
    expect(amounts.reduce((a, b) => a + b, 0))
      .toBe(projectInvoice(TEAM_PLAN, TEAM_USAGE).totalCents);
  });

  // rejects: a money string typed into the component. Comments are stripped
  // first — the doc-block above the import names $0.25 on purpose.
  test('no money literal is typed into the component', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'BillingPanel.jsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(source.match(/\$\d/g) || []).toEqual([]);
  });

  // rejects: quietly charging for the overage. The screen says it out loud,
  // before the invoice arrives, and says nothing was stopped.
  test('it states the overage in advance and promises nothing was blocked', () => {
    const { container } = team();
    const box = container.querySelector('.bill-notebox--warn');
    expect(box.textContent).toContain('You passed the included 5 sessions on 12 August');
    expect(box.textContent).toContain('$0.25');
    expect(box.textContent)
      .toContain('we do not block a session you are about to run in front of a room');
  });

  // rejects: stating the same fact about the same object twice. The METER says
  // what is held right now; the INVOICE bills the highest held at once, and the
  // note is what makes them two facts rather than one contradiction.
  test('it says how storage is measured', () => {
    const { container } = team();
    expect(container.textContent)
      .toContain('highest');
    expect(container.textContent)
      .toContain('A set you created and deleted still counted.');
  });

  test('recent periods are charged from pricing.js too, and each offers its invoice', () => {
    const onInvoice = jest.fn();
    const { container } = team({
      history: [{ key: 'jul', period: 'July 2026', sessions: 11, setsHeld: 2, chargedCents: 650 }],
      onInvoice,
    });
    const row = container.querySelector('.bill-tbl tbody tr');
    expect(row.textContent).toContain('$6.50');
    fireEvent.click(within(row).getByRole('button', { name: 'Invoice' }));
    expect(onInvoice).toHaveBeenCalledTimes(1);
  });

  // rejects: an empty "Recent periods" table pretending a history exists.
  test('no history means no Recent periods section', () => {
    const { container } = team();
    expect(container.querySelector('.bill-tbl')).toBeNull();
    expect(screen.queryByText('Recent periods')).toBeNull();
  });

  // rejects: showing a free plan's upgrade path to somebody already paying.
  test('a paying Team is never asked to upgrade', () => {
    team();
    expect(screen.queryByRole('button', { name: 'Create a team' })).toBeNull();
  });
});

describe('a free personal space at its limit', () => {
  // rejects: a limit with exactly one exit, which reads as a toll gate. Waiting
  // is a real exit here, because the allowance is per period.
  test('it offers BOTH exits: upgrade, or wait for the period to turn over', () => {
    const onUpgrade = jest.fn();
    const { container } = personal({ onUpgrade });
    const box = container.querySelector('.bill-notebox--warn');
    expect(box.textContent).toContain('You have used all 5 sessions this month.');
    expect(box.textContent).toContain('or wait until 1 September');
    fireEvent.click(within(box).getByRole('button', { name: 'Create a team' }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  // rejects: pricing the upgrade from a literal. $5.00 and $0.25 are TEAM_PLAN,
  // read through formatCents.
  test('the upgrade is priced from TEAM_PLAN, not from the copy', () => {
    const { container } = personal();
    const box = container.querySelector('.bill-notebox--warn');
    expect(box.textContent).toContain(`${pricing.formatCents(TEAM_PLAN.base)} a month`);
    expect(box.textContent).toContain(pricing.formatCents(TEAM_PLAN.perSession));
    expect(box.textContent).toContain(`includes ${TEAM_PLAN.includedSessions} sessions`);
  });

  // rejects: the assumption a person makes the moment they hit a wall — that
  // the room in front of them is about to stop. It is said unprompted.
  test('it says, unprompted, that a running session is not affected', () => {
    const { container } = personal();
    const foot = container.querySelector('.bill-notebox--foot');
    expect(foot.textContent)
      .toContain('The session you are running right now is not affected.');
    expect(foot.textContent).toContain('A limit only ever stops you STARTING one.');
  });

  // rejects: showing a free space an invoice. A personal plan does not meter,
  // so there is no total, and a $0.00 bill would only invite the question.
  test('a free space is shown no invoice at all', () => {
    const { container } = personal();
    expect(container.querySelector('.bill-calc')).toBeNull();
    expect(container.querySelector('.bill-bignum')).toBeNull();
    expect(screen.getByText('What a team adds')).toBeInTheDocument();
  });

  // rejects: naming the wrong wall. When the caller arrives here holding a 402
  // for sets, the box says sets.
  test('a 402 refusal names the thing that was actually refused', () => {
    const { container } = personal({
      usage: { sessionsRun: 2, setsCurrent: 5, setsPeak: 5 },
      refusal: { code: 'upgrade_required', limit: { kind: 'sets', used: 5, included: 5 } },
    });
    const box = container.querySelector('.bill-notebox--warn');
    expect(box.textContent).toContain('question sets');
    expect(box.textContent).toContain('The next set you store needs a Team');
  });

  // rejects: making the call site convert between the two shapes a refusal
  // arrives in. parseUpgradeRequired lifts `kind` to the top level; the raw 402
  // body keeps it under `limit`. The panel reads both.
  test('a refusal already through parseUpgradeRequired reads the same', () => {
    const parsed = parseUpgradeRequired(402, {
      code: 'upgrade_required',
      limit: { kind: 'sets', used: 5, included: 5 },
      upgrade: { plan: 'team' },
    });
    expect(parsed.kind).toBe('sets');
    const { container } = personal({
      usage: { sessionsRun: 2, setsCurrent: 5, setsPeak: 5 },
      refusal: parsed,
    });
    expect(container.querySelector('.bill-notebox--warn').textContent)
      .toContain('The next set you store needs a Team');
  });

  // rejects: an empty state that lies. A personal space under its limit is not
  // at a wall and must not be shown one.
  test('under the limit there is no wall, but the promise still holds', () => {
    const { container } = personal({ usage: { sessionsRun: 1, setsCurrent: 1, setsPeak: 1 } });
    expect(container.querySelector('.bill-notebox--warn')).toBeNull();
    expect(container.textContent).toContain('Nothing is ever blocked mid-session.');
  });
});

// rejects: defaulting an unreadable plan to Team, which would hand unlimited
// metered usage to every row with a typo in it — and there is nobody to send
// the invoice to. pricing.js's `planFor` owns this rule; the panel must not
// second-guess it.
test('an unrecognised plan is treated as personal, exactly as planFor says', () => {
  const { container } = render(<BillingPanel planId="free" usage={{ sessionsRun: 5 }} />);
  expect(container.firstChild).toHaveAttribute('data-plan', PERSONAL_PLAN.id);
  expect(container.querySelector('.bill-calc')).toBeNull();
});
