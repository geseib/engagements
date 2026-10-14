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
