/**
 * AN AI DRAFT ARRIVES WITH A TOPIC (components/DraftReview.jsx). The owner,
 * 23 Oct 2026: "when ai generates question sets. it should auto tag (based on
 * a list of categories) right now the user gets an error activating sets
 * because they dont have a tag".
 *
 * The run proposes a topic and tags (admin/shared/draft-topic.js); the review
 * pre-fills them, says "(suggested)", lets the person change either, and
 * Switch it on now works without a pick.
 *
 * Only `../auth/authFetch` is mocked, as in draftReview.test.jsx.
 *
 * // rejects: the "Choose a shelf to switch it on" blocker shown over a
 * //          suggestion the run already made; a suggestion silently replaced
 * //          by a poll while the person is choosing; suggested tags the
 * //          person removed coming back on accept; an addition to an unfiled
 * //          set that cannot file it; an addition that re-files a filed set.
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
const q = (n, category) => ({
  title: `Generated ${n}`, questionDetail: `Q${n}?`, category, difficulty: 'medium',
  optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', tags: [],
});
const header = (over = {}) => ({
  draftId: 'draft123abc', status: 'ready', scope: 'org', orgId: 'org_team', kind: 'trivia',
  engagementType: 'trivia', mode: 'new', appendMode: '', targetSetId: '', targetVersion: null,
  title: 'Presidents Trivia', requested: 2, produced: 2, warnings: [], error: '', promptSource: null,
  usage: { inputTokens: 100, outputTokens: 1400 }, tokensPerItem: 700, topic: '',
  suggestedTopic: 'history', suggestedTags: ['us-presidents', 'founders'], suggestedTopicSource: 'model',
  requestTags: [], targetTopic: '',
  createdAt: '2026-10-23T10:00:00.000Z', daysLeft: 30, ...over,
});
const ITEMS = [
  { seq: 1, decision: 'keep', edited: false, item: q(1, 'Founders') },
  { seq: 2, decision: 'keep', edited: false, item: q(2, 'Treaties') },
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
    throw new Error(`unexpected ${method} ${url}`);
  });
}
const accepted = (body) => json(200, {
  accepted: true, setId: 'presidentstrivia', setName: body.title, version: 1, active: body.activate, kept: 2, left: 0,
});

beforeEach(() => jest.clearAllMocks());

test('the suggested topic and tags are pre-filled, marked, and Accept switches it on without a pick', async () => {
  api(header(), { 'POST /admin/generation-drafts/draft123abc/accept': accepted });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  const select = await screen.findByLabelText(/^Shelf/);
  expect(select).toHaveValue('history');
  expect(screen.getByTestId('draft-topic-suggested')).toHaveTextContent('(suggested)');
  expect(screen.getByText(/Suggested from the questions/)).toBeInTheDocument();
  expect(screen.queryByTestId('draft-needs-shelf')).toBeNull();
  expect(screen.getByTestId('draft-tags')).toHaveTextContent('us-presidents');
  expect(screen.getByTestId('draft-tags')).toHaveTextContent('founders');
  const accept = screen.getByTestId('draft-accept');
  expect(accept).not.toBeDisabled();
  fireEvent.click(accept);
  expect(await screen.findByText(/switched on/)).toBeInTheDocument();
  expect(calls.find((c) => c.url.endsWith('/accept')).body).toEqual({
    activate: true, title: 'Presidents Trivia', topic: 'history', tags: ['us-presidents', 'founders'],
  });
});

test('changing the topic and removing a tag is what is sent; the "(suggested)" mark goes', async () => {
  api(header(), { 'POST /admin/generation-drafts/draft123abc/accept': accepted });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  fireEvent.change(await screen.findByLabelText(/^Shelf/), { target: { value: 'politics-society' } });
  expect(screen.queryByTestId('draft-topic-suggested')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag founders' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag us-presidents' }));
  const add = screen.getByLabelText('Add a tag');
  fireEvent.change(add, { target: { value: 'Heads of State' } });
  fireEvent.keyDown(add, { key: 'Enter' });
  fireEvent.click(screen.getByTestId('draft-accept'));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/accept'))).toBe(true));
  expect(calls.find((c) => c.url.endsWith('/accept')).body).toEqual({
    activate: true, title: 'Presidents Trivia', topic: 'politics-society', tags: ['heads-of-state'],
  });
});

test('removing every suggested tag sends an empty list, not "use the suggestion"', async () => {
  api(header({ suggestedTags: ['founders'] }), { 'POST /admin/generation-drafts/draft123abc/accept': accepted });
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove tag founders' }));
  fireEvent.click(screen.getByTestId('draft-accept'));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/accept'))).toBe(true));
  expect(calls.find((c) => c.url.endsWith('/accept')).body.tags).toEqual([]);
});

test('the builder\'s own topic wins over the suggestion, and is not marked suggested', async () => {
  api(header({ topic: 'music' }));
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  expect(await screen.findByLabelText(/^Shelf/)).toHaveValue('music');
  expect(screen.queryByTestId('draft-topic-suggested')).toBeNull();
});

const APPEND = {
  mode: 'append', appendMode: 'new', targetSetId: 'history', targetVersion: 4, title: 'History Quiz',
};
const appendApi = (draft, edit) => api(draft, {
  'accept': (body) => (body.phase === 'claim'
    ? json(200, { claimed: true, items: ITEMS, left: 0, activeVersion: 4 })
    : json(200, { accepted: true })),
  'GET /question-sets/history/questions': json(200, { questions: [] }),
  'POST /admin/upload-questions': json(200, { version: 5, questionCount: 2 }),
  ...(edit ? { 'PUT /admin/edit-question-set/history': edit } : {}),
});

test('adding to an UNFILED set offers the suggestion and files the set once the questions are saved', async () => {
  appendApi(header(APPEND), json(200, { updated: { topic: 'history' } }));
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  const offer = await screen.findByTestId('draft-target-topic');
  expect(offer).toHaveTextContent('(suggested)');
  expect(screen.getByLabelText(/Shelf for “History Quiz”/)).toHaveValue('history');
  fireEvent.click(screen.getByTestId('draft-accept'));
  expect(await screen.findByText('Version 5 saved')).toBeInTheDocument();
  const edit = calls.find((c) => c.method === 'PUT' && c.url.endsWith('admin/edit-question-set/history'));
  expect(edit.body).toEqual({ topic: 'history', scope: 'org' });
  expect(edit.headers['X-Engage-Org']).toBe('org_team');
  // Filed AFTER the version was saved, never before.
  const order = calls.map((c) => `${c.method} ${c.url.split('/').slice(-2).join('/')}`);
  expect(order.findIndex((o) => o.includes('upload-questions'))).toBeLessThan(order.findIndex((o) => o.startsWith('PUT')));
});

test('"Leave it unfiled" files nothing', async () => {
  appendApi(header(APPEND));
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  fireEvent.change(await screen.findByLabelText(/Shelf for “History Quiz”/), { target: { value: '' } });
  fireEvent.click(screen.getByTestId('draft-accept'));
  expect(await screen.findByText('Version 5 saved')).toBeInTheDocument();
  expect(calls.some((c) => c.method === 'PUT')).toBe(false);
});

test('adding to a set that HAS a topic offers nothing and files nothing', async () => {
  appendApi(header({ ...APPEND, targetTopic: 'politics-society' }));
  render(<DraftReview draftId="draft123abc" libraryKey="org_team" libraries={LIBS} />);
  fireEvent.click(await screen.findByTestId('draft-accept'));
  expect(await screen.findByText('Version 5 saved')).toBeInTheDocument();
  expect(screen.queryByTestId('draft-target-topic')).toBeNull();
  expect(calls.some((c) => c.method === 'PUT')).toBe(false);
});
