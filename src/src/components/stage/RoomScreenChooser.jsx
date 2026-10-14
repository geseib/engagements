import React, { useState } from 'react';
import { ROOM_WORDS as W, recommendRoomScreen } from '../../config/roomScreen';
import './RoomScreenChooser.css';

/**
 * "WHERE WILL THE ROOM WATCH?" (session flow v3 §4.7; the v3 mockup's
 * "0 Setup"). The two drawings that explain one and two screens are the choice
 * itself; "Help me pick" replaces the cards in place with three questions and
 * one recommendation. Nothing changes until the host chooses.
 *
 * Drawn in the stage's overlay slot over the lobby, so the fitted stage under
 * it is untouched; it closes once a choice is made.
 */
function TwoScreensDrawing() {
  return (
    <svg className="rsc-art" viewBox="0 0 200 90" aria-hidden="true" focusable="false">
      <rect x="8" y="34" width="70" height="42" rx="4" className="rsc-art-laptop" />
      <text x="43" y="59" textAnchor="middle" className="rsc-art-t">controls</text>
      <rect x="104" y="8" width="88" height="56" rx="4" className="rsc-art-wall" />
      <text x="148" y="40" textAnchor="middle" className="rsc-art-t">the wall</text>
    </svg>
  );
}

function OneScreenDrawing() {
  return (
    <svg className="rsc-art" viewBox="0 0 200 90" aria-hidden="true" focusable="false">
      <rect x="40" y="8" width="104" height="60" rx="4" className="rsc-art-wall" />
      <text x="92" y="36" textAnchor="middle" className="rsc-art-t">laptop + wall</text>
      <text x="92" y="50" textAnchor="middle" className="rsc-art-t rsc-art-sub">(mirrored)</text>
      <rect x="156" y="40" width="20" height="34" rx="4" className="rsc-art-laptop" />
    </svg>
  );
}

function Choice({ value, picked, onPick }) {
  return (
    <div className="rsc-choices" role="group">
      {value.options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`rsc-opt${picked === key ? ' is-picked' : ''}`}
          aria-pressed={picked === key}
          onClick={() => onPick(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function RoomScreenChooser({ current = null, presentHref = '', onChoose, onClose = null }) {
  const [helping, setHelping] = useState(false);
  const [answers, setAnswers] = useState({});
  const set = (k) => (v) => setAnswers((a) => ({ ...a, [k]: v }));

  if (helping) {
    const rec = recommendRoomScreen(answers);
    const asked = answers.connected === 'no' ? 1 : 3;
    const done = ['connected', 'picture', 'private'].filter((k) => answers[k]).length;
    return (
      <section className="wfs-view rsc" aria-label={W.helpHeading}>
        <div className="rsc-head">
          <h2 className="rsc-h">{W.helpHeading}</h2>
          <button type="button" className="rsc-link" onClick={() => setHelping(false)}>{W.backToChoices}</button>
        </div>
        <ol className="rsc-qs">
          <li>
            <p className="rsc-q">{W.q1}</p>
            <Choice value={{ options: [['yes', W.q1Yes], ['no', W.q1No]] }} picked={answers.connected} onPick={set('connected')} />
          </li>
          {answers.connected !== 'no' ? (
            <>
              <li>
                <p className="rsc-q">{W.q2}</p>
                <Choice value={{ options: [['own', W.q2Own], ['copy', W.q2Copy], ['unsure', W.q2Unsure]] }} picked={answers.picture} onPick={set('picture')} />
              </li>
              <li>
                <p className="rsc-q">{W.q3}</p>
                <Choice value={{ options: [['yes', W.q3Yes], ['no', W.q3No]] }} picked={answers.private} onPick={set('private')} />
              </li>
            </>
          ) : null}
        </ol>
        {rec ? (
          <div className="rsc-rec" role="status">
            <p><b>{rec.lead}</b> {rec.detail}</p>
            <div className="rsc-rec-acts">
              {rec.choice === 'two' && presentHref ? (
                <a className="rsc-btn rsc-btn--quiet" href={presentHref} target="_blank" rel="noopener noreferrer">{W.openPresent}</a>
              ) : null}
              <button type="button" className="rsc-btn" onClick={() => onChoose(rec.choice)}>
                {rec.choice === 'two' ? W.useTwo : W.useOne}
              </button>
            </div>
          </div>
        ) : (
          <p className="rsc-foot">{`${W.answeredOf(Math.min(done, asked), asked)} · ${W.nothingChanges}`}</p>
        )}
      </section>
    );
  }

  return (
    <section className="wfs-view rsc" aria-label={W.heading}>
      <div className="rsc-head">
        <h2 className="rsc-h">{W.heading}</h2>
        {onClose ? <button type="button" className="rsc-link" onClick={onClose}>{W.keepChoice}</button> : null}
      </div>
      <div className="rsc-cards">
        <div className={`rsc-card${current === 'two' ? ' is-chosen' : ''}`}>
          <TwoScreensDrawing />
          <h3 className="rsc-card-h">{W.twoTitle}</h3>
          <p className="rsc-card-p">{W.twoBody}</p>
          <div className="rsc-card-acts">
            {presentHref ? (
              <a className="rsc-btn rsc-btn--quiet" href={presentHref} target="_blank" rel="noopener noreferrer">{W.openPresent}</a>
            ) : null}
            <button type="button" className="rsc-btn" aria-pressed={current === 'two'} onClick={() => onChoose('two')}>
              {current === 'two' ? W.chosen : W.useTwo}
            </button>
          </div>
        </div>
        <div className={`rsc-card${current === 'classic' ? ' is-chosen' : ''}`}>
          <OneScreenDrawing />
          <h3 className="rsc-card-h">{W.oneTitle}</h3>
          <p className="rsc-card-p">{W.oneBody}</p>
          <div className="rsc-card-acts">
            <button type="button" className="rsc-btn" aria-pressed={current === 'classic'} onClick={() => onChoose('classic')}>
              {current === 'classic' ? W.chosen : W.useOne}
            </button>
          </div>
        </div>
      </div>
      <p className="rsc-foot">
        <button type="button" className="rsc-link" onClick={() => setHelping(true)}>{W.helpMePick}</button>
        {' '}{W.remembers}
      </p>
    </section>
  );
}
