/**
 * THE ACTION ROW (docs/design/build-room-batch-2-3, B1): one shape for every
 * step of the Host ask path. The hint slot is at the left, in words ("Press
 * Space to show results"); a confirmation replaces it after a press. Children
 * go in the order the eye finds them: ghosts, then secondaries, then the one
 * primary, right-most. Pinned to the bottom of the open step body.
 */
import React from 'react';

export default function ActionRow({ hint = '', pinned = true, space = false, children }) {
  return (
    <div className={`brm-arow${pinned ? ' is-pinned' : ''}`}>
      {/* A Space or Ctrl Enter hint means nothing on a phone or tablet: CSS hides it on a coarse pointer. */}
      <span className={`brm-say${space ? ' is-keys' : ''}`} role="status">{hint}</span>
      {children}
    </div>
  );
}
