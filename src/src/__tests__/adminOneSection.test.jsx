/**
 * EXACTLY ONE SECTION IS ON SCREEN AT A TIME.
 *
 * ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
 *
 * Reported from dev, and it reads as nonsense until you see the cause:
 *
 *   "clicking it goes to the Organizations menu item, but lists question sets"
 *   "i go to another item like moderation or Accounts and come back to
 *    organizations [and] the list is back to orgs"
 *
 * The console has TWO ideas of which section is open and they were wired to
 * different renderers:
 *
 *   activeTab   — what the person asked for, straight from the URL or the click
 *   resolvedTab — what they can actually be shown, after falling back when the
 *                 asked-for section is not in THIS account's nav
 *
 * The nav highlight, the heading and the four tenancy panels used `resolvedTab`.
 * Every older section — Question sets, Sessions, Prompts, Archive, Accounts,
 * Settings — still used `activeTab`. When the two disagree, BOTH branches are
 * true and BOTH panels mount: the head says Organisations, and Question sets
 * renders underneath it because it comes first in the file.
 *
 * The disagreement is not exotic; it is the normal state for Engage staff.
 * `activeTab` starts at the constant `questionsets`, and in platform mode that
 * is not a visible section, so `resolvedTab` is `orgs` from the first paint.
 *
 * ── WHY A TEST AND NOT A NOTE ──────────────────────────────────────────────
 *
 * There is no type, lint rule or build step that can see it: both variables are
 * strings in scope, and using the wrong one is a working program that renders
 * two screens. The only way to catch it is to mount the page and count.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
    /* A FUNCTION, not a boolean. UserManagement calls `isAdmin()`, and this
       suite is the first here to actually open Accounts — the other AdminPage
       suites mock it as `true` and never mount that screen, so the mismatch
       stayed invisible. */
    isAdmin: () => mockGroups.includes('admins'),
  }),
  AuthProvider: ({ children }) => children,
}));

import AdminPage from '../AdminPage';

const PLATFORM_MODE = '~platform';
const HOME = {
  orgId: 'org_WLZyeb6wGSarf1grsXGxSM', name: 'George Seib', type: 'personal', yourRole: 'owner',
};

/**
 * One marker per section, chosen to be the panel's own root rather than any
 * text — text moves, and a scope class is the thing that proves a whole screen
 * mounted.
 */
const MARKERS = {
  'Question sets': '.qsets',
  Organisations: '.porgs',
  Members: '.team',
  'Plan & usage': '.bill',
  'Data & privacy': '.privacy',
};

/** Which of the known sections are currently in the document. */
function mounted() {
  return Object.entries(MARKERS)
    .filter(([, selector]) => document.querySelector(selector))
    .map(([name]) => name);
}

function serve(orgs = [HOME]) {
  global.fetch = jest.fn(async (url) => (String(url).includes('/orgs')
    ? { ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs }) }
    : {
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({
        questionSets: [], sets: [], games: [], prompts: [], members: [], invites: [],
      }),
    }));
}

const settle = () => waitFor(() => expect(document.querySelector('h1')).toBeTruthy());

beforeEach(() => {
  localStorage.clear();
  mockActiveOrg = '';
  mockGroups = ['admins', 'hosts'];
  window.history.pushState({}, '', '/admin');
});

describe('platform mode', () => {
  /*
    THE EXACT REPORTED STATE. Engage staff, switcher on Engage, and `activeTab`
    still holding its initial constant `questionsets` — which platform mode does
    not have, so `resolvedTab` is `orgs`.
  */
  /*
    A bare /admin means "wherever I start", which is Organisations here — not
    the constant `questionsets` that `activeTab` initialises to.
  */
  // rejects: the mixed gating. Before the fix a disagreement mounted BOTH
  // .qsets and .porgs, with the head saying one and the body showing the other.
  it('shows exactly one section, and the head names it', async () => {
    mockActiveOrg = PLATFORM_MODE;
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Organisations']));
    expect(document.querySelector('h1')).toHaveTextContent('Organisations');
  });

  // rejects: the Shared library being unreachable, or mounting a customer's
  // rows beside it. It is Engage's OWN library and the one content section this
  // console has.
  it('opens Engage’s shared library on its own', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=questionsets');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Question sets']));
    expect(document.querySelector('h1')).toHaveTextContent('Shared library');
  });

  /* `games` rather than `billing`: Sessions is a section platform mode does not
     have, so it exercises the fallback — and it is one the URL parser actually
     recognises, which is the difference that matters. */
  // rejects: a section that platform mode does not have mounting alongside the
  // one it fell back to.
  it('falls back to ONE section when the URL names one it does not have', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=games');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Organisations']));
    expect(document.querySelector('h1')).toHaveTextContent('Organisations');
  });

  // rejects: the heading and the body describing different screens — the state
  // that makes the console feel broken rather than merely wrong.
  it('never disagrees with its own heading', async () => {
    mockActiveOrg = PLATFORM_MODE;
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toHaveLength(1));

    fireEvent.click(await screen.findByRole('button', { name: /^accounts$/i }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Accounts'));
    // Accounts has no marker of its own here; what matters is that no OTHER
    // section came along with it.
    expect(mounted()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /^organisations$/i }));
    await waitFor(() => expect(mounted()).toEqual(['Organisations']));
  });
});

describe('inside an organisation', () => {
  // rejects: the same fault in the other direction — a deep link to a platform
  // section from an org context mounting the org's content underneath it.
  it('a URL naming a platform section falls back to ONE section', async () => {
    mockActiveOrg = HOME.orgId;
    window.history.pushState({}, '', '/admin?section=orgs');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Question sets']));
    expect(document.querySelector('h1')).toHaveTextContent('Question sets');
  });

  // rejects: a section rendering for an account that cannot address it, which
  // is the same defect with a security-shaped consequence rather than a
  // cosmetic one.
  it('a host asking for the platform console gets their own content, only', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = PLATFORM_MODE;
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Question sets']));
  });
});
