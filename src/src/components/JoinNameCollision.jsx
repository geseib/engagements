import React from 'react';

/**
 * The screen the second Chris now sees instead of quietly inheriting the first
 * Chris's answers and score.
 *
 * Two refusals, and the difference between them is the whole point:
 *
 *   name-taken       the name is provably held by another browser. There is no
 *                    self-serve way through — see the handover note below.
 *   name-unverified  the session predates identity stamping, so the server
 *                    genuinely cannot tell a returning player from a namesake.
 *                    It does not guess: it asks, and the answer comes from the
 *                    person, who is the only one who knows.
 *
 * ── THE WAY OUT OF `name-taken` GOES THROUGH THE HOST, AND ONLY THE HOST ────
 *
 * This screen used to be a dead end: one button, "Pick a different name", and
 * that was deliberate — a "continue anyway" here would have been the silent
 * merge the whole feature exists to stop. It is still not offered. What is
 * offered is a way to ASK, because the person who actually swapped laptops was
 * stuck under a name that is provably theirs with no recourse at all.
 *
 * Owner's design constraint, and the reason nothing here is automatic: *"they
 * need the choice though because they may have just mistakenly picked the same
 * name."* A clash is as likely to be two different people as one person on a
 * new device, and only the host can see the room.
 *
 * So the actions step, and the step is load-bearing:
 *
 *   idle     "Ask the host to hand it over" — records the ask and pings the
 *            host's Players tab. It grants NOTHING (request-handover.js).
 *   asked    "Take over the name" — retries the join with `claimExisting`. The
 *            SERVER refuses it unless the host has opened a one-shot grant, so
 *            this button is a request to try, not a permission. `join-game.js`
 *            spends the grant in a conditional write; `tests/name-handover.js`
 *            §1 pins that a claim without a grant is still a collision.
 *   refused  the same button plus a line saying the host has not unlocked it
 *            yet, because "nothing happened" is the one outcome a person on a
 *            blocked screen cannot interpret.
 *
 * There is no state in which "Take over the name" is the FIRST thing on this
 * screen. Reaching it takes an explicit ask, so a person who mistyped a
 * colleague's name is never one tap from taking their round.
 *
 * IT IS TWO EXPORTS BECAUSE THE SHELL IS THREE REGIONS, NOT ONE.
 *
 * This shipped as a single component that rendered its heading, its sentence
 * and two full-width `.btn-primary`/`.btn-secondary` buttons into the middle of
 * `.plr-stage` — the one scrolling region on the surface. Every other ACT state
 * on the player's device puts its actions in `.plr-dock`, which sits OUTSIDE
 * that region precisely so "scrolling to read is fine, scrolling to act is not"
 * (RATIONALE §5.2) is structural rather than editorial. The rejoin prompt
 * twenty lines away in `PlayerPage.jsx` is the same screen — heading, lede, two
 * stacked choices — and it does it correctly. This one was the exception, and
 * an exception in the one place a player is already stuck.
 *
 * The shell takes its dock as a prop, so the refusal is split at the seam the
 * shell already has: the body here, the actions in `JoinNameCollisionActions`.
 * BOTH READ `ambiguous` FROM THE SAME PREDICATE — two copies of that ternary
 * is how a screen ends up asking a question the buttons do not answer. The
 * handover stage is read by both halves for the same reason: the note in the
 * stage and the label in the dock must never describe different steps.
 *
 * Shaped after docs/design/player-redesign/03-join-ended.html and
 * 04-join-locked.html, which are the design's two blocking join sub-states:
 * heading at the primary rung, one muted sentence, actions in the dock. There
 * is no card, no left rule and no amber heading, because RATIONALE §4.3 spends
 * the view's one amber idea on the task — here, the dock button — and nothing
 * decorative is ever amber.
 *
 * IT NO LONGER HAS A STYLESHEET. `JoinNameCollision.css` painted `#444` body
 * copy — 1.79:1 on `--bg #0F1A2E`, i.e. unreadable — because its header comment
 * still described a `.join-screen` container that was white, and that container
 * had been deleted. Every class below is `PlayerSurface.css` vocabulary that
 * already existed; the handover additions use `.plr-note`, which the dock's
 * own copy already uses, and add no rule at all.
 */

