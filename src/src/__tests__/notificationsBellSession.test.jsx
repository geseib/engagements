/**
 * THE BELL IN A LIVE SESSION (components/NotificationsBell.jsx `session`;
 * experience plan §4.3, owner decision 1, Phase 1b).
 *
 * // rejects: the owner's 1 Nov question, "why wasnt the alert with the alarm
 * //          bell": the bell was an account inbox polled every five minutes and
 * //          held no session events at all.
 * // rejects: a bell that stays lit all session for a chatty round's late
 * //          comments (Soon items are a dot, never a number).
 * // rejects: the bell changing outside a session (it is the account inbox,
 * //          exactly as before).
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { needsYou } from '../config/needsYou';

jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(),
  getActiveOrgId: () => '',
  PLATFORM_MODE_HEADER: '~platform',
  ORG_HEADER: 'X-Engage-Org',
}));
const { authFetch } = require('../auth/authFetch');
const NotificationsBell = require('../components/NotificationsBell').default;

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
const ITEMS = [{
  id: 'draft#abc', kind: 'draft.ready', source: 'stored', title: '20 questions ready to review',
  body: '', orgId: '', link: { type: 'draft', draftId: 'abc' }, read: false,
}, {
  id: 'invite#x', kind: 'invite', source: 'live', title: 'Invitation to join Acme', body: '', orgId: '', link: { type: 'invites' }, read: false,
}];

beforeEach(() => {
  jest.clearAllMocks();
  authFetch.mockImplementation(async (url) => {
    if (url.endsWith('me/notifications/list')) return json(200, { items: ITEMS, unread: 2 });
    return json(200, {});
  });
});

const asker = { name: 'Sam', handover: { requested: true, requestedAt: new Date().toISOString() } };

test('outside a session: the account count and list, as today', async () => {
  render(<NotificationsBell />);
  expect(await screen.findByTestId('nbell-count')).toHaveTextContent('2');
  expect(screen.getByTestId('nbell-button')).toHaveAttribute('aria-label', 'Notifications, 2 waiting');
  fireEvent.click(screen.getByTestId('nbell-button'));
  const panel = await screen.findByTestId('nbell-panel');
  expect(within(panel).queryByTestId('nbell-session')).toBeNull();
  expect(within(panel).queryByTestId('nbell-account')).toBeNull();
  expect(panel).toHaveTextContent('20 questions ready to review');
});

test('in a session the number is this session\'s Now items only', async () => {
  const session = { needs: needsYou({ players: [asker], late: { notReviewed: 4, answers: 4 } }), onAct: () => {} };
  render(<NotificationsBell session={session} />);
  // The account inbox has loaded (two entries)...
  await waitFor(() => expect(authFetch).toHaveBeenCalled());
  // ...and four late answers wait; the bell says 1: Sam.
  await waitFor(() => expect(screen.getByTestId('nbell-count')).toHaveTextContent('1'));
  expect(screen.getByTestId('nbell-button')).toHaveAttribute('aria-label', 'Needs you, 1 waiting');
});

test('Soon items only: a dot, never a number', async () => {
  const session = { needs: needsYou({ late: { notReviewed: 4, answers: 4 } }), onAct: () => {} };
  render(<NotificationsBell session={session} />);
  await screen.findByTestId('nbell-button');
  expect(screen.queryByTestId('nbell-count')).toBeNull();
  expect(screen.getByTestId('nbell-dot')).toBeInTheDocument();
});

test('This session first, its items acting in place; Your account folded below with no count', async () => {
  const onAct = jest.fn();
  const session = { needs: needsYou({ players: [asker] }), onAct };
  render(<NotificationsBell session={session} />);
  fireEvent.click(screen.getByTestId('nbell-button'));
  const panel = await screen.findByTestId('nbell-panel');
  const sessionPart = within(panel).getByTestId('nbell-session');
  const account = within(panel).getByTestId('nbell-account');
  // Order: This session, then the account.
  expect(sessionPart.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(sessionPart).toHaveTextContent('Sam wants their name on a new device');
  expect(account.tagName).toBe('DETAILS');
  expect(account.open).toBe(false);
  expect(account.querySelector('summary')).toHaveTextContent(/^Your account$/);
  fireEvent.click(within(sessionPart).getByRole('button', { name: 'Let them: Sam' }));
  expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam' }), 'let');
});
