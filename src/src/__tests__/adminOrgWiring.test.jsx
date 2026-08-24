/**
 * THE CONSOLE'S ORG WIRING, MOUNTED.
 *
 * `consoleSections` is pure and well covered, and every defect this file exists
 * for still shipped, because each one lives in the wiring BETWEEN that module
 * and the page:
 *
 *   1. `<OrgSwitcher orgs={…} onSwitch={…} />` — the component's props are
 *      `organisations` and `onSelect`. React says nothing about a prop that
 *      simply is not there, so the switcher took its "nothing to name" branch
 *      and rendered NOTHING. There was no way to change organisation, and once
 *      the platform links became a mode, no way to reach the platform console.
 *   2. `activeOrg.role` — `GET /orgs` answers with `yourRole`. Every team owner
 *      was rendered the member nav.
 *
 * Both are invisible to a pure-module test and to a green build. Only mounting
 * the page and looking finds them.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    currentUser: { username: 'staff', groups: mockGroups, attributes: {} },
    signOut: jest.fn(),
    isAdmin: true,
  }),
  AuthProvider: ({ children }) => children,
}));

import AdminPage from '../AdminPage';

const PERSONAL = {
  orgId: 'org_home', name: 'Amara Reyes', type: 'personal', yourRole: 'owner', plan: 'free',
};
const TEAM = {
  orgId: 'org_nw', name: 'Northwind', type: 'team', yourRole: 'owner', plan: 'team',
};

function serve(orgs) {
  global.fetch = jest.fn(async (url) => (String(url).includes('/orgs')
    ? { ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs }) }
    : {
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({ questionSets: [], sets: [], games: [], prompts: [] }),
    }));
}

beforeEach(() => {
  localStorage.clear();
  mockActiveOrg = '';
  mockGroups = ['admins', 'hosts'];
  window.history.pushState({}, '', '/admin');
});

describe('the organisation switcher', () => {
  /*
    A HOST, NOT STAFF — and that is what makes this bite.

    Written first with the default (staff) caller, where it passed against the
    shipped bug: `platform` is true for staff, and the chip renders from that
    branch whether or not any organisation arrived. The list is the only thing
    holding the chip up for an ordinary host, so this is the caller that can
    tell "the orgs got through" from "the component found something else to
    draw". A test that cannot fail is worse than no test, and this one could
    not until the caller changed.
  */
  // rejects: THE PROP-NAME BUG. This is the whole test: is it on the page.
  it('is actually rendered, for a host with no platform chip to fall back on', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = 'org_nw';
    serve([PERSONAL, TEAM]);
    render(<AdminPage />);
    expect(await screen.findByTestId('orgsw-chip')).toHaveTextContent('Northwind');
  });

  // rejects: passing the orgs under a name the component ignores, which shows
  // up as a chip naming the wrong org — or, as shipped, no chip at all.
  it('names the active organisation', async () => {
    mockActiveOrg = 'org_nw';
    serve([PERSONAL, TEAM]);
    render(<AdminPage />);
    expect(await screen.findByTestId('orgsw-chip')).toHaveTextContent('Northwind');
  });
});

describe('a team owner', () => {
  // rejects: READING `role` INSTEAD OF `yourRole`. Reported from dev as the nav
  // losing most of its entries between one visit and the next.
  it('gets Plan & usage and Data & privacy, not the member nav', async () => {
    mockActiveOrg = 'org_nw';
    mockGroups = ['hosts'];
    serve([TEAM]);
    render(<AdminPage />);
    expect(await screen.findByRole('button', { name: /Plan & usage/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Data & privacy/ })).toBeInTheDocument();
  });
});

describe('platform mode', () => {
  // rejects: an Engage admin seeing platform links stacked beside their own
  // question sets, with nothing saying which hat is on.
  it('is not entered by default, even for staff', async () => {
    serve([PERSONAL]);
    render(<AdminPage />);
    expect(await screen.findByRole('button', { name: /Question sets/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Organisations/ })).toBeNull();
  });

  // rejects: a remembered mode being reconciled away as "not a member of that
  // org", which would drop the console out of the mode one page after entering
  // it and read as the switcher being broken.
  it('survives a reload, and then shows only the platform sections', async () => {
    mockActiveOrg = PLATFORM_MODE;
    serve([PERSONAL]);
    render(<AdminPage />);
    expect(await screen.findByRole('button', { name: /Organisations/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Moderation/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Question sets/ })).toBeNull());
  });

  // rejects: a stored mode granting the platform console to an account that has
  // since lost the group. The mode is a view; the group is the permission.
  it('is ignored for an account that is no longer staff', async () => {
    mockActiveOrg = PLATFORM_MODE;
    mockGroups = ['hosts'];
    serve([PERSONAL]);
    render(<AdminPage />);
    expect(await screen.findByRole('button', { name: /Question sets/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Organisations/ })).toBeNull();
  });
});
