/**
 * A small focusable "i" for advice a host needs once (copy pass fix, 2026-10-10).
 * A title on plain text cannot be reached by keyboard or touch, so the advice
 * is also visually hidden text the button points at (aria-describedby).
 *
 * IT OPENS ON TOUCH TOO (help refresh Phase 0, defect 8 of the inventory).
 * The advice used to be a `title` only, and a phone or tablet never shows a
 * title, so a touch user could not read it at all. Now:
 *   - a tap, a click, or Enter/Space (it is a button) pins the text open in a
 *     visible popover, and a second press closes it;
 *   - Escape, or a press anywhere outside, closes it (Escape is stopped, so it
 *     does not also close the panel the tip sits in);
 *   - hovering with a mouse shows the same popover while the pointer is over
 *     it — but a touch's emulated hover is ignored, or a tap would open it
 *     twice and a second tap could never close it.
 * The text stays in the DOM either way, visually hidden when closed, so the
 * button's aria-describedby always points at it.
 */
import React from 'react';

let n = 0;
export default function InfoTip({ text, label = 'More' }) {
  const [id] = React.useState(() => { n += 1; return `brm-info-${n}`; });
  const [pinned, setPinned] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const wrapRef = React.useRef(null);
  const buttonRef = React.useRef(null);
  const touched = React.useRef(false);

  React.useEffect(() => {
    if (!pinned) return undefined;
    const onOutside = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setPinned(false);
        setHover(false);
      }
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setPinned(false);
      setHover(false);
      if (buttonRef.current) buttonRef.current.focus();
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [pinned]);

  const shown = pinned || hover;
  return (
    <span
      className="brm-info-wrap"
      ref={wrapRef}
      onTouchStart={() => { touched.current = true; }}
      onMouseEnter={() => { if (!touched.current) setHover(true); }}
      onMouseLeave={() => setHover(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className="brm-info"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => setPinned((open) => !open)}
      >
        i
      </button>
      <span id={id} className={shown ? 'brm-info-pop' : 'brm-sr'} data-open={shown ? '' : undefined}>{text}</span>
    </span>
  );
}
