import React, { useEffect, useState } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import Rail from '../components/stage/Rail';
import HostActionBar from '../components/HostActionBar';
import { hostControlsFor } from '../config/hostControls';
import { shortcutsSuppressed } from '../utils/hostOverlays';

const join = (extra = {}) => ({ code: '4821', url: 'eng.dev/play', ...extra });

describe('the session code as a QR trigger', () => {
  test('with handlers it is focusable and reachable by keyboard', () => {
    // rejects: a mouse-only implementation, which is unusable on a laptop
    // driven by keyboard and invisible to a screen reader
    const onPreview = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview, onPreviewEnd: jest.fn(), onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(code);
    expect(onPreview).toHaveBeenCalled();
  });

  test('hover previews and leaving dismisses', () => {
    const onPreview = jest.fn();
    const onPreviewEnd = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview, onPreviewEnd, onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    fireEvent.mouseEnter(code);
    expect(onPreview).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(code);
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
  });

  test('clicking pins', () => {
    // rejects: hover-only, which does not exist at all on a touchscreen
    const onPin = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin })} />
    );
    fireEvent.click(container.querySelector('.rail-join code'));
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  test('without handlers the code is inert, not a fake button', () => {
    const { container } = render(<Rail phase="ASK" title="Q3" join={join()} />);
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('tabindex')).toBeNull();
    expect(code.getAttribute('role')).toBeNull();
  });

  test('the code still carries no data-drop', () => {
    // rejects: a wrapper or an attribute that lets the fitter sacrifice the one
    // thing the room needs in order to join. The drop order is title(1),
    // JOIN(2), url(3) -- deliberately asymmetric, and the code is not in it.
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('data-drop')).toBeNull();
    expect(code.closest('[data-drop]')).toBeNull();
  });

  test('a closed session offers no QR at all', () => {
    // rejects: advertising a way into a session that has ended
    const { container } = render(
      <Rail phase="ENDED" title="Q3" join={join({ closed: true, onPreview: jest.fn() })} />
    );
    expect(container.querySelector('.rail-join code')).toBeNull();
  });

  test('Enter pins the QR and never reaches a window-level shortcut listener', () => {
    // rejects: role="button" with no onKeyDown, which looks activatable but
    // isn't -- React does not synthesize a click from Enter the way a native
    // <button> does, so without this the keyboard path does not exist.
    const onPin = jest.fn();
    const windowKeydown = jest.fn();
    window.addEventListener('keydown', windowKeydown);
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin })} />
    );
    fireEvent.keyDown(container.querySelector('.rail-join code'), { key: 'Enter' });
    window.removeEventListener('keydown', windowKeydown);

    expect(onPin).toHaveBeenCalledTimes(1);
    expect(windowKeydown).not.toHaveBeenCalled();
  });

  test.each([
    [' ', 'Space'],
    ['Spacebar', 'the legacy Space key name some clickers still send'],
    ['ArrowRight', 'a presenter clicker\'s forward button'],
  ])('%s reaches the dock instead of pinning (%s)', (key) => {
    // THE ESCAPE-DISMISS LOOP. An earlier revision swallowed Space here with
    // stopPropagation. Clicking the code to pin also focuses it; Escape then
    // clears qrMode but fires no blur, so focus stays on the code -- and the
    // dock, seeing no overlay, goes back to advertising SPACE. Pressing it
    // pinned the QR again. Escape, dismiss, SPACE, pin: a loop the host could
    // only leave with the mouse, while the dock claimed SPACE advanced.
    //
    // rejects: any handler that intercepts Space here (with or without
    // stopPropagation), and any handler that covers Space but not 'Spacebar'
    // or ArrowRight -- HostActionBar treats all three as advance keys, so a
    // clicker's two buttons would otherwise behave differently while the code
    // happens to hold focus.
    const onPin = jest.fn();
    const windowKeydown = jest.fn();
    window.addEventListener('keydown', windowKeydown);
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin })} />
    );
    fireEvent.keyDown(container.querySelector('.rail-join code'), { key });
    window.removeEventListener('keydown', windowKeydown);

    expect(onPin).not.toHaveBeenCalled();
    expect(windowKeydown).toHaveBeenCalledTimes(1);
    expect(windowKeydown.mock.calls[0][0].key).toBe(key);
  });
});

