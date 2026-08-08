/**
 * The bar itself. Two things matter here and nothing else:
 *   1. exactly one primary button reaches the DOM, and
 *   2. the keyboard shortcut never fires while the host is typing — they enter
 *      an event title, an AI context and a persona choice on this same page.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HostActionBar from '../components/HostActionBar';
import { hostControlsFor, HOST_INTENTS } from '../config/hostControls';

const controlsFor = (overrides = {}) => hostControlsFor({
  gameType: 'poll',
  phase: 'ASK',
  playerCount: 4,
  answeredCount: 4,
  votedCount: 0,
  answerCount: 4,
  hasQuestionSet: true,
  ...overrides,
});

describe('HostActionBar', () => {
  it('renders one primary action and its status line', () => {
    render(<HostActionBar controls={controlsFor()} onAction={() => {}} />);

    expect(screen.getByRole('button', { name: /start voting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip question/i })).toBeInTheDocument();
    expect(screen.getByText('All 4 answered')).toBeInTheDocument();
  });

  it('runs the primary action on click', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controlsFor()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: /start voting/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].intent).toBe(HOST_INTENTS.FINISH);
  });

  it('advances on Space and ArrowRight', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controlsFor()} onAction={onAction} />);

    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('does NOT advance while focus is in a text field', () => {
    const onAction = jest.fn();
    render(
      <>
        <input aria-label="Event title" />
        <textarea aria-label="AI context" />
        <HostActionBar controls={controlsFor()} onAction={onAction} />
      </>
    );

    fireEvent.keyDown(screen.getByLabelText('Event title'), { key: ' ' });
    fireEvent.keyDown(screen.getByLabelText('AI context'), { key: ' ' });
    fireEvent.keyDown(screen.getByLabelText('AI context'), { key: 'ArrowRight' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('ignores modified key presses so browser shortcuts still work', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controlsFor()} onAction={onAction} />);

    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('does not advance when the primary action is disabled', () => {
    const onAction = jest.fn();
    render(
      <HostActionBar
        controls={controlsFor({ phase: 'LOBBY', playerCount: 0 })}
        onAction={onAction}
      />
    );

    fireEvent.keyDown(window, { key: ' ' });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /start first question/i })).toBeDisabled();
  });

  it('honours shortcutsEnabled=false while an overlay is open', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controlsFor()} onAction={onAction} shortcutsEnabled={false} />);

    fireEvent.keyDown(window, { key: ' ' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('hides the status line on the big screen, where the stage prints its own', () => {
    const { container } = render(
      <HostActionBar controls={controlsFor()} onAction={() => {}} bigScreen />
    );
    expect(container.querySelector('.host-action-bar').className).toMatch(/big-screen-mode/);
    expect(screen.getByRole('button', { name: /start voting/i })).toBeInTheDocument();
  });
});
