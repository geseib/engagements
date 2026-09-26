/**
 * The round angles a Workie can be read from, and the house mix — the
 * frontend's copy of lambda-functions/game/round-angles.js's
 * HOUSE_ANGLE_WEIGHTS. tests/round-angles.js pins the two to the same numbers.
 *
 * Spec: docs/superpowers/specs/2026-09-24-workie-round-angles-design.md.
 */
export const ROUND_ANGLES = Object.freeze([
  { key: 'question', label: 'The question', house: 40, help: 'Stays on the question and the answers.' },
  { key: 'race', label: 'The race', house: 25, help: 'Standings against who won this round. Never on an anonymous round.' },
  { key: 'event', label: 'The event', house: 20, help: 'Ties the round to what the session is for. Only when there is event information.' },
  { key: 'fact', label: 'A fact', house: 15, help: 'One well-known fact tied to the topic.' },
]);

/** Game types whose rounds draw an angle. The others keep today's read-back. */
export const ANGLE_GAME_TYPES = Object.freeze(['call-and-answer']);
