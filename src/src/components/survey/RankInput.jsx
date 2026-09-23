import React from 'react';
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

  const add = (i) => onChange([...placed, i]);
  const takeOut = (i) => onChange(placed.filter((p) => p !== i));
  const move = (from, to) => {
    const next = [...placed];
    [next[from], next[to]] = [next[to], next[from]];
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
                  type="button"
                  className="plr-it"
                  aria-label={`Take out ${label} (place ${place + 1})`}
                  onClick={() => takeOut(i)}
                >
                  {label}
                </button>
                <span className="plr-mv">
                  <button
                    type="button"
                    aria-label={`Move ${label} up`}
                    disabled={place === 0}
                    onClick={() => move(place, place - 1)}
                  >
                    ↑
                  </button>
                  <button
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
    </>
  );
}
