/**
 * PUT N TO A VOTE (talking points T5): the window the Points row's main button
 * opens when 2 to 8 points are ticked. It shows the question, the options as
 * phones will read them, and how many each person may pick (1 to 5, 3 by
 * default, or one fewer than the options when that is smaller). Open voting
 * puts the multi-pick ask on the Stage and on phones at once; every pick
 * counts as one vote. Ctrl or Cmd Enter opens voting.
 *
 * The window's Open voting is the one orange button while it is open (the
 * Host screen behind holds none). Options never say who posted them to the
 * room; the host's own window may, so it can tell a builder's Claude's point
 * from Claude's.
 */
import React, { useState } from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { W } from './words';
import { defaultPicks, VOTE_PICKS_MAX, POINT_TAGS, pointFrom } from './buildScreens';

const letter = (i) => String.fromCharCode(65 + i);

export default function BuildPointsVote({ points, openAsk = null, busy, onOpen, onClose }) {
  const n = points.length;
  const [prompt, setPrompt] = useState(W.voteDefaultPrompt);
  const [picks, setPicks] = useState(() => defaultPicks(n));
  const top = Math.min(VOTE_PICKS_MAX, n);
  const ready = prompt.trim().length > 0 && !busy;
  const open = async () => {
    if (!ready) return;
    await onOpen({ ids: points.map((p) => p.id), prompt: prompt.trim(), maxPicks: Math.min(picks, top) });
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(); }
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--vote" onClose={onClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-pvote-title">
      <div className="brm-dh">
        <h2 className="brm-h" id="brm-pvote-title">{W.putToVote(n)}</h2>
        <button type="button" className="brm-x" aria-label={W.close} onClick={onClose}><Icon name="X" size={16} /></button>
      </div>
      <div onKeyDown={onKey}>
        <label className="brm-field">
          <span className="brm-lbl">{W.voteQuestion}</span>
          <input className="brm-input" value={prompt} maxLength={300} autoFocus onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <div className="brm-field">
          <span className="brm-lbl" id="brm-pvote-opts">{W.voteOptionsHead}</span>
          <ul className="brm-reviewopts" aria-labelledby="brm-pvote-opts">
            {points.map((p, i) => (
              <li key={p.id}>
                <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letter(i)}</span>
                <span className="brm-reviewopt-t">{p.text}</span>
                <span className="brm-who brm-push">{POINT_TAGS[p.kind]} · {pointFrom(p)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="brm-field">
          <span className="brm-lbl" id="brm-pvote-picks">{W.picksEach}</span>
          <div className="brm-stepper" role="group" aria-labelledby="brm-pvote-picks">
            <button type="button" className="brm-btn brm-btn--sm" aria-label={W.fewerPicks} disabled={picks <= 1} onClick={() => setPicks((v) => Math.max(1, v - 1))}>{'−'}</button>
            <output className="brm-stepper-n" aria-live="polite">{picks}</output>
            <button type="button" className="brm-btn brm-btn--sm" aria-label={W.morePicks} disabled={picks >= top} onClick={() => setPicks((v) => Math.min(top, v + 1))}>+</button>
            <span className="brm-hint">{W.picksRule}</span>
          </div>
        </div>
        <p className="brm-hint">{W.voteOptionsNote}</p>
      </div>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>{W.close}</button>
        <span className="brm-say is-keys brm-push" title={W.ctrlEnterTitle}>{W.ctrlEnterOpens}</span>
        <button type="button" className="brm-btn brm-btn--primary" disabled={!ready} onClick={open}>
          {openAsk ? W.closeAskOpenVote(Number(openAsk.askId) || openAsk.askId) : W.openVoting}
        </button>
      </div>
    </Modal>
  );
}
