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
  /*
    THE KEY MAY MEAN LESS THAN THE BUTTON. Reported: "host tend to skip the
    extra pages of the workie response by hitting the right arrow." On
    FIELD_NOTES the natural reading of → is "next page", but the primary is
    Next Round — so a host paging through Workie's summary walked the room out
    of it, unread. The page owns the paging state, so it decides: this hook
    runs before the primary fires, and a `true` means "I consumed that press"
    (it turned a page). The BUTTON is untouched — a host who clicks Next Round
    means Next Round; only the ambiguous key defers.
  */
  interceptAdvance = null,
  /*
    ← steps BACKWARDS — the key the paging design reserved from day one
    ("ArrowLeft is the clicker's other button and is reserved for stepping the
    beat backwards", config/stagePaging.js) and nothing ever wired. Reported:
    "there should be a way to go backwards from the AI Workie screen to the
    results screen." Same guard set as the advance keys; returns true to
    consume, false to leave the browser alone.
  */
  onBackKey = null,
  /* One line under the buttons saying what the keys do RIGHT NOW — the
     "visual queue on what to press". Changes with the phase, so it is the
     caller's sentence, not this component's guess. */
  keyHint = '',
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
      // A held key — or a presenter clicker's auto-repeat — arrives at the OS
      // repeat rate, and THE PRIMARY'S MEANING CHANGES BETWEEN REPEATS. On
      // RESULTS the first press opens "What We Heard" and the next one is
      // already "Next Round", so a key held a beat too long walks the room
      // past the AI summary and into the following round, discarding both.
      // Every advance here is a deliberate act in front of people; none of
      // them is something you do twice by holding a button down.
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;
      // THE SETUP PANEL IS NOT A TYPING TARGET, AND THAT IS THE PROBLEM.
      // `preventDefault()` below suppresses the browser's own space-activation
      // of any FOCUSED BUTTON, so a host who tabs to `Ask next` inside the
      // panel and presses Space does not press it — the round advances and the
      // question they were choosing is gone. The panel deliberately does not
      // join `anyOverlayOpen` (a blanket suppression is what produced the
      // unadvanceable state this handler was written to fix, and it would make
      // the dock's SPACE chip blink out while a live button sat under the
      // host's eye), so the rule is scoped to where the key actually landed.
      // Mouse-driven use keeps its accelerator; the keyboard gets the button
      // it is pointing at.
      if (event.target?.closest?.('.setup-panel')) return;
      // Also stops the browser page-scrolling on space, and stops a *focused*
      // primary button from firing its own click on top of this handler.
      event.preventDefault();
      // The page may take this press for itself — a Workie page turn instead
      // of a round advance. Only when it declines does the primary fire.
      if (typeof interceptAdvance === 'function' && interceptAdvance()) return;
      onAction(primary);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsEnabled, primaryId, primaryDisabled, onAction, primary, interceptAdvance]);

  // ← — the backwards key, with the exact guard set the advance keys carry.
  // Registered only while the caller has somewhere to go back TO; when
  // `onBackKey` is null the key stays the browser's.
  useEffect(() => {
    if (!shortcutsEnabled || typeof onBackKey !== 'function') return undefined;

    const onKeyDown = (event) => {
      if (event.key !== 'ArrowLeft') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;
      if (event.target?.closest?.('.setup-panel')) return;
      // preventDefault only when the press was actually taken: an unconsumed
      // ← (nothing to go back to) must keep scrolling a scrollable rail.
      if (onBackKey()) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsEnabled, onBackKey]);

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
        {/*
          WHAT THE KEYS DO RIGHT NOW — "should there be a visual queue on what
          to press for different actions." The Space chip above says a key
          exists; this line says what it means in THIS phase, which matters
          precisely where the meaning shifts (paging inside Workie's summary
          vs advancing out of it).
        */}
        {keyHint && (
          <div className="host-action-bar__keyhint" aria-hidden="true">{keyHint}</div>
        )}
      </div>
    </div>
  );
}
