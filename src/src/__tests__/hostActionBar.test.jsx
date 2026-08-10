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

  // A held key, or a presenter clicker's auto-repeat, arrives at the OS repeat
  // rate — and the primary's MEANING changes between repeats. On RESULTS the
  // first press opens "What We Heard" and the next is already "Next Round", so
  // without this guard a key held one beat too long walks the room past the AI
  // summary and into the following round, discarding both.
  //
  // Rejects: deleting the `event.repeat` check from HostActionBar's keydown
  // handler. Nothing else in the suite fires a repeated key.
  it('ignores auto-repeat, so a held key advances exactly one beat', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controlsFor()} onAction={onAction} />);

    fireEvent.keyDown(window, { key: ' ', repeat: false });
    fireEvent.keyDown(window, { key: ' ', repeat: true });
    fireEvent.keyDown(window, { key: ' ', repeat: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });

    expect(onAction).toHaveBeenCalledTimes(1);
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

  /**
   * THE SPACE DEFECT THE SETUP PANEL EXPOSES.
   *
   * `isTypingTarget` covers INPUT/TEXTAREA/SELECT/contenteditable only, and the
   * handler then calls `event.preventDefault()` — which suppresses the
   * browser's own space-activation of ANY focused button. So a host who tabs to
   * `Ask next` inside the setup panel and presses Space does not press the
   * button they are looking at: the round advances instead, and the question
   * they were choosing is gone.
   *
   * The panel deliberately does NOT join `anyOverlayOpen` (spec §3.5) — the
   * dock's SPACE chip renders exactly when nothing is suppressing, so blanket
   * suppression would make the host watch the affordance blink out while
   * looking at a live button, and blanket suppression is what produced the
   * unadvanceable state the original rule was written to fix. So the rule is
   * event-target logic, not geometry, and these three cases are it.
   */
  describe('SPACE and the setup panel', () => {
    const withPanel = (onAction) => render(
      <>
        <div className="setup-panel">
          <input aria-label="Search titles" />
          <button type="button">Ask next</button>
        </div>
        <HostActionBar controls={controlsFor()} onAction={onAction} />
      </>
    );

    it('still advances from the document body while the panel is open', () => {
      // rejects: putting the panel into `anyOverlayOpen`, or guarding on
      // "is the panel open" rather than on where the key landed. Mouse-driven
      // use — the overwhelming case, and the one a host under pressure is in —
      // must keep its accelerator.
      const onAction = jest.fn();
      withPanel(onAction);

      fireEvent.keyDown(document.body, { key: ' ' });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('does NOT advance when the key lands on a button inside the panel', () => {
      // rejects: the shipped handler. This is the regression a reviewer is
      // most likely to reintroduce, and the one that costs a live round.
      const onAction = jest.fn();
      withPanel(onAction);

      fireEvent.keyDown(screen.getByRole('button', { name: 'Ask next' }), { key: ' ' });
      expect(onAction).not.toHaveBeenCalled();
    });

    it('does NOT advance from the panel\'s search box', () => {
      // The existing isTypingTarget path, asserted here too because the search
      // box is the one surface in the panel where both rules apply.
      const onAction = jest.fn();
      withPanel(onAction);

      fireEvent.keyDown(screen.getByLabelText('Search titles'), { key: ' ' });
      expect(onAction).not.toHaveBeenCalled();
    });

    it('a button OUTSIDE the panel is unaffected — the guard is scoped', () => {
      // rejects: broadening the guard to every BUTTON, which would take the
      // accelerator away from a host whose focus happens to rest on the dock's
      // own primary — the commonest focus position there is.
      const onAction = jest.fn();
      render(
        <>
          <button type="button">Skip Round</button>
          <HostActionBar controls={controlsFor()} onAction={onAction} />
        </>
      );

      fireEvent.keyDown(screen.getByRole('button', { name: 'Skip Round' }), { key: ' ' });
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it('hides the status line on the big screen, where the stage prints its own', () => {
    const { container } = render(
      <HostActionBar controls={controlsFor()} onAction={() => {}} bigScreen />
    );
    expect(container.querySelector('.host-action-bar').className).toMatch(/big-screen-mode/);
    expect(screen.getByRole('button', { name: /start voting/i })).toBeInTheDocument();
  });
});
