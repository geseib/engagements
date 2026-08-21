/**
 * The host's are-you-sure dialog, and the arrows that drive it.
 *
 * The owner: *"if i accidentally click forward and get the warning, i would
 * like to press left arrow to cancel and right arrow to skip ahead anyway
 * (put those arrows as hints on the buttons)."*
 *
 * The dialog only appears when an advance was pressed early, so the host's
 * hand is already on the arrow keys — ArrowRight IS the advance key. The
 * bindings must therefore be tested against exactly that surface: the same
 * window HostActionBar listens on, with the suppressor doing its job.
 */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import ConfirmDialog from '../components/ConfirmDialog';
import HostActionBar from '../components/HostActionBar';
import { hostControlsFor } from '../config/hostControls';
import { shortcutsSuppressed } from '../utils/hostOverlays';

const press = (key, opts = {}) => fireEvent.keyDown(document.body, { key, ...opts });

describe('ConfirmDialog keys', () => {
  test('left arrow cancels, right arrow confirms', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(<ConfirmDialog title="Skip to Next Question?" message="m" confirmText="Skip Question" onConfirm={onConfirm} onCancel={onCancel} />);
    press('ArrowLeft');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    press('ArrowRight');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('Escape cancels, like every other overlay', () => {
    const onCancel = jest.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={() => {}} onCancel={onCancel} />);
    press('Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a held key cannot confirm', () => {
    // rejects: auto-repeat skipping a question the host has not finished
    // reading — the same reason HostActionBar refuses event.repeat on the
    // advance key.
    const onConfirm = jest.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={onConfirm} onCancel={() => {}} />);
    press('ArrowRight', { repeat: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('modified arrows are someone else\'s gesture', () => {
    // rejects: eating Shift+Arrow (a selection) or Cmd/Ctrl+Arrow (an OS
    // gesture) as a verdict on the round.
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={onConfirm} onCancel={onCancel} />);
    press('ArrowRight', { shiftKey: true });
    press('ArrowLeft', { metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('the buttons wear their keys', () => {
    // rejects: shipping the binding with no affordance — the owner asked for
    // the hints in the same breath as the keys.
    const { container } = render(
      <ConfirmDialog title="t" message="m" confirmText="Skip Question" onConfirm={() => {}} onCancel={() => {}} />
    );
    const [cancel, confirm] = container.querySelectorAll('.dialog-actions button');
    expect(cancel.textContent).toContain('←');
    expect(cancel.textContent).toContain('Cancel');
    expect(confirm.textContent).toContain('Skip Question');
    expect(confirm.textContent).toContain('→');
  });

  test('ArrowRight reaches the dialog and not the advance bar behind it', () => {
    /*
      The stage's real arrangement: HostActionBar's window listener is mounted
      and gated on the SAME suppressor the page uses, with showConfirmModal
      true — exactly the state GameHostPage is in while this dialog is up. One
      ArrowRight must confirm the dialog once and advance the round zero
      times. rejects: a dialog binding added without the suppressor doing its
      half, which would advance AND confirm on one keystroke.
    */
    const onAction = jest.fn();
    const onConfirm = jest.fn();
    const controls = hostControlsFor({
      gameType: 'poll', phase: 'ASK', playerCount: 4, answeredCount: 4,
      votedCount: 0, answerCount: 4, hasQuestionSet: true,
    });
    render(
      <>
        <HostActionBar
          controls={controls}
          onAction={onAction}
          shortcutsEnabled={!shortcutsSuppressed({ showConfirmModal: true })}
        />
        <ConfirmDialog title="t" message="m" onConfirm={onConfirm} onCancel={() => {}} />
      </>
    );
    press('ArrowRight');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  test('clicking the backdrop cancels; clicking the card does not', () => {
    // The inline version had exactly this behaviour; extraction must not
    // lose it.
    const onCancel = jest.fn();
    const { container } = render(
      <ConfirmDialog title="t" message="m" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(container.querySelector('.confirmation-modal'));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.expanded-qr-overlay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the call site', () => {
  const fs = require('fs');
  const path = require('path');
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  test('GameHostPage renders the component, not a private copy of the dialog', () => {
    // rejects: the inline block coming back beside the component, which would
    // put an untested second dialog on the stage.
    const host = strip(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));
    expect(host).toMatch(/<ConfirmDialog/);
    expect(host).not.toMatch(/confirmation-header/);
  });
});
