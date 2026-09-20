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

const HOME = {
  orgId: 'org_WLZyeb6wGSarf1grsXGxSM', name: 'George Seib', type: 'personal', yourRole: 'owner',
};

const SETS = {
  questionSets: [
    {
      id: 'safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, canManage: true, scope: 'org', activeVersion: 2, share: { status: 'flagged', version: 2, at: '2026-08-19T10:00:00.000Z' },
    },
    {
      id: 'clean', name: 'Clean one', engagementType: 'trivia', totalQuestions: 5, canManage: true, scope: 'org', activeVersion: 1,
    },
  ],
};

/*
  A LIBRARY WITH SOMETHING IN IT — and the reason it has to exist.

  `SETS` carries no `scope: 'public'` row, and PublicLibraryPanel answers an
  empty library with its own one-line empty state instead of mounting
  QuestionSetsPanel at all. So every assertion about a control that lives on
  that table — the header's "New set" — passes for the wrong reason against
  that fixture: the table is not there to carry a button either way. A negative
  assertion whose subject never rendered is not a test.
*/
const SETS_WITH_PUBLIC = {
  questionSets: [
    ...SETS.questionSets,
    {
      id: 'orgacme-published', name: 'Somebody else’s published set', engagementType: 'trivia', totalQuestions: 12, canManage: false, scope: 'public', activeVersion: 1, sourceOrgName: 'Acme',
    },
  ],
};

/** Routes GET …/orgs (and …platform/orgs, which also ends in "/orgs") to the
 *  one-org fixture, GET admin/question-sets to `sets`, and everything else
 *  (prompts, personas, appeal/check POSTs nothing here exercises) to `{}`. */
function serve(sets = SETS) {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.includes('/orgs')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs: [HOME] }),
      };
    }
    if (u.includes('admin/question-sets')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => sets,
      };
    }
    return {
      ok: true, status: 200, text: async () => '{}', json: async () => ({}),
    };
  });
}

beforeEach(() => {
  localStorage.clear();
  mockActiveOrg = '';
  mockGroups = ['admins', 'hosts'];
  window.history.pushState({}, '', '/admin');
});

test('an org console shows who can see each set, badges the flagged count, and Share opens the dialog', async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  serve();
  render(<AdminPage />);
  expect(await screen.findByRole('columnheader', { name: /who can see it/i })).toBeInTheDocument();
  expect(screen.getByText('Needs changes')).toBeInTheDocument();
  // AdminShell always renders two <nav> landmarks (the ever-present, usually
  // empty breadcrumb rail plus this one) — named, so this resolves to the
  // section rail the badge actually renders into rather than throwing on the
  // ambiguity between them.
  const nav = screen.getByRole('navigation', { name: /sections/i });
  expect(within(nav).getByText('1')).toHaveClass('adm-nav-badge');
  const row = screen.getByText('Clean one').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^share$/i }));
  expect(await screen.findByRole('heading', { name: /share “Clean one” publicly/i })).toBeInTheDocument();
});

test('the platform console has neither the column nor Share', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serve();
  render(<AdminPage />);
  await screen.findByRole('table');
  expect(screen.queryByRole('columnheader', { name: /who can see it/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /^share$/i })).toBeNull();
});

/**
 * A version whose review flagged one question — normalizeVersions() shape
 * (utils/questionSetEditing.js), the payload GET admin/question-sets/safety/
 * versions answers with. Drives components/SetReviewBanner.jsx's flagged
 * branch (role="status") when the editor opens on "safety".
 */
const VERSIONS_SAFETY = [
  {
    version: 2,
    isActive: true,
    review: 'flagged',
    reviewFindings: [{
      questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'Injuries in detail.',
    }],
    published: null,
    unfinished: false,
    reasons: [],
    questionCount: 30,
    pinnedByGames: [],
  },
  {
    version: 1,
    isActive: false,
    review: 'passed',
    reviewFindings: [],
    published: null,
    unfinished: false,
    reasons: [],
    questionCount: 28,
    pinnedByGames: [],
  },
];

