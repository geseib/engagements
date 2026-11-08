import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * WHERE THE QUESTION PICKER IS, AND THE WAY BACK (docs/design/question-picker
 * D6, D9, note 2). The page's state for the one picker every door opens,
 * kept in a hook so the contract is testable without mounting the page:
 *
 *   open({ from, focusKey })  from 'key' | 'rail' | 'row' | 'part' | 'menu'.
 *                             Remembers the opener; from the menu, closes
 *                             the menu first (two surfaces never stack). On
 *                             one screen it opens the private choice instead,
 *                             every time (F5).
 *   showHere()                the choice's "Show them here": the picker, with
 *                             `oneScreen` set (the amber room line).
 *   hide()                    the room line's Hide: back to the choice.
 *   close({ focus })          one press. Focus returns to the opener; if it
 *                             has gone (or was the body), to the Round queue's
 *                             heading, never to body (review A5). From the
 *                             menu, back to Up next and its door.
 *
 * `picker` is { from, focusKey, oneScreen } or null.
 */
export const PICKER_FALLBACK_FOCUS = [
  '.hc-sec[data-section="queue"] summary',
  '[data-testid="change-next"]',
  '.dock--part button',
  '.hc-now button',
];
export const MENU_DOOR = '[data-testid="up-next-choose"]';

export default function useQuestionPicker({
  allowed = () => true,
  twoSurfaces = true,
  onMenuClose = () => {},
  onMenuReturn = () => {},
  menuOpen = false,
} = {}) {
  const [picker, setPicker] = useState(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const openerRef = useRef(null);
  const pendingRef = useRef(null);
  const focusRef = useRef(null);

  const open = useCallback(({ from = 'key', focusKey = null } = {}) => {
    if (!allowed()) return false;
    openerRef.current = from === 'menu' ? null : (typeof document !== 'undefined' ? document.activeElement : null);
    if (from === 'menu') onMenuClose();
    if (!twoSurfaces) {
      pendingRef.current = { from, focusKey };
      setChoiceOpen(true);
      return true;
    }
    setPicker({ from, focusKey, oneScreen: false });
    return true;
  }, [allowed, twoSurfaces, onMenuClose]);

  const showHere = useCallback(() => {
    setChoiceOpen(false);
    setPicker({ ...(pendingRef.current || { from: 'key', focusKey: null }), oneScreen: true });
  }, []);

  const hide = useCallback(() => {
    setPicker((cur) => {
      if (cur) pendingRef.current = { from: cur.from, focusKey: cur.focusKey };
      return null;
    });
    setChoiceOpen(true);
  }, []);

  const close = useCallback(({ focus = true } = {}) => {
    const from = picker && picker.from;
    setPicker(null);
    if (!focus) { focusRef.current = null; return; }
    if (from === 'menu') {
      focusRef.current = MENU_DOOR;
      onMenuReturn();
      return;
    }
    focusRef.current = openerRef.current || 'fallback';
  }, [picker, onMenuReturn]);

  /* After the picker has gone (and, from the menu, the menu is back), put
     focus where the way back said it would go. */
  useEffect(() => {
    if (picker || !focusRef.current) return;
    const want = focusRef.current;
    if (want === MENU_DOOR && !menuOpen) return;
    focusRef.current = null;
    let el = null;
    if (typeof want === 'string' && want !== 'fallback') el = document.querySelector(want);
    else if (want && want !== 'fallback' && typeof want.focus === 'function'
      && document.contains(want) && want !== document.body) el = want;
    if (!el) {
      for (const sel of PICKER_FALLBACK_FOCUS) {
        el = document.querySelector(sel);
        if (el) break;
      }
    }
    if (el && typeof el.focus === 'function') el.focus();
  });

  /* The menu opening by any other route closes the picker: never both. */
  useEffect(() => {
    if (menuOpen) setPicker(null);
  }, [menuOpen]);

  return {
    picker, setPicker, choiceOpen, setChoiceOpen, open, close, showHere, hide,
  };
}
