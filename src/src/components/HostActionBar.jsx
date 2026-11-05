import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Button from './ui/Button';
import StatusMessage from './StatusMessage';
import KeyCap from './stage/KeyCap';
import { TIMER_WORDS } from '../config/roundTimer';
import RW from '../config/roundWords';
import './HostActionBarMore.css';

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
 *
 * Exported: this is the page's one typing-target check, and
 * `useSessionPanelKey` (components/stage/useSessionPanelKey.js) reuses it
 * rather than keeping a second copy.
 */
export function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  return Boolean(target.isContentEditable);
}

/*
  THE HOST CONSOLE'S OWN CONTROLS (host console spec §3). A host who TABS to a
  rail section, a rail link, a top-line control or a response / comment in
  the main column and presses Space means that control, not "advance the
  room", so a keyboard-focused target inside `.hc-rail`, `.hc-top` or
  `.hc-main` keeps its Space (→ still advances: the clicker). A control focused by a mouse click does
  not match :focus-visible and keeps Space = advance: hosts click a section,
  then press Space or the clicker to move on.
*/
/*
  A KEY THAT LANDED IN A HOST PANEL. The Session menu (`.setup-panel`) keeps
  every key that lands in it. The question picker (`.qpk`, docs/design/
  question-picker note 3) is not a dialog and does not trap focus, so only a
  key that landed on one of its CONTROLS is the control's: Space presses the
  focused Queue, and Space on its heading or a row still advances the room.
  BOTH CLASS NAMES ARE LOAD-BEARING.
*/
const PANEL_CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"]';
export function keyLandedInPanel(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest('.setup-panel')) return true;
  if (!target.closest('.qpk')) return false;
  try {
    return Boolean(target.closest(PANEL_CONTROL));
  } catch (e) {
    return false;
  }
}

export function isConsoleKeyboardTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (!target.closest('.hc-rail, .hc-top, .hc-main')) return false;
  try {
    return target.matches(':focus-visible');
  } catch (e) {
    return false;
  }
}

/*
  SKIP LEAVES THE MAIN LINE (owner, 5 Nov 2026, cut 8: "Skip this round"
  beside Start voting was a second thing to aim at, in front of the room, that
  throws a round away). It sits behind a ⋯ just left of the main button: one
  press opens a small menu, the item does what the button did, through the
  same `press` (so the page's own "Skip this round?" confirm still asks).
  Escape or a press outside closes it and gives focus back to ⋯. An inline
  popover, never a Modal (engage-design: the confirm is the dialog).
*/
function BarMore({ control, label, onPick }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      if (button.current) button.current.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span className="hab-more" ref={wrap}>
      <Button
        ref={button}
        variant="secondary"
        size={36}
        className="hab-more-toggle"
        aria-label={RW.moreRoundActions}
        title={RW.moreRoundActions}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="bar-more"
      >
        <Icon name="DotsThree" weight="bold" size={18} color="currentColor" />
      </Button>
      {open ? (
        <span className="hab-more-menu" role="menu" aria-label={RW.moreRoundActions}>
          <button
            type="button"
            role="menuitem"
            className="hab-more-item"
            disabled={Boolean(control.disabled)}
            onClick={() => { setOpen(false); onPick(); }}
            data-testid={`bar-more-${control.id}`}
          >
            <Icon name={control.icon} weight="bold" size={16} color="currentColor" />
            <span>{label}</span>
          </button>
        </span>
      ) : null}
    </span>
  );
}

