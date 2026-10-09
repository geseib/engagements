/**
 * THE MOCKUP VIEWER (docs/design/build-room-history-and-stage-decide R2).
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ImageLoader } from '../buildroom/BuildImage';
import MockupViewer from '../buildroom/MockupViewer';

// jsdom has no PointerEvent: a MouseEvent carries the clientX the swipe reads.
if (!window.PointerEvent) window.PointerEvent = class PointerEvent extends MouseEvent {};

const ask = {
  askId: '004', kind: 'choice', prompt: 'How should it look and feel?', status: 'decided',
  options: [
    { label: 'A', title: 'Calm and clear', imageId: 'img-a' },
    { label: 'B', title: 'Playful', imageId: 'img-b' },
    { label: 'C', title: 'Plain, no picture', imageId: null },
    { label: 'D', title: 'Bold', imageId: 'img-d' },
  ],
  decision: { chosen: ['B'] },
};
const show = (props = {}) => render(
  <ImageLoader.Provider value={(id) => Promise.resolve(`blob:test/${id}`)}>
    <MockupViewer ask={ask} startLabel="B" backLabel="Back to Ask 4" onBack={jest.fn()} {...props} />
  </ImageLoader.Provider>,
);

test('only options with a picture get tabs; the start label is shown; the pick says so', async () => {
  show();
  const tabs = within(screen.getByRole('tablist', { name: 'Choices' })).getAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual(['A · Calm and clear', 'B · Playful · picked', 'D · Bold']);
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('B · Playful · picked');
  expect(await screen.findByRole('img', { name: 'Choice B: Playful' })).toHaveAttribute('src', 'blob:test/img-b');
  expect(screen.getByText('2 of 3')).toBeInTheDocument();
});

test('arrow keys flip, wrapping nowhere past the ends; the buttons flip too', () => {
  show();
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^D/);
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^D/);
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^A/);
  fireEvent.click(screen.getByRole('button', { name: 'Next choice' }));
  expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^B/);
  fireEvent.click(screen.getByRole('button', { name: 'Previous choice' }));
  expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^A/);
});

test('Back says where it goes, and Back and Esc both call onBack', () => {
  const onBack = jest.fn();
  show({ onBack, backLabel: 'Back to Send to Claude' });
  fireEvent.click(screen.getByRole('button', { name: /Back to Send to Claude/ }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onBack).toHaveBeenCalledTimes(2);
});

test('a swipe of 50 px flips; a shorter one does not', () => {
  show();
  const main = screen.getByTestId('brm-viewer-main');
  fireEvent.pointerDown(main, { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(main, { clientX: 270, pointerId: 1 });
  expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^B/);
  fireEvent.pointerDown(main, { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(main, { clientX: 240, pointerId: 1 });
  expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^D/);
});
