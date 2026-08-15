import React from 'react';

/**
 * The screen the second Chris now sees instead of quietly inheriting the first
 * Chris's answers and score.
 *
 * Two refusals, and the difference between them is the whole point:
 *
 *   name-taken       the name is provably held by another browser. There is no
 *                    "continue anyway" here — offering one would hand back the
 *                    silent merge this exists to stop.
 *   name-unverified  the session predates identity stamping, so the server
 *                    genuinely cannot tell a returning player from a namesake.
 *                    It does not guess: it asks, and the answer comes from the
 *                    person, who is the only one who knows.
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
 * is how a screen ends up asking a question the buttons do not answer.
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
 * already existed; the conversion added no rule at all.
 */

/** One reading of `kind`, shared by the body and the actions. */
export const isAmbiguousCollision = (kind) => kind === 'name-unverified';

/**
 * The two ways out, for `PlayerShell`'s `dock`.
 *
 * `name-taken` renders EXACTLY ONE button and it is not "join as them" — the
 * missing second button is the silent merge, and `joinNameCollision.test.jsx`
 * counts them for that reason.
 */
export function JoinNameCollisionActions({
  kind,
  playerName,
  onRejoinAnyway,
  onUseAnotherName,
}) {
  const ambiguous = isAmbiguousCollision(kind);

  return (
    <>
      {ambiguous && (
        <button type="button" className="plr-btn" onClick={onRejoinAnyway}>
          Yes — rejoin as {playerName}
        </button>
      )}
      <button
        type="button"
        className={ambiguous ? 'plr-btn plr-btn--ghost' : 'plr-btn'}
        onClick={onUseAnotherName}
      >
        {ambiguous ? `No — I'm a different ${playerName}` : 'Pick a different name'}
      </button>
    </>
  );
}

function JoinNameCollision({ kind, playerName, message }) {
  const ambiguous = isAmbiguousCollision(kind);

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
    </div>
  );
}

export default JoinNameCollision;
