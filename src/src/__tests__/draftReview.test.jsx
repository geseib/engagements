/**
 * THE REVIEW OF AN AI DRAFT (components/DraftReview.jsx) — the owner's
 * "approval to accept the work that was created", with the destination named.
 *
 * Only `../auth/authFetch` is mocked; the server answers are the shapes
 * admin/generation-drafts.js returns.
 *
 * // rejects: a review that does not say where the work is saved; an accept
 * //          that saves left-out questions; an addition that is not ONE new
 * //          version through the importer; a failed save that leaves the
 * //          draft claimed; a regenerate that hides its cost.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(),
  getActiveOrgId: () => '',
  PLATFORM_MODE_HEADER: '~platform',
  ORG_HEADER: 'X-Engage-Org',
}));
const { authFetch } = require('../auth/authFetch');
const DraftReview = require('../components/DraftReview').default;

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const q = (n, category, extra = {}) => ({
  title: `Generated ${n}`, questionDetail: `Q${n}?`, category, difficulty: 'medium',
  optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', tags: [], ...extra,
});

const header = (over = {}) => ({
  draftId: 'draft123abc', status: 'ready', scope: 'org', orgId: 'org_team', kind: 'trivia',
  engagementType: 'trivia', mode: 'new', appendMode: '', targetSetId: '', targetVersion: null,
  title: 'Presidents Trivia', requested: 3, produced: 3, warnings: [], error: '', promptSource: null,
  usage: { inputTokens: 100, outputTokens: 2100 }, tokensPerItem: 700, topic: '',
  createdAt: '2026-10-18T10:00:00.000Z', daysLeft: 27, ...over,
});
const ITEMS = [
  { seq: 1, decision: 'keep', edited: false, item: q(1, 'Founders') },
  { seq: 2, decision: 'keep', edited: false, item: q(2, 'Founders') },
  { seq: 3, decision: 'keep', edited: false, item: q(3, 'Treaties') },
];
const LIBS = [{ key: 'org_team', label: 'Northwind', kind: 'team' }];

let calls;
function api(draft, extra = {}) {
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, url, body, headers: opts.headers || {} });
    for (const [match, answer] of Object.entries(extra)) {
      const [m, path] = match.includes(' ') ? match.split(' ') : ['', match];
      if ((!m || m === method) && url.includes(path)) return typeof answer === 'function' ? answer(body) : answer;
    }
    if (method === 'GET' && url.endsWith('admin/generation-drafts/draft123abc')) return json(200, { draft, items: ITEMS });
    if (method === 'POST' && url.endsWith('/items')) return json(200, { changed: body.updates.length });
    throw new Error(`unexpected ${method} ${url}`);
  });
}

beforeEach(() => jest.clearAllMocks());

test('it says where the work will be saved, and that public comes after', async () => {
  api(header());
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  const dest = await screen.findByTestId('draft-destination');
  expect(dest).toHaveTextContent('A new set in Northwind. It is saved only when you accept.');
  expect(screen.getByText(/Public is not a choice here/)).toBeInTheDocument();
  // Every request names the draft's library.
  expect(calls[0].headers['X-Engage-Org']).toBe('org_team');
});

test('leaving one out is saved as you go, and accept saves only what is kept, switched on with a shelf', async () => {
  api(header(), {
    'POST /admin/generation-drafts/draft123abc/accept': (body) => json(200, {
      accepted: true, setId: 'presidentstrivia', setName: body.title, version: 1, active: body.activate, kept: 2, left: 1,
    }),
  });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  fireEvent.click(await screen.findByLabelText('Keep “Generated 2”'));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/items'))).toBe(true));
  expect(calls.find((c) => c.url.endsWith('/items')).body).toEqual({ updates: [{ seq: 2, decision: 'leave' }] });

  fireEvent.change(screen.getByLabelText('Shelf'), { target: { value: 'history' } });
  const accept = screen.getByTestId('draft-accept');
  expect(accept).toHaveTextContent('Accept 2 of 3 — save the set in Northwind');
  fireEvent.click(accept);
  expect(await screen.findByText('“Presidents Trivia” saved')).toBeInTheDocument();
  const sent = calls.find((c) => c.url.endsWith('/accept')).body;
  expect(sent).toEqual({ activate: true, title: 'Presidents Trivia', topic: 'history' });
});

// rejects (walk of dev d2ba71d5; owner, 21 Oct 2026: "accepting switches it
// on"): a plain Accept with no shelf saving the set switched off unasked.
test('switched on by default: with no shelf Accept waits and says why; unticking saves it off', async () => {
  api(header(), {
    'POST /admin/generation-drafts/draft123abc/accept': json(200, { accepted: true, setId: 's', setName: 'S', active: false, kept: 3 }),
  });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  await screen.findByTestId('draft-accept');
  const on = screen.getByRole('checkbox', { name: /Switch it on now/ });
  expect(on).toBeChecked();
  expect(on).not.toBeDisabled();
  expect(screen.getByTestId('draft-accept')).toBeDisabled();
  expect(screen.getByTestId('draft-needs-shelf')).toHaveTextContent(/Choose a shelf to switch it on/);
  fireEvent.click(on);
  expect(screen.queryByTestId('draft-needs-shelf')).toBeNull();
  fireEvent.click(screen.getByTestId('draft-accept'));
  await screen.findByText(/switched off for now/);
  expect(calls.find((c) => c.url.endsWith('/accept')).body.activate).toBe(false);
});

test('adding to a set writes ONE new version through the importer, then records it', async () => {
  const draft = header({ mode: 'append', appendMode: 'new', targetSetId: 'history', targetVersion: 4, title: 'History Quiz' });
  const QUESTIONS = { questions: [
    { id: 'c001#001', Category: 'Presidents', title: 'FIRST PRESIDENT', QuestionNumber: 1, questionDetail: 'Who?',
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', difficulty: 'medium' },
  ] };
  api(draft, {
    'accept': (body) => (body.phase === 'claim'
      ? json(200, { claimed: true, items: ITEMS, left: 0, activeVersion: 4 })
      : json(200, { accepted: true })),
    'GET /question-sets/history/questions': json(200, QUESTIONS),
    'POST /admin/upload-questions': json(200, { version: 5, questionCount: 4 }),
  });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  expect(await screen.findByTestId('draft-destination')).toHaveTextContent('Adds to “History Quiz” in Northwind');
  const accept = screen.getByTestId('draft-accept');
  expect(accept).toHaveTextContent('Accept 3 of 3 — saves version 5');
  fireEvent.click(accept);
  expect(await screen.findByText('Version 5 saved')).toBeInTheDocument();
  const save = calls.find((c) => c.url.endsWith('admin/upload-questions'));
  expect(save.body.replaceSetId).toBe('history');
  expect(save.body.fileContent).toContain('FIRST PRESIDENT');
  expect(save.body.fileContent).toContain('Generated 3');
  expect(save.headers['X-Engage-Org']).toBe('org_team');
  const complete = calls.filter((c) => c.url.endsWith('/accept')).map((c) => c.body)[1];
  expect(complete).toEqual({ phase: 'complete', version: 5, previousVersion: 4, kept: 3, left: 0 });
  expect(screen.getByRole('button', { name: /Undo — back to version 4/ })).toBeInTheDocument();
});

test('a failed save hands the draft back: the claim is released and nothing is said to be saved', async () => {
  const draft = header({ mode: 'append', appendMode: 'new', targetSetId: 'history', targetVersion: 4, title: 'History Quiz' });
  api(draft, {
    'accept': (body) => (body.phase === 'claim'
      ? json(200, { claimed: true, items: ITEMS, left: 0, activeVersion: 4 })
      : json(200, { released: true })),
    'GET /question-sets/history/questions': json(200, { questions: [] }),
    'POST /admin/upload-questions': json(500, { error: 'The table was busy.' }),
  });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  fireEvent.click(await screen.findByTestId('draft-accept'));
  expect(await screen.findByText('The table was busy.')).toBeInTheDocument();
  expect(calls.filter((c) => c.url.endsWith('/accept')).map((c) => c.body.phase)).toEqual(['claim', 'release']);
  expect(screen.queryByText(/saved/)).toBeNull();
});

test('regenerating a category says what it costs before it calls the model', async () => {
  api(header(), {
    'POST /admin/ai-generate-trivia': (body) => json(202, { jobId: 'job1', draftId: body.draftId, requested: 2 }),
  });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  const buttons = await screen.findAllByRole('button', { name: /Regenerate this category/ });
  fireEvent.click(buttons[0]);
  expect(screen.getByTestId('draft-regen')).toHaveTextContent('about 1,400 output tokens');
  expect(calls.some((c) => c.url.includes('ai-generate'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Write them' }));
  await waitFor(() => expect(calls.some((c) => c.url.includes('ai-generate-trivia'))).toBe(true));
  expect(calls.find((c) => c.url.includes('ai-generate-trivia')).body)
    .toEqual({ draftId: 'draft123abc', regenerate: { category: 'Founders', count: 2 } });
});

test('a discarded draft offers Restore', async () => {
  api(header({ status: 'discarded', daysLeft: 6 }), {
    'POST /admin/generation-drafts/draft123abc/restore': json(200, { restored: true }),
  });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  expect(await screen.findByText('Draft discarded')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Restore it/ }));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(true));
});

test('with unsaved edits in the editor, accepting waits and says why', async () => {
  api(header({ mode: 'append', targetSetId: 'history', targetVersion: 2, title: 'History Quiz' }));
  render(<DraftReview draftId="draft123abc" libraryKey="" libraries={LIBS} blockAccept="Save or discard them first." />);
  expect(await screen.findByTestId('draft-accept')).toBeDisabled();
  expect(screen.getByText('Save or discard them first.')).toBeInTheDocument();
});
