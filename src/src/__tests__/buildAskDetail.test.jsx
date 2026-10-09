/**
 * A PAST ASK, OPENED FROM HISTORY (docs/design/build-room-history-and-stage-decide R1).
 * Read-only: the choices as shown, the result, the pick and how, what Claude was told.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ImageLoader } from '../buildroom/BuildImage';
import AskDetail from '../buildroom/BuildAskDetail';

const loader = (id) => Promise.resolve(`blob:test/${id}`);
const choice = (over = {}) => ({
  askId: '004', kind: 'choice', prompt: 'How should it look and feel?', detail: '', status: 'decided', source: 'agent',
  options: [
    { label: 'A', title: 'Calm and clear', imageId: 'img-a' },
    { label: 'B', title: 'Playful', imageId: 'img-b' },
  ],
  results: { total: 11, options: [{ label: 'A', title: 'Calm and clear', count: 4, pct: 36 }, { label: 'B', title: 'Playful', count: 7, pct: 64 }] },
  responses: [],
  decidedAt: '2026-10-08T14:58:00Z',
  decision: { direction: 'How should it look and feel? Playful. Keep the numbers big.', chosen: ['B'], method: 'vote', sentToAgent: true, decidedAt: '2026-10-08T14:58:00Z', deliveredAt: '2026-10-08T14:59:00Z' },
  fromIdeas: undefined,
  ...over,
});
const show = (ask, props = {}) => render(
  <ImageLoader.Provider value={loader}>
    <AskDetail ask={ask} onClose={jest.fn()} onViewMockup={jest.fn()} {...props} />
  </ImageLoader.Provider>,
);

test('a decided choice ask: the options with their pictures, the pick outlined, the direction and its kind', async () => {
  const onViewMockup = jest.fn();
  show(choice(), { onViewMockup, entry: { kind: 'decision', as: 'do-now', forAgent: true, askId: '004', createdAt: '2026-10-08T14:58:00Z' } });
  const dlg = screen.getByRole('dialog');
  expect(within(dlg).getByText(/^Ask 4 · Choose · decided /)).toBeInTheDocument();
  expect(within(dlg).getByText('How should it look and feel?')).toBeInTheDocument();
  expect(within(dlg).getByText("Picked · the room's choice, 7 to 4")).toBeInTheDocument();
  expect(within(dlg).getByText('Calm and clear')).toBeInTheDocument();
  const pickCard = within(dlg).getByText('Playful').closest('[data-pick]');
  expect(pickCard).toHaveAttribute('data-pick', 'true');
  expect(within(dlg).getByText('Calm and clear').closest('[data-pick]')).toHaveAttribute('data-pick', 'false');
  expect(within(dlg).getByText(/Claude was told/)).toBeInTheDocument();
  expect(within(dlg).getByText(/Keep the numbers big/)).toBeInTheDocument();
  expect(within(dlg).getByText(/Do now · sent /)).toBeInTheDocument();
  expect(within(dlg).getByText('Click a mockup to look closer.')).toBeInTheDocument();
  fireEvent.click(await within(dlg).findByRole('button', { name: /Look closer: Choice B/ }));
  expect(onViewMockup).toHaveBeenCalledWith('B');
});

test('held for Claude, later: says so until it is sent; then it was told, as Do now, at the sending row\'s time', () => {
  const ask = choice({ decision: { ...choice().decision, heldForLater: true, deliveredAt: null } });
  const decisionRow = { kind: 'decision', as: 'later', forAgent: false, askId: '004', createdAt: '2026-10-08T14:58:00Z' };
  const { rerender } = show(ask, { held: true, entry: decisionRow });
  expect(screen.getByText('Held for Claude, not sent yet')).toBeInTheDocument();
  expect(screen.queryByText(/Claude was told/)).toBeNull();
  const sentRow = { kind: 'direction', as: 'do-now', forAgent: true, askId: '004', createdAt: '2026-10-08T16:05:00Z' };
  rerender(
    <ImageLoader.Provider value={loader}>
      <AskDetail ask={ask} held={false} entry={sentRow} onClose={jest.fn()} onViewMockup={jest.fn()} />
    </ImageLoader.Provider>,
  );
  expect(screen.getByText(/Claude was told/)).toBeInTheDocument();
  const when = new Date('2026-10-08T16:05:00Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  expect(screen.getByText(`Do now · sent ${when} · Claude has it`.replace(' · Claude has it', ''), { exact: false })).toBeInTheDocument();
});

test('a choice with no votes does not say "0 to 0"', () => {
  show(choice({ results: { total: 0, options: [] } }));
  expect(screen.getByText("Picked · the room's choice")).toBeInTheDocument();
});

test('an Ideas ask lists the ideas with their votes and marks the picked one; no player name appears', () => {
  const ask = {
    askId: '005', kind: 'suggest', prompt: 'What should we add?', status: 'decided', options: [], decidedAt: '2026-10-08T15:10:00Z',
    results: { total: 9, ranked: [{ respId: 'r1', text: 'A map link', votes: 6, playerName: 'Priya' }, { respId: 'r2', text: 'A reminder', votes: 3, playerName: 'Dee' }] },
    responses: [{ respId: 'r1', text: 'A map link', playerName: 'Priya', votes: 6 }],
    decision: { direction: 'What should we add: A map link', chosen: ['r1'], method: 'vote', sentToAgent: true, deliveredAt: null },
  };
  const { container } = show(ask);
  expect(screen.getByText('A map link')).toBeInTheDocument();
  expect(screen.getByText('A reminder')).toBeInTheDocument();
  expect(screen.getByText('A map link').closest('[data-pick]')).toHaveAttribute('data-pick', 'true');
  expect(container.textContent).not.toMatch(/Priya|Dee/);
  expect(screen.queryByRole('button', { name: /Look closer/ })).toBeNull();
});

test('a rating shows the average and the spread', () => {
  const ask = {
    askId: '006', kind: 'rating', prompt: 'How is it?', status: 'decided', options: [], decidedAt: '2026-10-08T15:20:00Z',
    results: { total: 4, rating: { avg: 4.5, count: 4, dist: [0, 0, 0, 2, 2] } },
    decision: { direction: 'How is it: 4.5 out of 5', chosen: [], method: 'vote', sentToAgent: true },
  };
  show(ask);
  expect(screen.getByText('4.5')).toBeInTheDocument();
  expect(screen.getByText('average of 4')).toBeInTheDocument();
});

test('Close and the X both close it', () => {
  const onClose = jest.fn();
  show(choice(), { onClose });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close this window' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