/**
 * Important #5: ShareSetDialog.jsx:104 gates the "Published without your
 * Workie" note on `set.promptScope !== 'platform'`, but nothing ever sent
 * `promptScope` — get-question-sets.js projects `promptId` only. So the note
 * fired for EVERY set with a prompt, including one already on a platform
 * Workie, which spec §4.1 says must be right. AdminPage already holds
 * `availablePrompts` with each prompt's own `scope`; it must look the caller's
 * promptId up there before handing the set to the dialog.
 */
const SETS_WITH_PROMPTS = {
  questionSets: [
    {
      id: 'onplat', name: 'On a platform Workie', engagementType: 'trivia', totalQuestions: 5, canManage: true, scope: 'org', activeVersion: 1, promptId: 'p-plat',
    },
    {
      id: 'onorg', name: 'On an org Workie', engagementType: 'trivia', totalQuestions: 5, canManage: true, scope: 'org', activeVersion: 1, promptId: 'p-org',
    },
  ],
};
const PROMPTS = {
  prompts: [
    { promptId: 'p-plat', scope: 'platform', status: 'active', name: 'House coach' },
    { promptId: 'p-org', scope: 'org', status: 'active', name: 'Acme coach' },
  ],
};

test("the Workie note in the share dialog reflects the prompt's own scope, not merely its presence", async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.includes('admin/ai-prompts')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => PROMPTS,
      };
    }
    if (u.includes('admin/question-sets')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => SETS_WITH_PROMPTS,
      };
    }
    if (u.includes('/orgs')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs: [HOME] }),
      };
    }
    return {
      ok: true, status: 200, text: async () => '{}', json: async () => ({}),
    };
  });
  render(<AdminPage />);
  await screen.findByRole('columnheader', { name: /who can see it/i });

  const platRow = screen.getByText('On a platform Workie').closest('tr');
  fireEvent.click(within(platRow).getByRole('button', { name: /^share$/i }));
  await screen.findByRole('heading', { name: /share “On a platform Workie” publicly/i });
  expect(screen.queryByText(/published without your workie/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  const orgRow = screen.getByText('On an org Workie').closest('tr');
  fireEvent.click(within(orgRow).getByRole('button', { name: /^share$/i }));
  await screen.findByRole('heading', { name: /share “On an org Workie” publicly/i });
  expect(screen.getByText(/published without your workie/i)).toBeInTheDocument();
});

test('a rejected appeal still notices and refreshes the list', async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  let listCalls = 0;
  global.fetch = jest.fn(async (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    // The appeal itself: authFetch REJECTS (offline/DNS/CORS), not a !ok response.
    if (u.includes('question-sets/safety/appeal') && method === 'POST') {
      throw new Error('Network down');
    }
    if (u.includes('question-sets/safety/versions')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => VERSIONS_SAFETY,
      };
    }
    if (u.includes('question-sets/safety/questions') || u.includes('question-sets/clean/questions')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => [],
      };
    }
    if (u.includes('admin/question-sets')) {
      listCalls += 1;
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => SETS,
      };
    }
    if (u.includes('/orgs')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs: [HOME] }),
      };
    }
    return {
      ok: true, status: 200, text: async () => '{}', json: async () => ({}),
    };
  });

  render(<AdminPage />);
  await screen.findByRole('columnheader', { name: /who can see it/i });
  const callsBeforeAppeal = listCalls;

  const row = screen.getByText('Safety walkthrough').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^edit$/i }));

  // The needs-changes banner (components/SetReviewBanner.jsx) — its own
  // role="status" section, present once the flagged version 2 loads.
  await screen.findByRole('status');
  fireEvent.click(screen.getByRole('button', { name: /ask for a human review/i }));
  fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

  expect(await screen.findByText(/could not send that for review: network down/i)).toBeInTheDocument();
  await waitFor(() => expect(listCalls).toBeGreaterThan(callsBeforeAppeal));
});

