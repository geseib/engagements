/**
 * THE OVERVIEW AND THE SCOPE ROW, WIRED INTO THE REAL CONSOLE.
 *
 * docs/design/admin-landing (owner's rulings 2026-10-11). The pieces are
 * tested on their own (overviewPanel, scopeTabs, overviewAlerts); this mounts
 * AdminPage and looks, because a prop that never arrives is invisible to both.
 *
 *   - a bare /admin lands on the Overview, in an org and in platform mode;
 *   - the scope row is the only switcher (no organisation chip);
 *   - the Plan requests badge is filled on ENTERING platform mode, before
 *     anybody opens Plan requests (it was empty until then);
 *   - Accounts carries a badge for people waiting;
 *   - the "acting as Engage" banner covers the Overview in platform mode
 *     (ruling 11: kept for one release);
 *   - the tabs carry GET /me/attention's counts.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { PLATFORM_MODE } from '../config/consoleSections';

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
    currentUser: { username: 'staff', groups: mockGroups, attributes: { name: 'George Seib' } },
    signOut: jest.fn(),
    isAdmin: () => true,
  }),
  AuthProvider: ({ children }) => children,
}));

import AdminPage from '../AdminPage';

const PERSONAL = { orgId: 'org_home', name: 'George Seib', type: 'personal', yourRole: 'owner', plan: 'free' };
const TEAM = { orgId: 'org_st', name: 'Seib Tribe', type: 'team', yourRole: 'owner', plan: 'team' };

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });

function serve({ orgs = [PERSONAL, TEAM], attention = { scopes: {}, invites: 0 } } = {}) {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (/\/me\/attention$/.test(u)) return ok(attention);
    if (/\/orgs$/.test(u)) return ok({ orgs });
    if (u.includes('platform/plan-requests')) {
      return ok({ requests: [{ orgId: 'org_x', reqId: 'a', status: 'requested', orgName: 'X' }, { orgId: 'org_y', reqId: 'b', status: 'requested', orgName: 'Y' }] });
    }
    if (u.includes('admin/users/list')) {
      return ok({ users: [{ username: 'p', groups: ['pending'], enabled: true }, { username: 'h', groups: ['hosts'], enabled: true }] });
    }
    return ok({ questionSets: [], sets: [], games: [], prompts: [], items: [], count: 0, requests: [], members: [], invites: [], reports: [] });
  });
}

const navItem = (label) => within(screen.getByRole('navigation', { name: 'Sections' }))
  .getByRole('button', { name: new RegExp(`^${label}`) });

beforeEach(() => {
  localStorage.clear();
  mockGroups = ['admins', 'hosts'];
  window.history.pushState({}, '', '/admin');
});

test('inside an organisation, a bare /admin lands on its Overview, first in the nav', async () => {
  mockActiveOrg = TEAM.orgId;
  serve();
  render(<AdminPage />);
  await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Overview'));
  await waitFor(() => expect(document.querySelector('.adm-sub')).toHaveTextContent('Seib Tribe. What is waiting on you, and this month in numbers.'));
  const first = within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button')[0];
  expect(first).toHaveTextContent('Overview');
  expect(document.querySelector('.ovw')).not.toBeNull();
});

// rejects: two controls for "who am I right now"
test('the scope row is the only switcher: no organisation chip', async () => {
  mockActiveOrg = TEAM.orgId;
  serve();
  render(<AdminPage />);
  await screen.findByRole('navigation', { name: 'Where you work' });
  expect(screen.queryByTestId('orgsw-chip')).toBeNull();
});

test('the tabs carry GET /me/attention’s counts', async () => {
  mockActiveOrg = PERSONAL.orgId;
  serve({ attention: { scopes: { org_st: 4, '~platform': 6 }, invites: 0 } });
  render(<AdminPage />);
  const row = await screen.findByRole('navigation', { name: 'Where you work' });
  await waitFor(() => expect(within(row).getByRole('link', { name: /Seib Tribe/ })).toHaveTextContent('4'));
  expect(within(row).getByRole('link', { name: /Engage/ })).toHaveTextContent('6');
});

describe('platform mode', () => {
  test('lands on the Overview, under the acting-as banner', async () => {
    mockActiveOrg = PLATFORM_MODE;
    serve();
    render(<AdminPage />);
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Overview'));
    expect(screen.getByText(/You are acting as Engage/)).toBeInTheDocument();
  });

  // rejects: THE BADGE BUG — filled only by PlanRequestsPanel's onCountChange
  test('Plan requests carries its badge before Plan requests is opened', async () => {
    mockActiveOrg = PLATFORM_MODE;
    serve();
    render(<AdminPage />);
    await waitFor(() => expect(navItem('Plan requests')).toHaveTextContent('2'));
    expect(document.querySelector('.preq')).toBeNull();
  });

  test('Accounts carries a badge for the people waiting', async () => {
    mockActiveOrg = PLATFORM_MODE;
    serve();
    render(<AdminPage />);
    await waitFor(() => expect(navItem('Accounts').querySelector('.adm-nav-badge')).toHaveTextContent('1'));
  });

  test('a host never gets the badges’ reads', async () => {
    mockActiveOrg = PERSONAL.orgId;
    mockGroups = ['hosts'];
    serve();
    render(<AdminPage />);
    await screen.findByRole('navigation', { name: 'Where you work' });
    await waitFor(() => expect(document.querySelector('.ovw')).not.toBeNull());
    const asked = global.fetch.mock.calls.map(([u]) => String(u)).join(' ');
    expect(asked).not.toMatch(/admin\/users\/list|platform\/plan-requests/);
  });
});
