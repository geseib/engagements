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
import {
  render, screen, fireEvent, waitFor, within, act,
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
    /* A FUNCTION, not a boolean. UserManagement calls `isAdmin()`, and this
       suite is the first here to actually open Accounts — the other AdminPage
       suites mock it as `true` and never mount that screen, so the mismatch
       stayed invisible. */
    isAdmin: () => mockGroups.includes('admins'),
  }),
  AuthProvider: ({ children }) => children,
}));

/* EVENTS' OWN CALLS, mocked directly rather than through `serve`'s generic
   `global.fetch` stand-in — EventBuilder and EventsPanel both go through
   utils/eventsApi.js, and the race and wiring tests below need to control
   exactly when a `getEvent` resolves. `listEvents` defaults to an empty list
   in `beforeEach` so every OTHER test in this file (which never heard of
   this mock) keeps seeing the harmless empty state it already expected. */
jest.mock('../utils/eventsApi', () => ({
  listEvents: jest.fn(),
  getEvent: jest.fn(),
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
  updateItem: jest.fn(),
  reorderItems: jest.fn(),
  deleteEvent: jest.fn(),
}));
const eventsApi = require('../utils/eventsApi');

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
  Observability: '.pobs',
  Members: '.team',
  'Plan & usage': '.bill',
  'Data & privacy': '.privacy',
  'Public library': '.publib',
  // NOT plain '.evts': NewEventButton's head-action wrapper also carries
  // that class (`evts evts-headact`), so a bare '.evts' matches whether or
  // not the panel itself ever mounted — this excludes it (Fix round 1 #3).
  Events: '.evts:not(.evts-headact)',
};

/** Which of the known sections are currently in the document. */
function mounted() {
  return Object.entries(MARKERS)
    .filter(([, selector]) => document.querySelector(selector))
    .map(([name]) => name);
}

function serve(orgs = [HOME], features = undefined) {
  global.fetch = jest.fn(async (url) => (String(url).includes('/orgs')
    ? { ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs, ...(features ? { features } : {}) }) }
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
  // Harmless defaults for every test that never heard of the Events place —
  // a bare `.mockReset()` would leave these `undefined`, and EventsPanel's
  // `setEvents(await listEvents())` needs an array.
  eventsApi.listEvents.mockReset().mockResolvedValue([]);
  eventsApi.getEvent.mockReset();
  eventsApi.createEvent.mockReset();
  eventsApi.updateEvent.mockReset();
  eventsApi.addItem.mockReset();
  eventsApi.removeItem.mockReset();
  eventsApi.updateItem.mockReset();
  eventsApi.reorderItems.mockReset();
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
    // rejects: the fallback chain's subtitle. Organisations, Plan requests and
    // Discount codes were all headed with Question sets' sentence on test.
    expect(document.querySelector('.adm-sub')).toHaveTextContent(/Every organisation on this tier/);
    expect(document.querySelector('.adm-sub')).not.toHaveTextContent(/every session is built from/);
  });

  it.each([
    ['planrequests', /New organisations, and people asking for the Standard plan/],
    ['discountcodes', /redeemed by a team owner/],
  ])('%s is headed with its own sentence, not Question sets\'', async (id, sentence) => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', `/admin?section=${id}`);
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(document.querySelector('.adm-sub')).toHaveTextContent(sentence));
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

  // rejects: Observability unreachable, headed with another section's
  // sentence, or mounting beside Organisations (the landing section).
  it('opens Observability on its own, headed with its own sentence', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=observability');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Observability']));
    expect(document.querySelector('h1')).toHaveTextContent('Observability');
    expect(document.querySelector('.adm-sub')).toHaveTextContent(/Totals only/);
  });

  // rejects: a platform-only screen reachable from inside an organisation by URL.
  it('a URL naming Observability from inside an organisation does not open it', async () => {
    mockActiveOrg = HOME.orgId;
    window.history.pushState({}, '', '/admin?section=observability');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Question sets']));
  });

  // rejects: the Public library section being unreachable, or mounting
  // alongside another platform section (the exact bug this whole file exists
  // to catch, now for the fourth platform section to land).
  it('opens the Public library on its own', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=publiclibrary');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Public library']));
    expect(document.querySelector('h1')).toHaveTextContent('Public library');
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

  // rejects: the plan-request effect firing off `activeTab` (a fetch guard,
  // not a render gate — see its own comment) without checking onPlatform.
  // `?section=events` seeds `activeTab` with a real section id (Events is in
  // the global vocabulary, ALL_SECTION_IDS, even though platform mode has no
  // such section) — exactly what a staff member switching to platform view
  // FROM Events leaves behind. Without the guard this fetches
  // orgs/~platform/plan-requests, since activeOrgId is the literal string
  // PLATFORM_MODE and activeOrg is undefined (Fix round 2 #5).
  it('platform mode makes no plan-requests fetch, even with ?section=events left in the URL', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=events');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Organisations']));
    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes('/plan-requests'))).toBe(false);
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

