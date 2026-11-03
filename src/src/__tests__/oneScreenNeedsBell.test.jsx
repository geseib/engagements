/**
 * THE BELL ON ONE SCREEN (components/needs/OneScreenNeedsBell.jsx; experience
 * plan §3.3, owner decisions 2 and 4, Phase 1b).
 *
 * // rejects: a name on the room's screen. On one screen the laptop is what
 * //          the room reads, so the bell is a count and the sheet lists kinds
 * //          until "Show on this screen" is pressed for one item, and asked.
 * // rejects: "on your phone" when no phone is connected (PLAN §3.3).
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import OneScreenNeedsBell from '../components/needs/OneScreenNeedsBell';
import { needsYou } from '../config/needsYou';

const needs = needsYou({
  players: [{ name: 'Sam Okafor', handover: { requested: true, requestedAt: new Date().toISOString() } }],
  late: { notReviewed: 2, answers: 2 },
});

test('the button is a count, never a name', () => {
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} />);
  const bell = screen.getByTestId('needs-bell');
  expect(screen.getByTestId('needs-bell-count')).toHaveTextContent('1');
  expect(bell.textContent + bell.getAttribute('aria-label') + bell.getAttribute('title')).not.toMatch(/Sam/);
});

test('the sheet starts "The room can see this screen" and lists kinds, no names', () => {
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  const sheet = screen.getByRole('dialog');
  expect(within(sheet).getByRole('heading')).toHaveTextContent('The room can see this screen');
  expect(sheet).toHaveTextContent('A name request');
  expect(sheet).toHaveTextContent('2 late answers to review');
  expect(sheet.textContent).not.toMatch(/Sam/);
  expect(within(sheet).queryByRole('button', { name: /Let them/ })).toBeNull();
});

test('Show on this screen asks first, then shows that one item with its buttons', () => {
  const onAct = jest.fn();
  render(<OneScreenNeedsBell needs={needs} onAct={onAct} />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  const nameItem = screen.getByTestId('needs-kind-name-request');
  fireEvent.click(within(nameItem).getByRole('button', { name: 'Show on this screen' }));
  expect(nameItem).toHaveTextContent('The room will see this. Show it?');
  expect(nameItem.textContent).not.toMatch(/Sam/);
  fireEvent.click(within(nameItem).getByRole('button', { name: 'Show it' }));
  expect(nameItem).toHaveTextContent('Sam Okafor wants their name on a new device');
  // The late item stays a count.
  expect(screen.getByTestId('needs-kind-late').textContent).not.toMatch(/Sam/);
  fireEvent.click(within(nameItem).getByRole('button', { name: 'Let them: Sam Okafor' }));
  expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam Okafor' }), 'let');
});

test('no phone connected: Connect your phone, never "on your phone"', () => {
  const onConnectPhone = jest.fn();
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} onConnectPhone={onConnectPhone} />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  const sheet = screen.getByRole('dialog');
  expect(sheet.textContent).not.toMatch(/on your phone/i);
  fireEvent.click(within(screen.getByTestId('needs-kind-name-request')).getByRole('button', { name: 'Connect your phone' }));
  expect(onConnectPhone).toHaveBeenCalled();
});

test('phone connected: the item is said to be waiting there', () => {
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} remoteConnected />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  expect(screen.getByTestId('needs-kind-name-request')).toHaveTextContent('Waiting on your phone');
});

test('two exits: the X and Close', () => {
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByTestId('needs-bell'));
  fireEvent.click(screen.getByRole('button', { name: 'Close Needs you' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a private laptop (an event item on two screens): named, with buttons, no gate', () => {
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} oneScreen={false} />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  expect(screen.getByRole('dialog')).toHaveTextContent('Sam Okafor wants their name on a new device');
  expect(screen.getByRole('button', { name: 'Let them: Sam Okafor' })).toBeInTheDocument();
});

// rejects: owner, 2 Nov 2026 — "the bottom bar became 2 lines". The bell with
//          its word NEEDS YOU was the widest item in the dock, and it stood
//          there even with nothing waiting.
test('nothing waiting: nothing in the dock at all', () => {
  const { container } = render(<OneScreenNeedsBell needs={needsYou({})} onAct={() => {}} />);
  expect(screen.queryByTestId('needs-bell')).toBeNull();
  expect(container).toBeEmptyDOMElement();
});

test('compact: a bell and the count, no word; the name is in the label and title', () => {
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} />);
  const bell = screen.getByTestId('needs-bell');
  expect(bell.querySelector('svg')).not.toBeNull();
  expect(bell.querySelector('.dock-more-lbl')).toBeNull();
  expect(bell.textContent).toBe('1');
  expect(bell).toHaveAttribute('aria-label', 'Needs you, 1 waiting');
  expect(bell).toHaveAttribute('title', 'Needs you, 1 waiting');
});

test('only something to review: the bell and a dot, still no word', () => {
  render(<OneScreenNeedsBell needs={needsYou({ late: { notReviewed: 2, answers: 2 } })} onAct={() => {}} />);
  const bell = screen.getByTestId('needs-bell');
  expect(bell.querySelector('.dock-more-lbl')).toBeNull();
  expect(screen.queryByTestId('needs-bell-count')).toBeNull();
});

test('an open sheet stays open when the last item is handled', () => {
  const { rerender } = render(<OneScreenNeedsBell needs={needs} onAct={() => {}} />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  rerender(<OneScreenNeedsBell needs={needsYou({})} onAct={() => {}} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('Nothing needs you now.');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByTestId('needs-bell')).toBeNull();
});

// rejects: dev QA 1 Nov — the one-screen sheet said "The room can see this
//          screen" twice: once as its heading, once again on the item.
test('the sheet says "The room can see this screen" once, however many items', () => {
  render(<OneScreenNeedsBell needs={needs} onAct={() => {}} />);
  fireEvent.click(screen.getByTestId('needs-bell'));
  const sheet = screen.getByRole('dialog');
  expect(sheet.textContent.match(/The room can see this screen/g)).toHaveLength(1);
});
