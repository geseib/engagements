import React, { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';

/**
 * A ROW'S ⋯ (docs/design/session-menu README D9, fork F3).
 *
 * Running-order rows show ↑ ↓ ⋯; the browser step's rows show Queue, Ask
 * next and ⋯. What goes behind ⋯ is the rarer and the interrupting: Ask now
 * (with its "ends the round on screen" line), Put aside for this session,
 * Remove. Four or five buttons per row was the wall the owner complained of.
 *
 * AN INLINE POPOVER INSIDE THE SHEET, never a Modal (engage-design: never a
 * modal inside the menu). Escape and a press outside close it and give focus
 * back to ⋯. A `danger` item arms in place: the first press turns it into
 * its `armedLabel`, the second within six seconds goes ahead.
 *
 * items: [{ id, label, note?, onSelect, disabled?, title?, danger?, armedLabel? }]
 */
export const ROW_MENU_ARM_MS = 6000;

export default function RowMenu({ label, items = [], testId = 'row-menu', size = 26 }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(null);
  const wrap = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) { setOpen(false); setArmed(null); } };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // The menu, not the sheet: the sheet's own Escape listener is on
      // document too, so this one stops the event from reaching it.
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      e.preventDefault();
      setOpen(false);
      setArmed(null);
      if (button.current) button.current.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(null), ROW_MENU_ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const live = items.filter(Boolean);
  if (!live.length) return null;
  const press = (item) => {
    if (item.danger && item.armedLabel && armed !== item.id) { setArmed(item.id); return; }
    setArmed(null);
    setOpen(false);
    item.onSelect();
  };
  return (
    <span className="smenu-rowmenu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="setup-q__btn smenu-rowmenu__toggle"
        style={size !== 26 ? { width: size, height: size } : undefined}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setArmed(null); }}
        data-testid={testId}
      >
        <Icon name="DotsThree" weight="bold" size={16} color="currentColor" />
      </button>
      {open ? (
        <span className="smenu-rowmenu__list" role="menu" aria-label={label}>
          {live.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`smenu-rowmenu__item${item.danger ? ' is-danger' : ''}`}
              disabled={Boolean(item.disabled)}
              title={item.title || undefined}
              onClick={() => press(item)}
              data-testid={`${testId}-${item.id}`}
            >
              <span className="smenu-rowmenu__label">{armed === item.id ? item.armedLabel : item.label}</span>
              {item.note ? <span className="smenu-rowmenu__note">{item.note}</span> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