describe('Events (roadmap M1), behind the switch', () => {
  const TEAM = {
    orgId: 'org_TEAMteamTEAMteamTEAMte', name: 'Northwind Traders', type: 'team', yourRole: 'owner', plan: 'team',
  };

  // rejects: Events mounting beside another section, or headed with another's sentence.
  it('switched on, ?section=events opens Events on its own, with New event in the head', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = TEAM.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([TEAM], { events: true });
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Events']));
    expect(document.querySelector('h1')).toHaveTextContent('Events');
    expect(document.querySelector('.adm-sub')).toHaveTextContent(/One join code for a whole agenda/);
    // The panel's OWN body, not just its scope class (Fix round 1 #3) — an
    // empty team org's list.
    expect(await screen.findByTestId('events-empty')).toBeInTheDocument();
    // Scoped to the work head: the empty state's own "New event" button lives
    // in the panel body and must not stand in for this one (Fix round 1 #3).
    expect(within(document.querySelector('.adm-head-actions')).getByRole('button', { name: /new event/i })).toBeInTheDocument();
  });

  // rejects: the switch being a nav decoration the URL can walk round.
  it('switched off, the same link falls back to one section', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = TEAM.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([TEAM]);
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Question sets']));
    expect(screen.queryByRole('button', { name: /^events$/i })).toBeNull();
  });

  it('a Personal space on Free gets the page that explains the Standard plan, and no New event', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = HOME.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([HOME], { events: true });
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(screen.getByTestId('events-team-only')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new event/i })).toBeNull();
  });
});

