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
 */
export function shortcutsSuppressed({
  showConfirmModal = false,
  showQuestionBrowser = false,
  showExpandedQR = false,
  showReportsModal = false,
  lessonExpanded = false,
  isLoadingData = false,
  qrMode = null,
} = {}) {
  return Boolean(
    showConfirmModal || showQuestionBrowser || showExpandedQR ||
    showReportsModal || lessonExpanded || isLoadingData || qrMode === 'pinned'
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
