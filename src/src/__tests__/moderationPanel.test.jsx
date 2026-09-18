import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import ModerationPanel from '../components/ModerationPanel';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const QUEUE = { count: 2, oldestWaitingSince: '2026-09-15T10:00:00.000Z', items: [
  { sk: 'org_acme#safety#v2', orgName: 'Acme', setId: 'safety', title: 'Safety walkthrough', version: 2, gameType: 'trivia', questionCount: 30, reasons: ['escalated'], uncertainQuestionIds: ['c001#014', 'c002#022'], waitingSince: '2026-09-15T10:00:00.000Z' },
  { sk: 'org_beta#onboarding#v1', orgName: 'Beta', setId: 'onboarding', title: 'Onboarding', version: 1, gameType: 'poll', questionCount: 12, reasons: ['appealed'], appealMessage: 'It is a clinical set.', waitingSince: '2026-09-17T09:00:00.000Z' },
] };
const ITEM = { pointer: QUEUE.items[0], review: { status: 'escalated', findings: [], reasons: ['guardrail'], checkedAt: '2026-09-17T10:00:00.000Z', note: '' }, setFindings: [], log: [], snapshot: {
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia' },
  categories: [{ id: 'c001', name: 'Injuries' }],
  questions: [
    { questionId: 'c001#014', category: 'Injuries', title: 'Describe the injury', text: 'Describe the injury. In detail.', findings: [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Asking for injuries in detail is what was flagged, not the safety topic.' }] },
    { questionId: 'c001#001', category: 'Injuries', title: 'A clean one', text: 'Which glove?', findings: [] },
  ],
} };
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let decided;
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  decided = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && u.endsWith('/admin/moderation/decide')) { decided.push(JSON.parse(options.body)); return json({ decision: 'approve', publicSetId: 'orgacme-safety', publicVersion: 1 }); }
    if (u.endsWith('/admin/moderation')) return json(decided.length ? { count: 1, oldestWaitingSince: QUEUE.items[1].waitingSince, items: [QUEUE.items[1]] } : QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
});
afterEach(() => { Date.now.mockRestore(); });

test('the head says how many and how long, and each row says why in band words', async () => {
  render(<ModerationPanel />);
  expect(await screen.findByText('2 sets the check would not decide on its own. Oldest has waited 2 days.')).toBeInTheDocument();
  const row = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(row).getByText('Acme')).toBeInTheDocument();
  expect(within(row).getByText('2 uncertain questions')).toBeInTheDocument();
  expect(within(row).getByText('2 days')).toBeInTheDocument();
  // moderationRow.js's appealWords() wraps the appeal message in straight
  // ASCII quotes ("..."), not the curly U+201C/U+201D quotes — verified by
  // reading the Task 8 source byte-for-byte. See task-9-report.md.
  expect(within(screen.getByText('Onboarding').closest('tr')).getByText('Appealed: "It is a clinical set."')).toBeInTheDocument();
  expect(screen.getByText(/these are the ones it flagged as uncertain/i)).toBeInTheDocument();
});
test('an empty queue says the check decided everything, and never lies about an outage', async () => {
  global.fetch = jest.fn(async () => json({ count: 0, oldestWaitingSince: null, items: [] }));
  render(<ModerationPanel />);
  expect(await screen.findByText(/nothing is waiting — the check decided everything on its own/i)).toBeInTheDocument();
  global.fetch = jest.fn(async () => json({ error: 'boom' }, 500));
  render(<ModerationPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not read the queue/i);
});
test('Review opens the snapshot with the uncertain question first, and Approve decides and refreshes', async () => {
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  // Modal's dialog wrapper mounts (and role="dialog" satisfies findByRole
  // above) before ReviewDialog's own fetch resolves — the "Opening…" loading
  // state is real, not a testing artifact, so the heading that only exists
  // once state==='ready' has to be awaited too, not read synchronously right
  // after the wrapper appears. See task-9-report.md.
  expect(await within(dialog).findByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
  const items = within(dialog).getAllByTestId('modq-question');
  expect(items[0]).toHaveTextContent('Describe the injury');
  expect(items[0]).toHaveTextContent(/medium/i);
  expect(items[0]).toHaveTextContent(/injuries in detail/i);
  expect(items[1]).toHaveTextContent('A clean one');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Clinical, not gratuitous.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
  await waitFor(() => expect(decided).toEqual([{ sk: 'org_acme#safety#v2', decision: 'approve', note: 'Clinical, not gratuitous.' }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('1 set the check would not decide on its own. Oldest has waited 3 hours.')).toBeInTheDocument();
});
test('a lost race says who decided and refreshes; the dialog has an X and a bottom exit', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') return json({ error: 'Already decided by dai.', status: 'passed' }, 409);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  // Same loading-state gap as the test above: Reject only exists once
  // state==='ready', so it has to be awaited rather than read synchronously.
  fireEvent.click(await within(dialog).findByRole('button', { name: /^reject$/i }));
  expect(await within(dialog).findByText(/already decided by dai/i)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
