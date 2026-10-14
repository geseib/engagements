import React from 'react';
import './Pips.css';

/**
 * PIPS (docs/design/themes/SPEC.md §6, unit L6): progress as a row of pills.
 * A port of the Presentation's Meter, page pips and navigator track
 * (present/PresentMoments.jsx Meter/Track/ReadPage, present/navigatorWindow.js
 * trackOf), so the Presentation can adopt it with the same pills.
 *
 *   <Pips variant="meter" done={7} of={12} />          7 of 12 answered
 *   <Pips variant="pages" done={2} of={5} />           page 3 of 5 on screen, 1-2 read
 *   <Pips variant="track" done={5} of={40} />          response 6 of 40 (a bar past 24)
 *
 * Props
 *   variant   'meter' (default) | 'pages' | 'track'
 *   done      meter: how many are done. pages and track: the 0-based index of
 *             the one on screen.
 *   of        meter: how many there are. pages: page count. track: response count.
 *   seen      pages only: how many pages have been read (default `done`, so
 *             every page before the current one). A reader who went back sees
 *             the pages beyond it still marked read.
 *   label     words for the whole indicator (role="img"). Without one it is
 *             aria-hidden: the surface states the position in text, as the
 *             Presentation's foot does.
 *   className appended; other props pass through.
 *
 * Caps at 24 pills (PLAN L6). The meter scales `done` onto 24 pills and turns
 * green when everyone is done; pages and track past 24 become one bar with a
 * marker. Colours are the skin's (Pips.css).
 */
export const PIPS_MAX = 24;
const VARIANTS = ['meter', 'pages', 'track'];

const count = (v) => Math.max(0, Math.floor(Number(v) || 0));
const indexIn = (v, n) => Math.min(Math.max(0, n - 1), count(v));

/** The model each variant draws: { kind: 'pills', pills: [cls|undefined] } or { kind: 'bar', at }. */
export function pipsModel(variant, done, of, seen) {
  const n = count(of);
  if (variant === 'meter') {
    const cap = Math.min(n, PIPS_MAX);
    const d = Math.min(count(done), n);
    const on = n > 0 ? Math.round((d * cap) / n) : 0;
    const all = n > 0 && d >= n;
    return { kind: 'pills', pills: Array.from({ length: cap }, (_, i) => (i < on ? (all ? 'is-all' : 'is-on') : undefined)) };
  }
  const i = indexIn(done, n);
  if (n > PIPS_MAX) return { kind: 'bar', at: n > 1 ? i / (n - 1) : 0 };
  if (variant === 'track') return { kind: 'pills', pills: Array.from({ length: n }, (_, k) => (k === i ? 'is-on' : undefined)) };
  const read = seen === undefined || seen === null ? i : count(seen);
  return { kind: 'pills', pills: Array.from({ length: n }, (_, k) => (k === i ? 'is-on' : k < read ? 'is-seen' : undefined)) };
}

export default function Pips({ variant = 'meter', done = 0, of = 0, seen, label, className = '', style, ...rest }) {
  const v = VARIANTS.includes(variant) ? variant : 'meter';
  const model = pipsModel(v, done, of, seen);
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' };
  const base = `ui-pips ui-pips--${v}${model.kind === 'bar' ? ' is-bar' : ''}${className ? ` ${className}` : ''}`;
  if (model.kind === 'bar') {
    return (
      <div className={base} style={{ ...style, '--ui-pips-at': String(model.at) }} {...a11y} {...rest}>
        <span className="ui-pips-mark" />
      </div>
    );
  }
  return (
    <div className={base} style={style} {...a11y} {...rest}>
      {model.pills.map((cls, k) => <i key={k} className={cls} />)}
    </div>
  );
}
