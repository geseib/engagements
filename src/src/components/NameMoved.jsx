import React from 'react';

/**
 * "SAM IS NOW ON ANOTHER DEVICE." — what the OLD device shows once the host
 * has let its name move (experience plan §4.4, "The old device"; step 1d).
 *
 * It arrives three ways, and all three land here:
 *
 *   pushed     the moment the new device joins, the server sends this
 *              socket `nameMoved` (join-game.js, step 1f)
 *   refused    its next answer or vote is refused with NAME_MOVED
 *              (websocket/message.js, game/submit-vote.js)
 *   rejoined   after a reload or a reconnect, the join or the NAME_CHECK
 *              frame says the same (join-game.js `nameMoved`)
 *
 * The page has stopped: PlayerPage leaves the session and closes its socket,
 * so the two devices cannot race. The one way on is to join again under a
 * different name; the score went with the name, which is said plainly so
 * nobody thinks it was lost.
 *
 * Two exports for the shell's two regions, as JoinNameCollision does: the
 * words in the stage, the action in the dock.
 */

export const NAME_MOVED_LABEL = 'Join again with a different name';

export function NameMovedActions({ onJoinAgain }) {
  return (
    <button type="button" className="plr-btn" onClick={onJoinAgain}>
      {NAME_MOVED_LABEL}
    </button>
  );
}

export default function NameMoved({ playerName }) {
  return (
    <div role="alert">
      <h1 className="plr-h1 plr-h1--primary">{`${playerName} is now on another device.`}</h1>
      <p className="plr-lede plr-muted">
        This page has stopped. Your answers and score went with your name.
      </p>
      <p className="plr-note">
        If that was not you, tell the host.
      </p>
    </div>
  );
}
