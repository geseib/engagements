/**
 * QUESTIONS FOR THE ROOM IN THE REPORTS (docs/design/followup-icons, phase D).
 */
import React from 'react';
import { render } from '@testing-library/react';
import ReportFollowUps from '../components/ReportFollowUps';

const FOLLOW_UPS = [
  { kind: 'choice', question: 'Which test first?', options: ['On-call logs', 'Shadow invoices'], anchor: { section: 'Discussion topics', point: 2 }, status: 'closed', tally: { n: 3, counts: [2, 1] }, picked: [] },
  { kind: 'rate', statement: 'Bots at 3am', options: [], anchor: null, status: 'closed', tally: { n: 5, counts: [1, 2, 1, 0, 1], mean: 2.4 }, picked: [] },
  { kind: 'ideas', question: 'Who first?', options: [], anchor: null, status: 'closed', tally: { n: 4 }, picked: ['The two agencies'] },
  { kind: 'ideas', question: 'Never mind', options: [], anchor: null, status: 'cancelled', tally: null, picked: [] },
];

test('each question, where it came from, and its result in counts', () => {
  const { container } = render(<ReportFollowUps followUps={FOLLOW_UPS} />);
  const text = container.textContent;
  expect(text).toMatch(/Questions for the room/);
  expect(text).toMatch(/Choose · from Discussion topics, point 2/);
  expect(text).toMatch(/A · On-call logs — 2/);
  expect(text).toMatch(/2\.4 average of 5/);
  expect(text).toMatch(/5 · Agree — 1/);
  expect(container.querySelector('blockquote').textContent).toBe('The two agencies');
  expect(text).toMatch(/4 ideas · 1 shown/);
  expect(text).toMatch(/Cancelled before the results were shown/);
  expect(text).not.toMatch(/%/);
});

test('nothing sent, nothing drawn', () => {
  expect(render(<ReportFollowUps followUps={[]} />).container.innerHTML).toBe('');
});

// Session flow v3 §4.2: the full record of each question, and every idea in
// two groups (owner, 15 Oct, Q1).
test('the full record: the point, what Workie suggested, what changed, the reason, timing and the room', () => {
  const f = {
    kind: 'ideas', question: 'What is one measurable gate?', options: [], anchor: { section: 'Discussion topics', point: 3 },
    anchorText: 'Maya Chen proposes a staged commitment', origin: 'edited', edits: ['question'],
    suggested: { kind: 'ideas', question: 'Which gate would justify it?', why: 'Turns the staged commitment into a test.', answers: [2, 4] },
    status: 'closed', sentAt: '2026-10-14T01:12:00Z', closedAt: '2026-10-14T01:14:00Z', roomSize: 4, sentFrom: 'remote',
    tally: { n: 4 }, picked: ['In a limited trial'],
    ideas: [{ text: 'In a limited trial', shown: true }, { text: 'After the pilot', shown: false }, { text: 'Never', shown: false }],
  };
  const { container } = render(<ReportFollowUps followUps={[f]} />);
  const text = container.textContent;
  expect(text).toMatch(/“Maya Chen proposes a staged commitment”/);
  expect(text).toMatch(/Workie suggested: “Which gate would justify it\?” · Edited by the host \(question\)/);
  expect(text).toMatch(/Workie’s reason: Turns the staged commitment into a test\. · Drawn from responses 2 and 4/);
  expect(text).toMatch(/Open .+–.+ · 4 of 4 in the room answered · Sent from the Remote/);
  expect(text).toMatch(/Shown to the room \(1\)/);
  expect(text).toMatch(/Not shown \(2\)/);
  expect([...container.querySelectorAll('blockquote')].map((b) => b.textContent)).toEqual(['In a limited trial', 'After the pilot', 'Never']);
});

test('sent as written, and written by the host, each say so', () => {
  const base = { kind: 'rate', statement: 'Ship it', options: [], status: 'closed', tally: { n: 2, counts: [0, 0, 1, 1, 0], mean: 3.5 } };
  expect(render(<ReportFollowUps followUps={[{ ...base, origin: 'suggested' }]} />).container.textContent).toMatch(/Sent as Workie wrote it/);
  expect(render(<ReportFollowUps followUps={[{ ...base, origin: 'host' }]} />).container.textContent).toMatch(/Written by the host/);
});
