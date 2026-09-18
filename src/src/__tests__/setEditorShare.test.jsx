import React from 'react';
import {
  render, screen, fireEvent, within, waitFor,
} from '@testing-library/react';
import QuestionSetEditor from '../components/QuestionSetEditor';
import { authFetch } from '../auth/authFetch';

/*
 * Task 20: the editor says where each version went (a chip per version),
 * offers "Share publicly" per version, mounts the needs-changes banner, and
 * "Edit Q14" focuses the question's row.
 *
 * The fetch mock is copied verbatim from questionSetEditor.test.jsx's shape
 * (authFetch mocked as a module, routed by method + URL substring).
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const VERSIONS = [
  { version: 1, createdAt: '2026-08-01T10:00:00.000Z', questionCount: 30, categoryCount: 3, isActive: false, review: 'passed', reviewFindings: [], published: { publicSetId: 'orgacme-safety', publicVersion: 1, at: '2026-08-02T10:00:00.000Z' }, pinnedByGames: [], unfinished: false, reasons: [] },
  { version: 2, createdAt: '2026-08-19T10:00:00.000Z', questionCount: 30, categoryCount: 3, isActive: true, review: 'flagged', reviewFindings: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'Injuries in detail.' }], published: null, pinnedByGames: [], unfinished: false, reasons: [] },
];
const SET = { id: 'safety', name: 'Safety walkthrough', engagementType: 'trivia', activeVersion: 2, canManage: true, scope: 'org', share: { status: 'flagged', version: 2, at: '2026-08-19T10:00:00.000Z' } };

// R17: the questions route returns BARE ids (`id: 'q014'`, never
// `QUESTION#q014` — the API strips the prefix before answering, and
// utils/questionRows.js:toRow reads `id` first). 14 rows, sorted by `sk`
// (bare id) in QuestionsPanel's editableRows, so q014 is the 14th row —
// data-testid="question-13".
const QUESTIONS = Array.from({ length: 14 }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  return {
    id: `q${n}`,
    category: 'Safety',
    title: `Question ${i + 1}`,
    questionDetail: `Detail for question ${i + 1}`,
    optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
    correctAnswer: 'OptionA',
  };
});

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Route the mock by URL + method so each test only declares what it changes. */
function mockApi(handlers = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    for (const [match, handler] of Object.entries(handlers)) {
      const [wantMethod, pattern] = match.split(' ');
      if (method === wantMethod && url.includes(pattern)) return handler(url, options);
    }
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, VERSIONS);
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
    // Other panels (media) fetch on mount too; a quiet empty 200 keeps them
    // out of the way of tests that are not about them, same as a real 404
    // some of them already tolerate.
    if (method === 'GET') return jsonResponse(200, {});
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

test('each version says where it went, and Share publicly asks for that version', async () => {
  mockApi();
  const onShare = jest.fn();
  render(<QuestionSetEditor questionSet={SET} canShare onShare={onShare} onAppeal={jest.fn()} onCancel={() => {}} />);
  const v1 = await screen.findByTestId('version-1');
  expect(within(v1).getByText('public')).toBeInTheDocument();
  const v2 = await screen.findByTestId('version-2');
  expect(within(v2).getByText('needs changes')).toBeInTheDocument();
  fireEvent.click(within(v1).getByRole('button', { name: /share publicly/i }));
  expect(onShare).toHaveBeenCalledWith(1);
});

test('the needs-changes banner shows for the flagged version and Edit Q14 focuses the row', async () => {
  mockApi();
  render(<QuestionSetEditor questionSet={SET} canShare onShare={jest.fn()} onAppeal={jest.fn()} onCancel={() => {}} />);
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent(/not published/i);
  // R22: the banner's button reads "Edit Q14" (label(), not the bare id).
  fireEvent.click(within(banner).getByRole('button', { name: /edit q14/i }));
  // R17: q014 is bare, and is the 14th row (index 13) once sorted by sk.
  const row = await screen.findByTestId('question-13');
  expect(row).toHaveAttribute('data-question-id', 'q014');
  expect(row.className).toMatch(/focused/);
});

