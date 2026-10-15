/**
 * A second press, said in place (session flow v3 §4.3; owner, 15 Oct, open
 * question 8: "second press is right, but make sure it is obvious what is
 * happening"). The first press changes the button's look and label and says
 * why beside it; the second acts; it lets go on its own.
 */
import React from 'react';
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

afterEach(() => jest.useRealTimers());

test('the first press arms in place: new label, warning look, the reason in words; nothing is sent', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  expect(onAction).not.toHaveBeenCalled();
  const armed = screen.getByRole('button', { name: /Start round 3 anyway/ });
  expect(armed).toHaveClass('is-armed');
  expect(screen.getByRole('alert')).toHaveTextContent('3 questions not asked yet. Press again to move on.');
});

test('the second press acts', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  fireEvent.click(screen.getByRole('button', { name: /Start round 3 anyway/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('it lets go on its own after a few seconds', () => {
  jest.useFakeTimers();
  render(<HostActionBar controls={controls()} onAction={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(6500); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start round 3' })).not.toHaveClass('is-armed');
});

test('pressing the other button lets go and does that instead', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  fireEvent.click(screen.getByRole('button', { name: /Next page/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'notes-page' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a control without arm acts on one press, as before', () => {
  const onAction = jest.fn();
  render(<HostActionBar controls={controls({ secondary: { id: 'next', label: 'Start round 3', intent: 'next', icon: 'SkipForward' } })} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start round 3/ }));
  expect(onAction).toHaveBeenCalledTimes(1);
});
