import React, { useId, useState } from 'react';
import RW from '../config/roundWords';

/**
 * THE WORKFLOW STRIP ON THE HOST'S PHONE (session flow v3 §4.6): one dot per
 * step (done filled, live ringed, to come empty, Ask dashed because it is
 * optional) with the live step's name, "R2 ●●◉○ What we heard · page 2 of 6".
 * Tapping the row lists the steps and what each one is. Same data as the
 * laptop's strip (config/workflowStrip.js), so the two never disagree.
 */
export default function RemoteStepDots({ strip }) {
  const [open, setOpen] = useState(false);
  const liveId = useId();
  if (!strip) return null;
  const live = strip.steps.find((s) => s.state === 'live');
  const liveText = live ? [live.label, live.sub].filter(Boolean).join(' · ') : '';
  return (
    <div className="hr-steps">
      <button
        type="button"
        className="hr-steps-row"
        aria-expanded={open}
        // The name stays "Show the steps": a step's name here would read as a
        // second "What we heard" button beside the real one.
        aria-label={RW.showSteps}
        aria-describedby={liveId}
        onClick={() => setOpen((v) => !v)}
      >
        {strip.round ? <span className="hr-steps-round">{RW.stripRoundShort(strip.round.n, strip.round.of)}</span> : null}
        <span className="hr-steps-dots" aria-hidden="true">
          {strip.steps.map((s) => (
            <span key={s.id} className={`hr-steps-dot is-${s.state}${s.optional ? ' is-optional' : ''}`} />
          ))}
        </span>
        <span className="hr-steps-live">{liveText}</span>
        {/* The description a screen reader hears: the round and the live step. */}
        <span id={liveId} hidden>{[strip.round && strip.round.label, liveText].filter(Boolean).join('. ')}</span>
      </button>
      {open ? (
        <ol className="hr-steps-list">
          {strip.steps.map((s) => (
            <li key={s.id} className={`is-${s.state}`}>
              <b>{s.label}</b>
              {s.state === 'live' ? <span className="hr-steps-now">{RW.stepLive}</span> : null}
              <span className="hr-steps-explain">{s.explain}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
