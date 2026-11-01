import React from 'react';
import Icon from './Icon';

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
 * ── MOVING A NAME HERE, END TO END (experience plan §4.4, 1 Nov 2026) ─────
 *
 * The screen follows `useHandoverFlow`'s stage, and BOTH halves read it — the
 * words in the stage and the buttons in the dock must describe one step:
 *
 *   idle       "Sam is already in this session." — That's me: use my name on
 *              this device, or I'm someone else: pick another name
 *   asking     the ask is in flight; the first button is disabled
 *   askFailed  the ask did not arrive, and the screen SAYS so, with Try again.
 *              (It used to advance to "Asked the host" whatever happened.)
 *   waiting    "Waiting for the host to let you in as Sam", how long ago it
 *              asked, and that the page moves on by itself: the join is
 *              retried quietly, so a yes lands the phone in the session with
 *              nobody pressing anything. Ask again appears after a minute.
 *   granted    "You're in as Sam. Your answers and score came with you."
 *   declined   "The host said not now." Pick another name becomes the main
 *              button; Ask again waits thirty seconds.
 *   lapsed     "The host hasn't answered." after ten minutes: Ask again, or
 *              pick another name.
 *
 * There is still no state in which a button TAKES the name. The orange button
 * asks; only the host's grant, spent by the server's conditional write
 * (join-game.js `handover`), moves it. A person who mistyped a colleague's
 * name can ask, and the host — who can see the room — says not now.
 *
 * IT IS TWO EXPORTS BECAUSE THE SHELL IS THREE REGIONS, NOT ONE.
 *
 * Every ACT state on the player's device puts its actions in `.plr-dock`,
 * which sits OUTSIDE the one scrolling region, so "scrolling to read is fine,
 * scrolling to act is not" (RATIONALE §5.2) is structural. The body is here,
 * the actions in `JoinNameCollisionActions`; both read `ambiguous` from the
 * same predicate and the stage from the same value.
 *
 * Shaped after docs/design/player-redesign/03-join-ended.html and
 * 04-join-locked.html: heading at the primary rung, one muted sentence,
 * actions in the dock. No stylesheet of its own: every class is
 * `PlayerSurface.css` vocabulary (`.plr-note`, `.plr-err`, `.plr-btn`).
 */

/** One reading of `kind`, shared by the body and the actions. */
export const isAmbiguousCollision = (kind) => kind === 'name-unverified';

/**
 * The words on the buttons, once. Plain string literals (not JSX text) so the
 * help's **labels** can be checked against them character for character
 * (helpGuardrails.test.js §2), apostrophes included.
 */
export const HANDOVER_LABELS = Object.freeze({
  claim: "That's me: use my name on this device",
  someoneElse: "I'm someone else: pick another name",
  asking: 'Asking the host…',
  tryAgain: 'Try again',
  askAgain: 'Ask again',
  pickAnother: 'Pick another name',
});

/**
 * What the stage says at each step: a heading, a sentence, and sometimes an
 * error or a live note. Pure and exported, so the copy is assertable without
 * rendering and the two halves of the screen cannot disagree about the step.
 *
 * `message` is the server's refusal sentence, shown only before anything has
 * been asked; after that the screen speaks for the step it is on.
 */
export function handoverCopy({ stage = 'idle', playerName, message = '', agoText = '', error = '' }) {
  switch (stage) {
    case 'askFailed':
      return {
        heading: `${playerName} is already in this session.`,
        lede: message,
        error: error || 'Your request did not reach the host.',
        note: 'Check your connection and try again. Nothing has changed yet.',
      };
    case 'waiting':
      return {
        heading: `Waiting for the host to let you in as ${playerName}.`,
        lede: 'The host can see your request. This page moves on by itself as soon as they say yes.',
        note: agoText ? `Asked ${agoText} ago.` : null,
      };
    case 'granted':
      return {
        heading: `You're in as ${playerName}.`,
        lede: 'Your answers and score came with you.',
        note: null,
      };
    case 'declined':
      return {
        heading: 'The host said not now.',
        lede: 'If this is you, ask them in person.',
        note: null,
      };
    case 'lapsed':
      return {
        heading: "The host hasn't answered.",
        lede: 'Ask again, or pick another name.',
        note: null,
      };
    case 'asking':
    case 'idle':
    default:
      return {
        heading: `${playerName} is already in this session.`,
        lede: message,
        note: null,
      };
  }
}

