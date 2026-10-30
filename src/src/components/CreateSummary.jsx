import React, { useState } from 'react';
import Icon from './Icon';
import FormatPreview, { previewCaption } from './FormatPreview';

/**
 * THE SIDE PANE (docs/design/new-engagement README §3.5, frames 1, 4, 7, 9, 13).
 *
 * The preview on top, then — pinned to the bottom so they stay visible at
 * 1280×720 while the preview scrolls behind them — a status-only checklist
 * and "What happens next". The checklist never restates the form: required
 * rows tick or read "Not yet"; optional rows carry a dash and "that's fine"
 * (the first-time review: empty circles read as unfinished work).
 *
 *   notice    a refusal or plan-limit notice: the top of the pane (frame 13)
 *   rows      [{ label, value, done, optional }]
 *   next      { heading, steps: [{ b, text }] }  — ordered list
 *   handoff   rows are "When you continue" and there is no numbered list
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
  format = '', anonymous = true, setName = '', notice = null,
  rowsHeading = 'Three decisions', rows = [], next = null, edit = false,
}) {
  const [view, setView] = useState('room');
  const [play, setPlay] = useState(1);
  const choose = (v) => { setView(v); setPlay((n) => n + 1); };
  return (
    <aside className="gsd-side" aria-label={edit ? 'This session' : 'Preview and summary'}>
      {notice && <div className="gsd-side-notice">{notice}</div>}
      {!edit && (
        <section className="gsd-side-pv" aria-labelledby="gsd-pv-h">
          <div className="gsd-side-pvhead">
            <h3 className="gsd-side-h" id="gsd-pv-h">Preview</h3>
            <span className="gsd-side-tabs">
              <button type="button" className="gsd-btn" aria-pressed={view === 'room'} onClick={() => choose('room')} disabled={!format}>
                <Icon name="Monitor" size={14} /> Room screen
              </button>
              <button type="button" className="gsd-btn" aria-pressed={view === 'phone'} onClick={() => choose('phone')} disabled={!format}>
                <Icon name="DeviceMobile" size={14} /> Phones
              </button>
              <button type="button" className="gsd-btn" aria-label="Replay the preview" title="Replay the preview" onClick={() => setPlay((n) => n + 1)} disabled={!format}>
                <Icon name="ArrowCounterClockwise" size={14} />
              </button>
            </span>
          </div>
          {format && (
            <p className="gsd-side-example">
              <Icon name="Info" size={14} />
              <span>
                {setName
                  ? `An example of the format. The room will see the questions from “${setName}”.`
                  : 'Example from a ready-made set. Yours will show your own questions.'}
              </span>
            </p>
          )}
          <div className={`gsd-stage gsd-stage--${view}`}>
            {/* Plays once when the format is chosen or the view changes, and on Replay. */}
            <FormatPreview key={format} format={format} play={format ? play : 0} size={view === 'phone' ? 'phone' : 'pane'} />
          </div>
          <p className="gsd-side-cap">{previewCaption(format, { view, anonymous })}</p>
        </section>
      )}
      <div className="gsd-side-pin">
        <SummaryRows heading={rowsHeading} rows={rows} />
        {next && (
          <section className="gsd-next" aria-labelledby="gsd-next-h">
            <h3 className="gsd-side-h" id="gsd-next-h">{next.heading}</h3>
            <ol>
              {next.steps.map((s, i) => (
                <li key={s.b}>
                  <span className="gsd-next-n" aria-hidden="true">{i + 1}</span>
                  <span><b>{s.b}</b> {s.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </aside>
  );
}
