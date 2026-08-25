import React, { useId } from 'react';
import Icon from './Icon';
import './CountField.css';

/**
 * "HOW MANY?" — presets first, then one secondary row that is exact at one end
 * and gives you the sense of scale at the other.
 *
 * ── THE SLIDER WENT, AND THEN CAME BACK, AND BOTH WERE RIGHT ───────────────
 *
 * What was removed: every AI builder asked this with THREE SEPARATE controls
 * stacked on each other — an `<input type="range">`, a number box beside it,
 * and a row of presets underneath — repeated across five files, with the range
 * input the most prominent and the least able to answer the question. Nobody
 * drags to 37; they drag near it and correct in the number box, which is why
 * the number box was there. Reported as: "the use of slider seems old school
 * and not current cool design."
 *
 * What went with it, and shouldn't have: the only thing on the field that
 * answers "is 50 a lot?". Presets and a number box both state a value and
 * neither gives it a SIZE. That matters more here than it looks — a generation
 * costs money against an organisation's plan, and takes time in proportion to
 * this number.
 *
 * So the track is back, and it is a different object from the one that left:
 *
 *   - it is secondary, under presets that stay the primary way in;
 *   - it shares its row with the exact entry that answers its one real
 *     weakness, so the field reads as TWO affordances, not three;
 *   - nothing native survives — every visible pixel is painted (CountField.css),
 *     because dated native range styling was half the original complaint;
 *   - it replaces the separate `1–100` caption rather than joining it, stating
 *     the permitted range with its own endpoints;
 *   - it is drawn only where it carries information. Over a handful of values a
 *     track is decoration — see TRACK_MIN_SPAN.
 *
 * The presets stay primary because they are still the real answer almost every
 * time — 5, 10, 20 — and the selected one is filled, so the current value
 * survives a glance rather than being inferred from a thumb position. Every
 * value remains reachable without a pointer.
 */

/*
  Under this many steps a track is decoration: it cannot show a meaningful
  proportion, and its endpoints say less than the words "1–6" would. Every
  caller today spans 23, 49 or 99, so every caller gets one.
*/
export const TRACK_MIN_SPAN = 12;
export default function CountField({
  label,
  value,
  onChange,
  min = 1,
  max = 100,
  presets = [],
  hint = '',
  unit = '',
  track = true,
}) {
  const id = useId();
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const current = clamp(Number(value) || min);
  const set = (n) => onChange(clamp(Number(n) || min));
  const hasTrack = track && max - min >= TRACK_MIN_SPAN;
  const fill = max > min ? (current - min) / (max - min) : 0;

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
        {hasTrack ? (
          /*
            TWO CONTROLS FOR ONE VALUE, deliberately, and each labelled for what
            it does rather than for the value — the group already carries the
            name, exactly as the steppers do. A pointer user drags; everyone
            else has the presets, the steppers and the box, and the slider still
            takes arrow keys for anyone who prefers it.
          */
          <>
            <span className="cnt-edge cnt-edge-min">{min}</span>
            <span className="cnt-track" style={{ '--cnt-fill': fill }}>
              <input
                type="range"
                className="cnt-slider"
                min={min}
                max={max}
                value={current}
                onChange={(e) => set(e.target.value)}
                aria-label="Set roughly"
              />
            </span>
            <span className="cnt-edge">{max}</span>
          </>
        ) : (
          <span className="cnt-range">{min}–{max}</span>
        )}
      </div>

      {hint && <p className="cnt-hint">{hint}</p>}
    </div>
  );
}