/**
 * The ways out, for `PlayerShell`'s `dock`.
 *
 * `name-taken` never renders a button that takes the name: the first button
 * ASKS (or asks again), and the server moves the name only on the host's
 * grant. `joinNameCollision.test.jsx` walks every stage and checks the
 * handlers for that reason. A way to pick another name is in every stage but
 * `granted`, because a person who cannot get the name must always be able to
 * leave.
 */
export function JoinNameCollisionActions({
  kind,
  playerName,
  stage = 'idle',
  canAskAgain = false,
  onRejoinAnyway,
  onUseAnotherName,
  onRequestHandover,
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

  const ask = (label, ghost = false) => (
    <button
      type="button"
      className={ghost ? 'plr-btn plr-btn--ghost' : 'plr-btn'}
      onClick={onRequestHandover}
    >
      {label}
    </button>
  );
  const leave = (label, ghost = true) => (
    <button
      type="button"
      className={ghost ? 'plr-btn plr-btn--ghost' : 'plr-btn'}
      onClick={onUseAnotherName}
    >
      {label}
    </button>
  );

  switch (stage) {
    case 'asking':
      return (
        <>
          <button type="button" className="plr-btn" disabled>{HANDOVER_LABELS.asking}</button>
          {leave(HANDOVER_LABELS.someoneElse)}
        </>
      );
    case 'askFailed':
      return <>{ask(HANDOVER_LABELS.tryAgain)}{leave(HANDOVER_LABELS.pickAnother)}</>;
    case 'waiting':
      return <>{canAskAgain && ask(HANDOVER_LABELS.askAgain)}{leave(HANDOVER_LABELS.pickAnother)}</>;
    case 'lapsed':
      return <>{ask(HANDOVER_LABELS.askAgain)}{leave(HANDOVER_LABELS.pickAnother)}</>;
    case 'declined':
      // §4.4 step 7: Pick another name becomes the main button.
      return <>{leave(HANDOVER_LABELS.pickAnother, false)}{canAskAgain && ask(HANDOVER_LABELS.askAgain, true)}</>;
    case 'granted':
      return null;
    case 'idle':
    default:
      return <>{ask(HANDOVER_LABELS.claim)}{leave(HANDOVER_LABELS.someoneElse)}</>;
  }
}

function JoinNameCollision({ kind, playerName, message, stage = 'idle', agoText = '', error = '' }) {
  if (isAmbiguousCollision(kind)) {
    // The wrapper carries `role="alert"` and nothing else: the heading and the
    // sentence are announced as one refusal rather than two updates.
    return (
      <div role="alert">
        <h1 className="plr-h1 plr-h1--primary">{`Are you the ${playerName} already here?`}</h1>
        <p className="plr-lede plr-muted">{message}</p>
      </div>
    );
  }

  const copy = handoverCopy({ stage, playerName, message, agoText, error });

  return (
    <div role="alert">
      <h1 className="plr-h1 plr-h1--primary">{copy.heading}</h1>
      {copy.lede && <p className="plr-lede plr-muted">{copy.lede}</p>}
      {copy.error && (
        <p className="plr-err">
          <Icon name="WarningCircle" weight="bold" size={16} />
          {copy.error}
        </p>
      )}
      {/* The step's progress, announced politely: the refusal above is the
          alert, and "Asked 0:40 ago" ticking is not an interruption. */}
      {copy.note && (
        <p className="plr-note" aria-live="polite">{copy.note}</p>
      )}
    </div>
  );
}

export default JoinNameCollision;
