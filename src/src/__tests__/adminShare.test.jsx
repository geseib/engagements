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
