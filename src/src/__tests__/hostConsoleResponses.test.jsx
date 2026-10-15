// src/src/__tests__/hostConsoleResponses.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ResponsesPanel from '../components/console/panels/ResponsesPanel';

const R = [
  { answer: 'Weekly status meetings', playerName: 'Ada' },
  { answer: 'The paper sign-off sheet', playerName: 'Ben' },
  { answer: 'The Friday phone round-up', playerName: 'Cleo', isNew: true },
];

test('answering: the task, responses newest first, names hidden, still writing (Review Focus 1)', () => {
  render(<ResponsesPanel kicker="Round 2 · Answering" title="Meiji" task="Which process must go?" phase="ASK" responses={R} authorsHidden stillWriting={1} />);
  expect(screen.getByText('Which process must go?')).toBeInTheDocument();
  const items = screen.getAllByTestId('hc-resp').map((n) => n.textContent);
  expect(items[0]).toMatch('The Friday phone round-up');
  expect(items.join(' ')).not.toMatch(/Ada|Ben|Cleo/);
  expect(screen.getByText(/1 still writing/)).toBeInTheDocument();
});

test('voting: the room\'s order, Response N always, the one on the wall marked, a press puts one up', () => {
  const onPutOnWall = jest.fn();
  render(<ResponsesPanel kicker="Round 2 · Voting" title="The ballot" phase="VOTE" responses={R} authorsHidden={false} onWallIndex={2} onPutOnWall={onPutOnWall} />);
  const items = screen.getAllByTestId('hc-resp');
  expect(items[0].textContent).toMatch('Response 1');
  expect(items.map((n) => n.textContent).join(' ')).not.toMatch(/Ada|Ben|Cleo/);
  expect(items[2]).toHaveClass('is-onwall');
  fireEvent.click(items[1]);
  expect(onPutOnWall).toHaveBeenCalledWith(1);
});

test('results on a named round show names', () => {
  render(<ResponsesPanel kicker="Round 2 · Results" title="Results" phase="RESULTS" responses={R} authorsHidden={false} />);
  expect(screen.getAllByTestId('hc-resp')[0].textContent).toMatch('Ada');
});

test('no responses yet says so', () => {
  render(<ResponsesPanel kicker="k" title="t" phase="ASK" responses={[]} authorsHidden />);
  expect(screen.getByText('No responses yet.')).toBeInTheDocument();
});

test('between rounds shows Up next', () => {
  render(<ResponsesPanel kicker="k" title="t" phase="BETWEEN" responses={[]} upNext={{ title: 'Fleming', task: 'What accident is worth a second look?' }} />);
  expect(screen.getByText('Fleming')).toBeInTheDocument();
});
