/**
 * THE BELL — one inbox in the console's top line (owner, 2026-10-21).
 *
 * // rejects: a bell with no count, a click that goes nowhere, a stored
 * //          notification that stays unread after it was opened, and a panel
 * //          with no way out but the button that opened it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(),
  getActiveOrgId: () => '',
  PLATFORM_MODE_HEADER: '~platform',
  ORG_HEADER: 'X-Engage-Org',
}));
const { authFetch } = require('../auth/authFetch');
const NotificationsBell = require('../components/NotificationsBell').default;

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

const ITEMS = [
  {
    id: 'draft#abc123def', kind: 'draft.ready', source: 'stored', title: '20 questions ready to review',
    body: 'To add to “History Quiz”.', orgId: 'org_team', link: { type: 'draft', draftId: 'abc123def', orgId: 'org_team' },
    read: false, daysLeft: 4, reminder: true,
  },
  {
    id: 'invite#org_x', kind: 'invite', source: 'live', title: 'Invitation to join Acme', body: 'As member.',
    orgId: '', link: { type: 'invites' }, read: false,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  authFetch.mockImplementation(async (url, opts = {}) => {
    if (url.endsWith('me/notifications/list')) return json(200, { items: ITEMS, unread: 2 });
    if ((opts.method || 'GET') === 'POST') return json(200, {});
    throw new Error(`unexpected ${url}`);
  });
});

test('the count is what waits, and opening lists it with its library and time left', async () => {
  render(<NotificationsBell libraries={[{ key: 'org_team', label: 'Northwind', kind: 'team' }]} />);
  expect(await screen.findByTestId('nbell-count')).toHaveTextContent('2');
  fireEvent.click(screen.getByTestId('nbell-button'));
  const panel = await screen.findByTestId('nbell-panel');
  expect(panel).toHaveTextContent('20 questions ready to review');
  expect(panel).toHaveTextContent('Northwind');
  expect(panel).toHaveTextContent('Reminder · 4 days left');
  expect(panel).toHaveTextContent('Invitation to join Acme');
});

test('a click marks a stored notification read and goes where it points', async () => {
  const onOpen = jest.fn();
  render(<NotificationsBell onOpen={onOpen} />);
  await screen.findByTestId('nbell-count');
  fireEvent.click(screen.getByTestId('nbell-button'));
  fireEvent.click(await screen.findByTestId('nbell-item-draft.ready'));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft#abc123def' })));
  expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('me/notifications/draft%23abc123def/read'), expect.objectContaining({ method: 'POST' }));
  expect(screen.queryByTestId('nbell-panel')).toBeNull();
});

test('a live entry is not "read" — it goes where it points and stays until the thing is dealt with', async () => {
  const onOpen = jest.fn();
  render(<NotificationsBell onOpen={onOpen} />);
  await screen.findByTestId('nbell-count');
  fireEvent.click(screen.getByTestId('nbell-button'));
  fireEvent.click(await screen.findByTestId('nbell-item-invite'));
  await waitFor(() => expect(onOpen).toHaveBeenCalled());
  expect(authFetch.mock.calls.some(([url]) => /read$/.test(url))).toBe(false);
});

test('the panel has an X and a bottom Close, and Escape closes it', async () => {
  render(<NotificationsBell />);
  await screen.findByTestId('nbell-count');
  fireEvent.click(screen.getByTestId('nbell-button'));
  await screen.findByTestId('nbell-panel');
  expect(screen.getByRole('button', { name: 'Close notifications' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByTestId('nbell-panel')).toBeNull();
});

test('nothing waiting says so, and shows no count', async () => {
  authFetch.mockImplementation(async () => json(200, { items: [], unread: 0 }));
  render(<NotificationsBell />);
  fireEvent.click(screen.getByTestId('nbell-button'));
  expect(await screen.findByText(/Nothing is waiting for you/)).toBeInTheDocument();
  expect(screen.queryByTestId('nbell-count')).toBeNull();
});

// rejects (walk of dev d2ba71d5): the bell's link from another section landing
// on the bare Question sets list. handleNavigate closes the review it leaves,
// so AdminPage's openDraft must navigate BEFORE it opens the review.
test('AdminPage opens a draft after navigating to Question sets, not before', () => {
  // eslint-disable-next-line global-require
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'AdminPage.jsx'), 'utf8');
  const body = src.slice(src.indexOf('const openDraft = ('), src.indexOf('const closeDraft = ('));
  expect(body.indexOf('handleNavigate(DRAFTS_SECTION)')).toBeGreaterThan(-1);
  expect(body.indexOf('handleNavigate(DRAFTS_SECTION)')).toBeLessThan(body.indexOf('setDraftPlace({ draftId, libraryKey })'));
});
