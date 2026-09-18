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

/** Routes GET …/orgs (and …platform/orgs, which also ends in "/orgs") to the
 *  one-org fixture, GET admin/question-sets to SETS, and everything else
 *  (prompts, personas, appeal/check POSTs nothing here exercises) to `{}`. */
function serve() {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.includes('/orgs')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs: [HOME] }),
      };
    }
    if (u.includes('admin/question-sets')) {
      return {
        ok: true, status: 200, text: async () => '{}', json: async () => SETS,
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

// The Public library section is still Stage 2's placeholder — but its old copy
// said the sharing pipeline "is not built", which sent the owner looking here
// for a Share control that lives on the Question sets rows. The placeholder
// must point at where sharing IS, and never claim the pipeline is absent.
test('the Public library placeholder points at Share on the Question sets rows', async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  serve();
  render(<AdminPage />);
  await screen.findByRole('columnheader', { name: /who can see it/i });
  const nav = screen.getByRole('navigation', { name: /sections/i });
  fireEvent.click(within(nav).getByText('Public library'));
  await screen.findByText(/every set you own has a Share button/i);
  expect(screen.queryByText(/is not built/i)).toBeNull();
});
