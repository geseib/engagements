import React, { useEffect } from 'react';
import CompletionFlag from './CompletionFlag';

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
 * THE POLARITY IS THE DECISION, AND IT IS NOT SYMMETRIC. Inside a round, only
 * the waiting are named. Naming who HAS answered is a participation league
 * table and stays forbidden; it is also the version USER-REVIEWS.md rejected
 * outright ("naming and shaming three named colleagues on the all-hands
 * screen"). Two things blunt that objection here and both are load-bearing:
 * the list is never up unless the host asks for it, and it is the list of
 * people the room is waiting for, which is a nudge with a purpose, not a
 * scoreboard. (The LOBBY is the one phase where the list is the other set, at
 * the owner's request — see the paragraph after next, which is also where the
 * reason it is not the rejected version is written out.)
 *
 * THE LOBBY IS THE ONE EXCEPTION TO THE POLARITY, BY THE OWNER'S OWN REQUEST.
 * This paragraph used to read "NOT IN THE LOBBY", and its argument was sound
 * as far as it went: in the lobby there is no waiting set to name — nobody is
 * late to a round that has not started, there is no invite list, and the only
 * list available is who has JOINED, the exact polarity rejected above. THE
 * OWNER HAS NOW ASKED FOR THAT LIST: *"the lobby list is great, so we know who
 * has joined, and for small groups easily see who is missing."*
 *
 * It is a different feature wearing the same control, and three things keep it
 * from becoming the league table:
 *
 *   - There is nothing to be ranked by. A joined list has no scores, no order
 *     but arrival, and no round behind it. The thing USER-REVIEWS.md rejected
 *     was three named colleagues shown as laggards; this is the room's own
 *     attendance, before anything has been asked of anyone.
 *   - It says so. The heading over the lobby list is the lobby's own word
 *     ("Already joined"), never a waiting caption — see REVEAL_LABEL below and
 *     `data-list-kind`, which exists so a test can assert the polarity rather
 *     than infer it from copy. A joined list under "Still to answer" would be
 *     an accusation, and that is this polarity's failure mode.
 *   - The host still asks for it. Same hover/focus/click, same never-unprompted
 *     rule, same dismissal.
 *
 * The round-phase rule does not apply either, and `joinedRoster` in
 * ../../config/anonymity.js carries the argument: nothing is on the wall to
 * attribute in a lobby, and routing it through that rule would suppress the
 * list on every anonymous format — first as a response-count threshold the
 * lobby can never meet, and now as a host setting about rounds that have not
 * started.
 *
 * THE DECISION IS NOT HERE, AND IT IS NO LONGER THE CODE'S. Whether the list
 * may be shown during an anonymous round is `waitingRoster()`'s answer, in
 * ../../config/anonymity.js, which hands this component `null` when it may not.
 * IT USED TO BE AN AUTOMATIC GATE — withheld below five responses, no override —
 * and the owner retired it: *"the host has the info and the control."* It is
 * now the host's own setting in the sidebar's Settings tab, with the reasoning
 * that used to be the threshold printed beside the control as a sentence
 * (`waitingNamesCaution`). What has not moved is where any of it is decided:
 * this component renders what it is given and enforces nothing, deliberately,
 * because a rule that lives inside a rendered component is a rule that gets
 * moved by a styling change.
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
 * COMPLETION IS NOW A FLAG AS WELL AS A COLOUR, AND THE OLD REASONING IS
 * NARROWED RATHER THAN DELETED. Revision 2 of the design cut the mockup's
 * "Everyone is in" SENTENCE as the fourth of six statements of one fact, and
 * that cut stands: there is still no sentence here, still no bar, still no dot
 * matrix, and still exactly one fraction. What the cut left behind was a
 * completed state carried by hue and weight alone — `.count.done` turning
 * `--success-text` — on a surface the same document says cannot be trusted with
 * hue, in front of a room that includes colour-blind people and a projector
 * that has lifted the black point. The owner's report is that it does not read.
 * `CompletionFlag` answers that with a word, a glyph and a filled plate rather
 * than with a second count; its doc-block carries the argument in full.
 *
 * A `players` prop may still be handed in by a caller that has the roster on
 * hand, and it is STILL NEVER READ — the surviving half of the old rule. This
 * component does not assemble a list of people; it renders the one it is
 * given, already gated. stageShell.test.jsx passes a roster in and asserts
 * the silence, which is why the prop is worth mentioning rather than
 * forgetting.
 */

/**
 * The heading over the names, in the phase's own words (17-remote.html).
 *
 * LOBBY IS THE ODD ONE AND ITS COPY IS DOING THE WORK. ASK and VOTE name the
 * people the room is waiting for; LOBBY names the people who are already here,
 * which is the inverse set. "Already joined" was chosen because it cannot be
 * read as a waiting list under any stress — not "In the room" (which repeats
 * the heading above it word for word) and not anything built on "waiting",
 * "still" or "yet", which are the words the other two phases own. The fallback
 * stays a waiting phrase because every OTHER phase this component could be
 * handed a list on is a phase where somebody is being waited for.
 */
const REVEAL_LABEL = {
  LOBBY: 'Already joined',
  ASK: 'Still to answer',
  VOTE: 'Still to vote',
};

/**
 * Which set the list is — 'joined' or 'waiting'.
 *
 * Emitted as `data-list-kind` so the polarity is a fact in the markup rather
 * than something inferred from the caption. An implementation that fed the
 * lobby's joined names into an ASK-labelled list, or the answerers into a
 * waiting one, is the way this feature ships backwards while looking right;
 * this is what a test can hold on to.
 */
const LIST_KIND = { LOBBY: 'joined' };

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
  const names = (waiting && waiting.names) || [];
  const interactive = Boolean(names.length && waiting && typeof waiting.onPreview === 'function');
  const onPin = waiting && waiting.onPin;

  /*
    U SHOWS AND HIDES THE NAMES — the owner: "for the main screen a shortcut
    to show hide the users in the upper right." Same act as clicking the
    count (onPin toggles), so the shortcut cannot drift from the pointer path.

    Bound only while the list is actually offerable (`interactive` — a phase
    with no names, or a session whose settings withhold them, binds nothing),
    and refused the same three ways the page keys are refused in
    config/stagePaging.js pageIntentFor: modifiers are someone else's gesture,
    a typing target owns its own letters, and the setup panel's fields must
    not toggle the stage behind them. U is sent by no presenter clicker and
    bound nowhere else in the product.

    The hook runs before the empty-meter return below — a hook after an early
    return is the #310 blank page hookDepOrder.test.js exists to stop.
  */
  useEffect(() => {
    if (!interactive || typeof onPin !== 'function') return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'u' && event.key !== 'U') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target && target.tagName && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (target && target.isContentEditable) return;
      if (target && typeof target.closest === 'function' && target.closest('.setup-panel')) return;
      event.preventDefault();
      onPin();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [interactive, onPin]);

  if (!heading && !body) return null;
  const revealed = interactive && (waiting.mode === 'preview' || waiting.mode === 'pinned');
  const phaseKey = String(phase ?? '').toUpperCase();
  const label = REVEAL_LABEL[phaseKey] || 'Still waiting';
  const listKind = LIST_KIND[phaseKey] || 'waiting';
  const shown = names.slice(0, NAMES_SHOWN);
  const rest = names.length - shown.length;

  const countProps = interactive
    ? {
      tabIndex: 0,
      role: 'button',
      'aria-expanded': revealed,
      'aria-label': `${label}: ${names.length}. Show the names. Press U.`,
      title: 'U shows or hides the names',
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
      {/* Its own row, not appended to the heading. `.meter h4` is
          `white-space:nowrap` inside a column capped at
          `clamp(210px, 21vw, 460px)`, and "ANSWERED ✓ ALL IN" at TV's 26-31px
          label tier does not fit that cap — the heading would clip its own
          completion cue on the profile that loses the most. */}
      {complete && <CompletionFlag />}
      {revealed && (
        <div className="waiting" data-waiting-list="" data-list-kind={listKind}>
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