// UPDATED FOR TASK 12: the Public library section is no longer Stage 2's
// placeholder — this exact test used to assert that placeholder's copy
// ("every set you own has a Share button"), which Task 12 replaces with the
// real PublicLibraryPanel. This fixture's SETS carry no `scope: 'public'`
// row, so the honest thing on screen now is the panel's own empty state, not
// the retired "is not built" copy this test was originally written against.
test('the Public library section renders the real panel, not the retired placeholder', async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  serve();
  render(<AdminPage />);
  await screen.findByRole('columnheader', { name: /who can see it/i });
  const nav = screen.getByRole('navigation', { name: /sections/i });
  fireEvent.click(within(nav).getByText('Public library'));
  await screen.findByRole('heading', { level: 1, name: /public library/i });
  expect(screen.queryByText(/every set you own has a Share button/i)).toBeNull();
  expect(screen.queryByText(/is not built/i)).toBeNull();
  expect(await screen.findByText(/nobody has published a set yet/i)).toBeInTheDocument();
});

/*
  THE WAY IN, END TO END. The owner reported the Public library's "New set"
  button as doing nothing; it was QuestionSetsPanel's header button with no
  `onCreate` behind it. What replaces it has to reach the SAME dialog the
  question sets list's Share row action reaches, or it is a second share —
  which is the one thing the change is not allowed to be. Only a full AdminPage
  mount can show that, because the wiring is this page's.
*/
test('Share a set in the Public library opens the same share dialog the list row action opens', async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  serve();
  render(<AdminPage />);
  await screen.findByRole('columnheader', { name: /who can see it/i });
  const nav = screen.getByRole('navigation', { name: /sections/i });
  fireEvent.click(within(nav).getByText('Public library'));
  await screen.findByRole('heading', { level: 1, name: /public library/i });

  fireEvent.click(await screen.findByRole('button', { name: /share a set/i }));
  const picker = await screen.findByRole('dialog');
  const row = within(picker).getByText('Clean one').closest('li');
  fireEvent.click(within(row).getByRole('button', { name: /^share$/i }));

  expect(await screen.findByRole('heading', { name: /share “Clean one” publicly/i })).toBeInTheDocument();
  // One dialog, not two: the picker closed as the share dialog arrived.
  expect(screen.queryByRole('heading', { name: /which set do you want to share/i })).toBeNull();
});

/*
  THE LIBRARY HAS TO HAVE A ROW IN IT, or this test cannot fail.

  The dead button was QuestionSetsPanel's header, and this panel only mounts
  that table once there is a public row to put in it — with `SETS` (no public
  row) the panel renders "Nobody has published a set yet" and the table, the
  header and the button are all absent no matter what the component does. The
  fixture below puts a row in the library, and the first assertion states that
  the table really is on screen, so the two that follow are about a control
  that had somewhere to render.
*/
test('and the staff console has no way in there either, because Engage publishes nothing', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serve(SETS_WITH_PUBLIC);
  render(<AdminPage />);
  await screen.findByRole('table');
  const nav = screen.getByRole('navigation', { name: /sections/i });
  fireEvent.click(within(nav).getByText('Public library'));
  await screen.findByRole('heading', { level: 1, name: /public library/i });
  // The table this button would sit on top of is mounted and populated.
  expect(await screen.findByText('Somebody else’s published set')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /share a set/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /new set/i })).toBeNull();
});

/*
  AND THE ORG CONSOLE'S LIBRARY, which has the same table and the same absence
  of a creation path — the console the owner was actually looking at. "Share a
  set" is the way in here; "New set" was the button that did nothing.
*/
test("the org console's Public library has the Share a set way in and no New set button, with rows on screen", async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  serve(SETS_WITH_PUBLIC);
  render(<AdminPage />);
  await screen.findByRole('columnheader', { name: /who can see it/i });
  const nav = screen.getByRole('navigation', { name: /sections/i });
  fireEvent.click(within(nav).getByText('Public library'));
  await screen.findByRole('heading', { level: 1, name: /public library/i });
  expect(await screen.findByText('Somebody else’s published set')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /share a set/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /new set/i })).toBeNull();
});
