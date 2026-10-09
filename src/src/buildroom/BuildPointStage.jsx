/**
 * A TALKING POINT ON THE STAGE (talking points T4). The host chose one point;
 * it fills the Stage as a discussion prompt: where it came from, the text, the
 * source for a finding, and what to do. Everything here is room-safe: the
 * point's text only (never its Detail), the site of the first source, never a
 * participant's name (a builder's name appears only on their own point).
 *
 *   PointStage      the Stage's content
 *   ShownPointCard  the same two moves on the Host screen's Now card
 *   TakeDownOffer   T4c: with 2 or more ideas in, Take it down offers a vote
 */
import React from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { W } from './words';
import { stageFrom } from './buildScreens';

export function PointStage({ point }) {
  return (
    <section className="brm-stage brm-pointstage" aria-label={W.talkItOver}>
      <span className="brm-eyebrow"><b>{W.talkItOver}</b> · {stageFrom(point)}</span>
      <h2 className="brm-q brm-pointq">{point.text}</h2>
      {point.site && <p className="brm-pointsrc">Source: {point.site}</p>}
      <p className="brm-pointprompt">{W.talkPrompt}</p>
    </section>
  );
}

/** The Host screen's view of the point that is up: the same two moves as the Stage's dock. */
export function ShownPointCard({ point, ideas, busy, ended, onTakeDown, onSaveLater }) {
  return (
    <section className="brm-panel brm-shownpoint" aria-label={W.pointUp}>
      <h2 className="brm-h5">{W.pointUp}</h2>
      <p className="brm-nowline">{point.text}</p>
      <p className="brm-hint">{stageFrom(point)} · {W.ideasOnThis} {ideas}. {W.pointUpNote}.</p>
      {!ended && (
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn" disabled={busy} onClick={onSaveLater}>{W.saveLater}</button>
          <button type="button" className="brm-btn brm-push" disabled={busy} onClick={onTakeDown}>{W.takeItDown}</button>
        </div>
      )}
    </section>
  );
}

const letter = (i) => String.fromCharCode(65 + i);

/** Take it down, with 2 or more ideas in: put them to a vote, or let them wait. */
export function TakeDownOffer({ ideas, busy, onNotNow, onVote, onClose }) {
  const n = ideas.length;
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm" onClose={onClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-takedown-title">
      <div className="brm-dh">
        <div>
          <p className="brm-hint">{W.takingDown}</p>
          <h2 className="brm-h" id="brm-takedown-title">{W.putIdeasToVote(n)}</h2>
        </div>
        <button type="button" className="brm-x" aria-label={W.close} onClick={onClose}><Icon name="X" size={16} /></button>
      </div>
      <p>The room sent {n} ideas about this point:</p>
      <ul className="brm-reviewopts">
        {ideas.map((idea, i) => (
          <li key={idea.ideaId}>
            <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letter(i)}</span>
            <span className="brm-reviewopt-t">{idea.text}</span>
          </li>
        ))}
      </ul>
      <p className="brm-hint">{W.takeDownEither}</p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={onNotNow}>{W.notNow}</button>
        <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy} onClick={onVote}>{W.putToAVote}</button>
      </div>
    </Modal>
  );
}
