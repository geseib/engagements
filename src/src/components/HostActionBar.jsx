import React, { useEffect } from 'react';
import Icon from './Icon';
import StatusMessage from './StatusMessage';

/**
 * The host's one and only "move the room forward" control.
 *
 * Why a bar and not another button in the page: the advance control used to be
 * rendered inline at the bottom of each phase's content, which put it 1000–2800px
 * down the document on a 1280×800 laptop. Reading a long question or a long set
 * of Field Notes is worth a scroll; hunting for "Next Question" while a room
 * watches is not.
 *
 * In standard mode the bar is fixed to the bottom of the content column (see
 * `.host-action-bar` in styles.css) and the page reserves an equal strip of
 * bottom padding, so the bar is always reachable and never *permanently* covers
 * anything — the tail of the Field Notes panel can always be scrolled clear of
 * it. In big-screen mode the stage does not scroll at all, so the bar sits in
 * normal flow at the foot of the stage, exactly where the old per-phase controls
 * sat, and its status line is suppressed (the stage already shows its own
 * progress line).
 *
 * All labels, enablement and status copy come from config/hostControls.js —
 * this component decides nothing about the game.
 */

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * The host types an event title, an AI context and a persona choice on this
 * page. A bare spacebar shortcut that fires while they are typing would advance
 * a live room mid-word, so every text surface is excluded.
 */
function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  return Boolean(target.isContentEditable);
}

export default function HostActionBar({
  controls,
  onAction,
  bigScreen = false,
  shortcutsEnabled = true,
}) {
  const primary = controls?.primary || null;
  const secondary = controls?.secondary || null;

  const primaryId = primary?.id;
  const primaryDisabled = Boolean(primary?.disabled);

  // Space / → advance, so a presenter's clicker drives the room.
  useEffect(() => {
    if (!shortcutsEnabled || !primary || primaryDisabled) return undefined;

    const onKeyDown = (event) => {
      if (event.key !== ' ' && event.key !== 'Spacebar' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      // Also stops the browser page-scrolling on space, and stops a *focused*
      // primary button from firing its own click on top of this handler.
      event.preventDefault();
      onAction(primary);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsEnabled, primaryId, primaryDisabled, onAction, primary]);

  if (!primary) return null;

  return (
    <div
      className={`host-action-bar ${bigScreen ? 'big-screen-mode' : ''}`}
      role="group"
      aria-label="Round controls"
    >
      <div className="host-action-bar__inner">
        <div className="host-action-bar__status">
          <StatusMessage
            message={controls.status?.text}
            tone={controls.status?.tone}
            className="host-action-bar__status-msg"
          />
        </div>

        <div className="host-action-bar__actions">
          {primary.disabled && primary.hint && (
            <span className="host-action-bar__hint">{primary.hint}</span>
          )}
          {secondary && (
            <button
              type="button"
              className="btn-secondary host-action-bar__secondary"
              onClick={() => onAction(secondary)}
            >
              <Icon name={secondary.icon} weight="bold" size={18} />
              <span>{secondary.label}</span>
            </button>
          )}
          <button
            type="button"
            className="btn-primary host-action-bar__primary"
            onClick={() => onAction(primary)}
            disabled={primary.disabled}
            title={primary.disabled ? primary.hint : 'Space or → also advances'}
          >
            <Icon name={primary.icon} weight="bold" size={20} />
            <span>{primary.label}</span>
          </button>
          {!primary.disabled && shortcutsEnabled && (
            <kbd className="host-action-bar__kbd" aria-hidden="true">Space</kbd>
          )}
        </div>
      </div>
    </div>
  );
}
