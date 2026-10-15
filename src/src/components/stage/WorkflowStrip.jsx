import React from 'react';
import RW from '../../config/roundWords';
import './WorkflowStrip.css';

/**
 * THE WORKFLOW STRIP on the host's laptop (session flow v3 §4.6; the data is
 * config/workflowStrip.js). Where the round is and what is expected of the
 * host, under the title bar, always.
 *
 *   full  two screens: the laptop is private. Steps can be pressed to LOOK at
 *         them (owner, 14 Oct: looking only, never acting), and the "Your part
 *         now" line names the main button.
 *   slim  one screen: the laptop is on the wall. Step names and the live step
 *         only; a step explains itself on hover and is never pressed (owner,
 *         14 Oct, open question 10), and there is no "Your part now" line,
 *         which would speak to the host in front of the room.
 *
 * It adds no button that acts: every act stays in the dock.
 */
const TICK = '✓';

function Step({ step, viewing, onView }) {
  const cls = [
    'wfs-step',
    `is-${step.state}`,
    step.optional ? 'is-optional' : '',
    viewing ? 'is-viewing' : '',
  ].filter(Boolean).join(' ');
  const inner = (
    <>
      {step.state === 'done' ? <span className="wfs-tick" aria-hidden="true">{TICK}</span> : null}
      <span className="wfs-name">{step.label}</span>
      {step.sub ? <span className="wfs-sub">{step.sub}</span> : null}
      {step.state === 'live' ? <span className="wfs-live"><span className="wfs-dot" aria-hidden="true" />{RW.stepLive}</span> : null}
      {viewing ? <span className="wfs-viewing">{RW.stepViewing}</span> : null}
    </>
  );
  const label = [step.label, step.sub, step.state === 'live' ? 'live' : step.state === 'done' ? 'done' : '']
    .filter(Boolean).join(', ');
  if (!onView) {
    return (
      <li>
        <span className={cls} title={step.explain} aria-label={`${label}. ${step.explain}`} aria-current={step.state === 'live' ? 'step' : undefined}>
          {inner}
        </span>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className={cls}
        title={step.explain}
        aria-label={`${label}. ${step.explain}`}
        aria-current={step.state === 'live' ? 'step' : undefined}
        aria-pressed={viewing}
        onClick={() => onView(step.id)}
      >
        {inner}
      </button>
    </li>
  );
}

export default function WorkflowStrip({
  strip, mode = 'full', viewing = null, onView = null, viewingWhere = '', onBack = null, places = null,
}) {
  if (!strip) return null;
  const slim = mode === 'slim';
  const press = slim ? null : onView;
  const outer = strip.steps.filter((s) => !s.loop);
  const loop = strip.steps.filter((s) => s.loop);
  const setup = outer.find((s) => s.id === 'setup');
  const finish = outer.find((s) => s.id === 'finish');
  const sep = <li className="wfs-sep" aria-hidden="true">›</li>;

  return (
    <nav className={`wfs${slim ? ' wfs--slim' : ''}`} aria-label="Where the session is">
      {/* Players, Questions, Rounds, Settings, always in reach (owner's
          revised spec; §4.8). Each opens the Session panel at its tab. */}
      {!slim && places && places.length ? (
        <ul className="wfs-places" aria-label="Session">
          {places.map((p) => (
            <li key={p.id}><button type="button" className="wfs-place" onClick={p.onClick}>{p.label}</button></li>
          ))}
        </ul>
      ) : null}
      <ol className="wfs-steps">
        {setup ? <Step step={setup} viewing={viewing === 'setup'} onView={press} /> : null}
        {sep}
        <li className="wfs-loop-wrap">
          <ol className="wfs-loop" aria-label={strip.round ? strip.round.label : 'The round'}>
            {strip.round ? <li className="wfs-round">{strip.round.label}</li> : null}
            {loop.map((s) => <Step key={s.id} step={s} viewing={viewing === s.id} onView={press} />)}
          </ol>
        </li>
        {sep}
        {finish ? <Step step={finish} viewing={viewing === 'finish'} onView={press} /> : null}
      </ol>
      {!slim && viewing ? (
        <p className="wfs-bar" role="status">
          <span className="wfs-bar-text">
            {RW.viewingBar(strip.steps.find((s) => s.id === viewing)?.label || '', viewingWhere)}
          </span>
          {onBack ? <button type="button" className="wfs-bar-back" onClick={onBack}>{RW.backToRoom}</button> : null}
        </p>
      ) : null}
      {!slim && !viewing && strip.part ? (
        <p className="wfs-part">
          <span className="wfs-part-k">{RW.yourPartLabel}</span>
          {strip.part.before}
          {strip.part.action ? <b className="wfs-action">{strip.part.action}</b> : null}
          {strip.part.after}
        </p>
      ) : null}
    </nav>
  );
}
