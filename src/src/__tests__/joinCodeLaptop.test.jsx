/**
 * THE JOIN CODE ON THE HOST'S OWN LAPTOP (owner, 3 Nov 2026): "the qr code
 * should also pop up in the host screen when they hover or click on the room
 * code ... they don't have to look at other screen."
 *
 * Two screens: the top bar's code shows a card on this laptop (the join QR,
 * the code large, the address) on hover or focus, a click pins it, Escape or
 * its close button shuts it. None of that touches the room's window; the
 * room's toggle is the card's own "Show on the room's screen" button. One
 * screen keeps the plain toggle (the laptop IS the room's screen).
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ConsoleTop from '../components/console/ConsoleTop';
import HW from '../config/hostWords';

jest.mock('../components/HostNotificationsBell', () => () => null);
jest.mock('../components/HelpButton', () => () => null);

const QR = { playUrl: 'https://engage.test.invalid/play?gameId=7924', joinUrl: 'engage.test.invalid/play' };
const bar = (over = {}) => {
  const onJoin = jest.fn();
  const utils = render(
    <ConsoleTop title="Relay" code="7924" onJoin={onJoin} joinPressed={false} presentHref="/present?gameId=7924" joinQr={QR} {...over} />,
  );
  return { ...utils, onJoin };
};
const trigger = () => screen.getByRole('button', { name: /^Join 7924\./ });
const card = () => screen.queryByRole('dialog', { name: HW.joinCardLabel });

test('hover shows the card: the QR, the code large and the address', () => {
  const { container, onJoin } = bar();
  expect(card()).toBeNull();
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  fireEvent.mouseEnter(container.querySelector('[data-slot="join"]'));
  const c = card();
  expect(c).not.toBeNull();
  expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  // qrcode.react is mocked suite-wide (setupTests, as markup text): the value is what counts.
  expect(screen.getByRole('img', { name: HW.joinQrLabel }).textContent).toContain(`data-value="${QR.playUrl}"`);
  expect(c.querySelector('.hc-joincard-code').textContent).toBe('7924');
  expect(c.querySelector('.hc-joincard-url').textContent).toBe(QR.joinUrl);
  // Peeking never pins: no close button, and leaving takes it away.
  expect(screen.queryByRole('button', { name: HW.joinCardClose })).toBeNull();
  fireEvent.mouseLeave(container.querySelector('[data-slot="join"]'));
  expect(card()).toBeNull();
  expect(onJoin).not.toHaveBeenCalled();
});

test('focus shows it too, for the keyboard', () => {
  bar();
  act(() => { trigger().focus(); });
  expect(card()).not.toBeNull();
});

test('a click pins it, with a close button; leaving does not close it; the close button does', () => {
  const { container, onJoin } = bar();
  fireEvent.click(trigger());
  expect(card()).not.toBeNull();
  fireEvent.mouseLeave(container.querySelector('[data-slot="join"]'));
  expect(card()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: HW.joinCardClose }));
  expect(card()).toBeNull();
  expect(onJoin).not.toHaveBeenCalled();
});

test('Escape closes it, and is spent', () => {
  bar();
  fireEvent.click(trigger());
  const later = jest.fn();
  window.addEventListener('keydown', later);
  try {
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(card()).toBeNull();
    expect(later).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('keydown', later);
  }
});

test('a click elsewhere closes a pinned card', () => {
  bar();
  fireEvent.click(trigger());
  fireEvent.mouseDown(document.body);
  expect(card()).toBeNull();
});

test('hover and click never change the room\'s window; the card\'s own button does', () => {
  const { container, onJoin, rerender } = bar();
  fireEvent.mouseEnter(container.querySelector('[data-slot="join"]'));
  fireEvent.click(trigger());
  expect(onJoin).not.toHaveBeenCalled();
  const room = screen.getByRole('button', { name: HW.joinShowOnRoomScreen });
  expect(room).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(room);
  expect(onJoin).toHaveBeenCalledTimes(1);
  rerender(<ConsoleTop title="Relay" code="7924" onJoin={onJoin} joinPressed presentHref="/present?gameId=7924" joinQr={QR} />);
  expect(screen.getByRole('button', { name: HW.joinOffRoomScreen })).toHaveAttribute('aria-pressed', 'true');
  expect(trigger().getAttribute('aria-label')).toContain(HW.joinOnRoomScreen);
});

test('one screen keeps the plain toggle: the laptop is the room\'s screen', () => {
  const { onJoin } = bar({ oneScreen: true, presentHref: '' });
  const toggle = screen.getByRole('button', { name: new RegExp(`^${HW.showJoinCode}`) });
  fireEvent.click(toggle);
  expect(onJoin).toHaveBeenCalledTimes(1);
  expect(card()).toBeNull();
});

test('without joinQr (the Build Room) the bar is as it was', () => {
  const { onJoin } = bar({ joinQr: null });
  fireEvent.click(screen.getByRole('button', { name: /^Join 7924\./ }));
  expect(onJoin).toHaveBeenCalledTimes(1);
  expect(card()).toBeNull();
});
