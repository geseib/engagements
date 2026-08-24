import React, { useId } from 'react';
import Icon from './Icon';
import './CountField.css';

/**
 * "HOW MANY?" — presets, a stepper, and a typed value. No slider.
 *
 * ── WHY THE SLIDER WENT ────────────────────────────────────────────────────
 *
 * Every AI builder asked this question with THREE controls stacked on each
 * other: an `<input type="range">`, a number box beside it, and a row of preset
 * buttons underneath. Three affordances for one integer, repeated five times
 * across five files.
 *
 * The slider was the weakest of the three and the most prominent. Nobody drags
 * to 37; they drag near it and then correct in the number box, which is why the
 * number box was there. It is imprecise by construction, it is poor on touch,
 * it is awkward from a keyboard, and native range styling is the single most
 * dated-looking control on a modern screen — which is what was reported: "the
 * use of slider seems old school and not current cool design."
 *
 * ── WHAT REPLACED IT ───────────────────────────────────────────────────────
 *
 * The presets become the primary control, because they are the real answer
 * almost every time — 5, 10, 20. The selected one is filled, so the current
 * value is legible at a glance rather than inferred from a thumb position.
 * Anything else is typed, with − and + for the small adjustments a slider was
 * genuinely good at.
 *
 * That is one control instead of three, exact by construction, and it needs no
 * pointer at all.
 */
export default function CountField({
  label,
  value,
  onChange,
  min = 1,
  max = 100,
  presets = [],
  hint = '',
  unit = '',
}) {
  const id = useId();
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const current = clamp(Number(value) || min);
  const set = (n) => onChange(clamp(Number(n) || min));

  return (
    /*
      THE FIELD NAMES ITSELF ONCE, on the group. The steppers then say only what
      they do — "One fewer", "One more" — and assistive technology announces the
      group's name around them.

      They used to carry the whole label ("One fewer (Scenarios to generate)"),
      which is redundant when read aloud and, more practically, put the word
      "generate" inside a button name on a form whose primary action is called
      Generate. Every test that reached for that button found three.
    */
    <div className="cnt" role="group" aria-label={label}>
      <div className="cnt-head">
        <label className="cnt-label" htmlFor={id}>{label}</label>
        <span className="cnt-value">
          {current}
          {unit ? <span className="cnt-unit"> {unit}</span> : null}
        </span>
      </div>

      {presets.length > 0 && (
        /* `radiogroup`, not a row of buttons: these are mutually exclusive
           choices of one value, and saying so is what lets a screen reader
           announce "3 of 4" instead of four unrelated presses. */
        <div className="cnt-presets" role="radiogroup" aria-label={label}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={current === preset}
              className={`cnt-preset${current === preset ? ' is-on' : ''}`}
              onClick={() => set(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      )}

      <div className="cnt-exact">
        <button
          type="button"
          className="cnt-step"
          onClick={() => set(current - 1)}
          disabled={current <= min}
          aria-label="One fewer"
        >
          <Icon name="Minus" weight="bold" size={13} color="currentColor" />
        </button>
        <input
          id={id}
          className="cnt-input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={current}
          onChange={(e) => set(e.target.value)}
        />
        <button
          type="button"
          className="cnt-step"
          onClick={() => set(current + 1)}
          disabled={current >= max}
          aria-label="One more"
        >
          <Icon name="Plus" weight="bold" size={13} color="currentColor" />
        </button>
        <span className="cnt-range">{min}–{max}</span>
      </div>

      {hint && <p className="cnt-hint">{hint}</p>}
    </div>
  );
}
