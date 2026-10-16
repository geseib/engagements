import React from 'react';
import RW from '../../config/roundWords';
import ScreensGroup from './ScreensGroup';

/**
 * A STEP THE HOST IS LOOKING AT (session flow v3 §4.8; the v3 mockup's
 * "Looking without moving the room"). Drawn over the stage's main area on the
 * private laptop only; the stage underneath stays mounted, the wall and every
 * phone, laptop and tablet stay on the live step. The owner, 14 Oct: steps are
 * for looking, never acting, so nothing here sends, opens or closes anything.
 * "All settings" opens the Session panel, which is where settings are changed.
 *
 * facts: { title, twoScreens, presenting, setName, playerCount, answered,
 *          voted, roundsPlayed }
 *
 * SCREENS AT THE TOP OF SETUP (owner, 16 Oct: "there doesnt seem to be a way
 * when clicking on the setup button to change screen mode"). `screens` is
 * ScreensGroup's props, the same group the Session panel's Settings tab draws;
 * changing where the room watches is the one act Setup offers, because it
 * moves only this laptop and the room's window, never the live round.
 */
function Row({ label, scope, children }) {
  return (
    <div className="wfs-view-row">
      <p className="wfs-view-k">{label}{scope ? <span className="wfs-view-scope"> · {scope}</span> : null}</p>
      <p className="wfs-view-v">{children}</p>
    </div>
  );
}

export default function StepView({ step, facts = {}, onAllSettings, screens = null }) {
  if (!step) return null;
  const V = RW.view;
  let body;
  if (step.id === 'setup') {
    body = (
      <>
        <Row label={V.sessionName} scope={V.fromNextRound}>{facts.title || '—'}</Row>
        {screens ? null : (
          <Row label={V.roomScreen} scope={V.fromNextRound}>
            {facts.twoScreens ? V.twoScreens(facts.presenting) : V.oneScreen}
          </Row>
        )}
        {facts.setName ? <Row label={V.questionSet} scope={V.fromNextRound}>{facts.setName}</Row> : null}
        <Row label={V.joined}>{facts.playerCount ?? 0}</Row>
        <p className="wfs-view-note">{V.settingsScope}</p>
        {onAllSettings ? (
          <button type="button" className="wfs-view-btn" onClick={onAllSettings}>{V.allSettings}</button>
        ) : null}
      </>
    );
  } else if (step.id === 'finish') {
    body = (
      <>
        <p className="wfs-view-p">{V.roundsPlayed(facts.roundsPlayed || 0)}</p>
        <p className="wfs-view-note">{V.reportFromSession}</p>
      </>
    );
  } else if (step.state === 'done') {
    const n = facts.playerCount || 0;
    const line = step.id === 'answer' ? V.answeredOf(facts.answered || 0, n)
      : step.id === 'vote' ? V.votedOf(facts.voted || 0, n)
        : V.heardDone;
    body = <p className="wfs-view-p">{line}</p>;
  } else {
    body = <p className="wfs-view-p">{V.comesLater}</p>;
  }
  return (
    <section className="wfs-view" aria-label={`${RW.stepViewing} ${step.label}`}>
      <div className="wfs-view-card">
        <h2 className="wfs-view-h">{step.label}</h2>
        <p className="wfs-view-explain">{step.explain}</p>
        {step.id === 'setup' && screens ? <ScreensGroup {...screens} /> : null}
        {body}
      </div>
    </section>
  );
}
