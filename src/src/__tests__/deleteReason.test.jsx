/**
 * ENGAGE STAFF ARE ASKED WHY; NOBODY ELSE IS (the owner's delete rule,
 * 2026-10-04).
 *
 * "deletable by three types of people: the host that created it, an admin for
 * the org, and [an Engage platform admin] with a documented reason (logged to
 * the org's or user's admin page)". The server says the role each caller would
 * delete in (`deleteAs` / `deleteAllAs`, tenant.deleteRole); when it is
 * 'platform-admin' the delete confirm the screen already has carries a reason
 * field, inline, and Delete waits for it. Hosts and org admins see no change;
 * a caller who may not delete sees the button disabled, saying who may.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SessionsPanel from '../components/SessionsPanel';
import EventBuilder from '../components/EventBuilder';
import DeleteReasonField, { needsReason } from '../components/DeleteReasonField';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../utils/eventsApi', () => ({
  deleteEvent: jest.fn(),
  getEvent: jest.fn(),
  reorderItems: jest.fn(),
  updateItem: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
}));
const eventsApi = require('../utils/eventsApi');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const GAMES = [
  { gameId: '5101', title: 'Mine', gameType: 'trivia', createdAt: '2026-10-01T09:00:00Z', started: true, deleteAs: 'host' },
  { gameId: '5102', title: 'Their offsite', gameType: 'poll', createdAt: '2026-10-02T09:00:00Z', started: true, deleteAs: 'platform-admin' },
  { gameId: '5103', title: 'Someone else', gameType: 'poll', createdAt: '2026-10-03T09:00:00Z', started: true, deleteAs: '' },
];

beforeEach(() => {
  jest.clearAllMocks();
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

function api({ deleteAllAs = 'org-owner', firstDelete = null } = {}) {
  let first = firstDelete;
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && /\/games$/.test(url)) return json(200, { games: GAMES, events: [], deleteAllAs });
    if (method === 'POST' && url.includes('/admin/clear-game/')) {
      if (first) { const r = first; first = null; return r; }
      return json(200, { success: true });
    }
    if (method === 'POST' && url.includes('/admin/clear-all-games')) return json(200, { sessionsDeleted: 3 });
    throw new Error(`Unhandled ${method} ${url}`);
  });
}
async function mount(opts) {
  api(opts);
  render(<SessionsPanel environment={{ id: 'dev', label: 'DEV' }} />);
  await waitFor(() => expect(screen.queryByText(/Loading sessions/)).toBeNull());
}
const rowOf = (title) => screen.getByText(title).closest('tr');
const clearGameCalls = () => authFetch.mock.calls.filter(([u, o]) => u.includes('/admin/clear-game/') && o.method === 'POST');

describe("the console's Sessions list", () => {
  test('a row the caller created: the browser confirm as before, no reason asked, none sent', async () => {
    window.confirm = jest.fn(() => true);
    await mount();
    fireEvent.click(within(rowOf('Mine')).getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.queryByTestId('delete-reason')).toBeNull();
    await waitFor(() => expect(clearGameCalls()).toHaveLength(1));
    expect(clearGameCalls()[0][1].body).toBeUndefined();
  });

  test("Engage staff on another team's row: the inline confirm asks why, Delete waits for it, and the reason is sent", async () => {
    window.confirm = jest.fn(() => true);
    await mount();
    fireEvent.click(within(rowOf('Their offsite')).getByRole('button', { name: 'Delete' }));
    expect(window.confirm).not.toHaveBeenCalled();
    const row = screen.getByTestId('reason-row');
    const go = within(row).getByRole('button', { name: 'Delete' });
    expect(go).toBeDisabled();
    fireEvent.change(within(row).getByLabelText('Why are you deleting this?'), { target: { value: 'Owner asked by email' } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(clearGameCalls()).toHaveLength(1));
    expect(JSON.parse(clearGameCalls()[0][1].body)).toEqual({ reason: 'Owner asked by email' });
    await waitFor(() => expect(screen.queryByText('Their offsite')).toBeNull());
  });

  test('a caller who may not delete it: the button is disabled and says who may', async () => {
    await mount();
    const button = within(rowOf('Someone else')).getByRole('button', { name: 'Delete' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/host who created it/));
  });

  test('if the server still asks for a reason, the same inline confirm opens', async () => {
    window.confirm = jest.fn(() => true);
    await mount({ firstDelete: json(400, { code: 'reason_required', error: 'Engage staff must say why' }) });
    fireEvent.click(within(rowOf('Mine')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByTestId('reason-row')).toBeInTheDocument();
  });

  test('delete all, as Engage staff: the modal asks why and sends it', async () => {
    await mount({ deleteAllAs: 'platform-admin' });
    fireEvent.click(screen.getByRole('button', { name: /Delete all sessions/ }));
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'delete all sessions' } });
    const go = screen.getByRole('button', { name: /^Delete all 3$/ });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why are you deleting this?'), { target: { value: 'Team closed' } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(authFetch.mock.calls.some(([u]) => u.includes('clear-all-games'))).toBe(true));
    const [, init] = authFetch.mock.calls.find(([u]) => u.includes('clear-all-games'));
    expect(JSON.parse(init.body)).toEqual({ reason: 'Team closed' });
  });

  test('delete all, as the team owner: no reason; as a plain member: no Delete all at all', async () => {
    await mount({ deleteAllAs: 'org-owner' });
    fireEvent.click(screen.getByRole('button', { name: /Delete all sessions/ }));
    expect(screen.queryByTestId('delete-reason')).toBeNull();
  });
  test('a plain member is not offered Delete all', async () => {
    await mount({ deleteAllAs: '' });
    expect(screen.queryByRole('button', { name: /Delete all sessions/ })).toBeNull();
  });
});

describe('the event builder', () => {
  const EVENT = {
    code: '5307', title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London',
    access: 'open', state: 'SCHEDULED', itemCount: 1, engagementCount: 0, breakCount: 1, attendeeReports: 'full',
  };
  const ITEMS = [{ itemId: 'it_00000005', order: 1, type: 'break', title: 'Break', description: '', minutes: 15, state: 'planned' }];
  const mountEvent = async (deleteAs) => {
    eventsApi.getEvent.mockResolvedValue({ event: { ...EVENT, deleteAs }, items: ITEMS });
    eventsApi.deleteEvent.mockResolvedValue({ deleted: '5307' });
    render(<EventBuilder code="5307" sets={[]} onDeleted={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBe(1));
  };

  test('Engage staff: the inline delete confirm asks why, and the reason goes with the delete', async () => {
    await mountEvent('platform-admin');
    fireEvent.click(screen.getByRole('button', { name: 'Delete event…' }));
    const confirm = screen.getByTestId('delete-confirm');
    const go = within(confirm).getByRole('button', { name: 'Delete event' });
    expect(go).toBeDisabled();
    fireEvent.change(within(confirm).getByLabelText('Why are you deleting this?'), { target: { value: 'A duplicate' } });
    fireEvent.click(go);
    await waitFor(() => expect(eventsApi.deleteEvent).toHaveBeenCalledWith('5307', { reason: 'A duplicate' }));
  });

  test('its host: no reason, exactly as before', async () => {
    await mountEvent('host');
    fireEvent.click(screen.getByRole('button', { name: 'Delete event…' }));
    expect(screen.queryByTestId('delete-reason')).toBeNull();
    fireEvent.click(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Delete event' }));
    await waitFor(() => expect(eventsApi.deleteEvent).toHaveBeenCalledWith('5307'));
  });

  test('a member who may not: Delete event… is disabled and says who may', async () => {
    await mountEvent('');
    expect(screen.getByRole('button', { name: 'Delete event…' })).toBeDisabled();
  });
});

describe('DeleteReasonField', () => {
  test('borrows the screen\'s own classes and says where the reason goes', () => {
    render(<DeleteReasonField id="x" value="" onChange={() => {}} scope="evb" />);
    expect(screen.getByTestId('delete-reason')).toHaveClass('evb-field');
    expect(screen.getByText(/kept in the team’s audit log/)).toBeInTheDocument();
    expect(needsReason({ body: { code: 'reason_required' } })).toBe(true);
    expect(needsReason({ body: { code: 'item_running' } })).toBe(false);
  });
});
