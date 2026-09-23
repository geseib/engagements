import React, { useId } from 'react';
import { textLimit } from './surveyAnswers';

/**
 * AN OPEN ANSWER — p-06. The player's own field (`.plr-inp`, 19px on a phone,
 * so iOS never zooms on focus) with the counter under it.
 *
 * The limit is ENFORCED, not just shown: `maxLength` stops the keyboard, and
 * the value is cut on change as well, because a paste or an autocorrect can
 * land past `maxLength` in some browsers — and the server refuses anything
 * over it, which would turn a long answer into "Not saved".
 *
 * Typing is reported with `{typing: true}`, so the runner saves on a 600 ms
 * pause or on leaving the box rather than on every key.
 */
export default function TextInput({ question, value, onChange, onBlur }) {
  const limit = textLimit(question);
  const long = (question.textLength || 'long') === 'long';
  const text = typeof value === 'string' ? value : '';
  const id = useId();
  const countId = useId();
  const near = text.length >= Math.floor(limit * 0.9);

  return (
    <div className="plr-field">
      <label className="plr-lab" htmlFor={id}>Your answer</label>
      <textarea
        id={id}
        className={`plr-inp ${long ? 'plr-inp--area' : 'plr-inp--note'}`}
        maxLength={limit}
        value={text}
        placeholder={String(question.placeholder ?? '').trim() || undefined}
        aria-describedby={countId}
        onChange={(e) => onChange(e.target.value.slice(0, limit), { typing: true })}
        onBlur={onBlur}
      />
      <p className={`plr-count${near ? ' plr-count--near' : ''}`} id={countId}>
        {text.length} / {limit}
      </p>
    </div>
  );
}
