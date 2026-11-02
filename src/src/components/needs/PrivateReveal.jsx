import React, { useState } from 'react';
import Button from '../ui/Button';
import { NEEDS_WORDS } from '../../config/needsYou';
import './NeedsYou.css';

/**
 * "SHOW ON THIS SCREEN" (PLAN §2 principle 3, §3.3; owner decision 2). Where
 * the laptop IS the room's screen, a private part draws only after a
 * deliberate press for that one part, and the press asks first: "The room
 * will see this. Show it?". Until then the room sees `summary`, which must be
 * count-only (no name, no text, no title).
 *
 * `fallback`: what the room may see in the part's place while it is hidden
 * (the Players list without its flags, say).
 *
 * `oneScreen` false (a private laptop): the children, untouched. The reveal is
 * this component's own state, so it ends when the panel holding it closes.
 *
 * `note` false: leave out "The room can see this screen", because the
 * surface around it already says so once (the one-screen Needs-you sheet's
 * heading; dev QA 1 Nov found it said twice).
 */
export default function PrivateReveal({ oneScreen, summary = '', children, testId = 'private-reveal', after = null, fallback = null, shown = false, note = true }) {
  // `shown`: the host already asked for this part by name ("Set the running
  // order" lands on it), which is the deliberate press.
  const [stage, setStage] = useState(shown ? 'shown' : 'hidden');
  if (!oneScreen) return <>{children}</>;
  if (stage === 'shown') {
    return (
      <>
        {children}
        <div className="ny ny-private" data-testid={`${testId}-shown`}>
          <span className="ny-acts">
            <Button size={36} variant="secondary" onClick={() => setStage('hidden')}>{NEEDS_WORDS.hide}</Button>
          </span>
        </div>
      </>
    );
  }
  return (
    <>
    <div className="ny ny-private" data-testid={testId}>
      {note ? <p className="ny-k">{NEEDS_WORDS.roomCanSee}</p> : null}
      {summary ? <p className="ny-private-s">{summary}</p> : null}
      {stage === 'confirm' ? (
        <>
          <p className="ny-confirm" role="status">{NEEDS_WORDS.roomWillSee}</p>
          <span className="ny-acts">
            <Button size={36} variant="secondary" onClick={() => setStage('shown')}>{NEEDS_WORDS.showIt}</Button>
            <Button size={36} variant="secondary" onClick={() => setStage('hidden')}>{NEEDS_WORDS.cancel}</Button>
          </span>
        </>
      ) : (
        <span className="ny-acts">
          <Button size={36} variant="secondary" onClick={() => setStage('confirm')}>{NEEDS_WORDS.showHere}</Button>
          {after}
        </span>
      )}
    </div>
    {fallback}
    </>
  );
}
