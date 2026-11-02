/**
 * THE TIME CHIP AND THE +1 KEY (components/console/TimeChip.jsx,
 * HostActionBar's `timeChip` and `onAddTime`; experience plan 2f, frame 1-b6).
 *
 * // rejects: a chip that is not beside the main move, a close-at-zero tick
 * //          that is on by default or offered on voting, a + key that fires
 * //          while the host types, and a chip that steals Space from the
 * //          clicker workflow.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TimeChip from '../components/console/TimeChip';
import HostActionBar from '../components/HostActionBar';
import { hostControlsFor, HOST_INTENTS } from '../config/hostControls';
import { MINUTE_MS } from '../config/roundTimer';

const MIN = MINUTE_MS;

function Harness({ kind = 'ask', initial = { limitMs: 0, onWall: true, closes: false }, onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return <TimeChip kind={kind} round={3} value={value} onChange={(v) => { setValue(v); onChange(v); }} />;
}

describe('the chip', () => {
  test('says No limit by default, and opens a list of the five presets', () => {
    render(<Harness />);
    const chip = screen.getByTestId('time-chip-ask');
    expect(chip).toHaveTextContent('No limit');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Time for answering, round 3')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.parentElement.textContent)).toEqual(['No limit', '1 min', '2 min', '3 min', '5 min']);
    expect(screen.getByRole('radio', { name: 'No limit' })).toBeChecked();
  });

  test('choosing 2 min changes the chip and tells the page', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByTestId('time-chip-ask'));
    fireEvent.click(screen.getByRole('radio', { name: '2 min' }));
    expect(onChange).toHaveBeenLastCalledWith({ limitMs: 2 * MIN, onWall: true, closes: false });
    expect(screen.getByTestId('time-chip-ask')).toHaveTextContent('2 min');
  });

  test('"Show the time" is ticked at first; "Close answering at zero" is off, and waits for a limit', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByTestId('time-chip-ask'));
    const wall = screen.getByRole('checkbox', { name: /show the time on the room's window/i });
    const close = screen.getByRole('checkbox', { name: /close answering at zero/i });
    expect(wall).toBeChecked();
    expect(close).not.toBeChecked();
    expect(close).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '1 min' }));
    expect(screen.getByRole('checkbox', { name: /close answering at zero/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /close answering at zero/i }));
    expect(onChange).toHaveBeenLastCalledWith({ limitMs: MIN, onWall: true, closes: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /show the time on the room's window/i }));
    expect(onChange).toHaveBeenLastCalledWith({ limitMs: MIN, onWall: false, closes: true });
  });

  test('the voting chip has its own title and no close tick', () => {
    render(<Harness kind="vote" />);
    fireEvent.click(screen.getByTestId('time-chip-vote'));
    expect(screen.getByText('Time for voting')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /close answering/i })).toBeNull();
  });

  test('Escape closes the list and gives the chip its focus back', () => {
    render(<Harness />);
    const chip = screen.getByTestId('time-chip-ask');
    fireEvent.click(chip);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(chip);
  });

  test('Enter on the chip opens it (Space stays the main move\'s)', () => {
    render(<Harness />);
    const chip = screen.getByTestId('time-chip-ask');
    fireEvent.keyDown(chip, { key: 'Enter' });
    expect(chip).toHaveAttribute('aria-expanded', 'true');
  });
});

const controls = hostControlsFor({
  gameType: 'call-and-answer', phase: 'ASK', playerCount: 4, answeredCount: 4, votedCount: 0, answerCount: 4, hasQuestionSet: true,
});

describe('in the action bar', () => {
  test('the chip is drawn just before the main button', () => {
    render(<HostActionBar controls={controls} onAction={() => {}} timeChip={<TimeChip kind="vote" value={{ limitMs: 0 }} onChange={() => {}} />} />);
    const chip = screen.getByTestId('time-chip-vote');
    const primary = screen.getByRole('button', { name: /start voting/i });
    expect(chip.closest('.tchip').nextElementSibling).toBe(primary);
  });

  test('Space with the chip focused still presses the main move', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controls} onAction={onAction} timeChip={<TimeChip kind="vote" value={{ limitMs: 0 }} onChange={() => {}} />} />);
    const chip = screen.getByTestId('time-chip-vote');
    chip.focus();
    fireEvent.keyDown(chip, { key: ' ' });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].intent).toBe(HOST_INTENTS.FINISH);
  });

  test('+ and = give another minute; held keys, modifiers and typing do not', () => {
    const onAddTime = jest.fn();
    render(
      <>
        <input aria-label="title" />
        <HostActionBar controls={controls} onAction={() => {}} onAddTime={onAddTime} />
      </>,
    );
    fireEvent.keyDown(window, { key: '+' });
    fireEvent.keyDown(window, { key: '=' });
    expect(onAddTime).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: '+', repeat: true });
    fireEvent.keyDown(window, { key: '=', metaKey: true });
    fireEvent.keyDown(screen.getByLabelText('title'), { key: '+' });
    expect(onAddTime).toHaveBeenCalledTimes(2);
  });

  test('no timer, no key: + is the browser\'s', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controls} onAction={onAction} onAddTime={null} />);
    const e = fireEvent.keyDown(window, { key: '+' });
    expect(e).toBe(true); // not prevented
    expect(onAction).not.toHaveBeenCalled();
  });

  test('not while an overlay holds the keys', () => {
    const onAddTime = jest.fn();
    render(<HostActionBar controls={controls} onAction={() => {}} onAddTime={onAddTime} shortcutsEnabled={false} />);
    fireEvent.keyDown(window, { key: '+' });
    expect(onAddTime).not.toHaveBeenCalled();
  });
});
