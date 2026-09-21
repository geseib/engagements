import React, { useId, useState, useEffect } from 'react';
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

/**
 * THE NUMBER BOX, WHICH CAN BE EMPTIED AND RETYPED.
 *
 * The box used to be fully controlled by the clamped value, so backspacing it
 * snapped straight to the minimum and "clear, then type 12" produced 112. The
 * caller is still only ever handed a clamped integer — an emptied box reports
 * the minimum, never NaN — but what is DRAWN while the box is empty is the
 * empty box. It catches up with the real value on blur.
 */
function NumberBox({ id, value, min, max, onCommit, className = 'cnt-input', ariaLabel }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft((d) => (d === '' ? d : String(value))); }, [value]);
  return (
    <input
      id={id}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value;
        const next = Math.min(max, Math.max(min, Number(raw) || min));
        setDraft(raw === '' ? '' : String(next));
        onCommit(next);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
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
        <NumberBox id={id} value={current} min={min} max={max} onCommit={set} />
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

/**
 * HOW BIG IS THE SET — categories × questions in each, with the total stated.
 *
 * The builders used to ask for a TOTAL and, two fields away, a number of
 * categories, leaving the figure a person actually judges — how many questions
 * each category gets — as arithmetic to do in their head. The owner's ask:
 * "modify the question and the category count selectors to be much more user
 * friendly ... the question count picker [should] default to 2/3/5/10 per
 * category."
 *
 * So the two numbers sit in one group, the second is asked PER CATEGORY, and
 * the product is printed once underneath. The caller's state does not change
 * shape: it still holds a total (`count`) and `categories`, and `onChange`
 * hands back both, already clamped so the total never passes `maxTotal`.
 *
 * No steppers and no track here: presets for the usual answer, one box that
 * can be typed over for any other. Two affordances per number, not four.
 */
export const PER_CATEGORY_PRESETS = [2, 3, 5, 10];
export const CATEGORY_PRESETS = [1, 3, 4, 6, 8];

export function SetSizeField({
  count,
  categories,
  onChange,
  noun = 'questions',
  maxTotal = 100,
  maxCategories = 24,
  hint = '',
  /**
   * The categories are already decided — adding to a set's OWN categories.
   * The picker is replaced by their names, and only "in each" can change.
   */
  lockedCategories = null,
  /**
   * ADDING TO A SET THAT ALREADY HAS QUESTIONS — `{ existingTotal }`.
   * The owner: "its unclear when i select 5 questions (and there are 5
   * categories) am i adding 25 questions or increasing from what existed to a
   * total of 25?" So every number here says NEW, and the total line states
   * both figures: how many are added, and what the set grows from and to.
   */
  adding = null,
}) {
  const catId = useId();
  const perId = useId();
  const cats = Math.min(maxCategories, Math.max(1, Number(categories) || 1));
  const total = Math.min(maxTotal, Math.max(1, Number(count) || 1));
  const perMax = Math.max(1, Math.floor(maxTotal / cats));
  const per = Math.min(perMax, Math.max(1, Math.round(total / cats)));
  // A total that arrived from elsewhere ("generate the 7 that are missing")
  // may not divide evenly. Say "about" rather than print a false product.
  const even = per * cats === total;

  const setCats = (n) => {
    const nextCats = Math.min(maxCategories, Math.max(1, n));
    const nextPer = Math.min(per, Math.max(1, Math.floor(maxTotal / nextCats)));
    onChange({ categories: nextCats, count: nextCats * nextPer });
  };
  const setPer = (n) => {
    const nextPer = Math.min(perMax, Math.max(1, n));
    onChange({ categories: cats, count: cats * nextPer });
  };

  const row = (id, label, value, presets, max, commit) => (
    <div className="cnt-size-row">
      <label className="cnt-label" htmlFor={id}>{label}</label>
      <div className="cnt-size-pick">
        <div className="cnt-presets" role="radiogroup" aria-label={label}>
          {presets.filter((preset) => preset <= max).map((preset) => (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={value === preset}
              className={`cnt-preset${value === preset ? ' is-on' : ''}`}
              onClick={() => commit(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        <span className="cnt-size-or">or</span>
        <NumberBox id={id} value={value} min={1} max={max} onCommit={commit} />
        <span className="cnt-range">up to {max}</span>
      </div>
    </div>
  );

  return (
    <div className="cnt cnt-size" role="group" aria-label={`How many ${noun}`}>
      {lockedCategories ? (
        <div className="cnt-size-row" data-testid="set-size-locked">
          <span className="cnt-label">Categories — this set's own {lockedCategories.length}, no new ones</span>
          <p className="cnt-hint">{lockedCategories.join(' · ')}</p>
        </div>
      ) : row(catId, 'Categories', cats, CATEGORY_PRESETS, maxCategories, setCats)}
      {row(perId, adding ? `New ${noun} to add to each category` : `${noun.replace(/^./, (c) => c.toUpperCase())} in each category`, per, PER_CATEGORY_PRESETS, perMax, setPer)}
      <p className="cnt-size-total" data-testid="set-size-total" aria-live="polite">
        {adding ? 'Adding ' : ''}<b>{even ? total : `${adding ? 'about' : 'About'} ${total}`}</b> {adding ? `new ${noun}` : `${noun} in total`}
        {cats > 1 && even ? <span className="cnt-unit"> — {cats} categories × {per}</span> : null}
        {total >= maxTotal ? <span className="cnt-unit"> · the most one run can write</span> : null}
      </p>
      {adding && (
        <p className="cnt-hint" data-testid="set-size-grows">
          On top of the {adding.existingTotal} already in the set — it goes from {adding.existingTotal} to {adding.existingTotal + total}. Nothing existing is replaced.
        </p>
      )}
      {hint && <p className="cnt-hint">{hint}</p>}
    </div>
  );
}
