/**
 * A FAILED READ ON THE CONSOLE (components/console/panels/ReadPanel.jsx;
 * experience plan §4.2 row 5, Phase 1e).
 *
 * // rejects: audit A §2.2, "AI read failed → Console: Nothing. ReadPanel is
 * //          never passed failure, onRetry or onRedo": an empty "Workie's
 * //          read" card while the one-screen stage had the failure and Retry.
 */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import ReadPanel from '../components/console/panels/ReadPanel';

const failure = { headline: 'Workie could not finish the read.', detail: 'The model took too long. Try again in a moment.' };

test('a failure is a card with its headline, detail, Retry and Redo', () => {
  const onRetry = jest.fn();
  const onRedo = jest.fn();
  render(<ReadPanel kicker="Round 3" markdown="" failure={failure} onRetry={onRetry} onRedo={onRedo} />);
  const card = screen.getByTestId('read-failure');
  expect(card).toHaveAttribute('role', 'alert');
  expect(card).toHaveTextContent('Workie could not finish the read.');
  expect(card).toHaveTextContent('The model took too long.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onRedo).toHaveBeenCalledTimes(1);
});

test('while the automatic retry runs, the button says so and waits', () => {
  render(<ReadPanel kicker="Round 3" failure={failure} onRetry={() => {}} onRedo={() => {}} retrying />);
  expect(screen.getByRole('button', { name: 'Trying again…' })).toBeDisabled();
});

test('still writing: a line that says so, not an empty card', () => {
  render(<ReadPanel kicker="Round 3" markdown="" loading />);
  expect(screen.getByTestId('read-writing')).toHaveTextContent('Workie is reading the responses…');
});

test('a read that arrived renders as before', () => {
  render(<ReadPanel kicker="Round 3" markdown={'## Tensions\n\nSales and delivery disagree.'} />);
  expect(screen.queryByTestId('read-failure')).toBeNull();
  expect(screen.getByText('Sales and delivery disagree.')).toBeInTheDocument();
});

test('the console passes the page\'s failure and handlers to the read', () => {
  const host = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  expect(host).toMatch(/<ReadPanel [^>]*failure=\{aiSummaryFailure\} onRetry=\{handleRetryAISummary\} onRedo=\{handleRegenerateAISummary\}/);
});
