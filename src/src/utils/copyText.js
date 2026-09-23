/**
 * COPY A STRING TO THE CLIPBOARD — including on an iPhone.
 *
 * The owner, 2026-09-23, on the report's link and passkey: "the copy buttons
 * don't seem to work (tested on iPhone) but manually copying worked."
 *
 * The buttons called `navigator.clipboard.writeText` and, when it refused,
 * tried to select the field — and iOS Safari does neither reliably: the async
 * Clipboard API can reject there even inside a tap, and `select()` on a
 * read-only input selects nothing on iOS. So a refusal looked like a dead
 * button.
 *
 * This copies SYNCHRONOUSLY FIRST, inside the tap, through a throwaway
 * textarea and `execCommand('copy')` — deprecated, and still the one path that
 * works on every iOS Safari, because it runs while the tap still counts as the
 * user's own act. The async API is the second try. When both refuse this says
 * so (`false`), and the caller tells the person to press and hold instead of
 * leaving them tapping a button that does nothing.
 *
 * No iPhone was available where this was written; it follows the approach
 * clipboard.js and copy-to-clipboard take for iOS, and needs checking on one.
 */

/** Copy through a selection, synchronously. `true` only when the browser says it copied. */
export function copyViaSelection(text, doc = document) {
  const active = doc.activeElement;
  const area = doc.createElement('textarea');
  area.value = String(text);
  // readonly: no keyboard pops up. 16px: iOS zooms the page on focusing
  // anything smaller. Fixed and transparent: nothing on screen moves.
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  Object.assign(area.style, {
    position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
    padding: '0', border: '0', opacity: '0', fontSize: '16px',
  });
  doc.body.appendChild(area);
  let copied = false;
  try {
    area.select();
    area.setSelectionRange(0, area.value.length);   // iOS ignores select() alone
    copied = doc.execCommand('copy') === true;
  } catch {
    copied = false;
  } finally {
    area.remove();
    // Hand focus back to the button that was pressed, for keyboard users.
    if (active && typeof active.focus === 'function') active.focus();
  }
  return copied;
}

/**
 * Copy `text`. Resolves `true` when it was copied, `false` when the browser
 * refused every way — never throws.
 */
export async function copyText(text, { doc = document, nav = (typeof navigator !== 'undefined' ? navigator : undefined) } = {}) {
  if (copyViaSelection(text, doc)) return true;
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(String(text));
      return true;
    }
  } catch {
    /* refused: fall through and say so */
  }
  return false;
}
