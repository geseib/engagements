// src/src/__tests__/hostConsoleRead.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskComposerBody } from '../components/AskComposer';
import ReadPanel from '../components/console/panels/ReadPanel';
import { LobbyPanel, FeedbackPanel, EndedPanel, RoomQuestionPanel } from '../components/console/panels/SimplePanels';
import AskStage from '../components/stage/AskStage';

test('the composer body renders without a dialog, and sends', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true });
  const onClose = jest.fn();
  render(<AskComposerBody suggestions={[]} onSend={onSend} onClose={onClose} />);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('.askc.askc--inline')).not.toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'The question the room sees' }), { target: { value: 'Who first?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to the room' }));
  await screen.findByRole('button', { name: 'Send to the room' });
  expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ideas', question: 'Who first?' }));
  expect(onClose).toHaveBeenCalled();
});

test('the read panel draws the read, and the composer beside it when open', () => {
  render(<ReadPanel kicker="Round 2 · What we heard · page 1 of 2" markdown={'## Discussion topics\n- Who would miss it?'} composer={<div data-testid="composer" />} />);
  expect(screen.getByText('Who would miss it?')).toBeInTheDocument();
  expect(screen.getByTestId('composer').closest('.hc-cols')).not.toBeNull();
  expect(screen.getByTestId('composer').closest('.hc-cols')).toHaveClass('is-read');
});

/* THE COMPOSER'S SEND STAYS ON SCREEN (walk, 15 Oct: Send at y≈1259 on a
   768px laptop). The columns start at the top of the main area, so the
   composer's height can be the main area's own: the kicker rides in the read's
   column while composing. */
test('composing: the kicker sits in the read column, so the composer starts at the top', () => {
  const { container } = render(<ReadPanel kicker="Round 2 · Ask the room" markdown="x" composer={<div data-testid="composer" />} />);
  const panel = container.querySelector('.hc-panel');
  expect(panel).toHaveClass('is-composing');
  expect(panel.firstElementChild).toHaveClass('hc-cols');
  expect(screen.getByText('Round 2 · Ask the room').closest('.hc-cols')).not.toBeNull();
});

test('the read panel without a composer is one column', () => {
  const { container } = render(<ReadPanel kicker="Round 2" markdown="Plain words." />);
  expect(container.querySelector('.hc-cols')).toHaveClass('is-one');
  expect(screen.getByText('Plain words.')).toBeInTheDocument();
});

test('lobby: the code, who has joined, or nobody yet', () => {
  const { rerender } = render(<LobbyPanel code="7924" joined={['Ada', 'Ben']} firstTask="Which process must go?" />);
  expect(screen.getByText('7924')).toBeInTheDocument();
  expect(screen.getByText('Ada')).toBeInTheDocument();
  expect(screen.getByText('Which process must go?')).toBeInTheDocument();
  rerender(<LobbyPanel code="7924" joined={[]} />);
  expect(screen.getByText('Nobody has joined yet.')).toBeInTheDocument();
});

test('lobby: two people with one name are both listed', () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<LobbyPanel code="7924" joined={['Sam', 'Sam']} />);
  expect(screen.getAllByText('Sam')).toHaveLength(2);
  expect(err.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
  err.mockRestore();
});

test('lobby: a chooser replaces the lobby', () => {
  render(<LobbyPanel code="7924" joined={['Ada']} chooser={<div data-testid="chooser" />} />);
  expect(screen.getByTestId('chooser')).toBeInTheDocument();
  expect(screen.queryByText('7924')).toBeNull();
});

test('feedback: comments as they land, pressable to the wall', () => {
  const onFeature = jest.fn();
  render(<FeedbackPanel comments={[{ commentId: 'c1', text: 'Fair', anchorLabel: 'Workie\'s read', featured: false }]} onFeature={onFeature} />);
  fireEvent.click(screen.getByRole('button', { name: /Fair/ }));
  expect(onFeature).toHaveBeenCalledWith('c1');
});

test('feedback: the featured one says it is on the wall; none yet says so', () => {
  const { rerender } = render(<FeedbackPanel comments={[{ commentId: 'c1', text: 'Fair', anchorLabel: 'Round 2', featured: true }]} onFeature={() => {}} />);
  expect(screen.getByRole('button', { name: /Fair/ })).toHaveClass('is-onwall');
  expect(screen.getByText(/On the wall now/)).toBeInTheDocument();
  rerender(<FeedbackPanel comments={[]} onFeature={() => {}} />);
  expect(screen.getByText('No comments yet.')).toBeInTheDocument();
});

test('ended: open the report', () => {
  const onOpenReport = jest.fn();
  render(<EndedPanel onOpenReport={onOpenReport} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open session report' }));
  expect(onOpenReport).toHaveBeenCalled();
});

test('a question for the room in the console: pressing an idea still puts it on the wall', () => {
  const onPick = jest.fn();
  const ask = { askId: 'c', kind: 'ideas', status: 'closed', question: 'Who first?', tally: { n: 2 }, ideas: [{ id: 'i1', text: 'The agencies' }, { id: 'i2', text: 'Discount signups' }], picked: [] };
  const { container } = render(<div className="hc"><RoomQuestionPanel><AskStage ask={ask} total={5} onPick={onPick} /></RoomQuestionPanel></div>);
  expect(container.querySelector('.hc .hc-panel .askstage')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /The agencies/ }));
  expect(onPick).toHaveBeenCalledWith('c', 'i1', true);
});
