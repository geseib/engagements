/**
 * Two pure rules about the host page's overlays.
 *
 * Both live here for the same reason `qrOverlayClassName` does: the overlays
 * only ever mount inside GameHostPage, which needs an AuthProvider (and a live
 * WebSocket) to render at all, so anything expressed inline in that file is
 * unreachable from a test. A rule nobody can test is a rule that quietly
 * changes.
 */

/**
 * Does anything on screen mean the SPACE/→ advance shortcut must not fire?
 *
 * THE POINT OF THE `qrMode === 'pinned'` TERM. `qrMode` is deliberately three
 * valued -- null | 'preview' | 'pinned' -- and only ONE of those values gates
 * the shortcut. A preview is something the host got by resting a mouse near
 * the rail or by tabbing onto the session code; taking their advance key away
 * for that is taking it away by accident, and the dock would go on to stop
 * advertising SPACE at the same time, so the host would watch their shortcut
 * blink out for no reason they could name. A pinned QR is a deliberate act
 * with a deliberate dismissal, so that one counts.
 *
 * The obvious "simplification" -- folding qrMode into a boolean, or dropping
 * the `=== 'pinned'` -- is exactly the regression this function exists to
 * make visible. See __tests__/hostOverlays.test.js.
 *
 * WHAT IS NOT HERE, AND WHY. `showQuestionBrowser` was a term until the browser
 * stopped being a full-screen scrim over the dock and became a section of the
 * setup panel, which stops at the top of the dock. With the primary button and
 * its SPACE chip visibly live beneath the panel, suppressing here would make
 * the affordance lie. The narrower hazard the panel really does introduce --
 * SPACE landing on a focused button inside it -- is handled where it belongs,
 * by event target, in components/HostActionBar.jsx.
 *
 * ── THE TWO ANSWER DIALOGS, ADDED AFTER THEY ADVANCED A LIVE ROUND ─────────
 *
 * `spotlightOpen` and `pastRoundOpen` are here because their absence was a
 * product-down bug, not a tidiness problem.
 *
 * `AnswerSpotlight` and `PastRound` both bind ArrowLeft/ArrowRight to step
 * between answers, on `document`, and both call `preventDefault()` without
 * `stopPropagation()`. `HostActionBar` binds ArrowRight to the PRIMARY ACTION
 * on `window`. Bubble order is target -> document -> window, so the global
 * handler runs AFTERWARDS and sees the very same keystroke. None of its own
 * guards catch it: the event is not a repeat, and the target inside the dialog
 * is a div or a button rather than an input.
 *
 * So a host who opened an answer to read it aloud and pressed -> for the next
 * one ADVANCED THE ROUND. On RESULTS the spotlight then unmounted with the
 * phase, so the dialog vanished mid-sentence and the AI summary appeared.
 *
 * `PastRound` is worse and is why this could not wait: it is mounted at page
 * root rather than inside a phase branch, so it is open DURING a live
 * ASK/VOTE/RESULTS. A host reviewing round two while the room is still
 * answering could close answering, reveal results, or start the next question
 * — depending only on which phase was running behind the dialog.
 *
 * A PER-DIALOG TERM IS THE NARROW FIX, and it is chosen over the general one
 * deliberately. `Modal.jsx` already keeps a module-level stack of mounted
 * dialogs and an `isTopmost()`; reading that here would fix these two and
 * every future dialog at once. It is the better answer and it belongs in a
 * later change: touching the modal primitive while several dialogs are being
 * edited would put a shared-state refactor underneath work in flight. Recorded
 * so the next reader knows the narrow fix was a sequencing decision.
 */
export function shortcutsSuppressed({
  showConfirmModal = false,
  showExpandedQR = false,
  showReportsModal = false,
  lessonExpanded = false,
  isLoadingData = false,
  qrMode = null,
  spotlightOpen = false,
  pastRoundOpen = false,
} = {}) {
  return Boolean(
    showConfirmModal || showExpandedQR ||
    showReportsModal || lessonExpanded || isLoadingData || qrMode === 'pinned' ||
    spotlightOpen || pastRoundOpen
  );
}

/**
 * What the expanded-QR overlay tells the host to do to get rid of it.
 *
 * A PREVIEW MUST NOT SAY "CLICK". The preview overlay is
 * `pointer-events:none` (see `.expanded-qr-overlay--preview` in styles.css --
 * without it, the overlay occludes the `<code>` that opened it and the browser
 * loops mouseenter/mouseleave on every mousemove). With a mouse that is
 * harmless, because moving off the code dismisses the preview before any click
 * happens. With KEYBOARD focus it is not: the preview is up, the mouse is
 * free, and the overlay is transparent to it -- so a host who reads "Click
 * anywhere to close" and clicks in the lower third of the screen clicks
 * straight through onto the dock's primary button and advances the round while
 * answers are still arriving, unable to see what they hit.
 */
export function qrOverlayInstructions(qrMode) {
  return qrMode === 'preview'
    ? 'Press Escape to close, or click the code to pin it'
    : 'Click anywhere to close';
}
