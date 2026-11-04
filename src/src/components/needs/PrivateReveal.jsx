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
 * `remember` (a key, e.g. `<gameId>.people`): the host's choice for this part
 * is KEPT FOR THE SESSION, across the panel closing and the page reloading,
 * until they change it (owner, 4 Nov 2026: "if they choose to show or hide the
 * players in the Session menu for one-screen view, keep that for the duration
 * of the session, unless they change again"). Kept in this browser's
 * localStorage under `engage.reveal.<key>`; a session id in the key is what
 * makes it end with the session. Without a key the reveal ends when the panel
 * holding it closes, as before.
 *
 * `note` false: leave out "The room can see this screen", because the
 * surface around it already says so once (the one-screen Needs-you sheet's
 * heading; dev QA 1 Nov found it said twice).
 */
const revealKey = (key) => `engage.reveal.${key}`;

/** Whether the host chose to show this part earlier in the session. */
export function rememberedShown(key) {
  if (!key) return false;
  try {
    return window.localStorage.getItem(revealKey(key)) === 'shown';
  } catch (_) {
    return false;
  }
}

function remember(key, shownNow) {
  if (!key) return;
  try {
    if (shownNow) window.localStorage.setItem(revealKey(key), 'shown');
    else window.localStorage.removeItem(revealKey(key));
  } catch (_) { /* storage off: the choice lasts as long as this panel */ }
}

export default function PrivateReveal({ oneScreen, summary = '', children, testId = 'private-reveal', after = null, fallback = null, shown = false, note = true, remember: rememberKey = '' }) {
  // `shown`: the host already asked for this part by name ("Set the running
  // order" lands on it), which is the deliberate press. A remembered "show"
  // is the same press, made earlier in the session.
  const [stage, setStageRaw] = useState(shown || rememberedShown(rememberKey) ? 'shown' : 'hidden');
  const setStage = (next) => {
    setStageRaw(next);
    if (next === 'shown') remember(rememberKey, true);
    else if (next === 'hidden') remember(rememberKey, false);
  };
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
