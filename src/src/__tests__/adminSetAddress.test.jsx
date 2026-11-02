/**
 * THE CONSOLE'S SET EDITOR HAS AN ADDRESS (experience plan 5e).
 *
 * The console already drew the editor as a place (RATIONALE §2); it had no
 * address, so a reload lost it, a link could not reach it, and the browser's
 * Back left the list. `?set=<id>` names it now: opening pushes it, Back
 * returns to the list, Forward reopens the set, and a pasted link opens it.
 *
 * Mocks copied from adminCopyRebind.test.jsx (itself from adminOneSection).
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';

let mockActiveOrg = '';
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
  getActiveOrgId: () => mockActiveOrg,
  setActiveOrgId: (id) => { mockActiveOrg = id || ''; },
}));
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'host', groups: ['hosts'], attributes: {} },
    signOut: jest.fn(),
    isAdmin: () => false,
  }),
  AuthProvider: ({ children }) => children,
}));

import AdminPage, { setFromSearch, searchWithSet } from '../AdminPage';

const HOME = { orgId: 'org_home', name: 'Ivy', type: 'personal', yourRole: 'owner' };
const ROW = { id: 'ivy-retro', name: 'Ivy Retro', engagementType: 'call-and-answer', totalQuestions: 2, canManage: true, scope: 'org', activeVersion: 1, topic: 'general-knowledge' };
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

beforeEach(() => {
  localStorage.clear();
  mockActiveOrg = HOME.orgId;
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.includes('/orgs')) return json({ orgs: [HOME] });
    if (u.includes('admin/question-sets')) return json({ questionSets: [ROW] });
    if (u.includes('/versions')) return json([]);
    if (u.includes('/questions')) return json([]);
    return json({});
  });
});

const popTo = (url) => act(() => {
  window.history.pushState(window.history.state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
});

test('the helpers read and write the parameter, keeping every other one', () => {
  expect(setFromSearch('?section=questionsets&set=ivy-retro&setScope=org')).toEqual({ id: 'ivy-retro', scope: 'org' });
  expect(setFromSearch('?section=questionsets')).toBeNull();
  expect(searchWithSet('?section=questionsets', { id: 'a b', scope: '' })).toBe('?section=questionsets&set=a+b');
  expect(searchWithSet('?section=questionsets&set=x&setScope=org', null)).toBe('?section=questionsets');
});

test('opening a set writes its address; Back returns to the list and Forward reopens it', async () => {
  window.history.pushState({}, '', '/admin?section=questionsets');
  render(<AdminPage />);
  const row = (await screen.findByText('Ivy Retro')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^(open|edit)$/i }));
  await waitFor(() => expect(window.location.search).toMatch(/[?&]set=ivy-retro\b/));
  expect(screen.getByRole('heading', { name: /edit question set/i })).toBeInTheDocument();

  // Back in the browser returns to the list.
  await popTo('/admin?section=questionsets');
  await waitFor(() => expect(screen.queryByRole('heading', { name: /edit question set/i })).toBeNull());
  expect(screen.getByText('Ivy Retro')).toBeInTheDocument();

  // Forward reopens it.
  await popTo('/admin?section=questionsets&set=ivy-retro&setScope=org');
  expect(await screen.findByRole('heading', { name: /edit question set/i })).toBeInTheDocument();
});

test('a pasted link opens the set in its place', async () => {
  window.history.pushState({}, '', '/admin?section=questionsets&set=ivy-retro&setScope=org');
  render(<AdminPage />);
  expect(await screen.findByRole('heading', { name: /edit question set/i })).toBeInTheDocument();
  expect(await screen.findByText(/Ivy Retro ·/)).toBeInTheDocument();
});
