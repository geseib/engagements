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
import { DialogHead, DialogFoot } from '../components/ui/DialogParts';
import Icon from '../components/Icon';
import { W } from './words';
import { stageFrom } from './buildScreens';
import Button from '../components/ui/Button';

export function PointStage({ point }) {
  return (
    <section className="brm-stage brm-pointstage" aria-label={W.talkItOver}>
      <span className="brm-eyebrow"><b>{W.talkItOver}</b> · {stageFrom(point)}</span>
      <h2 className="brm-q brm-pointq">{point.text}</h2>
      {point.site && <p className="brm-pointsrc">{W.sourceSite(point.site)}</p>}
      <p className="brm-pointprompt">{W.talkPrompt}</p>
    </section>
  );
}

/** The Host screen's view of the point that is up: the same two moves as the Stage's dock. */
export function ShownPointCard({ point, ideas, busy, ended, onTakeDown, onSaveLater }) {
  return (
    <section className="brm-panel brm-shownpoint" aria-label={W.pointUp}>
      <p className="brm-nowline">{point.text}</p>
      <p className="brm-hint">{stageFrom(point)} · {W.nIdeas(ideas)}</p>
      {!ended && (
        <div className="brm-row brm-gap">
          <Button type="button" size={36} className="brm-ctl" disabled={busy} onClick={onSaveLater}>{W.saveLater}</Button>
          <Button type="button" size={36} className="brm-ctl brm-push" disabled={busy} onClick={onTakeDown}>{W.takeItDown}</Button>
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
      <DialogHead className="brm-dh" titleId="brm-takedown-title" title={<>{W.putIdeasToVote(n)}</>} titleClassName="brm-h" eyebrow={<>{W.takingDown}</>} eyebrowClassName="brm-hint" onClose={onClose} closeLabel={W.close} closeClassName="brm-x" />
      <p>{W.roomSentIdeas(n)}</p>
      <ul className="brm-reviewopts">
        {ideas.map((idea, i) => (
          <li key={idea.ideaId}>
            <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letter(i)}</span>
            <span className="brm-reviewopt-t">{idea.text}</span>
          </li>
        ))}
      </ul>
      <p className="brm-hint">{W.takeDownEither} {W.takeDownClose}</p>
      <DialogFoot className="brm-row brm-gap" cancel={<Button size={44} className="brm-ctl" disabled={busy} onClick={onNotNow}>{W.notNow}</Button>}>
        <Button type="button" variant="primary" size={44} className="brm-ctl brm-push" disabled={busy} onClick={onVote}>{W.putToAVote}</Button>
      </DialogFoot>
    </Modal>
  );
}
