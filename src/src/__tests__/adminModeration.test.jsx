/**
 * TASK 12 — the console has both libraries and the queue: an org previews and
 * copies its way into a shared set, Engage decides, unpublishes and reads the
 * score card.
 *
 * Mocks copied from adminShare.test.jsx:1-79, which copied them in turn from
 * adminOneSection.test.jsx — that suite is the only one that has ever mounted
 * the full `<AdminPage />` in jsdom.
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

const HOME = {
  orgId: 'org_WLZyeb6wGSarf1grsXGxSM', name: 'George Seib', type: 'personal', yourRole: 'owner',
};

const PUBLIC_ROWS = { questionSets: [
  { id: 'orgacme-safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, canManage: false, scope: 'public', activeVersion: 2, sourceOrgName: 'Acme' },
] };
const QUEUE = { count: 1, oldestWaitingSince: '2026-09-15T10:00:00.000Z', items: [{ sk: 'org_acme#safety#v2', orgName: 'Acme', setId: 'safety', title: 'Safety walkthrough', version: 2, gameType: 'trivia', questionCount: 30, reasons: ['escalated'], uncertainQuestionIds: ['c001#014'], waitingSince: '2026-09-15T10:00:00.000Z', publicSetId: '' }] };
const CARD = { publicSetId: 'orgacme-safety', name: 'Safety walkthrough', engagementType: 'trivia', questionCount: 30, sourceOrgName: 'Acme', publicVersion: 2, sourceVersion: 2, sensitivity: [], review: { status: 'passed', reviewer: 'dai', decidedAt: '2026-08-19T10:00:00.000Z', findings: [] }, log: [] };
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
let deleted;
function serveStaff() {
  deleted = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (u.includes('/orgs')) return json({ orgs: [HOME] });
    if (u.includes('admin/question-sets')) return json(PUBLIC_ROWS);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (method === 'DELETE' && u.includes('admin/public-library/')) { deleted.push(JSON.parse(options.body)); return json({ takenDown: 'orgacme-safety' }); }
    if (u.includes('admin/public-library/')) return json(CARD);
    return json({});
  });
}

beforeEach(() => {
  localStorage.clear();
  mockActiveOrg = '';
  mockGroups = ['admins', 'hosts'];
  window.history.pushState({}, '', '/admin');
});

test('the platform console has a Public library section with Unpublish, and the Moderation nav counts the queue', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=publiclibrary');
  render(<AdminPage />);
  expect(await screen.findByRole('heading', { level: 1, name: /public library/i })).toBeInTheDocument();
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Taken down pending an edit.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
  await waitFor(() => expect(deleted).toEqual([{ note: 'Taken down pending an edit.' }]));
  const nav = screen.getByRole('navigation', { name: /sections/i });
  await waitFor(() => expect(within(nav).getByText('Moderation').closest('button, a')).toHaveTextContent('1'));
});

/*
  R18 — not in the brief's literal Step 1 block; added because the ruling
  requires it. `handleUnpublish` THROWS on failure rather than resolving with
  `{ error }` or reaching for page-level `setNotice`: PublicLibraryPanel's
  UnpublishDialog owns the failure the same way ScoreCard's TakedownDialog
  does (R17) — closing it would lose a note someone just typed. First attempt
  500s; the dialog must stay open, show the reason and keep the note; the
  retry succeeds and the dialog closes.
*/
test('a failed unpublish keeps the dialog open with the reason and the note, and a retry succeeds (R18)', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  deleted = [];
  let attempts = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (u.includes('/orgs')) return json({ orgs: [HOME] });
    if (u.includes('admin/question-sets')) return json(PUBLIC_ROWS);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (method === 'DELETE' && u.includes('admin/public-library/')) {
      attempts += 1;
      if (attempts === 1) return json({ error: 'boom' }, 500);
      deleted.push(JSON.parse(options.body));
      return json({ takenDown: 'orgacme-safety' });
    }
    if (u.includes('admin/public-library/')) return json(CARD);
    return json({});
  });
  window.history.pushState({}, '', '/admin?section=publiclibrary');
  render(<AdminPage />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Taken down pending an edit.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/boom/i);
  expect(within(dialog).getByRole('textbox', { name: /note/i })).toHaveValue('Taken down pending an edit.');
  fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(deleted).toEqual([{ note: 'Taken down pending an edit.' }]);
});

test('Score card is a place: the breadcrumb goes back to the Public library', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=publiclibrary');
  render(<AdminPage />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /score card/i }));
  expect(await screen.findByRole('heading', { level: 1, name: /score card/i })).toBeInTheDocument();
  expect(await screen.findByTestId('scard-identity')).toHaveTextContent(/by Acme/);
  // Scoped to the top bar on purpose, the same reason adminShell.test.jsx
  // scopes its own "Question sets" breadcrumb query: the left nav also has a
  // "Public library" button (this section's own nav item, still current),
  // and an unscoped query throws on the ambiguity between two different
  // controls that happen to share a name.
  const topbar = screen.getByTestId('adm-topbar');
  fireEvent.click(within(topbar).getByRole('button', { name: /^public library$/i }));
  expect(await screen.findByRole('heading', { level: 1, name: /public library/i })).toBeInTheDocument();
});

test('Moderation mounts the queue, and the org console library lists public sets with Copy', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=moderation');
  render(<AdminPage />);
  expect(await screen.findByText(/1 set the check would not decide on its own/i)).toBeInTheDocument();
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=library');
  render(<AdminPage />);
  expect(await screen.findByRole('button', { name: /copy to my team/i })).toBeInTheDocument();
  expect(screen.queryByText(/sharing is live/i)).toBeNull();
});
