/**
 * Billing step 3 — AdjustmentsLedger, OrgBillingDrawer's grant dialog,
 * DiscountCodesPanel, and Plan & usage carrying the adjusted bill.
 * From docs/design/tenancy-redesign/16–19.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdjustmentsLedger, { AdjustedBill } from '../components/AdjustmentsLedger';
import { GrantAdjustmentDialog, grantBody } from '../components/OrgBillingDrawer';
import DiscountCodesPanel, { NewCodeDialog } from '../components/DiscountCodesPanel';
import BillingPanel from '../components/BillingPanel';
import pricingAdjust from '../../../lambda-functions/game/pricing-adjust';
import pricing from '../../../lambda-functions/game/pricing';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');
const respond = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });
beforeEach(() => { authFetch.mockReset(); window.API_BASE = 'https://api.test/'; });
afterEach(() => jest.restoreAllMocks());

const USAGE = { sessionsRun: 20, setsPeak: 2, setsCurrent: 2 };
const CODE = { adjId: 'c1', kind: 'CODE_REDEMPTION', percentOff: 30, validFrom: '2026-09', validTo: '2026-11', source: { type: 'code', code: 'WELCOME30' }, createdAt: '2026-09-23T09:00:00Z', status: 'active' };
const CREDIT = { adjId: 'k1', kind: 'CREDIT_CENTS', amountCents: 1000, remainingCents: 1000, note: 'pilot goodwill', source: { type: 'platform_admin' }, createdAt: '2026-09-01T09:00:00Z', createdByEmail: 'm.okafor@engage.example', status: 'active' };
const REVOKED = { adjId: 'o1', kind: 'OFFER', percentOff: 100, validFrom: '2026-07', validTo: '2026-08', note: 'two months free', source: { type: 'platform_admin' }, createdAt: '2026-07-01T09:00:00Z', revokedAt: '2026-07-10T09:00:00Z', revokeNote: 'granted to the wrong org', status: 'revoked' };
const adjusted = () => { const r = pricingAdjust.applyAdjustments(pricing.TEAM_PLAN, USAGE, [CODE, CREDIT], '2026-09'); r.sentence = pricingAdjust.simulationSentence(r); return r; };

describe('the ledger — one list for both sides (mockups 16 and 19)', () => {
  it('lists every row with its words, amount and status; a revoked row stays, marked', () => {
    render(<AdjustmentsLedger adjustments={[CODE, CREDIT, REVOKED]} audience="org" />);
    const rows = screen.getAllByTestId('adjl-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('30% off · code WELCOME30');
    expect(rows[1]).toHaveTextContent('Credit $10.00 · from Engage');
    expect(rows[1]).toHaveTextContent('“pilot goodwill”');
    expect(rows[2]).toHaveAttribute('data-status', 'revoked');
    expect(rows[2]).toHaveTextContent('granted to the wrong org');
    // rejects: a revoke button on the customer's side.
    expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull();
  });
  it('staff see the same rows, with who granted them and a Revoke on live ones only', () => {
    const onRevoke = jest.fn();
    render(<AdjustmentsLedger adjustments={[CREDIT, REVOKED]} audience="staff" onRevoke={onRevoke} />);
    expect(screen.getAllByTestId('adjl-row')[0]).toHaveTextContent('m.okafor@engage.example');
    expect(screen.getAllByRole('button', { name: /^revoke/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^revoke/i }));
    expect(onRevoke).toHaveBeenCalledWith(CREDIT);
  });
});

describe('the bill in miniature', () => {
  it('list, each adjustment as a negative line with its source, the total, the order, and "simulation"', () => {
    render(<AdjustedBill adjusted={adjusted()} audience="org" />);
    const bill = screen.getByTestId('adjl-bill');
    expect(bill).toHaveTextContent('List$8.75');
    expect(bill).toHaveTextContent('30% off · code WELCOME30');
    expect(bill).toHaveTextContent('−$2.63');
    expect(bill).toHaveTextContent('Credit $10.00 · from Engage · $3.88 stays for next month');
    expect(screen.getByTestId('adjl-total')).toHaveTextContent('$0.00');
    expect(bill).toHaveTextContent('This is a simulation.');
    expect(bill).toHaveTextContent(/largest percentage first, then any fixed amount, then credits/);
  });
});

describe('Plan & usage carries the adjusted bill and the ledger (mockup 19)', () => {
  it('shows both under the list arithmetic when there is anything to show', () => {
    render(<BillingPanel planId="team" usage={USAGE} period={{ label: 'September' }} adjusted={adjusted()} adjustments={[CODE, CREDIT]} />);
    expect(screen.getByTestId('bill-adjusted')).toBeInTheDocument();
    expect(screen.getByTestId('bill-adjustments')).toBeInTheDocument();
  });
  it('says nothing extra when nothing adjusts the bill', () => {
    const plain = pricingAdjust.applyAdjustments(pricing.TEAM_PLAN, USAGE, [], '2026-09');
    render(<BillingPanel planId="team" usage={USAGE} period={{ label: 'September' }} adjusted={plain} adjustments={[]} />);
    expect(screen.queryByTestId('bill-adjusted')).toBeNull();
    expect(screen.queryByTestId('bill-adjustments')).toBeNull();
  });
});

describe('the grant dialog (mockup 17)', () => {
  const org = { orgId: 'org_x', name: 'Northwind', plan: 'team', usage: USAGE };
  it('previews this period with the grant before anything is written, and names the grant on the button', () => {
    render(<GrantAdjustmentDialog org={org} plan={pricing.TEAM_PLAN} usage={USAGE} rows={[CODE]} period="2026-09" onCancel={jest.fn()} onGranted={jest.fn()} />);
    expect(screen.getByTestId('obill-grant-submit')).toHaveTextContent('Grant $10.00 credit');
    const preview = screen.getByTestId('obill-preview');
    expect(preview).toHaveTextContent('List$8.75');
    expect(preview).toHaveTextContent('Credit $10.00');
    expect(within(preview).getByTestId('adjl-total')).toHaveTextContent('$0.00');
    expect(preview).toHaveTextContent('No money moves in either direction');
    expect(authFetch).not.toHaveBeenCalled();
  });
  it('a reason is required, then the body is the ledger\'s shape', async () => {
    const onGranted = jest.fn();
    authFetch.mockImplementation(() => respond({ adjustment: CREDIT }, true, 201));
    render(<GrantAdjustmentDialog org={org} plan={pricing.TEAM_PLAN} usage={USAGE} rows={[]} period="2026-09" onCancel={jest.fn()} onGranted={onGranted} />);
    fireEvent.click(screen.getByTestId('obill-grant-submit'));
    expect(screen.getByRole('alert')).toHaveTextContent(/reason is required/i);
    fireEvent.change(screen.getByTestId('obill-reason'), { target: { value: 'pilot goodwill' } });
    fireEvent.click(screen.getByTestId('obill-grant-submit'));
    await waitFor(() => expect(onGranted).toHaveBeenCalled());
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toMatch(/platform\/orgs\/org_x\/adjustments$/);
    expect(JSON.parse(init.body)).toEqual({ kind: 'CREDIT_CENTS', note: 'pilot goodwill', validFrom: '2026-09', amountCents: 1000 });
  });
  it('the four kinds each build the right body', () => {
    const f = { amount: '4.00', percent: '', months: '2', sessions: '10', sets: '0', validFrom: '2026-10', note: 'x' };
    expect(grantBody('OFFER', f, '2026-09')).toMatchObject({ kind: 'OFFER', fixedOffCents: 400, months: 2, validFrom: '2026-10' });
    expect(grantBody('OFFER', { ...f, percent: '50' }, '2026-09')).toMatchObject({ percentOff: 50 });
    expect(grantBody('RATE_OVERRIDE', f, '2026-09')).toMatchObject({ rate: { baseCents: 400 }, months: 2 });
    expect(grantBody('CREDIT_UNITS', f, '2026-09')).toMatchObject({ units: { sessions: 10, sets: 0 } });
  });
  it('X and Cancel share one close; a typed reason is confirmed first', () => {
    const onCancel = jest.fn();
    render(<GrantAdjustmentDialog org={org} plan={pricing.TEAM_PLAN} usage={USAGE} rows={[]} period="2026-09" onCancel={onCancel} onGranted={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByTestId('obill-reason'), { target: { value: 'typed' } });
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('discount codes (mockup 18)', () => {
  it('lists codes with what they give, uses as a fraction, and Retire on live ones only', async () => {
    authFetch.mockImplementation(() => respond({ codes: [
      { code: 'WELCOME30', percentOff: 30, months: 3, validUntil: '2026-12-31', maxUses: 50, uses: 38, note: 'Launch', status: 'active', createdAt: '2026-08-01' },
      { code: 'LAUNCH50', fixedOffCents: 500, months: 1, validUntil: '2026-08-31', maxUses: 20, uses: 20, note: 'Launch week', status: 'expired', createdAt: '2026-07-01' },
    ] }));
    render(<DiscountCodesPanel />);
    await waitFor(() => expect(screen.getAllByTestId('dcode-row')).toHaveLength(2));
    const [a, b] = screen.getAllByTestId('dcode-row');
    expect(a).toHaveTextContent('30% off for 3 months');
    expect(a).toHaveTextContent('38 of 50');
    expect(within(a).getByRole('button', { name: 'Retire' })).toBeInTheDocument();
    expect(b).toHaveTextContent('$5.00 off for 1 month');
    expect(b).toHaveAttribute('data-status', 'expired');
    expect(within(b).queryByRole('button', { name: 'Retire' })).toBeNull();
  });
  it('the create dialog previews against a list month and posts the terms', async () => {
    const onCreated = jest.fn();
    authFetch.mockImplementation(() => respond({ code: { code: 'AUTUMN25' } }, true, 201));
    render(<NewCodeDialog onCancel={jest.fn()} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'autumn25' } });
    expect(screen.getByTestId('dcode-preview')).toHaveTextContent('On a $5.00 list month');
    expect(screen.getByTestId('dcode-preview')).toHaveTextContent('AUTUMN25 · 25% off · 2 months');
    expect(screen.getByTestId('dcode-preview')).toHaveTextContent('$3.75');
    fireEvent.click(screen.getByTestId('dcode-create'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toEqual({ code: 'AUTUMN25', note: '', maxUses: 100, validUntil: '', months: 2, percentOff: 25 });
  });
});
