/**
 * THE WHEEL (owner, 2026-10-05: "integrate a great looking wheel spin").
 *
 * One drawing for the wall, the host and every phone. WHERE IT LANDS IS THE
 * SERVER'S (build-store.js `wheelView`, build-room.js `spinWheel`): each spin
 * arrives with its result slice and a number of turns, and every screen
 * animates from where it is to that slice, so nobody sees a different answer.
 * A screen that opens after a spin shows the wheel at rest on its result.
 *
 * Pure SVG and one CSS transition: no library, nothing on a timer but the
 * fallback that settles a screen whose browser never fires `transitionend`.
 * Reduced motion skips the spin and shows the result.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './BuildWheel.css';

export const SPIN_MS = 5600;
const R = 100;          // slice radius
const RIM = 108;        // the rim behind the slices

/** The angle (degrees clockwise from the top) at the middle of slice `i` of `n`. */
export const sliceCenter = (i, n) => (i + 0.5) * (360 / n);

/** The rotation that puts slice `i` of `n` under the pointer at the top. */
export const restingAngle = (i, n) => ((360 - sliceCenter(i, n)) % 360 + 360) % 360;

/** Where to rotate next: on from `from`, `turns` whole turns, then to slice `i` (always forward). */
export function nextAngle(from, i, n, turns) {
  const base = from - (((from % 360) + 360) % 360);
  let to = base + turns * 360 + restingAngle(i, n);
  while (to - from < turns * 360) to += 360;
  return to;
}

/** Four slice colours that alternate; a last slice never matches the first. */
export function sliceTone(i, n) {
  const tone = i % 4;
  if (i === n - 1 && n > 1 && tone === 0) return 2;
  return tone;
}

const point = (deg, r) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
};

function slicePath(i, n) {
  const a0 = i * (360 / n);
  const a1 = (i + 1) * (360 / n);
  const [x0, y0] = point(a0, R);
  const [x1, y1] = point(a1, R);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M 0 0 L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function prefersStill() {
  try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

/**
 * `wheel` is the server's view: {slices, spinner, armed, spins, landed, mine}.
 * `onSpin`, when given, draws the Spin button (the host, or the phone whose
 * turn it is); `spinLabel` names it. `spinPrimary` marks it as the Host
 * screen's next move (useNextFocus: focus lands on it, Space presses it).
 */
export default function BuildWheel({ wheel, onSpin = null, spinLabel = 'Spin the wheel', busy = false, size = 'md', spinPrimary = false }) {
  const slices = (wheel && wheel.slices) || [];
  const n = slices.length;
  const spins = (wheel && wheel.spins) || [];
  const last = spins.length ? spins[spins.length - 1] : null;
  const lastIndex = last ? Math.max(0, slices.findIndex((s) => s.id === last.result)) : -1;

  const [angle, setAngle] = useState(() => (last ? restingAngle(lastIndex, n) : 0));
  const [moving, setMoving] = useState(false);
  const [settled, setSettled] = useState(Boolean(last));
  const seen = useRef(last ? last.spinId : null);
  const timer = useRef(null);

  const settle = () => {
    clearTimeout(timer.current);
    setMoving(false);
    setSettled(true);
  };

  // A new spin: animate on to its slice. (Layout effect, so the start angle
  // is painted before the transition begins.)
  useLayoutEffect(() => {
    if (!last || last.spinId === seen.current) return;
    seen.current = last.spinId;
    if (prefersStill()) {
      setAngle(restingAngle(lastIndex, n));
      settle();
      return;
    }
    setSettled(false);
    setMoving(true);
    setAngle((from) => nextAngle(from, lastIndex, n, last.turns || 5));
    clearTimeout(timer.current);
    timer.current = setTimeout(settle, SPIN_MS + 300);
  }, [last && last.spinId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);

  if (n < 2) return null;
  const won = settled && last ? last.result : null;
  const winner = won ? slices.find((s) => s.id === won) : null;
  const lettered = slices.every((s) => s.label);
  let caption;
  if (moving) caption = 'Spinning…';
  else if (winner) caption = `The wheel picked ${winner.label ? `${winner.label}: ` : ''}${winner.text}`;
  else if (wheel.spinner && wheel.armed) caption = `${wheel.spinner} spins the wheel`;
  else caption = 'Ready to spin';

  return (
    <div className={`bwh bwh--${size}${winner ? ' is-landed' : ''}`} data-landed={winner ? winner.id : ''}>
      <svg className="bwh-svg" viewBox="-116 -124 232 240" role="img" aria-label={`A wheel of ${n}: ${slices.map((s) => (s.label ? `${s.label}, ${s.text}` : s.text)).join('; ')}`}>
        <circle className="bwh-rim" r={RIM} />
        <g
          className={`bwh-rot${moving ? '' : ' is-still'}`}
          style={{ transform: `rotate(${angle}deg)` }}
          onTransitionEnd={settle}
        >
          {slices.map((s, i) => {
            const tone = sliceTone(i, n);
            const c = sliceCenter(i, n);
            return (
              <g key={s.id} className={`bwh-slice bwh-slice--${tone}${won === s.id ? ' is-won' : ''}`}>
                <path d={slicePath(i, n)} />
                <g transform={`rotate(${c})`}>
                  {lettered ? (
                    <>
                      <text className="bwh-letter" x="0" y={-R * 0.72} textAnchor="middle" dominantBaseline="middle">{s.label}</text>
                      {n <= 6 && (
                        <text className="bwh-word" x="0" y={-R * 0.46} textAnchor="middle" dominantBaseline="middle">{short(s.text, 14)}</text>
                      )}
                    </>
                  ) : (
                    // Along the radius, ending just inside the rim, so it never reaches the hub.
                    <text className="bwh-word bwh-word--radial" x={R * 0.9} y="0" transform="rotate(-90)" textAnchor="end" dominantBaseline="middle">
                      {short(s.text, n > 8 ? 13 : 16)}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
          {slices.map((s, i) => {
            const [x, y] = point(i * (360 / n), R + 3.5);
            return <circle key={`peg-${s.id}`} className="bwh-peg" cx={x.toFixed(2)} cy={y.toFixed(2)} r="3" />;
          })}
        </g>
        <circle className="bwh-hub" r="21" />
        <text className={`bwh-hubtext${winner && winner.label ? ' is-letter' : ''}`} x="0" y="1" textAnchor="middle" dominantBaseline="middle">
          {winner && winner.label ? winner.label : 'SPIN'}
        </text>
        <path className="bwh-pointer" d="M -12 -122 L 12 -122 L 0 -98 Z" />
      </svg>
      <p className="bwh-caption" role="status" aria-live="polite">{caption}</p>
      {onSpin && (
        <button type="button" className="bwh-spin" data-next-primary={spinPrimary || undefined} disabled={busy || moving} onClick={onSpin}>{spinLabel}</button>
      )}
    </div>
  );
}
