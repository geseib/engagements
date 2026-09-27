/**
 * A POLL ON THE WALL — components/stage/PollBoard.jsx (typed polls, 27 Sep
 * 2026: "showing the options for poll can be the same one that starts showing
 * the results").
 *
 * rejects: a poll whose options are not on the wall until someone answers;
 * a board that invents its own arithmetic instead of drawing the tally; a
 * binary that ignores its own labels; an open poll that shows nothing, or
 * says nobody answered while the round is still open.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import PollBoard from '../components/stage/PollBoard';

const CHOICE = { kind: 'choice', options: ['Monday', 'Wednesday', 'Friday'], allowMultiple: false };

test('asked and not yet answered: every option is already on the wall, at 0%', () => {
  render(<PollBoard question={CHOICE} tally={null} live />);
  for (const o of CHOICE.options) expect(screen.getByText(o)).toBeInTheDocument();
  expect(screen.getAllByText('0%')).toHaveLength(3);
  expect(screen.getByText('Answers fill in here as they arrive.')).toBeInTheDocument();
});

test('the same board fills in from the tally, and marks the most picked', () => {
  render(<PollBoard question={CHOICE} tally={{ kind: 'choice', n: 4, counts: [1, 0, 3], other: 0, otherIds: [], texts: [] }} live />);
  expect(screen.getByText('4 answered so far.')).toBeInTheDocument();
  expect(screen.getByText('75%')).toBeInTheDocument();
  expect(screen.getByText('Most picked')).toBeInTheDocument();
});

test('a binary reads in its own labels', () => {
  render(<PollBoard
    question={{ kind: 'yesno', yesLabel: 'Approve', noLabel: 'Decline', unsure: false }}
    tally={{ kind: 'yesno', n: 3, counts: { yes: 2, no: 1, unsure: 0 }, whys: { yes: [], no: [], unsure: [] }, texts: [] }}
  />);
  expect(screen.getByText(/Approve 67%/)).toBeInTheDocument();
  expect(screen.getByText(/Decline 33%/)).toBeInTheDocument();
});

test('an open poll shows the answers themselves, and "nobody" only once it is over', () => {
  const q = { kind: 'text', textLength: 'short', maxLength: 280 };
  const { rerender } = render(<PollBoard question={q} tally={{ kind: 'text', n: 0, answerIds: [], texts: [] }} live />);
  expect(screen.queryByText('Nobody answered this one.')).toBeNull();
  rerender(<PollBoard question={q} tally={{ kind: 'text', n: 2, answerIds: ['q:0', 'q:1'], texts: [{ id: 'q:0', text: 'Fridays' }, { id: 'q:1', text: 'Tuesdays' }] }} />);
  expect(screen.getByText(/Fridays/)).toBeInTheDocument();
  expect(screen.getByText(/Tuesdays/)).toBeInTheDocument();
  rerender(<PollBoard question={q} tally={{ kind: 'text', n: 0, answerIds: [], texts: [] }} />);
  expect(screen.getByText('Nobody answered this one.')).toBeInTheDocument();
});
