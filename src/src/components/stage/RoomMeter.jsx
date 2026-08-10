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
 * hand, but it is never read here. A count is a nudge; a ROSTER is an
 * attendance record, and the room is the wrong audience for one. This binds
 * Table too — Table is a stage profile, not a private one.
 *
 * NARROWED, NOT WEAKENED, now that <Podium> names three people on the same
 * stage. The two are different objects and the distinction is the whole of
 * the rule:
 *
 *   - a ROSTER is every name, unordered, complete, and it says who is present
 *     and who is late. That is surveillance, and it stays out of this
 *     component and off the stage.
 *   - a PODIUM is three names, ordered, earned, and it says what the room just
 *     did. That is the point of the session.
 *
 * So the rule is unchanged: this meter still never names anybody, and its
 * "it never names anybody" test in stageShell.test.jsx stands exactly as
 * written. The podium is not rendered here and never will be — it lives in
 * `.content`, on the two phases where this meter returns null, and it carries
 * its own gate (config/podium.js) and its own tests (__tests__/podium.test.jsx).
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
