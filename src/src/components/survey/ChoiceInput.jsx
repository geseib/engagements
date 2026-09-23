import React, { useEffect, useRef, useState } from 'react';
import { countWord, NOTE_LIMIT } from './surveyAnswers';

const isOther = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && typeof v.other === 'string';

/**
 * A MULTIPLE CHOICE — the player's own option row (`.plr-opt`), unchanged,
 * with the rule said twice: once by the SHAPE (a round key for pick one, a
 * square one with a tick for pick several — p-03) and once in words above the
 * options ("Pick up to two · 1 of 2 picked").
 *
 * Radios for one, checkboxes for several, so a screen reader announces the
 * rule before the first option. At the limit the unpicked options are
 * `aria-disabled` rather than silently ignoring a tap, and the rule line says
 * how to change your mind.
 *
 * `order` is the DISPLAY order (utils `seededOrder` when the set shuffles).
 * The value is always canonical indexes, whatever was drawn where.
 *
 * THE WRITE-IN. "Something else" is an option like the others and counts as a
 * pick; ticking it opens a labelled box under it. Ticked with nothing written
 * is not yet an answer, so nothing is sent until there are words — an empty
 * `{other}` would be an answer the person never gave. Typing is reported with
 * `{typing: true}` so the runner can save on a pause rather than per key.
 */
export default function ChoiceInput({ question, value, onChange, onBlur, order }) {
  const options = question.options || [];
  const multi = question.allowMultiple === true;
  const limit = multi ? (Number.isInteger(question.maxPicks) ? question.maxPicks : null) : 1;
  const allowOther = question.allowOther === true;
  const drawn = Array.isArray(order) && order.length === options.length ? order : options.map((_, i) => i);

  const current = Array.isArray(value) ? value : [];
  const picked = current.filter(Number.isInteger);
  const otherEntry = current.find(isOther);
  const [otherTicked, setOtherTicked] = useState(Boolean(otherEntry));
  const [draft, setDraft] = useState(otherEntry ? otherEntry.other : '');
  const otherOn = allowOther && (otherTicked || Boolean(otherEntry));
  const otherText = otherEntry ? otherEntry.other : draft;

  /* Ticking "Something else" is asking to type, so the box takes the focus —
     but only on a tick, never when a resumed answer draws it already open. */
  const otherBox = useRef(null);
  const focusOther = useRef(false);
  useEffect(() => {
    if (otherOn && focusOther.current && otherBox.current) otherBox.current.focus();
    focusOther.current = false;
  }, [otherOn]);

  const count = picked.length + (otherOn ? 1 : 0);
  const atLimit = multi && limit !== null && count >= limit;

  const build = (indexes, withOther, text) => {
    const next = [...new Set(indexes)].sort((a, b) => a - b);
    if (withOther && String(text).trim()) next.push({ other: text });
    return next;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const emit = (next, opts) => {
    if (opts) onChange(next, opts);
    else if (!same(next, current)) onChange(next);
  };

  const toggle = (i) => {
    if (!multi) {
      setOtherTicked(false);
      emit(build([i], false, ''));
      return;
    }
    if (picked.includes(i)) {
      emit(build(picked.filter((p) => p !== i), otherOn, otherText));
    } else if (!atLimit) {
      emit(build([...picked, i], otherOn, otherText));
    }
  };

  const toggleOther = () => {
    if (!multi) {
      if (!otherOn) focusOther.current = true;
      setOtherTicked(true);
      emit(build([], true, otherText));
      return;
    }
    if (otherOn) {
      setOtherTicked(false);
      emit(build(picked, false, ''));
    } else if (!atLimit) {
      focusOther.current = true;
      setOtherTicked(true);
      emit(build(picked, true, otherText));
    }
  };

  const typeOther = (text) => {
    const t = text.slice(0, NOTE_LIMIT);
    setDraft(t);
    emit(build(multi ? picked : [], true, t), { typing: true });
  };

  const role = multi ? 'checkbox' : 'radio';
  const groupName = multi ? (limit !== null ? `Pick up to ${countWord(limit)}` : 'Pick any') : 'Pick one';
  const keyClass = multi ? 'plr-k plr-k--sq' : 'plr-k plr-k--dot';

  let rule;
  if (!multi) rule = <>Pick one.</>;
  else if (limit === null) rule = <>Pick any that apply.</>;
  else {
    rule = (
      <>
        Pick up to <b>{countWord(limit)}</b> · {count} of {limit} picked.
        {atLimit ? ' Untick one to change.' : ''}
      </>
    );
  }

  return (
    <>
      <p className="plr-rule">{rule}</p>
      <div className="plr-opts" role={multi ? 'group' : 'radiogroup'} aria-label={groupName}>
        {drawn.map((i) => {
          const checked = picked.includes(i) && !(!multi && otherOn);
          const unavailable = multi && atLimit && !checked;
          return (
            <button
              key={i}
              type="button"
              role={role}
              aria-checked={checked}
              aria-disabled={unavailable || undefined}
              className="plr-opt"
              onClick={() => toggle(i)}
            >
              <span className={keyClass} aria-hidden="true" />
              <span>{options[i]}</span>
            </button>
          );
        })}
        {allowOther && (
          <div className={`plr-other${otherOn ? ' plr-other--on' : ''}`}>
            <button
              type="button"
              role={role}
              aria-checked={otherOn}
              aria-disabled={(multi && atLimit && !otherOn) || undefined}
              className="plr-opt"
              onClick={toggleOther}
            >
              <span className={keyClass} aria-hidden="true" />
              <span>Something else</span>
            </button>
            {otherOn && (
              <input
                ref={otherBox}
                type="text"
                className="plr-inp plr-inp--other"
                aria-label="Something else — say what"
                maxLength={NOTE_LIMIT}
                value={otherText}
                onChange={(e) => typeOther(e.target.value)}
                onBlur={onBlur}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
