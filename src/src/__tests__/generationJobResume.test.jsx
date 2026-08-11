/**
 * The job outliving the modal (G5.1/G5.2), and G1 end to end through a real
 * builder.
 *
 * TriviaAIBuilder is the one mounted here because it is the smallest of the
 * four and the other three are the same code with different nouns. It calls the
 * API only through utils/aiBatchClient, so exactly ONE module is mocked —
 * `../auth/authFetch` — and nothing else. It does not use useAuth, so
 * AuthContext is not mocked either, and AuthProvider is never wrapped.
 *
 * Fixtures are jobToResponse()'s ten keys (lambda-functions/admin/shared/
 * generation-jobs.js:178-192). Nothing here invents a field.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const TriviaAIBuilder = require('../components/TriviaAIBuilder').default;
const {
  rememberGenerationJob,
  recallGenerationJob,
} = require('../utils/generationJob');

/** The builder's own endpoint string, so the storage key matches exactly. */
const ENDPOINT = `${window.API_BASE}admin/ai-generate-trivia`;

const jobResponse = (overrides = {}) => ({
  jobId: 'm4k2p9x7bq1a',
  status: 'running',
  phase: '',
  requested: 0,
  completed: 0,
  items: [],
  warnings: [],
  meta: null,
  error: null,
  updatedAt: '2026-08-11T14:22:06.000Z',
  ...overrides,
});

