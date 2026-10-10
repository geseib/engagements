// #9: a 403 used to render as "your session may have expired - please sign in
// again", sending a signed-in admin around a sign-in loop that cannot help.
// A 403 reaches a VALID session that lacks the group; only 401 is about the
// session itself. These tests fail against the old collapsed branch.

import { describeHttpError } from '../utils/aiBatchClient';

describe('describeHttpError', () => {
  test('401 says the session is the problem and to sign in again', () => {
    const msg = describeHttpError(401, null, 'Batch 1');
    expect(msg).toMatch(/sign in again/i);
    expect(msg).toContain('401');
  });

  test('403 says the account lacks permission, and does NOT say to sign in again', () => {
    const msg = describeHttpError(403, null, 'Batch 1');
    expect(msg).toMatch(/not permitted/i);
    expect(msg).toContain('403');
    expect(msg).not.toMatch(/sign in again/i);
    expect(msg).not.toMatch(/session may have expired/i);
  });

  test('server errors keep the lambda detail when there is one', () => {
    expect(describeHttpError(500, 'Bedrock is having a day', 'Batch 2'))
      .toContain('Bedrock is having a day');
  });
});

/*
  STATUS LINES CARRY NO EMOJI (README/help pass, 2026-10-10). The retry and
  reconnect lines used to open with an hourglass emoji; the status chip that
  shows them already draws a Phosphor icon from statusTone(), so the emoji was
  a second, off-system icon on the same line.
*/
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

describe('status lines', () => {
  const { authFetch } = require('../auth/authFetch');
  const { postGenerationBatch, pollGenerationJob } = require('../utils/aiBatchClient');
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{231A}-\u{23FF}]/u;

  beforeEach(() => { jest.useFakeTimers(); authFetch.mockReset(); });
  afterEach(() => { jest.useRealTimers(); });

  test('a retried POST reports in words, with no emoji', async () => {
    authFetch
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'busy' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jobId: 'j1' }) });
    const lines = [];
    const done = postGenerationBatch('/x', {}, { label: 'Batch 1', onStatus: (s) => lines.push(s) });
    await jest.advanceTimersByTimeAsync(20000);
    await expect(done).resolves.toEqual({ jobId: 'j1' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Batch 1: network error, retrying in 2s/);
    expect(lines[1]).toMatch(/^Batch 1: HTTP 503 \(busy\) - retrying in/);
    lines.forEach((line) => expect(line).not.toMatch(EMOJI));
  });

  test('a poll that loses contact says "reconnecting" with no emoji', async () => {
    authFetch
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'complete', items: [] }) });
    const lines = [];
    const done = pollGenerationJob('/jobs', 'j1', { label: 'Generation', intervalMs: 10, onStatus: (s) => lines.push(s) });
    await jest.advanceTimersByTimeAsync(100);
    await done;
    expect(lines).toContain('Generation: reconnecting...');
    lines.forEach((line) => expect(line).not.toMatch(EMOJI));
  });
});
