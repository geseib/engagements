/**
 * LEAVING A PAID PLAN — components/LeavePlanDialog.jsx, and the control on
 * Plan & usage (components/BillingPanel.jsx) that opens it.
 *
 * The owner, 27 Sep 2026: they "will be given a list of their team or
 * individual sets and be told how many they have to delete to get down to 5
 * free", with a make-public button whose sets "will not be deleted until they
 * are accepted into public (a copy) or they come back and uncheck make public".
 *
 * Every number the dialog shows is the server's (GET /orgs/{id}/plan/leave), so
 * these tests hand it a preview and read the words. NO GEOMETRIC ASSERTIONS —
 * jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LeavePlanDialog, { leadSentence, planLabel } from '../components/LeavePlanDialog';
import BillingPanel from '../components/BillingPanel';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');
const pricing = require('../../../lambda-functions/game/pricing');

const ALLOWANCE = pricing.PERSONAL_PLAN.includedSets;
const respond = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const set = (i, extra = {}) => ({
  setId: `set${i}`, name: `Set ${String(i).padStart(2, '0')}`, engagementType: 'trivia', questionCount: 4,
  version: 1, topic: 'history', held: false, holdState: null, heldAt: '', released: null, ...extra,
});
function previewOf(sets, extra = {}) {
  const held = sets.filter((s) => s.held).length;
  const kept = sets.length - held;
  const mustDelete = Math.max(0, kept - ALLOWANCE);
  return {
    orgId: 'org_x', plan: { id: 'team', planId: 'team', name: 'Team plan', paid: true },
    freePlan: { name: 'Personal', includedSets: ALLOWANCE, includedSessions: 5 },
    allowance: ALLOWANCE, sets, total: sets.length, held, kept, mustDelete, canLeave: mustDelete === 0,
    sessions: { used: 2, included: 5, resetsOn: '2026-10-01' }, topics: [],
    ...extra,
  };
}
const eight = () => Array.from({ length: 8 }, (_, i) => set(i + 1));

/** Route authFetch by method and path, recording every call. */
function serve(routes) {
  authFetch.mockImplementation((url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const key = `${method} ${String(url).replace('https://api.test/', '')}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected ${key}`);
    return typeof handler === 'function' ? handler(init) : handler;
  });
}
const calls = (prefix) => authFetch.mock.calls.filter(([url, init = {}]) => `${(init.method || 'GET').toUpperCase()} ${String(url).replace('https://api.test/', '')}`.startsWith(prefix));

beforeEach(() => { authFetch.mockReset(); window.API_BASE = 'https://api.test/'; });

const open = (props = {}) => render(
  <LeavePlanDialog orgId="org_x" orgName="Northwind" onClose={jest.fn()} onLeft={jest.fn()} {...props} />,
);

