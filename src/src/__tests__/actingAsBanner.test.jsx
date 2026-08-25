/**
 * NAMING A MODE THAT IS OTHERWISE INVISIBLE.
 *
 * Platform mode is exclusive AND sticky: it is remembered in localStorage, so
 * somebody who tried it once opens the console days later to four sections none
 * of which are theirs. Reported from dev in exactly those terms — "I also dont
 * see anyway to get to question sets or prompts, sessions etc." The exit was
 * one click away in a chip they had never used, which is not an exit.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ActingAsBanner from '../components/ActingAsBanner';

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

const PLATFORM_MODE = '~platform';
const HOME = {
  orgId: 'org_WLZyeb6wGSarf1grsXGxSM', name: 'George Seib', type: 'personal', yourRole: 'owner',
};

describe('the banner on its own', () => {
  // rejects: "Leave platform mode", which names the thing you are stopping
  // rather than the place you are going. The destination is the useful half.
  it('names where the exit goes', () => {
    render(<ActingAsBanner orgName="George Seib" onLeave={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Go to George Seib' })).toBeInTheDocument();
  });

  // rejects: an exit that goes nowhere for an account with no organisation.
  it('offers no exit when there is nowhere to go', () => {
    render(<ActingAsBanner orgName="" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  // rejects: dropping the sentence that explains WHY there are no question
  // sets here, which is the actual question being asked.
  it('says the console holds no content, which is why none is on screen', () => {
    render(<ActingAsBanner orgName="X" onLeave={jest.fn()} />);
    expect(screen.getByText(/holds no\s+question sets or sessions/i)).toBeInTheDocument();
  });
});

describe('in the console', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGroups = ['admins', 'hosts'];
    window.history.pushState({}, '', '/admin');
    global.fetch = jest.fn(async (url) => (String(url).includes('/orgs')
      ? { ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs: [HOME] }) }
      : {
        ok: true,
        status: 200,
        text: async () => '{}',
        json: async () => ({ questionSets: [], sets: [], games: [], prompts: [] }),
      }));
  });

  // rejects: showing the strip only on Organisations. The trap is the MODE, and
  // it is just as confusing while looking at Accounts.
  it('appears on the platform sections', async () => {
    mockActiveOrg = PLATFORM_MODE;
    render(<AdminPage />);
    expect(await screen.findByText(/acting as Engage/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^accounts$/i }));
    await waitFor(() => expect(screen.getByText(/acting as Engage/i)).toBeInTheDocument());
  });

  // rejects: a standing banner on every screen. Inside an organisation there is
  // no mode to explain, and a permanent notice is one nobody reads.
  it('is absent inside an organisation', async () => {
    mockActiveOrg = HOME.orgId;
    render(<AdminPage />);
    await screen.findByRole('button', { name: /^question sets$/i });
    expect(screen.queryByText(/acting as Engage/i)).toBeNull();
  });

  /*
    Asserts the SELECTION, not the reload.

    `handleSwitchOrg` writes the org and then calls `window.location.reload()` —
    deliberately, because every panel has already fetched its own org's content
    and a soft switch would leave one team's rows under another team's name.
    That reload cannot be asserted here: this jsdom does not allow
    `window.location` to be replaced, so the stub silently does not take and the
    assertion fails while the code is correct. Spreading the real Location is
    worse still — it throws "'toString' called on an object that is not a valid
    instance of Location", which reads as a component bug.

    What matters and IS observable is that pressing the exit leaves platform
    mode for the right organisation.
  */
  // rejects: an exit that does not actually switch — the trap staying shut.
  it('the exit selects the personal space', async () => {
    mockActiveOrg = PLATFORM_MODE;
    render(<AdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Go to George Seib/ }));
    expect(mockActiveOrg).toBe(HOME.orgId);
  });
});
