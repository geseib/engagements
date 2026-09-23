import React, { useEffect, useRef, useState } from 'react';
import { countWord } from './surveyAnswers';

/**
 * A RANKING — tap in order, p-05.
 *
 * The Call & Answer vote's own mechanic (tap-in-order slots), grown to N
 * places. Tapping an unplaced item puts it next in line; tapping a placed one
 * takes it out and closes the gap; "Move X up" / "Move X down" reorder. Every
 * operation is a button — dragging is never required (WCAG 2.5.7), and none is
 * offered, because a drag on a phone that also scrolls is how a list ends up
 * reordered by accident.
 *
 * THE FOCUS FOLLOWS THE ITEM. Every one of those buttons is unmounted or
 * disabled by its own press — Add moves the item into the other list, Take
 * out moves it back, Move up into first place disables Move up — and each
 * used to drop a keyboard or screen-reader user's focus on <body>, back at
 * the top of the page, with nothing said. So after each action the focus goes
 * to the item's control in its new place (Add → its Take out; Take out → its
 * Add; a move → the same arrow, or the other one when the move reached an
 * end), and a polite live region says where it went: "Customer stories,
 * place 1", "Customer stories removed". The region is always in the DOM, so a
 * screen reader is already listening when the first change lands.
 *
 * The value is the canonical indexes in the order given. With a `rankTop` the
 * rule line says the top few is enough — the server counts unplaced items at
 * the mean of the places left (IMPLEMENTATION-phase-2.md §2 "Aggregate").
 */
export default function RankInput({ question, value, onChange }) {
  const options = question.options || [];
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < options.length;
  const placed = Array.isArray(value) ? [...new Set(value.filter(inRange))] : [];
  const unplaced = options.map((_, i) => i).filter((i) => !placed.includes(i));
  const top = Number.isInteger(question.rankTop) && question.rankTop > 0 ? question.rankTop : null;

  const [said, setSaid] = useState('');
  const controls = useRef(new Map());          // `${kind}:${item}` → the button
  const focusNext = useRef(null);              // the control to focus once the value lands
  const hold = (kind, i) => (el) => {
    const key = `${kind}:${i}`;
    if (el) controls.current.set(key, el);
    else controls.current.delete(key);
  };

  // After each render: if an action named a control, and it is there now, focus it.
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    const el = controls.current.get(want);
    if (el && !el.disabled) {
      el.focus();
      focusNext.current = null;
    }
  });

  const add = (i) => {
    focusNext.current = `take:${i}`;
    setSaid(`${options[i]}, place ${placed.length + 1}`);
    onChange([...placed, i]);
  };
  const takeOut = (i) => {
    focusNext.current = `add:${i}`;
    setSaid(`${options[i]} removed`);
    onChange(placed.filter((p) => p !== i));
  };
  const move = (from, to) => {
    const i = placed[from];
    const next = [...placed];
    [next[from], next[to]] = [next[to], next[from]];
    // The arrow pressed, unless the move reached the end that disables it.
    let kind = to < from ? 'up' : 'down';
    if (kind === 'up' && to === 0) kind = 'down';
    if (kind === 'down' && to === next.length - 1) kind = 'up';
    focusNext.current = `${kind}:${i}`;
    setSaid(`${options[i]}, place ${to + 1}`);
    onChange(next);
  };

  return (
    <>
      <p className="plr-rule">
        Tap them in the order you’d put them.
        {top && <> <b>Your top {countWord(top)} is enough.</b></>}
      </p>

      {placed.length > 0 && (
        <ol className="plr-rank" aria-label="Your order">
          {placed.map((i, place) => {
            const label = options[i];
            return (
              <li key={i} className="plr-rank-row plr-rank-row--placed">
                <span className="plr-pl" aria-hidden="true">{place + 1}</span>
                <button
                  ref={hold('take', i)}
                  type="button"
                  className="plr-it"
                  aria-label={`Take out ${label} (place ${place + 1})`}
                  onClick={() => takeOut(i)}
                >
                  {label}
                </button>
                <span className="plr-mv">
                  <button
                    ref={hold('up', i)}
                    type="button"
                    aria-label={`Move ${label} up`}
                    disabled={place === 0}
                    onClick={() => move(place, place - 1)}
                  >
                    ↑
                  </button>
                  <button
                    ref={hold('down', i)}
                    type="button"
                    aria-label={`Move ${label} down`}
                    disabled={place === placed.length - 1}
                    onClick={() => move(place, place + 1)}
                  >
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {unplaced.length > 0 && (
        <>
          <p className="plr-rank-h">{placed.length ? 'Not placed · tap to add' : 'Tap to place'}</p>
          <ul className="plr-rank" aria-label="Not placed">
            {unplaced.map((i) => (
              <li key={i} className="plr-rank-row plr-rank-row--unplaced">
                <span className="plr-pl" aria-hidden="true" />
                <button
                  ref={hold('add', i)}
                  type="button"
                  className="plr-it"
                  aria-label={`Add ${options[i]}`}
                  onClick={() => add(i)}
                >
                  {options[i]}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="plr-sr" aria-live="polite" aria-atomic="true">{said}</p>
    </>
  );
}