const questions = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Question ${i + 1}`,
  questionDetail: `Detail ${i + 1}`,
  category: 'Engineering',
  difficulty: 'medium',
  optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
  correctAnswer: 'OptionA',
}));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Route by method + URL. An unmatched request throws rather than hanging. */
function mockApi({ get, post }) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'POST' && post) return post(url, options);
    if (method === 'GET' && get) return get(url);
    throw new Error(`unexpected ${method} ${url}`);
  });
}

const calls = (method) => authFetch.mock.calls.filter(
  ([, options = {}]) => (options.method || 'GET') === method
);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('resuming a job this browser was already watching', () => {
  test('with nothing stored, opening the builder asks the server nothing', () => {
    // rejects: a resume effect that fires unconditionally, which would GET
    // `…/undefined` every time anyone opened a builder.
    mockApi({});
    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />);

    expect(authFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Configure Your Trivia Questions')).toBeInTheDocument();
  });

  test('a stored id is picked back up with ONE GET and no POST', async () => {
    // rejects: losing the jobId. It used to live in a local const inside
    // handleConfigSubmit, so the modal's only exit lost it forever — while the
    // client's own timeout message advised "reopen the builder to check", which
    // nothing made possible. Also rejects a resume that re-POSTs, which would
    // start a SECOND job and pay for the same set twice.
    rememberGenerationJob(ENDPOINT, 'm4k2p9x7bq1a');
    mockApi({
      get: async () => jsonResponse(200, jobResponse({
        status: 'complete', phase: 'Generated 3 of 3', requested: 3, completed: 3, items: questions(3),
      })),
    });

    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />);

    await screen.findByRole('button', { name: /Load 3 into System/ });
    expect(calls('POST')).toHaveLength(0);
    expect(calls('GET')).toHaveLength(1);
    expect(calls('GET')[0][0]).toContain('admin/ai-generate-trivia/m4k2p9x7bq1a');
  });

  test('a 404 means the job is GONE, not that something broke', async () => {
    // rejects: treating the expiry as an error, and rejects leaving the dead id
    // in storage to 404 again on every future open. The job row carries a
    // 3-day TTL stamped only at creation and never refreshed
    // (generation-jobs.js:39, 77), so this is the ordinary end of a stored id.
    //
    // Also rejects the old 404 handling, where the throw sat INSIDE the poll
    // loop's try: it was caught by the reconnect counter, retried five times,
    // and finally reported as "lost contact with the job".
    rememberGenerationJob(ENDPOINT, 'expired-job');
    mockApi({ get: async () => jsonResponse(404, { error: 'Job not found or expired' }) });

    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />);

    await waitFor(() => expect(screen.getByText(/That job has expired/)).toBeInTheDocument());
    expect(screen.getByText(/readable for three days/)).toBeInTheDocument();
    expect(screen.getByText('Configure Your Trivia Questions')).toBeInTheDocument();
    expect(recallGenerationJob(ENDPOINT)).toBeNull();
    expect(calls('GET')).toHaveLength(1);
  });

  test('a lost connection KEEPS the id, because the worker has not stopped', async () => {
    // rejects: forgetting the id on any poll failure. The worker runs against
    // its own 900s budget and knows nothing about this window; discarding the
    // id there is what made the "reopen the builder to check" advice a lie.
    rememberGenerationJob(ENDPOINT, 'm4k2p9x7bq1a');
    mockApi({ get: async () => { throw new Error('network down'); } });

    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /Lost contact with the job/ }))
      .toBeInTheDocument(), { timeout: 20000 });
    expect(recallGenerationJob(ENDPOINT)).toMatchObject({ jobId: 'm4k2p9x7bq1a' });
  }, 30000);
});

describe('a failed job, through the real builder', () => {
  /** Exactly what failJob(…, { items: produced }) leaves in the row. */
  const partial = jobResponse({
    status: 'error',
    phase: 'Failed',
    requested: 100,
    completed: 41,
    items: questions(41),
    warnings: ['A pass of 19 exceeded the output budget; continuing in smaller passes.'],
    error: 'rate limited by the AI service (HTTP 429)',
  });

  test('41 partials over a FAILED job do not render the success UI', async () => {
    // rejects: THE HEADLINE BUG, at the level it actually shipped. The builder
    // branched on `generatedTrivia.length > 0`, which a partial failure
    // satisfies, so the operator saw a review table and a live "Load into
    // System" over a job that had failed — and `Generation failed: …` went to
    // the else-branch that only renders when there are ZERO items.
    rememberGenerationJob(ENDPOINT, 'm4k2p9x7bq1a');
    mockApi({ get: async () => jsonResponse(200, partial) });

    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />);

    await screen.findByRole('heading', { name: /Generation stopped at 41 of 100/ });
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).not.toMatch(/into System/i);
    }
    expect(screen.getByText('rate limited by the AI service (HTTP 429)')).toBeInTheDocument();
    expect(screen.getByText(partial.warnings[0])).toBeInTheDocument();
  });

  test('the 41 are reachable, but only after the failure has been read', async () => {
    // rejects: skipping the failure screen straight to review, which is the
    // shipped behaviour and the reason the error was never seen.
    rememberGenerationJob(ENDPOINT, 'm4k2p9x7bq1a');
    mockApi({ get: async () => jsonResponse(200, partial) });

    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Review the 41 and make a set/ }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    // The shortfall is stated on the way in — 41 kept of 100 asked for.
    expect(screen.getByText(/You asked for 100 and got 41\./)).toBeInTheDocument();
  });
});

describe('starting a job, and finishing with it', () => {
  test('the id is stored as soon as the job exists, and dropped when it is used', async () => {
    // rejects: persisting nothing (G5.1), and rejects keeping a job on offer
    // after its questions have been loaded — the next open would resume a job
    // the operator has already dealt with.
    const onTriviaGenerated = jest.fn();
    mockApi({
      post: async () => jsonResponse(202, { jobId: 'brand-new-job', status: 'queued', requested: 3 }),
      get: async () => jsonResponse(200, jobResponse({
        jobId: 'brand-new-job',
        status: 'complete',
        phase: 'Generated 3 of 3',
        requested: 3,
        completed: 3,
        items: questions(3),
      })),
    });

    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={onTriviaGenerated} />);

    fireEvent.change(screen.getByPlaceholderText(/American History/i), {
      target: { value: 'Post-merger integration' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate Trivia Questions/ }));

    const load = await screen.findByRole('button', { name: /Load 3 into System/ });
    expect(recallGenerationJob(ENDPOINT)).toMatchObject({ jobId: 'brand-new-job' });

    fireEvent.click(load);
    expect(onTriviaGenerated).toHaveBeenCalled();
    expect(recallGenerationJob(ENDPOINT)).toBeNull();
  });

  test('an excluded question is not handed to the importer', async () => {
    // rejects: sending the whole array regardless of the per-item rejects (G6).
    // handleLoadIntoSystem used to post `generatedTrivia` entire, so one bad
    // row meant importing it and fixing it later.
    const onTriviaGenerated = jest.fn();
    mockApi({
      post: async () => jsonResponse(202, { jobId: 'brand-new-job', status: 'queued', requested: 3 }),
      get: async () => jsonResponse(200, jobResponse({
        jobId: 'brand-new-job', status: 'complete', requested: 3, completed: 3, items: questions(3),
      })),
    });

    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={onTriviaGenerated} />);
    fireEvent.change(screen.getByPlaceholderText(/American History/i), { target: { value: 'Topic' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Trivia Questions/ }));

    await screen.findByRole('table');
    const rows = screen.getAllByRole('row');
    fireEvent.click(rows[2].querySelector('.git-ghost')); // question 2

    fireEvent.click(screen.getByRole('button', { name: /Load 2 into System/ }));

    expect(onTriviaGenerated).toHaveBeenCalledTimes(1);
    const { questions: sent } = onTriviaGenerated.mock.calls[0][0];
    expect(sent.map((q) => q.title)).toEqual(['Question 1', 'Question 3']);
  });
});