// R23 fix round 1: clicking "Edit Q14" a second time for the same question
// used to do nothing — QuestionSetEditor set focusQuestionId to the same
// string, React bailed out of the identical setState, and QuestionsPanel's
// effect (deps [focusQuestionId]) never re-ran. No re-scroll, no
// re-highlight once the first 2-second fade had finished.
test('Edit Q14 works every time, not just the first', async () => {
  const scrollIntoView = jest.fn();
  const original = window.HTMLElement.prototype.scrollIntoView;
  window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
  try {
    mockApi();
    render(<QuestionSetEditor questionSet={SET} canShare onShare={jest.fn()} onAppeal={jest.fn()} onCancel={() => {}} />);
    const banner = await screen.findByRole('status');
    await screen.findByTestId('question-13');
    fireEvent.click(within(banner).getByRole('button', { name: /edit q14/i }));
    fireEvent.click(within(banner).getByRole('button', { name: /edit q14/i }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('question-13').className).toMatch(/focused/);
  } finally {
    window.HTMLElement.prototype.scrollIntoView = original;
  }
});

// R24 fix round 1: AdminPage's handleAppeal used to call a page-level
// `notice` that renders only in the list panel — unmounted for as long as
// this editor is open, so a rejected appeal noticed nowhere anyone could see.
// handleAppeal now RETURNS its outcome instead, and this editor shows it
// right where the action was taken: its own local status, above the banner.
test('an appeal the server refuses shows the reason right where it was sent from', async () => {
  mockApi();
  const onAppeal = jest.fn().mockResolvedValue({ ok: false, error: 'boom' });
  render(<QuestionSetEditor questionSet={SET} canShare onShare={jest.fn()} onAppeal={onAppeal} onCancel={() => {}} />);
  const banner = await screen.findByRole('status');
  fireEvent.click(within(banner).getByRole('button', { name: /ask for a human review/i }));
  fireEvent.click(within(banner).getByRole('button', { name: /^send$/i }));
  expect(await screen.findByText('boom')).toBeInTheDocument();
  expect(onAppeal).toHaveBeenCalledWith(2, '');
});

test('without canShare there is no Share button and no banner actions', async () => {
  mockApi();
  render(<QuestionSetEditor questionSet={{ ...SET, canManage: false }} onCancel={() => {}} />);
  await screen.findByTestId('version-1');
  expect(screen.queryByRole('button', { name: /share publicly/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /resubmit/i })).toBeNull();
});

// Important #1: the banner points at the FLAGGED version (v2 here, via
// SET.share.version), but "fix it, then Resubmit" should not re-check the
// flagged content — Save in QuestionsPanel already made v3 the active
// version. Resubmit must submit v3, or the drive loops: flagged again.
test('Resubmit submits the active version when it is newer than the flagged one', async () => {
  const versions = [
    { version: 1, createdAt: '2026-08-01T10:00:00.000Z', questionCount: 30, categoryCount: 3, isActive: false, review: 'passed', reviewFindings: [], published: { publicSetId: 'orgacme-safety', publicVersion: 1, at: '2026-08-02T10:00:00.000Z' }, pinnedByGames: [], unfinished: false, reasons: [] },
    { version: 2, createdAt: '2026-08-19T10:00:00.000Z', questionCount: 30, categoryCount: 3, isActive: false, review: 'flagged', reviewFindings: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'Injuries in detail.' }], published: null, pinnedByGames: [], unfinished: false, reasons: [] },
    { version: 3, createdAt: '2026-08-25T10:00:00.000Z', questionCount: 30, categoryCount: 3, isActive: true, review: 'unreviewed', reviewFindings: [], published: null, pinnedByGames: [], unfinished: false, reasons: [] },
  ];
  mockApi({ 'GET /versions': async () => jsonResponse(200, versions) });
  const onShare = jest.fn();
  render(<QuestionSetEditor questionSet={{ ...SET, activeVersion: 3 }} canShare onShare={onShare} onAppeal={jest.fn()} onCancel={() => {}} />);
  const banner = await screen.findByRole('status');
  fireEvent.click(within(banner).getByRole('button', { name: /^resubmit$/i }));
  expect(onShare).toHaveBeenCalledWith(3);
});

// Important #2: the editor's own `[setId]` effect loads versions once, on
// mount. A resubmit finishing WHILE the editor is still open changes
// `questionSet.share.at` (AdminPage re-derives `editingSet` on `onOutcome` ->
// `fetchQuestionSets`) but never re-fetches `versions` — so the banner and
// chips go stale exactly when a fresh outcome most needs to be seen.
test('a fresh check finishing inside the editor (a new share.at) reloads the versions list', async () => {
  mockApi();
  const { rerender } = render(
    <QuestionSetEditor questionSet={SET} canShare onShare={jest.fn()} onAppeal={jest.fn()} onCancel={() => {}} />,
  );
  await screen.findByTestId('version-1');
  const versionGets = () => authFetch.mock.calls.filter(([url]) => url.includes('/versions')).length;
  const before = versionGets();
  expect(before).toBe(1); // the [setId] load only — the share.at effect must not double-fetch on mount
  rerender(
    <QuestionSetEditor
      questionSet={{ ...SET, share: { ...SET.share, at: '2026-08-20T10:00:00.000Z' } }}
      canShare
      onShare={jest.fn()}
      onAppeal={jest.fn()}
      onCancel={() => {}}
    />,
  );
  await waitFor(() => expect(versionGets()).toBeGreaterThan(before));
});
