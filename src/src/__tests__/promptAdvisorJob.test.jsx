/**
 * THE PROMPT ADVISOR STARTS A JOB AND WAITS FOR IT — components/AIPromptAdvisor.jsx
 * (re-exported from AIPromptManager.jsx) and utils/promptAdvisorJob.js.
 *
 * The advisor used to POST and wait for the analysis in the same request. The
 * analysis takes 35-60 seconds and the API's gateway gives up at 30, so every
 * run ended in a 503 — which the dialog reported as "Failed to analyze prompt",
 * having never read the status or the body. The server now answers 202 with a
 * job id (lambda-functions/admin/ai-prompt-advisor.js) and this dialog polls it.
 *
 * rejects: reading the analysis off the POST; polling forever; a generic string
 *          in place of the server's own message; a gateway page's non-JSON body
 *          hiding the status; a closed dialog that keeps polling.
 *
 * One mocked module — `../auth/authFetch` — as promptManagerDialogs.test.jsx.
 * The poll interval and the give-up are props, so nothing here waits on the
 * real three seconds (a `waitFor` racing POLL_INTERVAL_MS is the documented
 * trap, docs/handoff/multitenant-saas-2026-08-23.md §0).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import { AIPromptAdvisor } from '../components/AIPromptManager';
import {
  ADVISOR_GIVE_UP_MS, ADVISOR_POLL_INTERVAL_MS, describeAdviceProgress, describeAdviceStartFailure,
} from '../utils/promptAdvisorJob';

const PROMPT = {
  promptId: 'p1',
  name: 'Lessons Learned',
  gameType: 'call-and-answer',
  category: 'lessons-learned',
  template: 'Summarise {responsesText}',
};

/** A fetch Response. `body === undefined` is a gateway page: .json() throws. */
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) throw new SyntaxError('Unexpected token < in JSON at position 0');
    return body;
  },
});

/** The checklist both lenses return — promptAdvisorChecklist.test.jsx owns what the dialog does with it. */
const ANALYSIS = {
  overallScore: 7.5,
  summary: 'Clear sections, vague audience.',
  issues: [{ id: 'r1', severity: 'high', half: 'both', issue: 'Vague ask', fix: 'Name the audience' }],
};

/**
 * Route the mock by method: the POST answers `start`, and each GET takes the
 * next of `polls` (the last one repeats).
 */
function serve({ start = reply(202, { jobId: 'job-1', status: 'queued' }), polls = [] } = {}) {
  const gets = [];
  authFetch.mockImplementation(async (url, init = {}) => {
    if ((init.method || 'GET') === 'POST') return start;
    gets.push(url);
    const next = polls.length > 1 ? polls.shift() : polls[0];
    return next;
  });
  return gets;
}

const running = (phase = 'Analysing the prompt') => reply(200, { jobId: 'job-1', status: 'running', phase, error: null, result: null });
const done = (analysis = ANALYSIS) => reply(200, {
  jobId: 'job-1', status: 'complete', phase: 'Analysis ready', error: null,
  result: { analysisType: 'review', analysis, metadata: { modelUsed: 'claude-sonnet-4-6' } },
});
const failed = (error) => reply(200, { jobId: 'job-1', status: 'error', phase: 'Failed', error, result: null });

function renderAdvisor(props = {}) {
  return render(
    <AIPromptAdvisor
      prompt={PROMPT}
      onClose={jest.fn()}
      onApplyImprovedPrompt={jest.fn()}
      pollIntervalMs={5}
      giveUpMs={5000}
      {...props}
    />,
  );
}

const run = () => fireEvent.click(screen.getByRole('button', { name: /Run analysis/i }));
const notice = () => screen.getByTestId('pmgr-advisor-notice');

beforeEach(() => {
  authFetch.mockReset();
});

