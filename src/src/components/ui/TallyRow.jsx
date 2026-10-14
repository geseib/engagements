import React from 'react';
import { sizeValue } from './NumberBadge';
import './TallyRow.css';

/**
 * TALLY ROW (docs/design/themes/SPEC.md §6, unit L10): rank · label · bar · points.
 * A port of the Presentation's results row (present/PresentMoments.jsx
 * PresentTally, `.present-trow`).
 *
 *   <TallyRow rank={1} label="Shorter meetings" sub="We could start by…" share={0.42} points={18} />
 *   <TallyRow rank={2} label="A shared notebook" share={0.05} points={null} />
 *
 * Props
 *   rank       the place, shown muted in tabular figures. Omit for an empty cell.
 *   label      the row's name.
 *   sub        a line under the label (the response's first words), cut to one
 *              line with an ellipsis; the full text is its title (hard rule 7).
 *   share      0..1, drawn as a bar. Never under 3% so a share is always seen,
 *              never over 100%. null/undefined: no bar.
 *   points     the score, tabular figures, with `unit` after it. null/undefined:
 *              an empty cell, so the columns of a list still line up.
 *   unit       the word after the points, default 'points'.
 *   size       the row's ladder step: a CSS length or var() string, or px.
 *              Sets --ui-size; the rest of the row is in em of it.
 *   as         the element, default 'div' ('li' inside an <ol>).
 *   className  appended; every other prop passes through.
 */
export const BAR_MIN_PERCENT = 3;

/** The bar's width in whole percent: at least 3, at most 100; null for no bar. */
export function barPercent(share) {
  if (share === null || share === undefined || share === '') return null;
  const n = Number(share);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(BAR_MIN_PERCENT, Math.round(n * 100)));
}

const present = (v) => v !== null && v !== undefined && v !== '';

export default function TallyRow({ rank, label, sub, share, points, unit = 'points', size, as: Tag = 'div', className = '', style, ...rest }) {
  const pct = barPercent(share);
  const s = sizeValue(size);
  return (
    <Tag className={`ui-trow${className ? ` ${className}` : ''}`} style={s ? { ...style, '--ui-size': s } : style} {...rest}>
      <span className="ui-trow-rank">{present(rank) ? rank : null}</span>
      <div className="ui-trow-who">
        {label}
        {present(sub) ? <span className="ui-trow-sub" title={typeof sub === 'string' ? sub : undefined}>{sub}</span> : null}
        {pct !== null ? <div className="ui-trow-bar" style={{ width: `${pct}%` }} /> : null}
      </div>
      {present(points) ? (
        <span className="ui-trow-points">
          {points}
          {unit ? <small className="ui-trow-unit">{unit}</small> : null}
        </span>
      ) : <span className="ui-trow-points" />}
    </Tag>
  );
}
