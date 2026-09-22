/**
 * Billing step 4 — components/InvoicePanel.jsx, from mockups 20 and 21.
 * The transparency rule is enforced here: every `$` on the invoice is a
 * button with a data-source.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Invoice, BillingHistory, periodLabel } from '../components/InvoicePanel';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');
const respond = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });
beforeEach(() => { authFetch.mockReset(); window.API_BASE = 'https://api.test/'; });

const INV = {
  orgId: 'org_x', orgName: 'Northwind Learning', period: '2026-09', number: 'SIM-X-2026-09', status: 'closed', simulated: true,
  closedAt: '2026-10-01T00:05:00Z', closedBy: 'reconciler', planId: 'team',
  periodBounds: { start: '2026-09-01', end: '2026-09-30' },
  plan: { id: 'team', name: 'Team plan', base: 500, perSession: 25, perSet: 25, includedSessions: 5, includedSets: 5 },
  usage: { sessionsRun: 20, setsPeak: 2, setsCurrent: 2 },
  lines: [
    { key: 'base', label: 'Team plan', detail: 'the monthly subscription', quantity: 1, included: 0, billable: 1, unitCents: 500, amountCents: 500, amountDisplay: '$5.00' },
    { key: 'sets', label: 'Question sets', detail: 'stored', quantity: 2, included: 5, billable: 0, unitCents: 25, amountCents: 0, amountDisplay: '$0.00' },
    { key: 'sessions', label: 'Sessions', detail: 'run', quantity: 20, included: 5, billable: 15, unitCents: 25, amountCents: 375, amountDisplay: '$3.75' },
  ],
  listCents: 875, listDisplay: '$8.75',
  discounts: [{ adjId: 'c1', kind: 'CODE_REDEMPTION', label: '30% off · code WELCOME30 · 2026-09 to 2026-11', amountCents: 263, amountDisplay: '$2.63', percent: 30 }],
  credits: [{ adjId: 'k1', label: 'Credit $10.00 · from Engage', appliedCents: 612, appliedDisplay: '$6.12', remainingAfterCents: 388, remainingAfterDisplay: '$3.88' }],
  totalCents: 0, totalDisplay: '$0.00', savingsCents: 875, savingsPercent: 100,
  order: 'The largest percentage first, then any fixed amount, then credits — never below $0.00. Anything left of a credit carries to the next month.',
  sentence: 'This is a simulation. No card was charged. You would have been charged $0.00 — a 100% discount from the list price of $8.75.',
  settlement: { kind: 'simulated', chargedCents: 0, wouldHaveChargedCents: 0 },
  adjustmentSnapshot: [
    { adjId: 'c1', SK: 'ADJ#2026-09-23T09:00:00Z#c1', kind: 'CODE_REDEMPTION', note: 'Code WELCOME30', createdAt: '2026-09-23T09:00:00Z', createdBy: 'u_staff', source: { type: 'code', code: 'WELCOME30' } },
    { adjId: 'k1', SK: 'ADJ#2026-09-01T09:00:00Z#k1', kind: 'CREDIT_CENTS', note: 'pilot goodwill', createdAt: '2026-09-01T09:00:00Z', createdBy: 'u_staff', source: { type: 'platform_admin' } },
  ],
};

describe('the invoice (mockup 20)', () => {
  it('says "This is a simulation. No card was charged." at the top and again at the total', async () => {
    authFetch.mockImplementation(() => respond({ invoice: INV }));
    render(<Invoice orgId="org_x" period="2026-09" onBack={jest.fn()} />);
    await waitFor(() => screen.getByTestId('invoice'));
    const banner = screen.getByTestId('inv-banner');
    expect(banner).toHaveTextContent('This is a simulation. No card was charged.');
    expect(banner).toHaveTextContent('a 100% discount from the list price of $8.75');
    expect(screen.getByTestId('invoice')).toHaveTextContent('Simulated — see the banner above.');
    expect(screen.getByTestId('invoice')).toHaveTextContent('SIM-X-2026-09');
  });

  it('every dollar amount is a button naming the row it came from', async () => {
    authFetch.mockImplementation(() => respond({ invoice: INV }));
    render(<Invoice orgId="org_x" period="2026-09" onBack={jest.fn()} />);
    const doc = await screen.findByTestId('invoice');
    // rejects: a `$` printed as plain text anywhere in the lines table.
    const table = doc.querySelector('.inv-lines');
    const amounts = [...table.querySelectorAll('button.inv-amt')];
    expect(amounts.length).toBeGreaterThanOrEqual(7);
    amounts.forEach((b) => expect(b.getAttribute('data-source')).toMatch(/^(plan:|USAGE#|ADJ#|INVOICE#)/));
    const plainDollars = [...table.querySelectorAll('td:last-child')].filter((td) => /\$/.test(td.textContent) && !td.querySelector('button.inv-amt'));
    expect(plainDollars).toHaveLength(0);
    // The sources are the right ones.
    expect(amounts[0]).toHaveAttribute('data-source', 'plan:team');
    expect(amounts[2]).toHaveAttribute('data-source', 'USAGE#2026-09');
    expect(amounts.find((b) => b.textContent === '−$2.63')).toHaveAttribute('data-source', 'ADJ#2026-09-23T09:00:00Z#c1');
  });

  it('clicking a number opens the row as stored', async () => {
    authFetch.mockImplementation(() => respond({ invoice: INV }));
    render(<Invoice orgId="org_x" period="2026-09" onBack={jest.fn()} />);
    await screen.findByTestId('invoice');
    fireEvent.click(screen.getByText('−$6.12'));
    const dlg = screen.getByRole('dialog', { name: /the row behind this number/i });
    expect(dlg).toHaveTextContent('ADJ#2026-09-01T09:00:00Z#k1');
    expect(within(dlg).getByTestId('inv-row-fields')).toHaveTextContent('pilot goodwill');
    // Both exits: the X and the footer button.
    expect(within(dlg).getAllByRole('button', { name: 'Close' })).toHaveLength(2);
    fireEvent.click(within(dlg).getAllByRole('button', { name: 'Close' })[1]);
    expect(screen.queryByRole('dialog', { name: /the row behind/i })).toBeNull();
  });

  it('prints the order of application and the frozen note', async () => {
    authFetch.mockImplementation(() => respond({ invoice: INV }));
    render(<Invoice orgId="org_x" period="2026-09" onBack={jest.fn()} />);
    const doc = await screen.findByTestId('invoice');
    expect(doc).toHaveTextContent(/largest percentage first, then any fixed amount, then credits/);
    expect(doc).toHaveTextContent(/frozen inside this invoice/);
  });
});

describe('billing history (mockup 21)', () => {
  it('lists closed months newest first: list, applied, charged; free months as $0.00 rows', async () => {
    authFetch.mockImplementation(() => respond({ invoices: [
      INV,
      { ...INV, period: '2026-08', number: 'SIM-X-2026-08', planId: 'personal', listCents: 0, listDisplay: '$0.00', totalCents: 0, totalDisplay: '$0.00', discounts: [], credits: [] },
    ] }));
    const onOpen = jest.fn();
    render(<BillingHistory orgId="org_x" onOpen={onOpen} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('inv-row')).toHaveLength(2));
    const [sep, aug] = screen.getAllByTestId('inv-row');
    expect(sep).toHaveTextContent('September 2026');
    expect(sep).toHaveTextContent('30% off −$2.63 · Credit $10.00 −$6.12');
    expect(sep).toHaveTextContent('$0.00');
    expect(aug).toHaveTextContent('Free');
    expect(aug).toHaveClass('inv-row--free');
    fireEvent.click(within(sep).getByRole('button', { name: 'Invoice' }));
    expect(onOpen).toHaveBeenCalledWith('2026-09');
  });
  it('an empty history says when the first invoice will exist', async () => {
    authFetch.mockImplementation(() => respond({ invoices: [] }));
    render(<BillingHistory orgId="org_x" onOpen={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('inv-empty')).toHaveTextContent(/on the 1st of the next/));
  });
  it('periodLabel', () => { expect(periodLabel('2026-09')).toBe('September 2026'); });
});
