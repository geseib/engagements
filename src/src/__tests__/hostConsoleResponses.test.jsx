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

/* THE STAGE'S READINESS GUARD (final review, 15 Oct). */
test('gathering: no rows, no press, the stage\'s words instead of "No responses yet."', () => {
  const onPutOnWall = jest.fn();
  render(<ResponsesPanel kicker="k" title="t" phase="VOTE" responses={R} status="gathering" onPutOnWall={onPutOnWall} onWallIndex={0} />);
  expect(screen.queryAllByTestId('hc-resp')).toHaveLength(0);
  expect(screen.getByText('Gathering responses…')).toBeInTheDocument();
  expect(screen.queryByText('No responses yet.')).toBeNull();
  expect(screen.queryByText('Press a response to put it on the wall.')).toBeNull();
});

test('failed: says the results did not load, and the retry runs', () => {
  const onRetry = jest.fn();
  render(<ResponsesPanel kicker="k" title="t" phase="RESULTS" responses={R} status="failed" gatheringNoun="results" onRetry={onRetry} />);
  expect(screen.queryAllByTestId('hc-resp')).toHaveLength(0);
  expect(screen.getByText('The results did not load.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalled();
});

test('answering with a press: newest first, so the first item shown is original index 2, and the press says 2', () => {
  const onPutOnWall = jest.fn();
  render(<ResponsesPanel kicker="k" title="t" phase="ASK" responses={R} authorsHidden onWallIndex={2} onPutOnWall={onPutOnWall} />);
  const items = screen.getAllByTestId('hc-resp');
  expect(items[0].textContent).toMatch('The Friday phone round-up');
  expect(items[0]).toHaveClass('is-onwall');
  expect(items[0].textContent).toMatch('On the wall now');
  expect(items[1]).not.toHaveClass('is-onwall');
  fireEvent.click(items[0]);
  expect(onPutOnWall).toHaveBeenCalledWith(2);
});

test('results with the names hidden show no names', () => {
  render(<ResponsesPanel kicker="k" title="t" phase="RESULTS" responses={R} authorsHidden />);
  const text = screen.getAllByTestId('hc-resp').map((n) => n.textContent).join(' ');
  expect(text).not.toMatch(/Ada|Ben|Cleo/);
  expect(text).toMatch('Weekly status meetings');
});
