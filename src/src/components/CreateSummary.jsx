import React from 'react';
import Icon from './Icon';
import FormatWalkthrough from './FormatWalkthrough';

/**
 * THE SIDE PANE (docs/design/new-engagement README §3.5; round 2, frames
 * 2-01, 2-03, 2-10).
 *
 * Creating: the walkthrough of the chosen format, and nothing under it. The
 * status line it used to pin (Title · Format · Questions) is gone in round 4:
 * the foot's "Still needed: …" says the same thing beside the button it is
 * about. Editing a session keeps its checklist.
 *
 *   notice    a refusal or plan-limit notice: the top of the pane (frame 13)
 *   rows      [{ label, value, done }] — edit mode's summary rows
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

export default function CreateSummary({
  format = '', label = '', notice = null,
  rowsHeading = 'Three decisions', rows = [], edit = false,
  /* "How it runs" folded to its rail (README round 3, option A). */
  hidden = false, onToggleHidden = null,
  /* Nothing chosen yet: 'example' (Call & Answer, said to be one) or
     'hover' (the gallery card under the pointer or focus). */
  preview = '',
  /* Round 4: nothing chosen and nothing pointed at — the quiet pane. */
  exampleOnly = false,
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
              preview={preview}
              exampleOnly={exampleOnly}
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
        </>
      )}
    </aside>
  );
}
