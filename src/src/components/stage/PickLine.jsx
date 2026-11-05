import React from 'react';
import Icon from '../Icon';
import { PICKER_WORDS as W } from '../../config/questionPicker';
import './PickLine.css';

/**
 * YOUR PART NOW'S LINE FOR WHAT COMES NEXT (docs/design/question-picker D3,
 * D7; reviews R2, R5, A8), drawn by the console's card (ConsoleFooter) and
 * the stage's Dock alike.
 *
 *   notice        after Ask next: "✓ Next: <title> · Undo", in a polite live
 *                 region. It stays until the phase changes or the host acts
 *                 again (R5), which the page decides; after Undo it says
 *                 "Put back" with no button (A8).
 *   onChangeNext  otherwise, the quiet door to the picker, "Change what's
 *                 next C". It does not repeat the title: the rail says it
 *                 (hard rule 5). The page passes it only while a next round
 *                 exists (R2).
 *
 * Neither: nothing is drawn.
 */
export default function PickLine({ notice = null, onChangeNext = null }) {
  if (notice) {
    return (
      <p className="pkl pkl--notice" role="status" data-testid="pick-notice">
        <Icon name="Check" weight="bold" size={14} color="currentColor" />
        {notice.undone ? (
          <span>{W.putBack}</span>
        ) : (
          <span>
            {`${W.pickNext} `}
            <b title={notice.title}>{notice.title}</b>
          </span>
        )}
        {!notice.undone && typeof notice.onUndo === 'function' ? (
          <button type="button" className="pkl-undo" onClick={notice.onUndo} data-testid="pick-undo">{W.undo}</button>
        ) : null}
      </p>
    );
  }
  if (typeof onChangeNext !== 'function') return null;
  return (
    <button type="button" className="pkl pkl-change" onClick={() => onChangeNext()} data-testid="change-next">
      <Icon name="ListBullets" weight="bold" size={14} color="currentColor" />
      {W.change}
      <kbd className="pkl-kbd" aria-hidden="true">{W.key}</kbd>
    </button>
  );
}
