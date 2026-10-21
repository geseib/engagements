/**
 * THE OWNER'S CASE, IN THE BUILDER: "Add questions → 2 new categories × 10",
 * closed while it ran, came back to nothing.
 *
 * Three things had to change in the builders, and each is held here:
 *   1. The run NAMES ITS SET (`appendTo: { setId, scope, mode }`), so the
 *      server drafts it in that set's library instead of leaving the items on
 *      a job row for an open editor.
 *   2. REOPENING RESUMES, it does not replace. "Add questions" opened the
 *      builder already generating, so a second press paid for a fresh run and
 *      forgot the first. A run remembered for THIS set is now picked back up.
 *   3. A FINISHED RUN IS HANDED TO THE PAGE'S REVIEW (`onDraftReady`), not
 *      reviewed in the builder, and the running panel promises only what
 *      happens: a draft, the bell, nothing saved until you accept.
 *
 * Only `../auth/authFetch` is mocked, as in aiBuilderCloseConfirm.test.jsx.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(),
  getActiveOrgId: () => '',
  PLATFORM_MODE_HEADER: '~platform',
  ORG_HEADER: 'X-Engage-Org',
}));
const { authFetch } = require('../auth/authFetch');
const TriviaAIBuilder = require('../components/TriviaAIBuilder').default;

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const appendTo = (over = {}) => ({
  setName: 'History Quiz', setId: 'history', scope: 'org', mode: 'new', categories: ['Presidents'],
  brief: { topic: 'American history', audience: 'Adults', difficulty: 'medium' },
  existingTotal: 10, autoStart: true, count: 20, numberOfCategories: 2, onModeChange: () => {},
  libraryLabel: 'Northwind', ...over,
});

const jobDone = (extra = {}) => json(200, {
  jobId: 'job-1', status: 'complete', phase: '', requested: 20, completed: 20,
  items: [{ title: 'Q', questionDetail: 'Q?', category: 'Founders', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA' }],
  warnings: [], meta: null, error: null, createdSet: null, setCreationError: null, updatedAt: '2026-10-21T10:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('an Add questions run names its set, and its finished draft goes to the page\'s review', async () => {
  const posts = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST' && url.includes('ai-generate-trivia')) {
      posts.push(JSON.parse(opts.body));
      return json(202, { jobId: 'job-1', status: 'queued', requested: 20, draftId: 'job-1' });
    }
    if (url.includes('ai-generate-trivia/job-1')) return jobDone({ draftId: 'job-1' });
    throw new Error(`unexpected ${url}`);
  });
  const onDraftReady = jest.fn();
  render(<TriviaAIBuilder appendTo={appendTo()} onClose={() => {}} onTriviaGenerated={() => {}} onDraftReady={onDraftReady} />);
  await waitFor(() => expect(onDraftReady).toHaveBeenCalledWith({ draftId: 'job-1', libraryKey: '' }));
  expect(posts).toHaveLength(1);
  expect(posts[0].appendOnly).toBe(true);
  expect(posts[0].appendTo).toEqual({ setId: 'history', scope: 'org', mode: 'new' });
  // The run is forgotten once it is handed over: the draft is the record now.
  expect(window.localStorage.getItem('engage.generationJob.ai-generate-trivia#history')).toBeNull();
});

test('reopening Add questions RESUMES the run remembered for this set — it does not pay for a second', async () => {
  window.localStorage.setItem('engage.generationJob.ai-generate-trivia#history',
    JSON.stringify({ jobId: 'job-1', startedAt: Date.now(), libraryKey: '' }));
  authFetch.mockImplementation(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST') throw new Error('a second run was started');
    if (url.includes('ai-generate-trivia/job-1')) return jobDone({ draftId: 'job-1' });
    throw new Error(`unexpected ${url}`);
  });
  const onDraftReady = jest.fn();
  render(<TriviaAIBuilder appendTo={appendTo()} onClose={() => {}} onTriviaGenerated={() => {}} onDraftReady={onDraftReady} />);
  await waitFor(() => expect(onDraftReady).toHaveBeenCalledWith({ draftId: 'job-1', libraryKey: '' }));
  expect(authFetch.mock.calls.some(([, o]) => (o && o.method) === 'POST')).toBe(false);
});

test('another set\'s remembered run is not this one: the slot is keyed by set', async () => {
  window.localStorage.setItem('engage.generationJob.ai-generate-trivia#another-set',
    JSON.stringify({ jobId: 'job-other', startedAt: Date.now() }));
  const posts = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST') {
      posts.push(JSON.parse(opts.body));
      return json(202, { jobId: 'job-1', status: 'queued', requested: 20, draftId: 'job-1' });
    }
    if (url.includes('ai-generate-trivia/job-1')) return jobDone({ draftId: 'job-1' });
    throw new Error(`unexpected ${url}`);
  });
  render(<TriviaAIBuilder appendTo={appendTo()} onClose={() => {}} onTriviaGenerated={() => {}} onDraftReady={jest.fn()} />);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(authFetch.mock.calls.some(([url]) => url.includes('job-other'))).toBe(false);
});

test('while it runs, the panel promises a draft and the bell — and offers a real Stop', async () => {
  authFetch.mockImplementation(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST' && url.includes('ai-generate-trivia')) {
      return json(202, { jobId: 'job-1', status: 'queued', requested: 20, draftId: 'job-1' });
    }
    if (url.includes('ai-generate-trivia/job-1')) {
      return json(200, { jobId: 'job-1', status: 'running', phase: 'Generated 0 of 20...', requested: 20, completed: 0, items: [], warnings: [], draftId: 'job-1' });
    }
    throw new Error(`unexpected ${url}`);
  });
  render(<TriviaAIBuilder appendTo={appendTo()} onClose={() => {}} onTriviaGenerated={() => {}} onDraftReady={jest.fn()} />);
  const panel = await screen.findByTestId('gjp-draft-running');
  expect(panel).toHaveTextContent('Close — you’ll be notified');
  expect(panel).toHaveTextContent('Everything it writes waits in a draft for thirty days');
  expect(panel).toHaveTextContent('Nothing is saved, and no set changes, until you accept it.');
  expect(panel).not.toHaveTextContent('The set gets made without you');
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
});

test('adding to a set says where the questions go, before anything is generated', () => {
  authFetch.mockImplementation(async () => new Promise(() => {}));
  render(<TriviaAIBuilder appendTo={appendTo({ autoStart: false })} onClose={() => {}} onTriviaGenerated={() => {}} />);
  expect(screen.getByTestId('destination-note')).toHaveTextContent('Adds to “History Quiz” in Northwind.');
});

test('a new set offers only the libraries handed in, defaulting to Your space here', () => {
  render(
    <TriviaAIBuilder
      onClose={() => {}}
      onTriviaGenerated={() => {}}
      libraries={[
        { key: 'org_me', label: 'Your space', kind: 'personal' },
        { key: 'org_team', label: 'Northwind', kind: 'team' },
      ]}
    />,
  );
  const select = screen.getByLabelText('Save into');
  expect(select).toHaveValue('org_me');
  expect([...select.options].map((o) => o.textContent)).toEqual(['Your space', 'Northwind (team)']);
  expect(screen.getByTestId('destination-field')).toHaveTextContent('Public is not a choice here');
});
