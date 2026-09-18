import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import ScoreCard from '../components/ScoreCard';

const CARD = {
  publicSetId: 'orgacme-safety', name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia',
  sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2, publicVersion: 2, questionCount: 30,
  contentHash: 'c'.repeat(64), sensitivity: ['graphic-medical'], promptDropped: true, publishedAt: '2026-08-19T10:01:00.000Z',
  review: { status: 'passed', reviewer: 'dai', decidedAt: '2026-08-19T10:00:00.000Z', note: 'Clinical, not gratuitous.', notice: ['graphic-medical'], checkedAt: '2026-08-19T09:00:00.000Z',
    findings: [{ questionId: 'c001#001', category: 'VIOLENCE', band: 'LOW' }, { questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Injuries in detail.' }] },
  log: [
    { event: 'checked', at: '2026-08-19T09:00:00.000Z', version: 2, outcome: 'escalated' },
    { event: 'decided', at: '2026-08-19T10:00:00.000Z', version: 2, decision: 'approve', reviewer: 'dai', note: 'Clinical, not gratuitous.' },
    { event: 'published', at: '2026-08-19T10:01:00.000Z', version: 2, publicVersion: 2 },
  ],
};
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let deleted;
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  deleted = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'DELETE') { deleted.push(JSON.parse(options.body)); return json({ takenDown: 'orgacme-safety' }); }
    return json(CARD);
  });
});

test('the identity line, the timeline newest first, and the findings uncertain first', async () => {
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
  const line = screen.getByTestId('scard-identity');
  expect(line).toHaveTextContent('Public v2');
  expect(line).toHaveTextContent('by Acme');
  expect(line).toHaveTextContent(/approved by dai, 19 Aug/i);
  expect(line).toHaveTextContent(/content notice: graphic medical/i);
  const events = screen.getAllByTestId('scard-event');
  expect(events[0]).toHaveTextContent(/published/i);
  expect(events[2]).toHaveTextContent(/checked/i);
  expect(events[1]).toHaveTextContent(/clinical, not gratuitous/i);
  const findings = screen.getAllByTestId('scard-finding');
  expect(findings[0]).toHaveTextContent('c001#014');
  expect(findings[0]).toHaveTextContent(/uncertain/i);
  expect(findings[0]).toHaveTextContent(/injuries in detail/i);
  expect(findings[1]).toHaveTextContent(/low/i);
});
test('Take down states the consequence, needs a note, and hands back the id', async () => {
  const onTakenDown = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={onTakenDown} />);
  fireEvent.click(await screen.findByRole('button', { name: /take down/i }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/gone for everyone/i);
  expect(dialog).toHaveTextContent(/keeps their copy and sees your note/i);
  const confirm = within(dialog).getByRole('button', { name: /^take down$/i });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Reported for graphic detail.' } });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(deleted).toEqual([{ note: 'Reported for graphic detail.' }]));
  await waitFor(() => expect(onTakenDown).toHaveBeenCalledWith('orgacme-safety'));
});
test('the back link calls onBack, and a missing set says so', async () => {
  const onBack = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={onBack} onTakenDown={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /public library/i }));
  expect(onBack).toHaveBeenCalled();
  global.fetch = jest.fn(async () => json({ error: 'No such public set.' }, 404));
  render(<ScoreCard publicSetId="gone" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/no such public set/i);
});
test('a card with no review renders without throwing (R17 Important #1)', async () => {
  const { review, ...noReview } = CARD;
  global.fetch = jest.fn(async () => json(noReview));
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
});
test('a typed note survives an accidental Escape, but a deliberate Cancel still works (R16)', async () => {
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /take down/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Still drafting this.' } });
  // Accidental exit, gated on the unsaved note: the dialog must stay open.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  // Deliberate exit, through requestClose: still works regardless of the note.
  fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
test('a failed takedown keeps the note and shows why, and a retry succeeds (R17 Important #3)', async () => {
  const onTakenDown = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={onTakenDown} />);
  fireEvent.click(await screen.findByRole('button', { name: /take down/i }));
  const dialog = await screen.findByRole('dialog');
  const note = within(dialog).getByRole('textbox', { name: /note/i });
  fireEvent.change(note, { target: { value: 'Reported for graphic detail.' } });

  global.fetch = jest.fn(async () => json({ error: 'boom' }, 500));
  fireEvent.click(within(dialog).getByRole('button', { name: /^take down$/i }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/boom/i);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(note).toHaveValue('Reported for graphic detail.');

  global.fetch = jest.fn(async (url, options = {}) => {
    deleted.push(JSON.parse(options.body));
    return json({ takenDown: 'orgacme-safety' });
  });
  fireEvent.click(within(dialog).getByRole('button', { name: /^take down$/i }));
  await waitFor(() => expect(deleted).toEqual([{ note: 'Reported for graphic detail.' }]));
  await waitFor(() => expect(onTakenDown).toHaveBeenCalledWith('orgacme-safety'));
  expect(onTakenDown).toHaveBeenCalledTimes(1);
});
