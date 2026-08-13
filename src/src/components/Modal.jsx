import React, { useCallback, useEffect, useRef } from 'react';

/**
 * ONE MODAL BEHAVIOUR, FOUR DIALOGS.
 *
 * Four `*Dialog.jsx` components each grew their own overlay: their own backdrop
 * click rule (or none), their own ARIA (or none), no Escape anywhere, no focus
 * trap anywhere, and no scroll lock anywhere. The differences were not decisions
 * — three of the four simply never got the fourth's treatment. This owns the
 * BEHAVIOUR so there is one place to fix it.
 *
 * IT OWNS BEHAVIOUR AND NOT ONE CLASS NAME. The overlay and content class names
 * arrive as props and are rendered verbatim. That is deliberate: `.qsets-scrim`,
 * `.new-game-overlay`, `.modal-overlay` and their content classes carry
 * z-index, palette and geometry that several tests read straight out of the
 * stylesheets (`hostQuestionSetsPalette`, `questionSetsPalette`), and the three
 * levels of nesting below only stack correctly because of the specific numbers
 * on those specific selectors. Converging the CSS is a separate pass; this
 * primitive must not pre-empt it.
 *
 * NO PORTAL. `new-game-overlay` → `qsets-scrim--over` → `qsets-scrim` nest three
 * deep and the inner two are DOM DESCENDANTS of the outer. That containment is
 * load-bearing twice over: the light theme reaches the inner dialogs through
 * `.qsets--onlight .qsets`, and the inner scrims' clicks are stopped by the
 * outer content's `stopPropagation` rather than closing the screen behind them.
 * A portal would move both of those out from under the ancestor and break them
 * silently. So children render exactly where they render today.
 *
 * WHICH MODAL IS "THE" MODAL. With three open at once, Escape and Tab must be
 * answered by the innermost one only. Topmost is decided by DOM CONTAINMENT
 * rather than mount order: a modal whose overlay contains another registered
 * modal's overlay is, by definition, not the top one. Mount order is wrong here
 * — React runs child effects before parent effects, so a modal that mounts with
 * a nested modal already open would register the inner one FIRST.
 *
 * SCROLL LOCK IS REFERENCE-COUNTED for the same reason. Lock on mount and
 * unlock on unmount would have the delete dialog closing and handing the page
 * back its scrollbar while two dialogs are still open over it.
 *
 * THE ESCAPE LISTENER IS ON `document`, not `window` — the convention every
 * other keyboard surface in this app already follows (`SessionSetupPanel`,
 * `QuickstartMenu`), and the one the tests fire against.
 *
 * IT DOES NOT MOVE FOCUS ON MOUNT. Restoring focus on close and trapping Tab
 * while open are additions no dialog here had; pulling focus off whatever the
 * host was typing in at the moment a dialog appears is a change to what people
 * see, and this pass is a behaviour-preserving one.
 */

/** Same set as `stage/SessionSetupPanel.jsx`, plus textarea — GameSetupDialog has two. */
const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex="0"]',
].join(', ');

/**
 * Every mounted modal, in mount order. Entries are mutable so the overlay
 * element can be attached once the DOM exists without re-registering.
 */
const mounted = [];

/* --------------------------------------------------------------- scroll lock */

let lockCount = 0;
let restoreOverflow = '';

