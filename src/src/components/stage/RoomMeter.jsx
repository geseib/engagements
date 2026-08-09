import React from 'react';

/**
 * The ONE room meter.
 *
 * The mockup's version stated the same fact six times: the word ANSWERED,
 * the numeral, a progress bar, a sentence, forty dots, and the dock's own
 * status line. What survives here is the single labelled fraction —
 * `heading` + `body`. The bar and the dot matrix are not ported; they are
 * deleted on purpose, and this component is what keeps them deleted (see
 * ../../styles/stage.css for the corresponding CSS cut).
 *
 * A `players` prop may be handed in by a caller that has the roster on
 * hand, but it is never read here. A count is a nudge; a list of names is
 * an attendance record, and the room is the wrong audience for one. This
 * binds Table too — Table is a stage profile, not a private one.
 */
export default function RoomMeter({ phase, heading, body, complete = false }) {
  if (!heading && !body) return null;

  return (
    <aside className={`meter${complete ? ' is-complete' : ''}`} data-phase={phase}>
      <h4>{heading}</h4>
      <div className={`count${complete ? ' done' : ''}`}>{body}</div>
    </aside>
  );
}
