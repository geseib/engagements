import React, { useState } from 'react';

/**
 * THE ONE CODE-ENTRY WIDGET (experience plan 3a; audit C §1.1 and P7).
 *
 * Audit C found three widgets for four digits: /join's cells (RootPage), the
 * marketing hero's cells (JoinCodeEntry), and a plain text field with the
 * placeholder "Game ID" on the play page. This is the one: four cells drawn
 * over one real input, which stays focusable, pasteable and labelled. Each
 * surface keeps its own stylesheet, so `skin` only chooses whose class names
 * the same markup carries; the structure, the cells and the input are the same
 * everywhere.
 *
 * Controlled. `value` is the code; `onChange` receives the raw change event,
 * exactly as an <input> would, so a caller's own filtering (useJoinCode's
 * digits-only) stays where it is. `focused` / `onFocusChange` may be lifted
 * when a parent draws the focus ring (the marketing row does); otherwise the
 * field keeps its own.
 */
export const CODE_CELLS = 4;

const SKINS = {
  entry: {
    wrap: 'entry-codewrap', focused: 'is-focused', bad: 'is-bad',
    cells: 'entry-cells', cell: 'entry-cell', filled: 'is-filled', next: 'is-next', input: undefined,
  },
  jce: {
    // The marketing row draws focus and the miss on `.jce-row`, its parent.
    wrap: 'jce-codewrap', focused: '', bad: '',
    cells: 'jce-cells', cell: 'jce-cell', filled: '', next: 'jce-next', input: 'jce-input',
  },
  plr: {
    wrap: 'plr-codewrap', focused: 'plr-codewrap--focused', bad: 'plr-codewrap--bad',
    cells: 'plr-cells', cell: 'plr-cell', filled: 'plr-cell--filled', next: 'plr-cell--next', input: 'plr-codein',
  },
};

const join = (...names) => names.filter(Boolean).join(' ');

export default function SessionCodeField({
  skin = 'plr',
  id,
  name = 'code',
  value = '',
  onChange,
  onPaste,
  readOnly = false,
  required = false,
  bad = false,
  autoFocus = false,
  ariaLabel,
  describedBy,
  inputRef,
  focused: focusedProp,
  onFocusChange,
  length = CODE_CELLS,
}) {
  const s = SKINS[skin] || SKINS.plr;
  const [ownFocus, setOwnFocus] = useState(false);
  const focused = focusedProp === undefined ? ownFocus : focusedProp;
  const setFocused = (next) => {
    setOwnFocus(next);
    if (onFocusChange) onFocusChange(next);
  };
  const code = String(value || '');
  const cells = Array.from({ length }, (_, index) => index);

  return (
    <div className={join(s.wrap, focused && s.focused, bad && s.bad)}>
      <div className={s.cells} aria-hidden="true">
        {cells.map((index) => (
          <div
            key={index}
            className={join(
              s.cell,
              code[index] && s.filled,
              !readOnly && index === code.length && s.next,
            )}
          >
            {code[index] || ''}
          </div>
        ))}
      </div>
      <input
        id={id}
        className={s.input}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={length}
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        // Declarative, so each platform does the right thing: Chrome on
        // Android raises the keyboard, iOS Safari declines without a gesture.
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={bad || undefined}
        readOnly={readOnly}
        required={required || undefined}
        value={code}
        onChange={onChange}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        ref={inputRef}
      />
    </div>
  );
}