describe('the advisor runs as a job', () => {
  test('it starts a job, polls it, and shows the analysis when it arrives', async () => {
    const gets = serve({ polls: [running(), running(), done()] });
    renderAdvisor();
    run();

    expect(await screen.findByText('Clear sections, vague audience.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Vague ask/ })).toBeChecked();
    expect(screen.getByTestId('pmgr-advice-apply')).toBeInTheDocument();

    const post = authFetch.mock.calls.find(([, init]) => init && init.method === 'POST');
    expect(post[0]).toMatch(/admin\/ai-prompt-advisor$/);
    expect(JSON.parse(post[1].body)).toMatchObject({ analysisType: 'review', existingPromptId: 'p1' });
    // rejects: reading the answer off the POST — the analysis only ever comes from the poll.
    expect(gets.length).toBeGreaterThanOrEqual(3);
    expect(gets.every((u) => /admin\/ai-prompt-advisor\/job-1$/.test(u))).toBe(true);
  });

  test('it shows progress while the job runs, and the button cannot start a second one', async () => {
    serve({ polls: [running('Analysing the prompt')] });
    const { unmount } = renderAdvisor();
    run();

    const progress = await screen.findByTestId('pmgr-advisor-progress');
    await waitFor(() => expect(progress).toHaveTextContent(/Analysing the prompt/));
    expect(screen.getByRole('button', { name: /Analysing/i })).toBeDisabled();
    unmount();
  });

  test('the progress line gives the phase and the time so far', () => {
    const text = describeAdviceProgress({ status: 'running', phase: 'Analysing the prompt' }, 42_000);
    expect(text).toMatch(/Analysing the prompt/);
    expect(text).toMatch(/42s/);
    expect(describeAdviceProgress({ status: 'queued', phase: 'Queued' }, 1_000)).toMatch(/Queued|Waiting/);
  });
});

describe('a failure says what the server said', () => {
  test("a failed job shows the job's own error, not a generic string", async () => {
    serve({ polls: [running(), failed("The advisor's reply was cut off at its 16,000-token limit before it finished.")] });
    renderAdvisor();
    run();

    await waitFor(() => expect(notice()).toHaveTextContent(/cut off at its 16,000-token limit/));
    expect(notice()).not.toHaveTextContent(/Failed to analyze prompt/);
    expect(notice()).toHaveTextContent(/untouched/);
    expect(screen.getByRole('button', { name: /Run analysis/i })).toBeEnabled();
  });

  test('a refused start shows the body the server sent', async () => {
    serve({ start: reply(404, { error: 'Prompt not found: p1' }) });
    renderAdvisor();
    run();

    await waitFor(() => expect(notice()).toHaveTextContent('Prompt not found: p1'));
    expect(authFetch.mock.calls.filter(([, init]) => (init?.method || 'GET') === 'GET')).toHaveLength(0);
  });

  test("a gateway page's non-JSON body does not hide the status", async () => {
    serve({ start: reply(503, undefined) });
    renderAdvisor();
    run();

    await waitFor(() => expect(notice()).toHaveTextContent(/HTTP 503/));
  });

  test('a message without a full stop still reads as a sentence between two others', async () => {
    serve({ start: reply(404, { error: 'Prompt not found: p1' }) });
    renderAdvisor();
    run();

    await waitFor(() => expect(notice()).toHaveTextContent(
      'No analysis was produced. Prompt not found: p1 (HTTP 404). The prompt itself is untouched',
    ));
  });

  test('the start failures read as sentences a person can act on', () => {
    expect(describeAdviceStartFailure(401, null)).toMatch(/sign in/i);
    expect(describeAdviceStartFailure(403, 'Administrator access required')).toMatch(/Administrator access required/);
    expect(describeAdviceStartFailure(413, 'This prompt is too long to analyse (300 KB)')).toMatch(/too long/);
    expect(describeAdviceStartFailure(500, null)).toMatch(/HTTP 500/);
  });

  test('it stops waiting after the give-up and says so', async () => {
    serve({ polls: [running()] });
    renderAdvisor({ giveUpMs: 60 });
    run();

    await waitFor(() => expect(notice()).toHaveTextContent(/stopped waiting/), { timeout: 3000 });
    expect(notice()).toHaveTextContent(/Nothing was changed/);
  });

  test('a job that has vanished says so, rather than "lost contact"', async () => {
    serve({ polls: [reply(404, { error: 'Job not found or expired' })] });
    renderAdvisor();
    run();

    await waitFor(() => expect(notice()).toHaveTextContent(/could no longer be found/));
  });
});

describe('closing the dialog', () => {
  test('stops the polling', async () => {
    const gets = serve({ polls: [running()] });
    const { unmount } = renderAdvisor({ pollIntervalMs: 20 });
    run();
    await waitFor(() => expect(gets.length).toBeGreaterThan(0));
    unmount();
    const seen = gets.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(gets.length).toBeLessThanOrEqual(seen + 1);
  });
});

test('the real cadence: polled every few seconds, abandoned after a few minutes', () => {
  expect(ADVISOR_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
  expect(ADVISOR_POLL_INTERVAL_MS).toBeLessThanOrEqual(5000);
  // Past the ~6 minutes a reply that used the whole 16,000-token budget would
  // take at the ~45 tokens/s this account measures, and well short of forever.
  expect(ADVISOR_GIVE_UP_MS).toBeGreaterThanOrEqual(6 * 60 * 1000);
  expect(ADVISOR_GIVE_UP_MS).toBeLessThanOrEqual(10 * 60 * 1000);
});
