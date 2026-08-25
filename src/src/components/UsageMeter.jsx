import React from 'react';
import './UsageMeter.css';

/**
 * THE USAGE METER — one grid, N rows, and an allowance drawn as a NOTCH.
 *
 * Specification: docs/design/tenancy-redesign/04-billing.html (a paid Team over
 * its sessions) and 12-personal-limit.html (a free personal space at its
 * limit). RATIONALE §3 carries the reasoning.
 *
 * THE ALLOWANCE IS A NOTCH ON THE TRACK, NOT THE END OF IT. A bar that fills to
 * 100% and stops cannot show "15 over". So the track is scaled to whichever is
 * larger — what was used, or what is included — and the allowance is a rule
 * drawn ON it. Past the allowance the fill runs the whole length and the notch
 * slides left, which makes the overage a length you can see rather than a
 * number you have to read.
 *
 * PURE PROPS AND CALLBACKS, NO CONTEXT, NO FETCH. `AdminPage` cannot be mounted
 * in jsdom at all — `useAuth` hard-throws outside its provider — so a component
 * that renders on its own is a component that can be tested. Everything here
 * arrives as props.
 *
 * NO GEOMETRY IS ASSERTED IN TESTS, because jsdom has no layout engine and
 * every measured width there is 0. The fill and the notch therefore carry their
 * position as a `data-percent` STRING as well as an inline width/left, and the
 * tests read the string.
 */

/** A percentage as CSS wants it, with no float dust: 25, 60, 33.33, 100. */
function percent(value) {
  return `${Number(Number(value).toFixed(2))}%`;
}

/**
 * Where the fill ends and where the notch sits, for one row.
 *
 * Exported because it is the whole idea of the component and deserves to be
 * tested without a DOM. `included` of 0 would divide by zero, so the span
 * floors at 1 — a row with no allowance draws a full bar and a notch at the
 * origin rather than `NaN%`, which CSS drops silently.
 */
export function meterGeometry(used, included) {
  const u = Math.max(0, Math.trunc(Number(used) || 0));
  const inc = Math.max(0, Math.trunc(Number(included) || 0));
  const span = Math.max(u, inc, 1);
  return {
    used: u,
    included: inc,
    /* At or past the allowance. `5 of 5` on a free plan is amber too: it is the
       last one, and finding that out afterwards is the failure this screen
       exists to prevent. */
    over: inc > 0 && u >= inc,
    /* Strictly past it — the only state that has an overage to name. */
    past: u > inc,
    overage: Math.max(0, u - inc),
    fill: percent((u / span) * 100),
    notch: percent((inc / span) * 100),
    /* The notch sitting exactly at the end needs its label right-aligned or it
       hangs into the gap before the value. */
    notchAtEnd: inc >= u,
  };
}

/**
 * @param {object[]} rows      [{ key, label, used, included }]
 * @param {boolean}  compact   the one-line strip for the host front door: no
 *                             panel, no notch label, tighter gutters.
 * @param {string}   theme     'dark' (default) or 'light'. DECLARED on the
 *                             root, never inherited — index.html puts
 *                             data-theme="light" on <html>.
 */
export default function UsageMeter({
  rows = [],
  compact = false,
  theme = 'dark',
  className = '',
}) {
  if (!rows.length) return null;

  return (
    <div
      className={`usg${compact ? ' usg--compact' : ''}${className ? ` ${className}` : ''}`}
      data-theme={theme}
    >
      {rows.map((row) => {
        const g = meterGeometry(row.used, row.included);
        const includedLabel = `${g.included} included`;
        return (
          <div
            key={row.key || row.label}
            className={`usg-row${g.over ? ' usg-row--over' : ''}`}
            data-row={row.key || row.label}
          >
            <span className="usg-label" title={row.label}>{row.label}</span>
            <span
              className="usg-track"
              role="img"
              aria-label={g.past
                ? `${row.label}: ${g.used}, ${g.overage} over the included ${g.included}`
                : `${row.label}: ${g.used} of ${g.included} included`}
            >
              <span className="usg-fill" data-percent={g.fill} style={{ width: g.fill }} />
              <span
                className={`usg-notch${g.notchAtEnd ? ' usg-notch--end' : ''}`}
                data-label={includedLabel}
                /* The compact strip drops the printed label rather than
                   shrinking it below the 12px floor, so the string has to
                   survive somewhere reachable. */
                title={compact ? includedLabel : undefined}
                data-percent={g.notch}
                style={{ left: g.notch }}
              />
            </span>
            <span className="usg-value">
              {g.past ? (
                <>
                  <b className="usg-num usg-num--over">{g.used}</b>
                  <span className="usg-sep"> · </span>
                  <span className="usg-over-text">{g.overage} over</span>
                </>
              ) : (
                <>
                  <b className={`usg-num${g.over ? ' usg-num--over' : ''}`}>{g.used}</b>
                  {` of ${g.included}`}
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
