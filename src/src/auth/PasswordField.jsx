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
 */
export default function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete = 'new-password',
  showRules = false,
  invalid = false,
  disabled = false,
  hint = null,
  hintId,
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
          className={`au-input${invalid ? ' is-bad' : ''}`}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
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

      {hint && (
        <p className="au-hint is-bad" id={hintId}>
          {hint}
        </p>
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
