/**
 * GUIDANCE FOR THESE QUESTIONS — one batch's instruction, when ADDING to a set.
 *
 * The owner: *"I can imagine having a question set on historic figures and
 * wanting to add 'be sure to include George Washington in at least 1 question',
 * or 'make these more focused on recent historic figures'."*
 *
 * ONE FILE OWNS THE BOX — its words, its limit, its placeholder — so the places
 * that show it cannot drift apart. It is separate from "Additional
 * Requirements", which is the set's standing brief; this one applies to the run
 * it is sent with and is not kept. utils/appendMode.js batchGuidanceFor() is
 * what turns it into the `batchGuidance` request field.
 *
 * TWO PLACES, TWO TONES, ONE BOX.
 *   form     (default) the AI builders' own form. Inside their `.form-group`,
 *            so the label and textarea take that form's styling.
 *   console  the Add questions dialog, beside "Write N more" — the box that
 *            steers the FIRST batch, since that button opens the builder
 *            already generating. The dialog's `.qsets-field` / `.qsets-input`
 *            idiom, on the dialog's own theme.
 * Only the hint line is this file's (BatchGuidanceField.css).
 */
import React, { useId } from 'react';
import { BATCH_GUIDANCE_MAX } from '../utils/appendMode';
import './BatchGuidanceField.css';

export default function BatchGuidanceField({ value = '', onChange, tone = 'form' }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const used = String(value || '').length;
  const onConsole = tone === 'console';
  return (
    <div className={onConsole ? 'qsets-field bgf bgf--console' : 'form-group bgf'} data-testid="batch-guidance">
      <label htmlFor={id}>Guidance for these questions (optional)</label>
      <textarea
        id={id}
        className={onConsole ? 'qsets-input' : undefined}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        maxLength={BATCH_GUIDANCE_MAX}
        rows={onConsole ? 2 : 3}
        aria-describedby={hintId}
        placeholder={'e.g. "Include George Washington in at least one question" or "Focus on more recent historic figures"'}
      />
      <p className="bgf-hint" id={hintId}>
        <span>Applies to this batch only.</span>
        {used > 0 && <span className="bgf-count">{used} / {BATCH_GUIDANCE_MAX}</span>}
      </p>
    </div>
  );
}
