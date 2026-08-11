import React, { useState } from 'react';
import { checkPassword } from './passwordPolicy';
import './auth.css';

/**
 * The one password control. Every surface that asks for a password uses this,
 * which is what makes `passwordPolicy.js` binding rather than advisory.
 *
 * Two things it carries that the old three fields did not:
 *
 * 1. AN ACCESSIBLE NAME. The mockup audit's check E5 found three password
 *    fields with no label at all. The `label` prop is required and is wired
 *    with htmlFor/id, not placeholder text.
 *
 * 2. A LIVE CHECKLIST, from the first keystroke rather than an error after
 *    submitting (RATIONALE.md §8.3). There is deliberately no strength meter
 *    beside it: the checklist states every fact the meter approximates, and two
 *    statements of one thing is redundancy.
 *
 * `data-met` on each rule carries the met/unmet state, so it is legible to a
 * test and to assistive technology rather than living in colour alone.
 *
 * THE SHOW TOGGLE IS PER FIELD, AND THAT MATTERS NOW THAT REGISTRATION HAS TWO
 * OF THEM. `visible` is local state, so a screen that renders two of these gets
 * two independent toggles. That is the choice, not an accident of where the
 * state happened to live:
 *
 *   - You only ever need to see the field you are correcting. Unmasking both at
 *     once doubles what is on a shared or projected screen and buys nothing.
 *   - A linked toggle would have to be lifted into each caller and threaded back
 *     down, so the other four surfaces would carry a prop only registration uses.
 *
 * The three optional props below (`onBlur`, `inputRef`, `liveHint`) exist for
 * registration's confirm field and default to the previous behaviour, so the
 * other four call sites are unchanged.
 */
export default function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  onBlur,
  inputRef,
  autoComplete = 'new-password',
  showRules = false,
  invalid = false,
  disabled = false,
  hint = null,
  hintId,
  liveHint = false,
  trailing = null,
}) {
  const [visible, setVisible] = useState(false);
  const rules = showRules ? checkPassword(value) : null;

  return (
    <div className="au-field">
      {/* THE TRAILING CONTROL IS A SIBLING OF THE LABEL, NOT A CHILD OF IT.
          "Forgotten it?" sat inside the <label> first, which is nested
          interactive content: the label's activation behaviour forwards the
          click to the input it names, so the button rendered, looked right, and
          did nothing. It is also invalid -- a label may not contain another
          focusable control. A flex row of two siblings gets the same line with
          neither problem. */}
      {trailing ? (
        <div className="au-label-row">
          <label className="au-label" htmlFor={id}>{label}</label>
          {trailing}
        </div>
      ) : (
        <label className="au-label" htmlFor={id}>{label}</label>
      )}

      <span className="au-pwwrap">
        <input
          id={id}
          name={name}
          ref={inputRef}
          className={`au-input${invalid ? ' is-bad' : ''}`}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-describedby={hint || liveHint ? hintId : undefined}
          aria-invalid={invalid || undefined}
        />
        <button
          type="button"
          className="au-pwtoggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          disabled={disabled}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>

      {/* A LIVE REGION HAS TO EXIST BEFORE ITS CONTENT CHANGES. Screen readers
          watch regions that were already in the accessibility tree; one that is
          inserted together with its first text is announced unreliably or not
          at all. So with `liveHint` the paragraph is always rendered and only
          its text comes and goes -- `.au-hint:empty` hides the empty one, which
          is why it costs no space. Without `liveHint` this is exactly the old
          markup: mount-on-error, described-by, no live region. */}
      {liveHint ? (
        <p className="au-hint is-bad" id={hintId} aria-live="polite">
          {hint || ''}
        </p>
      ) : (
        hint && (
          <p className="au-hint is-bad" id={hintId}>
            {hint}
          </p>
        )
      )}

      {rules && (
        <ul className="au-rules">
          {rules.map((rule) => (
            <li key={rule.id} data-met={rule.ok ? 'true' : 'false'}>
              <span className="au-bx" aria-hidden="true" />
              {rule.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