/** A control that goes behind the ⋯ rather than on the line (cut 8). */
export const isTucked = (control) => Boolean(control && control.id === 'skip');

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
  /*
    A KEY THE PAGE KEEPS (Build Room's Stage, parity PLAN §2a D1). Called
    with the keydown before the bar takes it, and before preventDefault: a
    `true` leaves the key alone, so a focused button inside a dialog, or a
    focused control on the page, still gets its own Space. `shortcutsEnabled`
    is decided at render; this is decided at the press, where an overlay the
    page does not track (a dialog of a child component) can still be seen.
  */
  ignoreKey = null,
  /*
    THE TIME CHIP (experience plan 2f; session-start D4): a node drawn BEFORE
    the primary on an opening move (Start round N, Start voting), so the time
    is chosen where the phase is opened. The page decides when; the bar only
    places it. Space still presses the primary, even with the chip focused.
  */
  timeChip = null,
  /*
    +1 MIN ON THE KEYBOARD (`+` or `=`), with the same guard set as the advance
    keys: never while typing, never under an overlay, never on a held key.
    null while no timer runs, so the keys stay the browser's.
  */
  onAddTime = null,
  /*
    +1 MIN AS A BUTTON, BESIDE THE MAIN ONE (dev QA 2 Nov: on one screen a
    timed round showed no way to add time, only the room's words). The
    console's room tile carries its own, so only a bar with no room tile asks for
    it. Quiet, never orange: the main button keeps the one orange.
  */
  showAddTime = false,
  /* Told true while a press is armed and false when it lets go, so the page
     can hold its one-screen chrome up (Stage `chromeHold`) while it waits. */
  onArmedChange = null,
}) {
  const primary = controls?.primary || null;
  const secondaryControl = controls?.secondary || null;
  // Skip goes behind the ⋯ beside the main button (cut 8); every other second button stays on the line.
  const tucked = isTucked(secondaryControl) ? secondaryControl : null;
  const secondary = tucked ? null : secondaryControl;
  // Task 8, 2026-09-26 feature sweep: a THIRD, optional slot, beside
  // `secondary` — config/hostControls.js sets it only for the two survey
  // phases where a second button already exists and a room is not watching
  // (CLOSED and a survey's own ENDED), so every other phase's "at most one
  // secondary" shape is unchanged.
  const tertiary = controls?.tertiary || null;

  const primaryId = primary?.id;
  const primaryDisabled = Boolean(primary?.disabled);

  /*
    A SECOND PRESS, SAID IN PLACE (session flow v3 §4.3; owner, 15 Oct: "make
    sure it is obvious what is happening"). A control carrying `arm.inPlace`
    does not act on its first press: the button turns to its warning look and
    its `confirmLabel` ("Start round 3 anyway"), the reason appears above the
    buttons ("3 questions not asked yet. Press again to move on."), and the
    next press acts. It lets go on any other button, on Escape, or when the
    moment changes, so an armed button is never left waiting to surprise.

    NO TIMEOUT (dev QA 5 Nov: "Start round 2" armed, and the warning vanished
    within a few seconds, so a slow second click read as nothing happening).
    It used to let go after 6s on its own; on one screen the auto-hiding
    chrome then took the bar away after 3s as well. Now the armed state and
    its words stay until the host decides: press again, press something
    else, the room moves on, or Escape. `onArmedChange` tells the page, so
    the one-screen chrome is held up while a press is pending.
  */
  const [armedId, setArmedId] = useState(null);
  const disarm = () => { setArmedId(null); };
  useEffect(() => {
    if (typeof onArmedChange === 'function') onArmedChange(Boolean(armedId));
  }, [armedId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (typeof onArmedChange === 'function') onArmedChange(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Escape lets go of an armed press (and only then is the key taken).
  useEffect(() => {
    if (!armedId) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      setArmedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armedId]);
  const controlIds = [primary?.id, secondaryControl?.id, tertiary?.id].join('|');
  useEffect(() => { disarm(); }, [controlIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE BUTTON STOPPED NEEDING A SECOND PRESS (review #38, 19 Oct 2026). Show
  // results pressed early arms it; the last ballots then land, the same button
  // drops its `arm`, and the bar read the armed control's warning text from
  // nothing: the host page went blank. An armed control without `arm` lets go.
  const armedStill = [primary, secondary, tertiary].some((c) => c && c.id === armedId && c.arm);
  useEffect(() => { if (armedId && !armedStill) disarm(); }, [armedId, armedStill]); // eslint-disable-line react-hooks/exhaustive-deps
  const press = (control) => {
    if (!control) return;
    if (control.arm && control.arm.inPlace && armedId !== control.id) {
      setArmedId(control.id);
      return;
    }
    disarm();
    onAction(control);
  };
  const armedControl = [primary, secondary, tertiary].find((c) => c && c.id === armedId && c.arm) || null;
  const labelOf = (control) => (armedId === control.id && control.arm && control.arm.confirmLabel
    ? control.arm.confirmLabel : control.label);
  const armClass = (control) => (armedId === control.id && control.arm ? ' is-armed' : '');

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
      if (typeof ignoreKey === 'function' && ignoreKey(event)) return;
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
      if (event.target?.closest?.('.setup-panel') || keyLandedInPanel(event.target)) return;
      // Space only: → and ← have no meaning on a focused button or summary,
      // and the clicker sends them, so they keep driving the room.
      if (event.key !== 'ArrowRight' && isConsoleKeyboardTarget(event.target)) return;
      // Also stops the browser page-scrolling on space, and stops a *focused*
      // primary button from firing its own click on top of this handler.
      event.preventDefault();
      // The page may take this press for itself — a Workie page turn instead
      // of a round advance. Only when it declines does the primary fire.
      if (typeof interceptAdvance === 'function' && interceptAdvance()) return;
      press(primary);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsEnabled, primaryId, primaryDisabled, onAction, primary, interceptAdvance, armedId, ignoreKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (typeof ignoreKey === 'function' && ignoreKey(event)) return;
      if (event.target?.closest?.('.setup-panel') || keyLandedInPanel(event.target)) return;
      // preventDefault only when the press was actually taken: an unconsumed
      // ← (nothing to go back to) must keep scrolling a scrollable rail.
      if (onBackKey()) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsEnabled, onBackKey, ignoreKey]);

  // + / = — one more minute on the round's timer.
  useEffect(() => {
    if (!shortcutsEnabled || typeof onAddTime !== 'function') return undefined;

    const onKeyDown = (event) => {
      if (event.key !== '+' && event.key !== '=') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;
      if (typeof ignoreKey === 'function' && ignoreKey(event)) return;
      if (event.target?.closest?.('.setup-panel') || keyLandedInPanel(event.target)) return;
      event.preventDefault();
      onAddTime();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsEnabled, onAddTime, ignoreKey]);

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
          {/* THE REASON, BESIDE THE BUTTON, SAID POLITELY (dev QA 5 Nov). One
              live region that is always mounted, so a screen reader hears the
              words the moment they arrive (a region mounted with its text is
              often not read), polite rather than an alert: the host asked for
              this by pressing. Empty, it takes no room in the row. */}
          <span
            className={armedControl ? 'host-action-bar__armed' : 'host-action-bar__armed-slot'}
            role="status"
            aria-live="polite"
            data-testid="bar-armed"
          >
            {armedControl ? armedControl.arm.text : ''}
          </span>
          {/* ui/Button (experience plan §5.1, step 5a): the main move is the
              one primary, every other button secondary, 36px. The
              host-action-bar__* classes stay as hooks for the stage dock's
              sizing (styles/stage.css) and the tests. */}
          {secondary && (
            <Button
              variant="secondary"
              size={36}
              className={`host-action-bar__secondary${armClass(secondary)}`}
              onClick={() => press(secondary)}
              disabled={Boolean(secondary.disabled)}
              title={labelOf(secondary)}
            >
              <Icon name={secondary.icon} weight="bold" size={18} />
              <span>{labelOf(secondary)}</span>
            </Button>
          )}
          {tertiary && (
            <Button
              variant="secondary"
              size={36}
              className={`host-action-bar__tertiary${armClass(tertiary)}`}
              onClick={() => press(tertiary)}
              disabled={Boolean(tertiary.disabled)}
              title={labelOf(tertiary)}
            >
              <Icon name={tertiary.icon} weight="bold" size={18} />
              <span>{labelOf(tertiary)}</span>
            </Button>
          )}
          {tucked ? <BarMore control={tucked} label={labelOf(tucked)} onPick={() => press(tucked)} /> : null}
          {timeChip}
          {showAddTime && typeof onAddTime === 'function' ? (
            <Button
              variant="secondary"
              size={36}
              className="host-action-bar__addtime"
              onClick={() => onAddTime()}
              title={`${TIMER_WORDS.plusOneLabel} (${TIMER_WORDS.plusOneKeys})`}
              aria-keyshortcuts="+ ="
              data-testid="bar-add-minute"
            >
              <Icon name="Plus" weight="bold" size={16} />
              <span>{TIMER_WORDS.plusOne}</span>
            </Button>
          ) : null}
          <Button
            variant="primary"
            size={36}
            className={`host-action-bar__primary${armClass(primary)}`}
            onClick={() => press(primary)}
            disabled={primary.disabled}
            title={primary.disabled ? primary.hint : 'Space or → also advances'}
            aria-keyshortcuts={!primary.disabled && shortcutsEnabled ? 'Space ArrowRight' : undefined}
          >
            <Icon name={primary.icon} weight="bold" size={20} />
            <span>{labelOf(primary)}</span>
            {/* The key, on the button (./stage/KeyCap.jsx). Inside a Dock the
                dock says whether it works; on the console, this bar does. */}
            <KeyCap on={!primary.disabled && shortcutsEnabled} />
          </Button>
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
