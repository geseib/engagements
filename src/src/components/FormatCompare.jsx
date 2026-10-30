import React, { useRef, useState } from 'react';
import Icon from './Icon';
import FormatWalkthrough from './FormatWalkthrough';
import { formatGuide } from '../config/formatGuide';

/**
 * THE FORMAT GUIDE (docs/design/new-engagement README "Round 2 — owner
 * feedback", decisions 6–7; frames 2-06, 2-07, 2-08, 2-09).
 *
 * The seven-column table is gone: at the compact width it clipped Build Room
 * and Event and the chosen "Use …" button, and six rows of prose per format
 * were the least readable way to say what happens (the owner's screenshot,
 * feedback/owner-2026-10-30.md). Two rows instead:
 *
 *   top     the shown format's walkthrough — picture, plain summary, the
 *           step with You / Phones / Room screen, Back / dots / Next / Play,
 *           a rail of every step — and the ONE "Use …" button, beside the
 *           name, where no column can clip it
 *   bottom  seven short cards, one per format, acting as TABS (← → move and
 *           show); group labels above them
 *
 * The dialog gives the guide its own width (`gsd--guide`, min(1760px, the
 * window − 48px)) whichever view opened it. On a phone it is one format at a
 * time, with ‹ › between them and "Use …" full width at the foot.
 */
export default function FormatCompare({
  options = [], value = '', suggested = '', suggestedFor = '', onUse, onBack, phone = false,
}) {
  const first = options.find((o) => o.id === value) || options.find((o) => o.id === suggested) || options[0];
  const [shown, setShown] = useState(first ? first.id : '');
  const tabs = useRef([]);
  const index = Math.max(0, options.findIndex((o) => o.id === shown));
  const current = options[index] || null;
  const live = options.filter((o) => !o.handoff);
  const own = options.filter((o) => o.handoff);

  const show = (i, focus = false) => {
    const n = options.length;
    const at = ((i % n) + n) % n;
    setShown(options[at].id);
    if (focus && tabs.current[at]) tabs.current[at].focus();
  };
  const tabKey = (event, i) => {
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = i + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = i - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    show(next, true);
  };

  const useButton = current ? (
    <button
      type="button"
      className="btn-primary gsd-guide-use"
      onClick={() => onUse?.(current.id)}
    >
      Use {current.label}
    </button>
  ) : null;

  /* On a phone the dialog's own head says "Format guide" and the foot has
     Back (frame 2-09): this head stays for the focus and the screen reader. */
  const head = (
    <div className={`gsd-guide-head${phone ? ' gsd-sr' : ''}`}>
      <button type="button" className="gsd-btn gsd-btn--link gsd-guide-back" onClick={onBack}>
        <Icon name="CaretLeft" size={14} /> Back to the form
      </button>
      <h3 className="gsd-guide-t" id="gsd-compare-t" tabIndex={-1}>Format guide</h3>
      {!phone && <span className="gsd-guide-sub">Your title and choices are kept. Pick a format below to see how it runs.</span>}
    </div>
  );

  if (phone) {
    const guide = current ? formatGuide(current.id) : null;
    return (
      <div className="gsd-guide gsd-guide--phone" data-testid="gsd-compare">
        {head}
        {current && (
          <>
            <div className="gsd-guide-pager">
              <button type="button" className="gsd-btn gsd-guide-arrow" aria-label="Previous format" onClick={() => show(index - 1)}>
                <Icon name="CaretLeft" size={16} weight="bold" />
              </button>
              <span className="gsd-guide-pagename" aria-live="polite">
                <b>{current.icon && <Icon name={current.icon} size={15} />} {current.label}</b>
                <small>{index + 1} of {options.length}</small>
              </span>
              <button type="button" className="gsd-btn gsd-guide-arrow" aria-label="Next format" onClick={() => show(index + 1)}>
                <Icon name="CaretRight" size={16} weight="bold" />
              </button>
            </div>
            <FormatWalkthrough format={current.id} label={current.label} layout="phone" summary={guide.short} idPrefix="gsd-guide-wt" />
            <dl className="gsd-guide-facts">
              <div><dt>Good for</dt><dd>{guide.good.replace(/\.$/, '')}</dd></div>
              <div><dt>Starts</dt><dd>{guide.startsShort}</dd></div>
            </dl>
            <div className="gsd-guide-foot">
              <button type="button" className="btn-secondary" onClick={onBack}>Back</button>
              {useButton}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="gsd-guide" data-testid="gsd-compare">
      {head}
      {current && (
        <div className="gsd-guide-top" role="tabpanel" id="gsd-guide-panel" aria-labelledby={`gsd-guide-tab-${current.id}-name`}>
          <FormatWalkthrough
            format={current.id}
            label={current.label}
            layout="guide"
            summary={formatGuide(current.id).short}
            idPrefix="gsd-guide-wt"
            head={(
              <div className="gsd-guide-name">
                <h4>{current.icon && <Icon name={current.icon} size={18} />} {current.label}</h4>
                {useButton}
              </div>
            )}
          />
        </div>
      )}
      <div className="gsd-guide-cards" style={{ '--live': live.length, '--own': own.length }}>
        <p className="gsd-guide-group">Play a set of questions live</p>
        {own.length > 0 && <p className="gsd-guide-group is-own">Continue on their own page</p>}
        <div className="gsd-guide-tabs" role="tablist" aria-label="Formats">
          {options.map((o, i) => {
            const guide = formatGuide(o.id);
            const on = o.id === shown;
            return (
              <button
                key={o.id}
                ref={(el) => { tabs.current[i] = el; }}
                type="button"
                role="tab"
                id={`gsd-guide-tab-${o.id}`}
                aria-selected={on}
                aria-controls="gsd-guide-panel"
                aria-labelledby={`gsd-guide-tab-${o.id}-name`}
                aria-describedby={`gsd-guide-tab-${o.id}-desc`}
                tabIndex={on ? 0 : -1}
                className={`gsd-guide-card${on ? ' is-on' : ''}${o.handoff ? ' is-own' : ''}${o.handoff && o === own[0] ? ' is-own-first' : ''}`}
                data-format={o.id}
                onClick={() => show(i)}
                onKeyDown={(event) => tabKey(event, i)}
              >
                <span className="gsd-guide-cardname">
                  {o.icon && <Icon name={o.icon} size={15} />}
                  <span id={`gsd-guide-tab-${o.id}-name`}>{o.label}</span>
                </span>
                <span id={`gsd-guide-tab-${o.id}-desc`} className="gsd-guide-carddesc">
                  <span className="gsd-guide-col">{guide.col}</span>
                  <span className="gsd-guide-fact gsd-guide-fact--good"><b>Good for</b> {guide.good.replace(/\.$/, '')}</span>
                  <span className="gsd-guide-fact"><b>Group</b> {guide.group}</span>
                  <span className="gsd-guide-fact"><b>Starts</b> {guide.startsShort}</span>
                  {o.id === suggested && suggestedFor && (
                    <span className="gsd-guide-mark">Suggested for a {suggestedFor.toLowerCase()}</span>
                  )}
                </span>
                {on && <span className="gsd-guide-mark"><Icon name="Check" size={12} weight="bold" /> Showing above</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
