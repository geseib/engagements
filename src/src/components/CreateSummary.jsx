import React from 'react';
import Icon from './Icon';
import FormatWalkthrough from './FormatWalkthrough';

/**
 * THE SIDE PANE (docs/design/new-engagement README §3.5; round 2, frames
 * 2-01, 2-03, 2-10).
 *
 * In Guided, the walkthrough of the chosen format on top and — pinned to the
 * bottom so it stays visible at 1280×720 — one status line: Title, Format,
 * Questions, ticked or "not yet". The one-picture preview, the long
 * checklist and "What happens next" are retired: the walkthrough's steps say
 * what happens next, in more detail. Editing a session keeps its checklist.
 *
 *   notice    a refusal or plan-limit notice: the top of the pane (frame 13)
 *   rows      [{ label, value, done }] — the first three make the status line
 */
export function SummaryRows({ heading, rows = [] }) {
  return (
    <section className="gsd-sum" aria-labelledby="gsd-sum-h">
      <h3 className="gsd-side-h" id="gsd-sum-h">{heading}</h3>
      <dl className="gsd-sum-rows">
        {rows.map((r) => (
          <div key={r.label} className={`gsd-sum-row${r.done ? ' is-done' : ''}`}>
            <dt>
              <span className="gsd-sum-mark" aria-hidden="true">
                {r.done ? <Icon name="Check" size={12} weight="bold" /> : '–'}
              </span>
              {r.label}
            </dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * THE STATUS LINE under the walkthrough (frames 2-01, 2-03): the three
 * decisions as ticks, never restating the form.
 */
export function StatusLine({ rows = [] }) {
  return (
    <ul className="gsd-stat" aria-label="Your decisions">
      {rows.map((r) => (
        <li key={r.label} className={r.done ? 'is-done' : ''}>
          <span className="gsd-stat-mark" aria-hidden="true">{r.done ? <Icon name="Check" size={12} weight="bold" /> : '–'}</span>
          {r.label}{r.done ? '' : <span className="gsd-stat-not"> {String(r.value || 'not yet').toLowerCase()}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function CreateSummary({
  format = '', label = '', notice = null,
  rowsHeading = 'Three decisions', rows = [], edit = false,
  /* "How it runs" folded to its rail (README round 3, option A). */
  hidden = false, onToggleHidden = null,
}) {
  if (!edit && hidden) {
    /* THE RAIL: one button, named for what it holds, so a host who hid the
       storyboard can see what is there and how to get it back. */
    return (
      <aside className="gsd-side gsd-side--rail" aria-label="How it runs">
        {notice && <div className="gsd-side-notice">{notice}</div>}
        <button
          type="button"
          className="gsd-how-rail"
          aria-expanded="false"
          onClick={() => onToggleHidden?.(false)}
        >
          <Icon name="CaretLeft" size={14} weight="bold" />
          <span className="gsd-how-rail-t">Show how {label || 'it'} runs</span>
        </button>
      </aside>
    );
  }
  return (
    <aside className="gsd-side" aria-label={edit ? 'This session' : 'How it runs'} id={edit ? undefined : 'gsd-how-pane'}>
      {notice && <div className="gsd-side-notice">{notice}</div>}
      {edit ? (
        <div className="gsd-side-pin">
          <SummaryRows heading={rowsHeading} rows={rows} />
        </div>
      ) : (
        <>
          {/* THE STORYBOARD (README round 3): how the chosen format runs,
              stage by stage, to scroll through. Hide sits on the thing it
              hides. */}
          <div className="gsd-side-pv">
            <FormatWalkthrough
              key={format || 'none'}
              format={format}
              label={label}
              layout="pane"
              headActs={onToggleHidden ? (
                <button
                  type="button"
                  className="gsd-btn gsd-how-hide"
                  aria-expanded="true"
                  aria-controls="gsd-how-pane"
                  onClick={() => onToggleHidden(true)}
                >
                  Hide <Icon name="CaretRight" size={13} weight="bold" />
                </button>
              ) : null}
            />
          </div>
          <div className="gsd-side-pin">
            <StatusLine rows={rows.slice(0, 3)} />
          </div>
        </>
      )}
    </aside>
  );
}
