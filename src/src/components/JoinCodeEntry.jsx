import React from 'react';
import useJoinCode, { CODE_LENGTH } from '../hooks/useJoinCode';
import SessionCodeField from './SessionCodeField';
import { JOIN } from '../config/playerWords';
import './JoinCodeEntry.css';

/**
 * The join field for a page whose main job is something else. No autoFocus:
 * on /join the field IS the page, here it is one line under a headline.
 *
 * Presentation follows the mockup's `.jce` form (docs/design/marketing-redesign/
 * 01-home.html): four digit cells drawn over one real input, the way RootPage
 * draws `.entry-cells` over `.entry-code`. All join logic stays in
 * useJoinCode -- this component only renders it.
 */
export default function JoinCodeEntry({ label = 'Have a code?' }) {
  const j = useJoinCode();
  return (
    <form className="jce" onSubmit={j.handleSubmit}>
      <label className="jce-label" htmlFor="jce-code">{label}</label>
      <div
        className={[
          'jce-row',
          j.focused ? 'jce-focused' : '',
          j.missing ? 'jce-bad' : '',
        ].filter(Boolean).join(' ')}
      >
        {/* THE ONE CODE WIDGET (experience plan 3a): the same cells and
            input as /join and the play page; this row draws its focus. */}
        <SessionCodeField
          skin="jce"
          id="jce-code"
          value={j.code}
          length={j.cells.length || CODE_LENGTH}
          onChange={j.handleChange}
          onPaste={j.handlePaste}
          ariaLabel="Session code, 4 digits"
          focused={j.focused}
          onFocusChange={j.setFocused}
        />
        <button type="submit" className="jce-go" disabled={!j.canSubmit}>{JOIN.button}</button>
      </div>
      {j.missing ? (
        <p className="jce-missing" role="alert">
          Nothing is running under {j.missing}. Check the screen at the front of the room.
        </p>
      ) : (
        <p className="jce-hint">
          No account and no app. The code is on the screen at the front of the room.
        </p>
      )}
      <p className="jce-note" role="status" aria-live="polite">{j.note}</p>
    </form>
  );
}