/** One reading of `kind`, shared by the body and the actions. */
export const isAmbiguousCollision = (kind) => kind === 'name-unverified';

/**
 * The sentence under the refusal that says what just happened and what to do
 * next — `null` before the person has done anything, because a screen that
 * narrates a step nobody has taken is noise.
 *
 * Exported and pure so the copy is assertable without rendering: the two
 * halves of this screen have to agree, and the way they agree is by both
 * calling this.
 */
export function handoverNote(stage, playerName) {
  if (stage === 'asked') {
    return `Asked the host to hand “${playerName}” over. When they say go ahead, tap Take over the name.`;
  }
  if (stage === 'refused') {
    // NEVER "something went wrong". The host simply has not got to it, and
    // saying so is what stops the person tapping the same button forever.
    return `The host has not unlocked “${playerName}” yet. Ask them out loud, then try again.`;
  }
  return null;
}

/**
 * The ways out, for `PlayerShell`'s `dock`.
 *
 * `name-taken` renders EXACTLY TWO buttons and neither of them is "join as
 * them": the missing third button is the silent merge, and
 * `joinNameCollision.test.jsx` counts them and checks their handlers for that
 * reason. The first button either asks the host or retries the claim the host
 * has authorised — it is never an unconditional takeover, because the server
 * would refuse one and this screen must not offer what it cannot deliver.
 */
export function JoinNameCollisionActions({
  kind,
  playerName,
  handoverStage = 'idle',
  onRejoinAnyway,
  onUseAnotherName,
  onRequestHandover,
  onTakeOver,
  busy = false,
}) {
  const ambiguous = isAmbiguousCollision(kind);

  if (ambiguous) {
    return (
      <>
        <button type="button" className="plr-btn" onClick={onRejoinAnyway}>
          Yes — rejoin as {playerName}
        </button>
        <button type="button" className="plr-btn plr-btn--ghost" onClick={onUseAnotherName}>
          No — I&apos;m a different {playerName}
        </button>
      </>
    );
  }

  const asked = handoverStage !== 'idle';

  return (
    <>
      <button
        type="button"
        className="plr-btn"
        onClick={asked ? onTakeOver : onRequestHandover}
        disabled={busy}
      >
        {asked ? 'Take over the name' : 'Ask the host to hand it over'}
      </button>
      <button type="button" className="plr-btn plr-btn--ghost" onClick={onUseAnotherName}>
        Pick a different name
      </button>
    </>
  );
}

function JoinNameCollision({ kind, playerName, message, handoverStage = 'idle' }) {
  const ambiguous = isAmbiguousCollision(kind);
  const note = ambiguous ? null : handoverNote(handoverStage, playerName);

  // The wrapper carries `role="alert"` and nothing else: it exists so the
  // heading and the sentence are announced as one refusal rather than two
  // unrelated updates, and it deliberately has no class, because a bare div
  // with a class nothing declares is how an orphan selector starts.
  return (
    <div role="alert">
      <h1 className="plr-h1 plr-h1--primary">
        {ambiguous
          ? `Are you the ${playerName} already here?`
          : 'That name is taken.'}
      </h1>

      <p className="plr-lede plr-muted">{message}</p>

      {/* The step, announced. `aria-live` rather than a second `role="alert"`:
          the refusal above is the alert, and this is a progress note under it —
          two alerts on one screen is two interruptions for one event. */}
      {note && (
        <p className="plr-note" aria-live="polite">{note}</p>
      )}
    </div>
  );
}

export default JoinNameCollision;
