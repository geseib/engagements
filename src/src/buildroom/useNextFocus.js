/**
 * FOCUS GOES WHERE THE HOST GOES NEXT (owner, 2026-10-07: "if i select
 * something or a choice has been made, it seems i need to send to claude but
 * the focus does [not] move to it ... always moving the focus to where they
 * likely should be going next").
 *
 * The contract is two attributes. Inside a container, the one element marked
 * `data-next-primary` is the step's main move: focus lands on it and Space on
 * the Host screen presses it. An element marked `data-next-focus` (the
 * direction for Claude) takes the focus instead, when there is one.
 *
 * Focus moves only when the step changes, never on a refetch of the same step,
 * never while the host is typing, and never while a dialog is open. A step
 * whose move is still disabled (the page is busy saving) is focused once it is
 * ready, unless the host has put the focus somewhere else in the meantime.
 */
import { useEffect, useRef } from 'react';

/** True when keys pressed in `el` are typing: a text field, a select, or contentEditable. */
export function isTypingTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  return tag === 'textarea' || tag === 'select' || Boolean(el.isContentEditable);
}

/** An open dialog owns the keyboard: a modal, or one of the Build Room's own. */
export function dialogOpen(doc = document) {
  return Boolean(doc.querySelector('[role="dialog"][aria-modal="true"], .brm-modal'));
}

/** The element a step's focus lands on: its direction box, else its primary move. */
export function nextTarget(container) {
  if (!container) return null;
  return container.querySelector('[data-next-focus]') || container.querySelector('[data-next-primary]');
}

export function useNextFocus(containerRef, stepKey) {
  const seen = useRef(undefined);
  const pending = useRef(false);
  // A step that arrived while a dialog was open (the host just created an ask
  // in one): the dialog closes next, Modal puts the focus back on its opener,
  // and the step still owns the focus once the dialog is gone.
  const afterDialog = useRef(false);
  // Every render, so a move disabled while the page saves is focused once it
  // is enabled; the step key alone decides whether there is anything to do.
  useEffect(() => {
    let fresh = false;
    if (seen.current !== stepKey) {
      seen.current = stepKey;
      pending.current = true;
      afterDialog.current = false;
      fresh = true;
    }
    if (!pending.current) return;
    const active = document.activeElement;
    // Ticking in Decided can change the lead; it never pulls the focus away.
    const inDecided = Boolean(active && active.closest && active.closest('.brm-decided'));
    // A dialog first: typing INSIDE one (Enter in its Question box) defers the
    // step, it never cancels it. Typing anywhere else does cancel.
    if (dialogOpen()) { afterDialog.current = true; return; }
    if (isTypingTarget(active) || inDecided) { pending.current = false; afterDialog.current = false; return; }
    const container = containerRef.current;
    const el = nextTarget(container);
    if (!el || el.disabled) return; // not ready yet: try again on the next render
    // A retry never takes the focus from somewhere the host has since put it,
    // except the opener Modal restored when the dialog that deferred us closed.
    if (!fresh && !afterDialog.current && active && active !== document.body && !(container && container.contains(active))) {
      pending.current = false;
      return;
    }
    pending.current = false;
    afterDialog.current = false;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    el.focus({ preventScroll: true });
  });
}
