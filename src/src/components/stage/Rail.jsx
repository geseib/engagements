import React from 'react';

/**
 * The persistent identity strip — the `.rail` grid area. Styled from
 * docs/design/host-redesign/02-ask-call-and-answer.html:149-196 (CSS) and
 * :768 (markup) — see ../../styles/stage.css for the ported rules.
 *
 * The title is a single text node on purpose (`.rail-title` is
 * `display:block` with `overflow:hidden;text-overflow:ellipsis;
 * white-space:nowrap`): text-overflow only applies to a block container
 * with inline content, and on a flex box with span children it is inert —
 * which is how the rail previously shipped clipping mid-glyph with no
 * ellipsis at all.
 *
 * The drop order is fixed and asymmetric: the title (1) goes first, then the
 * word JOIN (2), then the URL (3). The session code is never part of this
 * list — an earlier revision numbered it backwards and sacrificed the code
 * before the title, and the code is what the room actually needs to get in.
 *
 * THE CHIP. Task 4 ported `.chip`'s CSS and nothing rendered one, because Rail
 * had no slot for the phase. It is wired here rather than deleted: the mockups
 * carry both the chip and the full-width bar on every state (01:4, 02:4, 05,
 * 06, 09, 10), and they are not the same statement. The bar is a colour — it
 * is perceived without being read, and a colour alone is unnameable without a
 * legend. The chip is the legend: one word saying what the room is doing right
 * now. It is also the only place FIELD_NOTES and RESULTS are distinguishable,
 * since they share the bar's green.
 *
 * The chip is NOT droppable. It is one short word at the label tier and it
 * carries the state; the title is what goes when the rail runs out of room.
 */
const CHIP = {
  LOBBY: ['lobby', 'Lobby'],
  ASK: ['ask', 'Answering'],
  VOTE: ['vote', 'Voting'],
  RESULTS: ['results', 'Results'],
  FIELD_NOTES: ['results', 'What we heard'],
  ENDED: ['done', 'Complete'],
};

export default function Rail({ phase, title, context = {}, join = {}, timer }) {
  const hasJoin = Boolean(join && (join.code || join.url));
  // A FINISHED SESSION MUST NOT ADVERTISE A LIVE ONE. The join block was
  // rendered whenever a gameId existed, so ENDED still read "JOIN
  // eng.seibtribe.us/play 4821" at a room that had just been told the session
  // was complete — an instruction to do something that no longer works.
  // 10-ended's rail answers it in four words: `Session 4821 · closed`.
  const closed = Boolean(join && join.closed);
  // An unrecognised phase renders no chip rather than a fabricated one — a
  // mislabelled state is worse than an unlabelled bar.
  const chip = CHIP[String(phase ?? '').toUpperCase()] || null;

  return (
    <header className="rail">
      {chip && (
        <span className={`chip ${chip[0]}`}>
          <span className="dot" />
          {chip[1]}
        </span>
      )}
      <span className="rail-title" data-drop="1">{title}</span>
      <span className="rail-ctx">
        {context.category && <span>{context.category}</span>}
        {context.category && context.round != null && <i>/</i>}
        {/* The noun is the question set's, not this component's — the same
            resolveRoundNoun() every other label site reads, which is why ASK
            once said "Lesson 3" while RESULTS said "Question 3". */}
        {context.round != null && <b>{`${context.noun || 'Round'} ${context.round}`}</b>}
        {context.of != null && <span>{`of ${context.of}`}</span>}
      </span>
      {timer && <span className="rail-timer">{timer}</span>}
      {hasJoin && closed && (
        <div className="rail-join">
          <span data-join-closed="">{join.code ? `Session ${join.code} · closed` : 'Session closed'}</span>
        </div>
      )}
      {hasJoin && !closed && (
        <div className="rail-join">
          <span data-join-word="" data-drop="2">JOIN</span>
          {join.url && <span data-join-url="" data-drop="3">{join.url}</span>}
          {join.code && <code>{join.code}</code>}
        </div>
      )}
    </header>
  );
}