describe('what it says', () => {
  it('says, in plain words, how many there are, what the free plan keeps, and how many to delete', async () => {
    serve({ 'GET orgs/org_x/plan/leave': () => respond(previewOf(eight())) });
    open();
    expect(await screen.findByTestId('lvp-lead')).toHaveTextContent(
      `You have 8 sets. The free plan keeps ${ALLOWANCE} — delete ${8 - ALLOWANCE}, or make some public.`,
    );
    expect(screen.getByRole('heading', { name: 'Leave the Team plan' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 8);
  });

  it('keeps Leave disabled with its reason beside it until the kept sets fit', async () => {
    serve({ 'GET orgs/org_x/plan/leave': () => respond(previewOf(eight())) });
    open();
    await screen.findByTestId('lvp-lead');
    const button = screen.getByTestId('lvp-leave');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('lvp-why')).toHaveTextContent(`Delete ${8 - ALLOWANCE} more, or make some public, to leave.`);
    expect(button).toHaveAttribute('aria-describedby', 'lvp-why');
  });

  it('names held sets once, as the reason the kept number is not the total', () => {
    const sets = [...eight().slice(0, 6), set(7, { held: true, holdState: 'waiting' }), set(8, { held: true, holdState: 'checking' })];
    expect(leadSentence(previewOf(sets))).toBe(
      `You have 8 sets. 2 are waiting for the public library and do not count. The free plan keeps ${ALLOWANCE} — delete ${6 - ALLOWANCE}, or make some public.`,
    );
    expect(leadSentence(previewOf(eight().slice(0, ALLOWANCE)))).toMatch(/so you can leave now\.$/);
    expect(planLabel('Standard')).toBe('Standard plan');
    expect(planLabel('Organisation plan')).toBe('Organisation plan');
  });

  it('warns when this month has already used more sessions than the free plan includes', async () => {
    serve({ 'GET orgs/org_x/plan/leave': () => respond(previewOf(eight(), { sessions: { used: 12, included: 5, resetsOn: '2026-10-01' } })) });
    open();
    expect(await screen.findByTestId('lvp-sessions')).toHaveTextContent('You have run 12 sessions this month. The free plan includes 5');
  });

  it('has an X and a bottom exit through one close', async () => {
    serve({ 'GET orgs/org_x/plan/leave': () => respond(previewOf(eight())) });
    const onClose = jest.fn();
    open({ onClose });
    await screen.findByTestId('lvp-lead');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('make public', () => {
  it('holds the set and says it is kept until the library accepts a copy', async () => {
    const held = [...eight().slice(0, 7), set(8, { held: true, holdState: 'checking' })];
    serve({
      'GET orgs/org_x/plan/leave': () => respond(previewOf(eight())),
      'POST orgs/org_x/plan/leave/hold': () => respond({ setId: 'set8', held: true, state: 'checking', message: 'x', preview: previewOf(held) }),
    });
    open();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Make “Set 08” public' }));
    await waitFor(() => expect(screen.getByTestId('lvp-held-set8')).toHaveTextContent(
      'Kept until the public library accepts a copy — then it’s removed from here. Untick to keep it.',
    ));
    expect(screen.getByRole('checkbox', { name: 'Make “Set 08” public' })).toBeChecked();
    expect(JSON.parse(calls('POST orgs/org_x/plan/leave/hold')[0][1].body)).toEqual({ setId: 'set8', hold: true });
    expect(screen.getByTestId('lvp-lead')).toHaveTextContent('1 is waiting for the public library and does not count.');
  });

  it('a set that went public at once leaves the list with a short note', async () => {
    const after = eight().filter((s) => s.setId !== 'set3');
    serve({
      'GET orgs/org_x/plan/leave': () => respond(previewOf(eight())),
      'POST orgs/org_x/plan/leave/hold': () => respond({
        setId: 'set3', held: false, state: 'public', deleted: true,
        message: 'The public copy of “Set 03” is live, so it has been removed from here.', preview: previewOf(after),
      }),
    });
    open();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Make “Set 03” public' }));
    expect(await screen.findByTestId('lvp-gone')).toHaveTextContent('The public copy of “Set 03” is live');
    expect(screen.queryByTestId('lvp-row-set3')).toBeNull();
  });

  it('asks for a topic inline when the set has none, and sends the one chosen', async () => {
    let n = 0;
    serve({
      'GET orgs/org_x/plan/leave': () => respond(previewOf(eight())),
      'POST orgs/org_x/plan/leave/hold': (init) => {
        n += 1;
        if (n === 1) return respond({ setId: 'set2', needsTopic: true, error: 'Choose a topic for it first — the public library files every set under one.' }, 409);
        expect(JSON.parse(init.body)).toEqual({ setId: 'set2', hold: true, topic: 'science-technology' });
        return respond({ setId: 'set2', held: true, state: 'checking', preview: previewOf([...eight().slice(0, 1), set(2, { held: true, holdState: 'checking' }), ...eight().slice(2)]) });
      },
    });
    open();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Make “Set 02” public' }));
    const row = await screen.findByTestId('lvp-row-set2');
    expect(await within(row).findByText(/Choose a topic for it first/)).toBeInTheDocument();
    const file = within(row).getByRole('button', { name: 'File it and make public' });
    expect(file).toBeDisabled();
    fireEvent.change(within(row).getByLabelText('Topic'), { target: { value: 'science-technology' } });
    fireEvent.click(file);
    await waitFor(() => expect(screen.getByTestId('lvp-held-set2')).toBeInTheDocument());
    expect(within(screen.getByTestId('lvp-row-set2')).queryByLabelText('Topic')).toBeNull();
  });

  it('unticking releases it and says what that means', async () => {
    const sets = [...eight().slice(0, 7), set(8, { held: true, holdState: 'waiting' })];
    serve({
      'GET orgs/org_x/plan/leave': () => respond(previewOf(sets)),
      'POST orgs/org_x/plan/leave/hold': (init) => {
        expect(JSON.parse(init.body)).toEqual({ setId: 'set8', hold: false });
        return respond({ setId: 'set8', held: false, state: 'kept', message: 'Kept, and it counts towards your sets again.', preview: previewOf(eight()) });
      },
    });
    open();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Make “Set 08” public' }));
    expect(await screen.findByText('Kept, and it counts towards your sets again.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Make “Set 08” public' })).not.toBeChecked();
  });

  it('a set the library declined says so, quoting the reviewer', async () => {
    serve({ 'GET orgs/org_x/plan/leave': () => respond(previewOf([set(1, { released: { reason: 'declined', note: 'Q2 needs work.', at: '' } })])) });
    open();
    expect(await screen.findByText(/The public library declined it, so it counts again\. “Q2 needs work\.”/)).toBeInTheDocument();
  });
});

describe('delete, and leave', () => {
  it('delete is confirmed in the row first, then uses the Question sets delete route', async () => {
    let listed = eight();
    serve({
      'GET orgs/org_x/plan/leave': () => respond(previewOf(listed)),
      'DELETE admin/question-sets/set1?scope=org': () => { listed = listed.slice(1); return respond({ message: 'deleted' }); },
    });
    const onSetsChanged = jest.fn();
    const onClose = jest.fn();
    open({ onSetsChanged, onClose });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete “Set 01”' }));
    expect(calls('DELETE')).toHaveLength(0);
    const confirm = screen.getByTestId('lvp-confirm-set1');
    expect(confirm).toHaveTextContent('Making it public instead keeps it here until the library has a copy.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete it' }));
    expect(await screen.findByTestId('lvp-gone')).toHaveTextContent('Deleted “Set 01”.');
    await waitFor(() => expect(screen.queryByTestId('lvp-row-set1')).toBeNull());
    expect(calls('DELETE')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onSetsChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves when the sets fit, and hands the result back so Plan & usage refreshes', async () => {
    const onLeft = jest.fn();
    serve({
      'GET orgs/org_x/plan/leave': () => respond(previewOf(eight().slice(0, ALLOWANCE))),
      'POST orgs/org_x/plan/leave': () => respond({ plan: 'free', left: { fromPlan: 'team', toPlan: 'free' } }),
    });
    open({ onLeft });
    const button = await screen.findByTestId('lvp-leave');
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByTestId('lvp-why')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith(expect.objectContaining({ plan: 'free' })));
  });

  it("a refusal is shown in the dialog, with the server's fresh count", async () => {
    serve({
      'GET orgs/org_x/plan/leave': () => respond(previewOf(eight().slice(0, ALLOWANCE))),
      'POST orgs/org_x/plan/leave': () => respond({ error: 'You have 6 sets to keep.', code: 'too_many_sets', ...previewOf(eight().slice(0, ALLOWANCE + 1)) }, 409),
    });
    open();
    const button = await screen.findByTestId('lvp-leave');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('You have 6 sets to keep.');
    expect(screen.getByTestId('lvp-lead')).toHaveTextContent('delete 1');
  });
});

describe('the control on Plan & usage', () => {
  const USAGE = { sessionsRun: 3, setsCurrent: 3, setsPeak: 3 };
  it('shows on a paid plan when the caller may manage billing, and opens the dialog', () => {
    const onLeavePlan = jest.fn();
    render(<BillingPanel planId="team" usage={USAGE} period={{}} onLeavePlan={onLeavePlan} />);
    const control = screen.getByTestId('bill-leave-plan');
    expect(control).toHaveTextContent(/^Leave the .*plan$/);
    fireEvent.click(control);
    expect(onLeavePlan).toHaveBeenCalled();
  });
  it('is absent on the free plan, and for someone the caller did not give it to', () => {
    const { unmount } = render(<BillingPanel planId="personal" usage={USAGE} period={{}} onLeavePlan={jest.fn()} />);
    expect(screen.queryByTestId('bill-leave-plan')).toBeNull();
    unmount();
    render(<BillingPanel planId="team" usage={USAGE} period={{}} />);
    expect(screen.queryByTestId('bill-leave-plan')).toBeNull();
  });
});
