/**
 * A second press, said in place (session flow v3 §4.3; owner, 15 Oct, open
 * question 8: "second press is right, but make sure it is obvious what is
 * happening"). The first press changes the button's look and label and says
 * why beside it; the second acts. It waits for the host: no silent timeout
 * (dev QA 5 Nov), and Escape, another button or the room moving on lets go.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HostActionBar from '../components/HostActionBar';

const controls = (over = {}) => ({
  primary: { id: 'notes-page', label: 'Next page', intent: 'notes-page', icon: 'ArrowRight' },
  secondary: {
    id: 'next', label: 'Start round 3', intent: 'next', icon: 'SkipForward',
    arm: { text: '3 questions not asked yet. Press again to move on.', confirmLabel: 'Start round 3 anyway', inPlace: true },
  },
  tertiary: null,
  status: { text: 'Reading page 1 of 3 · 3 asks ready', tone: 'pending' },
  ...over,
});

const reason = () => screen.getByTestId('bar-armed');

afterEach(() => jest.useRealTimers());

test('the first press arms in place: new label, warning look, the reason in words; nothing is sent', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  expect(onAction).not.toHaveBeenCalled();
  const armed = screen.getByRole('button', { name: /Start round 3 anyway/ });
  expect(armed).toHaveClass('is-armed');
  expect(reason()).toHaveTextContent('3 questions not asked yet. Press again to move on.');
  expect(reason()).toHaveClass('host-action-bar__armed');
});

test('the second press acts', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  fireEvent.click(screen.getByRole('button', { name: /Start round 3 anyway/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }));
  expect(reason()).toHaveTextContent('');
});

// rejects: dev QA 5 Nov — "Start round 2" armed and the warning vanished
// within a few seconds, so a slow second click looked like nothing happened.
test('it does not let go on its own: a minute later it is still armed, words and all', () => {
  jest.useFakeTimers();
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  act(() => { jest.advanceTimersByTime(60000); });
  expect(screen.getByRole('button', { name: /Start round 3 anyway/ })).toHaveClass('is-armed');
  expect(reason()).toHaveTextContent('3 questions not asked yet. Press again to move on.');
  fireEvent.click(screen.getByRole('button', { name: /Start round 3 anyway/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }));
});

// rejects: dev QA 5 Nov — the armed state with no way to step back but a timeout.
test('Escape lets go, and nothing is sent', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Start round 3' })).not.toHaveClass('is-armed');
  expect(reason()).toHaveTextContent('');
  expect(onAction).not.toHaveBeenCalled();
});

test('the room moving on (the controls change) lets go', () => {
  const { rerender } = render(<HostActionBar controls={controls()} onAction={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  rerender(<HostActionBar controls={controls({ secondary: null, primary: { id: 'open-vote', label: 'Start voting', icon: 'Play' } })} onAction={() => {}} />);
  expect(reason()).toHaveTextContent('');
});

// rejects: dev QA 5 Nov — an alert that a screen reader may not read because
// the region arrived with its text; the press asked for it, so polite.
test('the reason is one polite live region, mounted before it speaks', () => {
  render(<HostActionBar controls={controls()} onAction={() => {}} />);
  const region = reason();
  expect(region).toHaveAttribute('role', 'status');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveTextContent('');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  expect(reason()).toBe(region);
});

test('onArmedChange says when a press is pending, so the one-screen chrome can stay up', () => {
  const onArmedChange = jest.fn();
  render(<HostActionBar controls={controls()} onAction={() => {}} onArmedChange={onArmedChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  expect(onArmedChange).toHaveBeenLastCalledWith(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onArmedChange).toHaveBeenLastCalledWith(false);
});

test('pressing the other button lets go and does that instead', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  fireEvent.click(screen.getByRole('button', { name: /Next page/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'notes-page' }));
  expect(reason()).toHaveTextContent('');
});

test('a control without arm acts on one press, as before', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls({ secondary: { id: 'next', label: 'Start round 3', intent: 'next', icon: 'SkipForward' } })} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  expect(onAction).toHaveBeenCalledTimes(1);
});

// rejects: dev QA 5 Nov — on the one-screen dock the hover rule (0,4,0) took the
// armed ring (0,3,0) away while the pointer was still on the button just pressed.
describe('the ring survives the pointer', () => {
  const stage = fs.readFileSync(path.join(__dirname, '..', 'styles', 'stage.css'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  test('the dock restates the armed ring for a hovered primary', () => {
    expect(stage).toMatch(/\.dock \.host-action-bar__primary\.is-armed:hover:not\(:disabled\)\{[\s\S]*?box-shadow:0 0 0 3px rgb\(var\(--warn-rgb\)/);
  });
  test('the empty live region takes no room in the row and is not display:none', () => {
    const m = main.match(/\.host-action-bar__armed-slot \{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/position: absolute/);
    expect(m[1]).not.toMatch(/display: *none|visibility: *hidden/);
  });
  test('the page holds the one-screen chrome while the stage bar is armed', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(page).toMatch(/onArmedChange=\{setStageArmed\}/);
    expect(page).toMatch(/chromeHold=\{[^}]*\|\| stageArmed\}/);
  });
});
