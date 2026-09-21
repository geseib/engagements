/**
 * TASK 21 — AdminPage wires the share dialog, the appeal, the list's
 * "Who can see it" column and Share action, and the flagged-count badge on
 * the Question sets nav item.
 *
 * Mocks copied from adminOneSection.test.jsx:10-70 — that suite is the only
 * one that has ever mounted the full `<AdminPage />` in jsdom.
 */
import React from 'react';
import {
  render, screen, fireEvent, within, waitFor,
} from '@testing-library/react';

let mockActiveOrg = '';
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
  getActiveOrgId: () => mockActiveOrg,
  setActiveOrgId: (id) => { mockActiveOrg = id || ''; },
}));

let mockGroups = ['admins', 'hosts'];
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'staff', groups: mockGroups, attributes: {} },
    signOut: jest.fn(),
    isAdmin: () => mockGroups.includes('admins'),
  }),
  AuthProvider: ({ children }) => children,
}));

import AdminPage from '../AdminPage';

// Reported by the owner (2026-09-18): "when i find a question set that's public
// and try to edit it, it has the option to save a copy. but when i do
// successfully, it still leaves me in the public version that i have edited and
// can only cancel." Expected: after Save-as-copy the editor is on MY copy, clean,
// with Close as the way out.

const HOME = { orgId: 'org_WLZyeb6wGSarf1grsXGxSM', name: 'George Seib', type: 'personal', yourRole: 'owner' };
// Both rows carry a shelf: the Details save requires one before it will send,
// and a copy keeps whatever the original was filed under.
const PUBLIC_ROW = { id: 'name-that-thing', name: 'Name that thing', engagementType: 'trivia', totalQuestions: 3, canManage: false, scope: 'public', activeVersion: 1, topic: 'general-knowledge' };
const COPY_ROW = { id: 'name-that-thing', name: 'Name that thing (mine)', engagementType: 'trivia', totalQuestions: 3, canManage: true, scope: 'org', activeVersion: 1, topic: 'general-knowledge' };

let copied = false;
const calls = [];
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

function serve() {
  copied = false; calls.length = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    calls.push(`${method} ${u.replace(/^.*?\/(admin|question-sets|orgs)/, '$1')}`);
    if (u.includes('/orgs')) return json({ orgs: [HOME] });
    if (u.includes('admin/question-sets')) return json({ questionSets: copied ? [PUBLIC_ROW, COPY_ROW] : [PUBLIC_ROW] }) // the public row can come FIRST, and it shares the copy's id;
    if (method === 'POST' && u.includes('/question-sets/name-that-thing/copy')) { copied = true; return json({ setId: 'name-that-thing', name: 'Name that thing (mine)', sourceSetId: 'name-that-thing' }); }
    if (method === 'PUT' && u.includes('admin/edit-question-set/')) return json({ updated: { name: true } });
    if (u.includes('/versions')) return json([]);
    if (u.includes('/questions')) return json([]);
    return json({});
  });
}

beforeEach(() => { localStorage.clear(); mockActiveOrg = HOME.orgId; mockGroups = ['hosts']; window.history.pushState({}, '', '/admin'); });

test('after Save-as-copy the editor is on my copy, clean, with Close as the way out', async () => {
  serve();
  render(<AdminPage />);
  const row = (await screen.findByText('Name that thing')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^open$/i }));
  await screen.findByText(/belongs to another organisation/i);
  const title = screen.getByDisplayValue('Name that thing');
  fireEvent.change(title, { target: { value: 'Name that thing (mine)' } });
  fireEvent.click(screen.getByRole('button', { name: /save details as my copy/i }));
  await waitFor(() => expect(calls.some((c) => c.startsWith('POST') && c.includes('/copy'))).toBe(true));
  await waitFor(() => expect(screen.queryByText(/belongs to another organisation/i)).toBeNull(), { timeout: 3000 });
  expect(screen.queryByRole('button', { name: /save details as my copy/i })).toBeNull();
  // The header X and the footer exit both read Close once nothing is pending.
  expect(screen.getAllByRole('button', { name: /^close$/i }).length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
});
