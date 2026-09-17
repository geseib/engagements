// src/src/__tests__/shareSetDialog.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
jest.mock('../utils/aiBatchClient', () => ({
  __esModule: true,
  pollGenerationJob: jest.fn(),
}));
import { pollGenerationJob } from '../utils/aiBatchClient';
import ShareSetDialog from '../components/ShareSetDialog';

const SET = { id: 'safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, activeVersion: 2 };
const jsonResponse = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => { window.API_BASE = 'https://api.test/'; global.fetch = jest.fn(); pollGenerationJob.mockReset(); });

test('reads like the mockup, and has an X and a Cancel that both close', () => {
  const onClose = jest.fn();
  render(<ShareSetDialog set={SET} onClose={onClose} onOutcome={() => {}} />);
  expect(screen.getByRole('heading', { name: /share “Safety walkthrough” publicly/i })).toBeInTheDocument();
  expect(screen.getByText(/every question is checked first/i)).toBeInTheDocument();
  expect(screen.getByText(/goes to a person at Engage/i)).toBeInTheDocument();
  expect(screen.getByText(/publishing copies the set/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
test('submit posts the version with publish, then polls, then says it is in the library', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j1', version: 2, status: 'queued' }));
  pollGenerationJob.mockImplementation(async (url, jobId, { onProgress }) => {
    onProgress({ status: 'running', phase: 'Checking 12 of 30', completed: 12, requested: 30 });
    return { status: 'complete', items: [], meta: { outcome: 'passed', publicSetId: 'orgacme-safety', publicVersion: 1 } };
  });
  const onOutcome = jest.fn();
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={onOutcome} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  expect(global.fetch).toHaveBeenCalledWith('https://api.test/question-sets/safety/check', expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 2, publish: true }) }));
  await screen.findByText(/now in the public library/i);
  expect(pollGenerationJob).toHaveBeenCalledWith('https://api.test/question-sets/safety/check', 'j1', expect.objectContaining({ label: 'Content check' }));
  expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'passed' }));
});
test('escalated says a person has it and where the outcome will show — never "you will hear back"', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j2', version: 2 }));
  pollGenerationJob.mockResolvedValue({ status: 'complete', items: [], meta: { outcome: 'escalated', reasons: ['guardrail'] } });
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  const p = await screen.findByText(/gone to a person at Engage/i);
  expect(p.textContent).toMatch(/outcome will show on this set's row/i);
  expect(document.body.textContent).not.toMatch(/hear back/i);
});
test('flagged closes onto the editor via onNeedsChanges', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j3', version: 2 }));
  pollGenerationJob.mockResolvedValue({ status: 'complete', items: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH' }], meta: { outcome: 'flagged' } });
  const onNeedsChanges = jest.fn();
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={() => {}} onNeedsChanges={onNeedsChanges} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await waitFor(() => expect(onNeedsChanges).toHaveBeenCalled());
});
test('409 and 429 are sentences, not errors, and leave Submit available', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(409, { error: 'This version is already being checked.', status: 'checking' }));
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await screen.findByText(/already being checked/i);
  expect(screen.getByRole('button', { name: /submit for review/i })).toBeEnabled();
  global.fetch.mockReturnValueOnce(jsonResponse(429, { error: "This organisation has used today's 20 checks. Try again tomorrow.", cap: 20 }));
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await screen.findByText(/used today's 20 checks/i);
});
test('closing while the job runs keeps it running and still reports the outcome', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j4', version: 2 }));
  let finish;
  pollGenerationJob.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onClose = jest.fn(); const onOutcome = jest.fn();
  const { unmount } = render(<ShareSetDialog set={SET} onClose={onClose} onOutcome={onOutcome} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await screen.findByText(/checking/i);
  expect(screen.getByText(/closing this keeps the check running/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
  expect(onClose).toHaveBeenCalled();
  unmount();
  await act(async () => { finish({ status: 'complete', items: [], meta: { outcome: 'passed' } }); });
  expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'passed' }));
});
