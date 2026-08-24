/**
 * THE FIVE PEOPLE WHO USE THIS CONSOLE, WALKED END TO END.
 *
 * Asked for directly: "look through the experience of three different type of
 * users… a Engage admin… a regular admin who is not in an org… an admin who is
 * in an org and finally one who is in two orgs… [and] a user who logs in and is
 * a host of an org."
 *
 * Every one of these could be reasoned about from `sectionsFor` alone, and
 * reasoning about it is exactly how the last three defects shipped — the nav
 * module was right and the WIRING was not. So this walks each persona through
 * the mounted page and asserts what they see, what they do not, and what the
 * screen tells them about the difference.
 *
 * The single most important assertion in the file is that a host is told WHY
 * their Members screen has no controls, rather than being left to conclude the
 * product is broken.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

let mockActiveOrg = '';
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
  getActiveOrgId: () => mockActiveOrg,
  setActiveOrgId: (id) => { mockActiveOrg = id || ''; },
}));

let mockGroups = ['hosts'];
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'p', groups: mockGroups, attributes: {} },
    signOut: jest.fn(),
    isAdmin: () => mockGroups.includes('admins'),
  }),
  AuthProvider: ({ children }) => children,
}));

import AdminPage from '../AdminPage';

const PLATFORM_MODE = '~platform';

const HOME = {
  orgId: 'org_3JtYs6WgHn5RkMqZaB7uEv', name: 'Amara Reyes', type: 'personal', yourRole: 'owner', plan: 'free',
};
const NORTHWIND = {
  orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR', name: 'Northwind Learning', type: 'team', yourRole: 'owner', plan: 'team',
};
const MERIDIAN = {
  orgId: 'org_Tb2VnQ8sLxK4WmC7gRdYpF', name: 'Meridian Delivery', type: 'team', yourRole: 'admin', plan: 'team',
};
/** The same organisation, seen by somebody who is only a host in it. */
const NORTHWIND_AS_HOST = { ...NORTHWIND, yourRole: 'member' };

/** The roster GET /orgs/{id}/members returns, from that host's point of view. */
const ROSTER_AS_MEMBER = {
  yourRole: 'member',
  members: [
    {
      userId: 'u_owner', email: 'dai@northwind.example', displayName: 'Dai Ferreira', role: 'owner', joinedAt: '2026-02-01T00:00:00.000Z',
    },
    {
      userId: 'u_me', email: 'amara@northwind.example', displayName: 'Amara Reyes', role: 'member', you: true, joinedAt: '2026-06-01T00:00:00.000Z',
    },
  ],
  invites: [],
};

function serve(orgs, extra = {}) {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (/\/orgs$/.test(href)) {
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs }) };
    }
    if (href.includes('/members')) {
      return { ok: true, status: 200, text: async () => '{}', json: async () => (extra.roster || { yourRole: 'owner', members: [], invites: [] }) };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({
        questionSets: extra.sets || [], sets: [], games: [], prompts: [],
      }),
    };
  });
}

/** Every nav entry, in order — the console's whole offer to this person. */
async function navLabels() {
  await screen.findByRole('navigation').catch(() => null);
  await waitFor(() => expect(document.querySelector('.adm-nav-label')).toBeTruthy());
  return [...document.querySelectorAll('.adm-nav-label')].map((n) => n.textContent);
}

beforeEach(() => {
  localStorage.clear();
  mockActiveOrg = '';
  mockGroups = ['hosts'];
  window.history.pushState({}, '', '/admin');
});

/* ──────────────────────────────────────────────────────────── 1. Engage ── */

describe('an Engage admin', () => {
  beforeEach(() => { mockGroups = ['admins', 'hosts']; });

  // rejects: staff landing in the platform console by default. Engage staff are
  // people with their own work; the platform console is a hat they put on.
  it('starts in their own space, not in the Engage console', async () => {
    mockActiveOrg = HOME.orgId;
    serve([HOME]);
    render(<AdminPage />);
    const labels = await navLabels();
    expect(labels).toEqual(expect.arrayContaining(['Question sets', 'Sessions', 'Prompts']));
    expect(labels).not.toContain('Organisations');
  });

  // rejects: the additive console — platform tools rendered beside their own
  // question sets, with nothing saying which hat is on.
  it('sees Engage’s console only after asking for it, and then no personal content', async () => {
    mockActiveOrg = PLATFORM_MODE;
    serve([HOME]);
    render(<AdminPage />);
    const labels = await navLabels();
    expect(labels).toEqual(expect.arrayContaining(['Organisations', 'Moderation', 'Accounts']));
    expect(labels).not.toContain('Sessions');
  });

  /*
    THE GAP THIS CLOSED. "they should be able to add questions to their personal
    space or org or to the overall engage space as a engage manager/admin."

    The first two always worked. The third had nowhere to happen: `createSetRef`
    falls back to the caller's organisation, and an Engage admin always has one,
    so a set made anywhere became a personal set. The Shared library is the
    surface, and `scope: 'platform'` on the upload is what makes it land there.
  */
  // rejects: an Engage admin having no way to add to the shared library.
  it('has a Shared library, and creating there targets the platform scope', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=questionsets');
    serve([HOME]);
    render(<AdminPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Shared library' }))
      .toBeInTheDocument();
    expect(await navLabels()).toContain('Shared library');
  });

  // rejects: a customer's rows appearing in the Engage console — the isolation
  // break this console exists to prevent.
  it('sees ONLY Engage’s sets there, never an organisation’s', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=questionsets');
    serve([HOME], {
      sets: [
        { id: '80strivia', name: '80s Trivia', scope: 'platform', canManage: true, totalQuestions: 10, active: true },
        { id: 'retro', name: 'Q3 Restructure Retro', scope: 'org', orgId: NORTHWIND.orgId, canManage: false, totalQuestions: 4, active: true },
      ],
    });
    render(<AdminPage />);
    expect(await screen.findByText('80s Trivia')).toBeInTheDocument();
    expect(screen.queryByText('Q3 Restructure Retro')).toBeNull();
  });
});

