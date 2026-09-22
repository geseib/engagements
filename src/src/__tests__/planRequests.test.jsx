/**
 * Billing step 2 — components/PlanRequestDialog.jsx and PlanRequestsPanel.jsx,
 * from docs/design/tenancy-redesign/13, 14, 15.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PlanRequestDialog, { PlanRequestStrip } from '../components/PlanRequestDialog';
import PlanRequestsPanel, { DecideRequestDialog } from '../components/PlanRequestsPanel';
import BillingPanel from '../components/BillingPanel';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');
const respond = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });

beforeEach(() => { authFetch.mockReset(); window.API_BASE = 'https://api.test/'; });
afterEach(() => jest.restoreAllMocks());

const REQ = { reqId: 'r1', orgId: 'org_x', fromPlan: 'free', toPlan: 'team', status: 'requested', code: 'WELCOME30', requestedAt: '2026-09-22T10:00:00Z', orgName: 'Northwind', note: 'Programme for 40' };

describe('the request dialog (mockup 13)', () => {
  it('shows the list price and what is included, and says No card. No charge. above the button', () => {
    render(<PlanRequestDialog orgId="org_x" orgName="Northwind" onClose={jest.fn()} onRequested={jest.fn()} />);
    expect(screen.getByTestId('preq-sum')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('preq-sum')).toHaveTextContent('5 sessions · 5 stored sets · then $0.25 each');
    const note = screen.getByTestId('preq-no-charge');
    expect(note).toHaveTextContent('No card. No charge.');
    // Above the button: the sentence comes before the footer in the DOM.
    expect(note.compareDocumentPosition(screen.getByTestId('preq-send')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has an X and a bottom exit through one close; a typed note is confirmed first', () => {
    const onClose = jest.fn();
    render(<PlanRequestDialog orgId="org_x" orgName="Northwind" onClose={onClose} onRequested={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByPlaceholderText(/facilitator programme/i), { target: { value: 'hello' } });
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('sends toPlan team, the upper-cased code and the note, and hands back the request', async () => {
    const onRequested = jest.fn();
    authFetch.mockImplementation(() => respond({ request: REQ }, true, 201));
    render(<PlanRequestDialog orgId="org_x" orgName="Northwind" onClose={jest.fn()} onRequested={onRequested} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. WELCOME30'), { target: { value: 'welcome30' } });
    fireEvent.click(screen.getByTestId('preq-send'));
    await waitFor(() => expect(onRequested).toHaveBeenCalledWith(REQ));
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toMatch(/orgs\/org_x\/plan-requests$/);
    expect(JSON.parse(init.body)).toEqual({ toPlan: 'team', note: '', code: 'WELCOME30' });
  });

  it('a refusal is shown in the dialog, not swallowed', async () => {
    authFetch.mockImplementation(() => respond({ error: 'A request is already waiting.' }, false, 409));
    render(<PlanRequestDialog orgId="org_x" orgName="Northwind" onClose={jest.fn()} onRequested={jest.fn()} />);
    fireEvent.click(screen.getByTestId('preq-send'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('A request is already waiting.'));
  });
});

describe('the strip (mockup 14): four states, told apart by the first word', () => {
  it.each([
    ['requested', /^Team plan requested/, 'Withdraw'],
    ['approved', /^You are on the team plan/, null],
    ['declined', /^Not this time\./, 'Request again'],
    ['withdrawn', /^Request withdrawn/, 'Request the Team plan'],
  ])('%s', (status, lead, button) => {
    render(<PlanRequestStrip request={{ ...REQ, status, decidedAt: '2026-09-23T09:00:00Z', withdrawnAt: '2026-09-22T12:00:00Z', decisionNote: 'Welcome aboard' }} onWithdraw={jest.fn()} onRequestAgain={jest.fn()} />);
    const strip = screen.getByTestId('preq-strip');
    expect(strip).toHaveAttribute('data-status', status);
    expect(strip.textContent).toMatch(lead);
    if (button) expect(within(strip).getByRole('button', { name: button })).toBeInTheDocument();
    else expect(within(strip).queryByRole('button')).toBeNull();
  });

  it('quotes the reviewer\'s note verbatim on a decision', () => {
    render(<PlanRequestStrip request={{ ...REQ, status: 'declined', decidedAt: '2026-09-23T09:00:00Z', decisionNote: 'That code expired in August.' }} />);
    expect(screen.getByTestId('preq-strip').querySelector('q')).toHaveTextContent('That code expired in August.');
  });
});

describe('Plan & usage offers the request, and never the old Create a team', () => {
  it('free org, owner: Request the Team plan; waiting: the button gives way to the strip', () => {
    const onRequestPlan = jest.fn();
    const { rerender } = render(<BillingPanel planId="personal" usage={{ sessionsRun: 5, setsCurrent: 3, setsPeak: 3 }} period={{ label: 'September', resetsOn: '2026-10-01' }} onRequestPlan={onRequestPlan} />);
    fireEvent.click(screen.getByTestId('bill-request-plan'));
    expect(onRequestPlan).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create a team' })).toBeNull();
    rerender(<BillingPanel planId="personal" usage={{ sessionsRun: 5, setsCurrent: 3, setsPeak: 3 }} period={{ label: 'September' }} onRequestPlan={onRequestPlan} planRequest={REQ} onWithdrawRequest={jest.fn()} />);
    expect(screen.queryByTestId('bill-request-plan')).toBeNull();
    expect(screen.getByTestId('preq-strip')).toHaveAttribute('data-status', 'requested');
  });
});

describe('the platform queue and the decision (mockup 15)', () => {
  it('lists waiting requests with the org, the code and the note', async () => {
    authFetch.mockImplementation(() => respond({ requests: [REQ] }));
    render(<PlanRequestsPanel />);
    await waitFor(() => expect(screen.getAllByTestId('preq-row')).toHaveLength(1));
    const row = screen.getByTestId('preq-row');
    expect(row).toHaveTextContent('Northwind');
    expect(row).toHaveTextContent('WELCOME30');
    expect(row).toHaveTextContent('Programme for 40');
    expect(within(row).getByRole('button', { name: /decide/i })).toBeInTheDocument();
  });

  it('reports the waiting count for the nav badge', async () => {
    const onCountChange = jest.fn();
    authFetch.mockImplementation(() => respond({ requests: [REQ, { ...REQ, reqId: 'r2' }] }));
    render(<PlanRequestsPanel onCountChange={onCountChange} />);
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
  });

  it('the decision needs a note, and the button is named for the decision', async () => {
    const onDecided = jest.fn();
    authFetch.mockImplementation(() => respond({ request: { ...REQ, status: 'approved' }, plan: 'team' }));
    render(<DecideRequestDialog request={REQ} onCancel={jest.fn()} onDecided={onDecided} />);
    expect(screen.getByTestId('preq-decide')).toHaveTextContent('Approve');
    fireEvent.click(screen.getByTestId('preq-decide'));
    expect(screen.getByRole('alert')).toHaveTextContent(/note to the customer is required/i);
    expect(authFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/Decline/));
    expect(screen.getByTestId('preq-decide')).toHaveTextContent('Decline');
    fireEvent.click(screen.getByLabelText(/Approve/));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Welcome aboard' } });
    fireEvent.click(screen.getByTestId('preq-decide'));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(REQ, 'team', 'approved', 'Welcome aboard'));
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toMatch(/platform\/plan-requests\/org_x\/r1\/decide$/);
    expect(JSON.parse(init.body)).toEqual({ decision: 'approved', note: 'Welcome aboard' });
  });

  it('the decide dialog has an X and Cancel, both through one close', () => {
    const onCancel = jest.fn();
    render(<DecideRequestDialog request={REQ} onCancel={onCancel} onDecided={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
