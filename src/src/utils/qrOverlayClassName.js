/**
 * Class name for the expanded-QR overlay, given the rail's qrMode.
 *
 * Pulled out as a pure function because the overlay itself only ever mounts
 * inside GameHostPage, which needs an AuthProvider to render at all --
 * making the modifier-class behaviour untestable through the page. The rule
 * it encodes: a hover/focus PREVIEW must stay pointer-transparent (see the
 * `.expanded-qr-overlay--preview` comment in styles.css for why -- without
 * it, the overlay occludes the very `<code>` that opened it and the browser
 * loops mouseenter/mouseleave on every mousemove). A PINNED QR is a
 * deliberate act and keeps normal pointer events so click-away can close it.
 */
export function qrOverlayClassName(qrMode) {
  return `expanded-qr-overlay${qrMode === 'preview' ? ' expanded-qr-overlay--preview' : ''}`;
}

export default qrOverlayClassName;