function lockScroll() {
  if (lockCount === 0) {
    restoreOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  // Only the LAST modal out gives the page its scrollbar back.
  if (lockCount === 0) {
    document.body.style.overflow = restoreOverflow;
    restoreOverflow = '';
  }
}

/* ------------------------------------------------------------------- helpers */

/** `true` | `false` | a predicate. Anything else is treated as enabled. */
function gateAllows(gate) {
  if (typeof gate === 'function') return gate() !== false;
  return gate !== false;
}

/** The innermost open modal: the one whose overlay contains no other. */
function topmostEntry() {
  const live = mounted.filter((entry) => entry.overlay);
  const innermost = live.filter(
    (entry) => !live.some((other) => other !== entry && entry.overlay.contains(other.overlay)),
  );
  // Two unrelated modals can both be innermost; the later one wins, which is
  // the one that opened last.
  return innermost.length ? innermost[innermost.length - 1] : null;
}

export default function Modal({
  /** Rendered verbatim on the backdrop element. No default — the caller's DOM is the caller's. */
  overlayClassName = '',
  /** Rendered verbatim on the dialog element. */
  contentClassName = '',
  /** The one canonical close callback. Dialogs keep their own public prop names and pass them here. */
  onClose,
  /** `true` | `false` | `() => boolean`, evaluated at click time. */
  closeOnBackdrop = true,
  /** Same three shapes, evaluated at keypress time. */
  closeOnEscape = true,
  /** id of the element naming this dialog. */
  labelledBy,
  /** ...or the name itself, when there is no element to point at. */
  label,
  children,
  /**
   * Rendered inside the overlay but OUTSIDE the dialog box. Exactly one caller
   * needs it: GameSetupDialog hangs HostQuestionSetsDialog off its overlay as a
   * sibling of the dialog, so the nested scrim covers the create screen instead
   * of being clipped inside it.
   */
  afterContent = null,
}) {
  const overlayRef = useRef(null);
  const contentRef = useRef(null);
  const entryRef = useRef({ overlay: null });

  // Read at event time, so the document listener below never re-subscribes and
  // never closes over a stale `busy` flag.
  const latest = useRef({});
  latest.current = { onClose, closeOnBackdrop, closeOnEscape };

  const close = useCallback(() => {
    const handler = latest.current.onClose;
    if (handler) handler();
  }, []);

  const isTopmost = useCallback(() => topmostEntry() === entryRef.current, []);

  // Registration, scroll lock and focus restore share one effect so they share
  // one lifetime — a modal that is registered but not counted, or counted but
  // not registered, is the bug this whole file exists to make impossible.
  useEffect(() => {
    const entry = entryRef.current;
    entry.overlay = overlayRef.current;
    mounted.push(entry);
    lockScroll();

    // Where focus came from, so it can go back. Without this a keyboard user
    // who closes a dialog is dropped at the top of the document.
    const opener = document.activeElement;

    return () => {
      const index = mounted.indexOf(entry);
      if (index >= 0) mounted.splice(index, 1);
      entry.overlay = null;
      unlockScroll();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      // Only the innermost dialog answers the keyboard.
      if (!isTopmost()) return;

      if (event.key === 'Escape') {
        if (!gateAllows(latest.current.closeOnEscape)) return;
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== 'Tab') return;

      const content = contentRef.current;
      if (!content) return;
      const focusables = Array.from(content.querySelectorAll(FOCUSABLE));
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement;

      // Tab from outside the dialog lands inside it. Without this branch focus
      // stays wherever it was and the trap only closes at the two ends.
      if (!content.contains(active)) {
        event.preventDefault();
        firstEl.focus();
        return;
      }
      if (event.shiftKey && active === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close, isTopmost]);

  // A dialog whose backdrop never closes gets no click handler at all, rather
  // than one that is called and does nothing.
  const backdropWired = closeOnBackdrop !== false;

  const onOverlayClick = backdropWired
    ? () => { if (gateAllows(latest.current.closeOnBackdrop)) close(); }
    : undefined;

  return (
    <div
      ref={overlayRef}
      className={overlayClassName}
      onClick={onOverlayClick}
    >
      <div
        ref={contentRef}
        className={contentClassName}
        role="dialog"
        aria-modal="true"
        {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
        {...(!labelledBy && label ? { 'aria-label': label } : {})}
        onClick={backdropWired ? (event) => event.stopPropagation() : undefined}
      >
        {children}
      </div>
      {afterContent}
    </div>
  );
}