describe('Events: opening one, as a place (roadmap M1, Fix round 1)', () => {
  const TEAM = {
    orgId: 'org_TEAMteamTEAMteamTEAMte', name: 'Northwind Traders', type: 'team', yourRole: 'owner', plan: 'team',
  };
  const ROW_A = {
    code: 'AAAA', title: 'Event A', place: '', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0,
  };
  const ROW_B = {
    code: 'BBBB', title: 'Event B', place: '', startsAt: '2026-11-01T10:00', timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0,
  };
  const sectionsNav = () => within(screen.getByRole('navigation', { name: 'Sections' }));

  const openEventsSection = async (rows = [ROW_A]) => {
    mockGroups = ['hosts'];
    mockActiveOrg = TEAM.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([TEAM], { events: true });
    eventsApi.listEvents.mockResolvedValue(rows);
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(screen.getAllByTestId('event-row')).toHaveLength(rows.length));
  };

  const openRow = async (title) => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^open ${title}$`, 'i') }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent(title));
  };

  // Item 4: opening a row is a place, shaped like the set editor's.
  it('opening a row shows the ‹ Events breadcrumb, the title as h1, and no subtitle', async () => {
    eventsApi.getEvent.mockResolvedValue({ event: ROW_A, items: [] });
    await openEventsSection();
    await openRow('Event A');
    expect(document.querySelector('.adm-back')).toHaveTextContent('Events');
    expect(document.querySelector('.adm-sub')).toBeNull();
  });

  // Item 4: the breadcrumb closes the place.
  it('the ‹ Events breadcrumb closes the place, back to the list', async () => {
    eventsApi.getEvent.mockResolvedValue({ event: ROW_A, items: [] });
    await openEventsSection();
    await openRow('Event A');
    fireEvent.click(document.querySelector('.adm-back'));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Events'));
    expect(screen.getAllByTestId('event-row')).toHaveLength(1);
  });

  // Final review I1: a deleted event takes the host back to the list, which
  // is read again and no longer has it.
  it('deleting the event returns to the Events list, with the event gone', async () => {
    eventsApi.getEvent.mockResolvedValue({ event: ROW_A, items: [] });
    eventsApi.deleteEvent.mockResolvedValue({ deleted: 'AAAA' });
    await openEventsSection([ROW_A, ROW_B]);
    await openRow('Event A');
    eventsApi.listEvents.mockResolvedValue([ROW_B]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete event…' }));
    fireEvent.click(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Delete event' }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Events'));
    await waitFor(() => expect(screen.getAllByTestId('event-row')).toHaveLength(1));
    expect(screen.getByTestId('event-row')).toHaveTextContent('Event B');
    expect(eventsApi.deleteEvent).toHaveBeenCalledWith('AAAA');
  });

  // Item 4: handleNavigate (another section) closes the place.
  it('leaving for another section closes the place; returning shows the list, not the builder', async () => {
    eventsApi.getEvent.mockResolvedValue({ event: ROW_A, items: [] });
    await openEventsSection();
    await openRow('Event A');
    fireEvent.click(sectionsNav().getByRole('button', { name: /^question sets$/i }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Question sets'));
    fireEvent.click(sectionsNav().getByRole('button', { name: /^events$/i }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Events'));
    expect(screen.getAllByTestId('event-row')).toHaveLength(1);
  });

  // Item 4: popstate closes the place too (NOT A DEFECT: Back lands on the
  // section open before Events, the same as the set editor and score card).
  it('Back (a popstate) closes the place too', async () => {
    eventsApi.getEvent.mockResolvedValue({ event: ROW_A, items: [] });
    await openEventsSection(); // pushes '/admin?section=events' onto beforeEach's '/admin'
    await openRow('Event A');
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Question sets'));
    fireEvent.click(sectionsNav().getByRole('button', { name: /^events$/i }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Events'));
    expect(screen.getAllByTestId('event-row')).toHaveLength(1);
  });

  // Item 2 (minor): the New event dialog is a place-level control too — Back
  // must close it, and Forward must not reopen it.
  it('the New event dialog closes on Back, and does not reopen on Forward', async () => {
    await openEventsSection();
    fireEvent.click(within(document.querySelector('.adm-head-actions')).getByRole('button', { name: /new event/i }));
    expect(await screen.findByRole('heading', { name: 'New event', level: 2 })).toBeInTheDocument();
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Question sets'));
    expect(screen.queryByRole('heading', { name: 'New event', level: 2 })).toBeNull();
    await act(async () => { window.history.forward(); });
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Events'));
    expect(screen.queryByRole('heading', { name: 'New event', level: 2 })).toBeNull();
  });

  // Item 5 (ruling): the page reuses Billing's own request/state — wired
  // end to end from AdminPage, not just the component in isolation
  // (eventsPanel.test.jsx covers the component's own two states).
  it('a Personal space with a pending Standard-plan request shows it as pending, not a button', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = HOME.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/plan-requests')) {
        return {
          ok: true, status: 200, text: async () => '{}',
          json: async () => ({ requests: [{ status: 'requested', toPlan: 'standard', requestedAt: '2026-09-20T10:00:00Z', reqId: 'req_1' }] }),
        };
      }
      if (u.includes('/orgs')) {
        return {
          ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs: [HOME], features: { events: true } }),
        };
      }
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => ({ questionSets: [], sets: [], games: [], prompts: [], members: [], invites: [] }),
      };
    });
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(screen.getByTestId('events-team-only')).toBeInTheDocument());
    expect(await screen.findByTestId('preq-strip')).toHaveTextContent('Standard plan requested');
    expect(screen.queryByRole('button', { name: /request the standard plan/i })).toBeNull();
  });

  // Fix round 2 #4: proves the button actually opens AdminPage's real
  // PlanRequestDialog, not merely that a mock onRequestPlan callback fired
  // (eventsPanel.test.jsx already covers that in isolation).
  it('"Request the Standard plan" on Events opens the real PlanRequestDialog', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = HOME.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([HOME], { events: true });
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(screen.getByTestId('events-team-only')).toBeInTheDocument());
    // rejects: a person's own space offered a team plan (27 Sep 2026).
    fireEvent.click(screen.getByRole('button', { name: 'Request the Standard plan' }));
    expect(await screen.findByRole('heading', { name: 'Request the Standard plan', level: 2 })).toBeInTheDocument();
    expect(screen.getByTestId('preq-sum')).toBeInTheDocument();
  });

  // Item 1 (IMPORTANT): a slow load for a left-behind event must not rename
  // the one now open. open A (getEvent pending) -> back -> open B -> resolve
  // A late: B's title and B's agenda must be what is on screen.
  it('a slow load for a left-behind event cannot rename the one now open', async () => {
    let resolveA;
    const pendingA = new Promise((resolve) => { resolveA = resolve; });
    eventsApi.getEvent.mockImplementation((code) => (
      code === 'AAAA' ? pendingA : Promise.resolve({ event: ROW_B, items: [] })
    ));
    await openEventsSection([ROW_A, ROW_B]);

    fireEvent.click(screen.getByRole('button', { name: /^open event a$/i }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Event A'));

    fireEvent.click(document.querySelector('.adm-back'));
    await waitFor(() => expect(screen.getAllByTestId('event-row')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /^open event b$/i }));
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Event B'));
    expect(await screen.findByTestId('agenda-empty')).toBeInTheDocument();

    // A's load, abandoned when we went back, resolves only now — after B is
    // already open and showing.
    resolveA({ event: { ...ROW_A, title: 'Renamed by a stale load' }, items: [] });
    await act(async () => { await pendingA; });

    expect(document.querySelector('h1')).toHaveTextContent('Event B');
    expect(document.querySelector('h1')).not.toHaveTextContent('Renamed by a stale load');
    expect(screen.getByTestId('agenda-empty')).toBeInTheDocument();
  });
});
