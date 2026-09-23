import React, { useRef } from 'react';
import { ratingSteps, rovingIndex } from './surveyAnswers';

/**
 * A RATING — one row of equal steps (p-01), eleven that wrap for 0–10 (p-02),
 * or stars.
 *
 * A radiogroup with a ROVING tab stop: one Tab lands on the chosen step (or
 * the first, before anything is chosen), and the arrow keys move the choice
 * with the focus — the way a native radio group behaves, which is what a
 * keyboard user already knows. Stars are the same buttons drawn as glyphs;
 * the digit stays in the accessible name ("4 of 5"), so a screen reader never
 * hears "star, star, star".
 *
 * The end labels sit UNDER the ends they name, never inside a step.
 */
export default function RatingInput({ question, value, onChange }) {
  const steps = ratingSteps(question.scale);
  const stars = question.scale === 'stars';
  const lo = steps[0];
  const hi = steps[steps.length - 1];
  const low = String(question.lowLabel ?? '').trim();
  const high = String(question.highLabel ?? '').trim();
  const refs = useRef([]);

  const chosen = steps.indexOf(value);
  const tabStop = chosen >= 0 ? chosen : 0;

  const groupName = low || high
    ? `From ${lo}${low ? `, ${low},` : ''} to ${hi}${high ? `, ${high}` : ''}`
    : `From ${lo} to ${hi}`;

  const onKeyDown = (event, index) => {
    const next = rovingIndex(event.key, index, steps.length);
    if (next === null) return;
    event.preventDefault();
    onChange(steps[next]);
    const el = refs.current[next];
    if (el) el.focus();
  };

  const groupClass = stars
    ? 'plr-stars'
    : `plr-scale${steps.length > 10 ? ' plr-scale--wrap' : ''}`;

  return (
    <>
      <div className={groupClass} role="radiogroup" aria-label={groupName}>
        {steps.map((step, i) => {
          const checked = step === value;
          const lit = stars && chosen >= 0 && i <= chosen;
          return (
            <button
              key={step}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${step} of ${hi}`}
              tabIndex={i === tabStop ? 0 : -1}
              className={`plr-step${lit ? ' plr-step--on' : ''}`}
              onClick={() => onChange(step)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {stars ? '★' : step}
            </button>
          );
        })}
      </div>
      {(low || high) && (
        <div className="plr-ends">
          <span>{low ? `${lo} · ${low}` : ''}</span>
          <span>{high ? `${hi} · ${high}` : ''}</span>
        </div>
      )}
    </>
  );
}