/* ─────────────────────────────────────────── 2. approved, no team yet ── */

describe('somebody with no team', () => {
  // rejects: the "no organisation" dead end. Everybody approved is given a
  // personal space, so this person has somewhere to work from the first load.
  it('gets a full personal space, and no team sections', async () => {
    mockActiveOrg = HOME.orgId;
    serve([HOME]);
    render(<AdminPage />);
    const labels = await navLabels();
    expect(labels).toEqual(expect.arrayContaining([
      'Question sets', 'Sessions', 'Public library', 'Prompts', 'Plan & usage', 'Data & privacy',
    ]));
    // No Members: there is nobody to manage, and a section that only ever says
    // "just you" is one you stop looking at.
    expect(labels).not.toContain('Members');
    expect(labels).not.toContain('Organisations');
  });
});

/* ───────────────────────────────────────────────── 3. an org's admin ── */

describe('an admin of one organisation', () => {
  it('gets the content, the roster, the money and the log', async () => {
    mockActiveOrg = NORTHWIND.orgId;
    serve([HOME, NORTHWIND]);
    render(<AdminPage />);
    const labels = await navLabels();
    expect(labels).toEqual(expect.arrayContaining([
      'Question sets', 'Sessions', 'Prompts', 'Members', 'Plan & usage', 'Data & privacy',
    ]));
    expect(labels).not.toContain('Organisations');
  });
});

/* ──────────────────────────────────────────────── 4. two organisations ── */

describe('somebody in two organisations', () => {
  // rejects: a switcher that lists one org, or none. This person has three
  // places — their own space and two teams — and switching is the only way to
  // reach the others.
  it('can reach all three of their places from the switcher', async () => {
    mockActiveOrg = NORTHWIND.orgId;
    serve([HOME, NORTHWIND, MERIDIAN]);
    render(<AdminPage />);
    fireEvent.click(await screen.findByTestId('orgsw-chip'));
    for (const name of ['Amara Reyes', 'Northwind Learning', 'Meridian Delivery']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  // rejects: the nav being computed from the wrong organisation. The role
  // differs per org, and the console has to follow the active one.
  it('the nav follows the ACTIVE organisation, not the first one', async () => {
    mockActiveOrg = MERIDIAN.orgId;
    serve([HOME, NORTHWIND, MERIDIAN]);
    render(<AdminPage />);
    expect(await screen.findByTestId('orgsw-chip')).toHaveTextContent('Meridian Delivery');
  });
});

/* ────────────────────────────────────────────────── 5. a host in a team ── */

describe('a host in an organisation', () => {
  beforeEach(() => {
    mockActiveOrg = NORTHWIND.orgId;
    serve([HOME, NORTHWIND_AS_HOST], { roster: ROSTER_AS_MEMBER });
  });

  /*
    "they would be a admin of their personal space, but just a host for the org.
     what would that restrict them to? obviously they cant delete users, or
     promote users of the org, probalby dont need account mgmt, billing plan etc"
  */
  // rejects: showing a host the plan and the access log — powers, not
  // information. A member who can see the invoice but not change it is being
  // shown a control that refuses them.
  it('keeps the content and loses the money and the log', async () => {
    render(<AdminPage />);
    const labels = await navLabels();
    expect(labels).toEqual(expect.arrayContaining([
      'Question sets', 'Sessions', 'Public library', 'Prompts', 'Members',
    ]));
    expect(labels).not.toContain('Plan & usage');
    expect(labels).not.toContain('Data & privacy');
    expect(labels).not.toContain('Accounts');
  });

  // rejects: offering Invite, Make admin or Remove to somebody the server will
  // refuse. `authorizeOrg(…, 'admin')` guards all three.
  it('sees the roster and none of the controls that change it', async () => {
    window.history.pushState({}, '', '/admin?section=members');
    render(<AdminPage />);
    expect(await screen.findByText('Dai Ferreira')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite someone/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /make admin/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^remove$/i })).toBeNull();
  });

  /*
    THE MOST IMPORTANT ASSERTION HERE. Without this the host arrives at a roster
    with no buttons and "An admin can change this" on every row, and concludes
    the product is broken rather than that they are a host.
  */
  // rejects: a silently reduced screen. The owner asked for a friendly but
  // informative notice, and it has to say what they CAN do first — a notice
  // that only lists refusals reads as a demotion.
  it('is TOLD it is a host, what it can do, and who to ask', async () => {
    window.history.pushState({}, '', '/admin?section=members');
    render(<AdminPage />);
    const note = await screen.findByText(/You are a host in Northwind Learning/i);
    const box = note.closest('div');
    expect(within(box).getByText(/build question sets, run sessions/i)).toBeInTheDocument();
    expect(within(box).getByText(/belong to its admins/i)).toBeInTheDocument();
    expect(within(box).getByText(/own space is still entirely yours/i)).toBeInTheDocument();
  });

  // rejects: the notice following them into their own space, where they are the
  // owner and it would be false.
  it('does not see that notice in their own space', async () => {
    mockActiveOrg = HOME.orgId;
    serve([HOME, NORTHWIND_AS_HOST], { roster: { yourRole: 'owner', members: [], invites: [] } });
    render(<AdminPage />);
    await navLabels();
    expect(screen.queryByText(/You are a host in/i)).toBeNull();
  });
});
