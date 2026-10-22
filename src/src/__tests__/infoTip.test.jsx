/**
 * InfoTip ON TOUCH (help refresh Phase 0; inventory defect 8: "InfoTips only
 * show on hover, so touch users never see them").
 *
 * The advice was a `title` and visually hidden text. A phone shows no title,
 * so a tap revealed nothing. These hold the new contract: a press pins a
 * visible popover; Escape and a press outside close it; a mouse hover still
 * shows it; a touch's emulated hover does not.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import InfoTip from '../buildroom/InfoTip';

const TEXT = 'The room sees the brief before the first ask.';
const tip = () => screen.getByText(TEXT);

test('closed, the text is still the button\'s description, visually hidden', () => {
  render(<InfoTip text={TEXT} label="About the room brief" />);
  const button = screen.getByRole('button', { name: 'About the room brief' });
  expect(button).toHaveAccessibleDescription(TEXT);
  expect(tip()).toHaveClass('brm-sr');
  expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('a tap (click) opens a visible popover, and a second tap closes it', () => {
  render(<InfoTip text={TEXT} label="About" />);
  const button = screen.getByRole('button', { name: 'About' });
  fireEvent.touchStart(button);
  fireEvent.mouseEnter(button.parentElement); // the emulated hover a tap fires
  fireEvent.click(button);
  expect(tip()).toHaveClass('brm-info-pop');
  expect(button).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(button);
  // rejects: the emulated hover keeping it open after the second tap.
  expect(tip()).toHaveClass('brm-sr');
});

test('Escape closes it, returns focus to the "i", and does not reach the page', () => {
  const underneath = jest.fn();
  document.addEventListener('keydown', underneath);
  render(<InfoTip text={TEXT} label="About" />);
  fireEvent.click(screen.getByRole('button', { name: 'About' }));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  document.removeEventListener('keydown', underneath);
  expect(tip()).toHaveClass('brm-sr');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About' }));
  expect(underneath).not.toHaveBeenCalled();
});

test('a press outside closes it', () => {
  render(<><InfoTip text={TEXT} label="About" /><p>elsewhere</p></>);
  fireEvent.click(screen.getByRole('button', { name: 'About' }));
  fireEvent.mouseDown(screen.getByText('elsewhere'));
  expect(tip()).toHaveClass('brm-sr');
  fireEvent.click(screen.getByRole('button', { name: 'About' }));
  fireEvent.touchStart(screen.getByText('elsewhere'));
  expect(tip()).toHaveClass('brm-sr');
});

test('a mouse hover still shows it, and leaving hides it', () => {
  render(<InfoTip text={TEXT} label="About" />);
  const wrap = screen.getByRole('button', { name: 'About' }).parentElement;
  fireEvent.mouseEnter(wrap);
  expect(tip()).toHaveClass('brm-info-pop');
  fireEvent.mouseLeave(wrap);
  expect(tip()).toHaveClass('brm-sr');
});

test('the popover is painted with roles only, inside the .brm scope', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'buildroom', 'BuildRoom.css'), 'utf8');
  const rule = css.slice(css.indexOf('.brm .brm-info-pop {'), css.indexOf('}', css.indexOf('.brm .brm-info-pop {')));
  expect(rule).toMatch(/background:\s*var\(--surface-2\)/);
  expect(rule).toMatch(/color:\s*var\(--text\)/);
  expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|var\(--primary/i);
  expect(rule).toMatch(/max-width:\s*min\(280px, 80vw\)/);
});
