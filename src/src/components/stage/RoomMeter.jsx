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
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE THAT USED TO BE HERE, AND WHY IT IS GONE
 *
 * This doc-block used to end: "this meter still never names anybody", and
 * stageShell.test.jsx carried a test called 'it never names anybody' that
 * held it. THE OWNER HAS RETIRED THAT RULE. The meter now names WHO IS STILL
 * WAITING — on demand, never unprompted — and the test that guarded the old
 * rule has been rewritten to guard the new one rather than deleted. If you
 * are here because something names the wrong people, that test is where the
 * boundary is written down.
 *
 * The old rule was one sentence covering two different facts, and retiring it
 * splits them:
 *
 *   - WHO WROTE WHAT is authorship. Still absent, still absent by design, and
 *     nothing here has moved: no answer text, no score, no standings column.
 *     `standingsVisible` still keeps a score away from a response because a
 *     score beside an answer is attribution by arithmetic.
 *   - WHO HAS NOT ACTED YET is not authorship, and the product has said so in
 *     writing for a while: get-answers.js:216 calls the participation list
 *     deliberately public, and 17-remote.html prints the argument under the
 *     roster on the host's phone — "who has not acted yet is a different fact
 *     from who wrote what."
 *
 * What actually changed is WHERE that second fact may be shown. It was on the
 * phone because a projector is a bigger audience, not because the data was
 * secret; host-redesign/CRITIQUE.md #3 argued the opposite — that a
 * facilitator's job is to nudge *Dana*, and making that require projecting an
 * operator surface is the worse outcome. The owner has now chosen the stage.
 *
 * THE POLARITY IS THE DECISION, AND IT IS NOT SYMMETRIC. Only the waiting are
 * named. Naming who HAS answered is a participation league table and stays
 * forbidden; it is also the version USER-REVIEWS.md rejected outright ("naming
 * and shaming three named colleagues on the all-hands screen"). Two things
 * blunt that objection here and both are load-bearing: the list is never up
 * unless the host asks for it, and it is the list of people the room is
 * waiting for, which is a nudge with a purpose, not a scoreboard.
 *
 * NOT IN THE LOBBY. The design sentence says "the room count and the
 * answered/voted fractions", but in the lobby there is no waiting set to
 * name: nobody is late to a round that has not started, there is no invite
 * list, and the only list available is who has joined — which is the exact
 * polarity the owner rejected. So LOBBY keeps a bare count, and the reveal
 * exists on ASK and VOTE, where "still waiting" means something.
 *
 * THE GATE IS NOT HERE. Whether the list may be shown at all during an
 * anonymous round is decided by `waitingRoster()` in ../../config/anonymity.js,
 * which hands this component `null` when it may not. The reasoning — naming
 * the waiters hands the room the answerer set by subtraction, so the guard
 * counts RESPONSES rather than waiters — is written out there, next to the
 * constant it turns on. This component renders what it is given and enforces
 * nothing, which is deliberate: a gate that lives inside a rendered component
 * is a gate that gets moved by a styling change.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THE INTERACTION IS RAIL'S, COPIED RATHER THAN INVENTED. Hover previews,
 * focus previews for a keyboard, click pins, Enter pins, Escape unpins, and
 * SPACE IS NOT OURS TO TAKE — Space is the room's advance key and swallowing
 * it here would rebuild the pin/unpin loop Rail.jsx:98-126 documents at
 * length. Two things differ from Rail, both on purpose:
 *
 *   - click TOGGLES. Rail's QR opens a full-screen overlay that closes on a
 *     click anywhere; this list has no overlay and no scrim, so a second
 *     press of the same control is the only dismissal a touchscreen has.
 *   - a pinned list does NOT suppress the advance shortcut. Rail's pinned QR
 *     does, because it covers the stage including the dock. This is a few
 *     lines inside the meter's own column with the primary button untouched
 *     beneath it, so taking SPACE away would be taking it away for nothing —
 *     and the dock would stop advertising it at the same moment.
 *
 * Interactive ONLY when the caller supplies handlers, so a test rendering a
 * bare meter, or any phase with no waiting set, gets the plain element rather
 * than a button that does nothing.
 *
 * A `players` prop may still be handed in by a caller that has the roster on
 * hand, and it is STILL NEVER READ — the surviving half of the old rule. This
 * component does not assemble a list of people; it renders the one it is
 * given, already gated. stageShell.test.jsx passes a roster in and asserts
 * the silence, which is why the prop is worth mentioning rather than
 * forgetting.
 */

/** The heading over the names, in the phase's own words (17-remote.html). */
const WAITING_LABEL = {
  ASK: 'Still to answer',
  VOTE: 'Still to vote',
};

/**
 * How many names are printed before the list becomes "+ N more".
 *
 * 8, matching the one place the design actually draws a waiting list
 * (17-remote.html's `.rm-wait`). This is a LEGIBILITY limit and nothing else:
 * it is not a privacy mechanism, and must never be mistaken for one. A
 * truncated list still lets a room eliminate the names it can see, so it does
 * not soften the subtraction the anonymity gate exists to stop.
 */
const NAMES_SHOWN = 8;

export default function RoomMeter({
  phase, heading, body, complete = false, waiting = null,
}) {
  if (!heading && !body) return null;

  const names = (waiting && waiting.names) || [];
  const interactive = Boolean(names.length && waiting && typeof waiting.onPreview === 'function');
  const revealed = interactive && (waiting.mode === 'preview' || waiting.mode === 'pinned');
  const label = WAITING_LABEL[String(phase ?? '').toUpperCase()] || 'Still waiting';
  const shown = names.slice(0, NAMES_SHOWN);
  const rest = names.length - shown.length;

  const countProps = interactive
    ? {
      tabIndex: 0,
      role: 'button',
      'aria-expanded': revealed,
      'aria-label': `${label}: ${names.length}. Show the names.`,
      onMouseEnter: waiting.onPreview,
      onMouseLeave: waiting.onPreviewEnd,
      onFocus: waiting.onPreview,
      onBlur: waiting.onPreviewEnd,
      onClick: waiting.onPin,
      onKeyDown: (e) => {
        // ENTER PINS. SPACE IS NOT OURS TO TAKE — see the doc-block above and
        // Rail.jsx:98-126, which traces the loop this omission prevents.
        // React does not synthesize a click from Enter on an ARIA role, so the
        // keyboard path has to be written out.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          waiting.onPin?.();
        }
      },
    }
    : {};

  return (
    <aside className={`meter${complete ? ' is-complete' : ''}`} data-phase={phase}>
      <h4>{heading}</h4>
      <div
        className={`count${complete ? ' done' : ''}${interactive ? ' revealable' : ''}`}
        {...countProps}
      >
        {body}
      </div>
      {revealed && (
        <div className="waiting" data-waiting-list="">
          <h5>{label}</h5>
          <ul>
            {shown.map((name) => <li key={name}>{name}</li>)}
          </ul>
          {rest > 0 && <span className="more">{`+ ${rest} more`}</span>}
        </div>
      )}
    </aside>
  );
}