/**
 * The three pieces together, wired the way GameHostPage wires them: the rail
 * owns the trigger, `shortcutsSuppressed` decides whether the dock listens,
 * and HostActionBar is the thing SPACE is supposed to reach. Each passed its
 * own scoped review; the loop below only appears when all three are in one
 * tree, which is why it is asserted in one tree.
 */
function StageHarness({ onAdvance }) {
  const [qrMode, setQrMode] = useState(null);
  useEffect(() => {
    if (!qrMode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setQrMode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrMode]);

  return (
    <>
      <Rail
        phase="ASK"
        title="Q3"
        join={join({
          onPreview: () => setQrMode((mode) => (mode === 'pinned' ? mode : 'preview')),
          onPreviewEnd: () => setQrMode((mode) => (mode === 'pinned' ? mode : null)),
          onPin: () => setQrMode('pinned'),
        })}
      />
      <span data-testid="qr-mode">{String(qrMode)}</span>
      <HostActionBar
        controls={hostControlsFor({
          gameType: 'poll', phase: 'ASK', playerCount: 4, answeredCount: 4,
          votedCount: 0, answerCount: 4, hasQuestionSet: true,
        })}
        onAction={onAdvance}
        shortcutsEnabled={!shortcutsSuppressed({ qrMode })}
      />
    </>
  );
}

describe('SPACE and the session code, in one tree', () => {
  const setup = () => {
    const onAdvance = jest.fn();
    const { container, getByTestId } = render(<StageHarness onAdvance={onAdvance} />);
    const code = container.querySelector('.rail-join code');
    // A REAL focus, not fireEvent.focus: the point of the sequence is that the
    // code still holds document.activeElement after Escape, and only a genuine
    // .focus() puts it there. act() is what flushes the state it triggers.
    const focusTheCode = () => act(() => { code.focus(); });
    return { onAdvance, code, focusTheCode, mode: () => getByTestId('qr-mode').textContent };
  };

  test('click-to-pin, Escape, SPACE — advances the round, no mouse required', () => {
    // THE TRACED SEQUENCE, end to end. Clicking a focusable element focuses it,
    // and Escape unmounts the overlay WITHOUT firing a blur, so the code still
    // holds focus when the host reaches for SPACE. The shipped code swallowed
    // that keypress and re-pinned the QR, while the dock had already gone back
    // to advertising SPACE.
    //
    // rejects: Rail intercepting Space at all. Also rejects "fix" the failure
    // report warned against -- leaving the interception in and relying on the
    // host clicking elsewhere first.
    const { onAdvance, code, focusTheCode, mode } = setup();

    focusTheCode();                                  // hover's keyboard twin
    fireEvent.click(code);                           // pin
    expect(mode()).toBe('pinned');

    fireEvent.keyDown(window, { key: 'Escape' });    // dismiss
    expect(mode()).toBe('null');
    expect(document.activeElement).toBe(code);       // ...and focus never left

    fireEvent.keyDown(code, { key: ' ' });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  test('a pinned QR does suppress SPACE while it is up', () => {
    // rejects: dropping the gate along with the interception, which would let
    // the host advance the round blind behind a full-screen QR.
    const { onAdvance, code, focusTheCode, mode } = setup();

    focusTheCode();
    fireEvent.click(code);
    expect(mode()).toBe('pinned');

    fireEvent.keyDown(code, { key: ' ' });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  test('a preview leaves SPACE live, exactly as the dock advertises', () => {
    // rejects: folding preview and pinned into one flag -- the dock would keep
    // printing SPACE (or stop printing it) while the key did the other thing.
    const { onAdvance, code, focusTheCode, mode } = setup();

    focusTheCode();
    expect(mode()).toBe('preview');

    fireEvent.keyDown(code, { key: ' ' });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
