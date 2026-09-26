/**
 * ONE ANGLE PER ROUND — what a read-back talks about, drawn by the lambda.
 *
 * Spec: docs/superpowers/specs/2026-09-24-workie-round-angles-design.md.
 *
 * A Call & Answer round carries participant counts, the event's own
 * information and the race, and a Workie used to be handed all of it with no
 * reason to pick any of it up — so every read-back was the same kind of
 * read-back. The owner: "it should be random though: sometimes it could
 * comment about the event, the ranks, other times just focused on the
 * question or task at hand".
 *
 *   question  always              stay on the question and the answers
 *   race      standings visible,  who leads overall against who won this
 *             round 2+, 2+ scored round — numbers written into the block
 *   event     event text exists   tie the round to what the event is for
 *   fact      always              one well-known fact tied to the topic
 *
 * Pure: the caller gathers the round's data, and `rng` is injected so a test
 * can pin a thousand draws.
 */

const { normalizeGameType } = require('./game-types');

const ANGLES = Object.freeze(['question', 'race', 'event', 'fact']);

const HOUSE_ANGLE_WEIGHTS = Object.freeze({ question: 40, race: 25, event: 20, fact: 15 });

/**
 * The house mix per game type. Only Call & Answer has one: trivia has a race
 * too and wavelength has none, and each is a decision of its own, not a side
 * effect of this one. `null` means the game type draws no angle at all and
 * its prompt is unchanged.
 */
const HOUSE_WEIGHTS_BY_GAME_TYPE = Object.freeze({
  'call-and-answer': HOUSE_ANGLE_WEIGHTS,
});
const houseWeightsFor = (gameType) => HOUSE_WEIGHTS_BY_GAME_TYPE[normalizeGameType(gameType)] || null;

/** Angles that must not run two rounds in a row. `question` may. */
const NO_REPEAT = new Set(['race', 'event', 'fact']);

/**
 * Which angles this round can support. The race needs standings the room is
 * allowed to see (a hidden round's leaderboard is attribution by arithmetic),
 * a previous round to race from, and at least two people on the board.
 */
function availableAngles({ hidden = false, roundNumber = 0, standings = [], hasEventText = false } = {}) {
  const out = ['question'];
  const scored = (standings || []).filter((p) => Number(p.score) > 0);
  if (!hidden && Number(roundNumber) >= 2 && scored.length >= 2) out.push('race');
  if (hasEventText) out.push('event');
  out.push('fact');
  return out;
}

/**
 * One angle, weighted. A weight missing from an override falls back to the
 * house weight; zero removes an angle; the final round doubles the race; and
 * when nothing with weight is left the answer is `question`.
 */
function pickAngle({ available = ['question'], weights = HOUSE_ANGLE_WEIGHTS, lastAngle = null, isFinalRound = false, rng = Math.random } = {}) {
  const pool = available
    .filter((a) => ANGLES.includes(a))
    .filter((a) => !(NO_REPEAT.has(a) && a === lastAngle))
    .map((a) => {
      const raw = weights && Number.isFinite(Number(weights[a])) ? Number(weights[a]) : HOUSE_ANGLE_WEIGHTS[a];
      const w = Math.max(0, raw) * (a === 'race' && isFinalRound ? 2 : 1);
      return [a, w];
    })
    .filter(([, w]) => w > 0);
  const total = pool.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return 'question';
  let r = rng() * total;
  for (const [a, w] of pool) {
    if (r < w) return a;
    r -= w;
  }
  return pool[pool.length - 1][0];
}

const ORDINAL = ['1st', '2nd', '3rd'];
const points = (n) => `${n} point${Number(n) === 1 ? '' : 's'}`;

const HEAD = (name) =>
  `THIS ROUND'S ANGLE — ${name}. A requirement of the FORMAT block above, identical in force to the headings.`;

const turnoutLine = ({ answered, voted, joined } = {}) => {
  const parts = [];
  if (Number.isFinite(answered)) parts.push(`${answered} answered`);
  if (Number.isFinite(voted)) parts.push(`${voted} voted`);
  if (Number.isFinite(joined) && joined > 0) parts.push(`${joined} joined the session`);
  return parts.length ? `Turnout, if it is worth a line: ${parts.join(', ')}.` : '';
};

/** Rule 1's widening, the same terms the voice's required addition carries. */
const GENERAL_KNOWLEDGE =
  'The rules above that limit you to "the material listed at the end", and to numbers "you can copy from that ' +
  'material", govern what you say about THIS ROOM. They do not forbid general knowledge of the world. State only ' +
  'what you are confident is true, never present it as something the room said, and never contradict the correct ' +
  'answer or any reveal printed in the material.';

function raceBlock({ standings = [], standingsBefore = [], roundWinners = [] }) {
  const top = standings.slice(0, 3);
  const lines = [
    'Somewhere in the reply, where it lands best, say where the race stands now that this round is counted.',
    'Copy these numbers exactly. Do not add, subtract or recount them.',
    `- Standings after this round: ${top.map((p, i) => `${ORDINAL[i]} ${p.name}, ${points(p.score)}`).join('; ')}.`,
  ];
  const winners = roundWinners.filter((w) => Number(w.points) > 0);
  if (winners.length) {
    lines.push(`- Top of this round: ${winners.map((w) => `${w.name}, +${points(w.points)} this round`).join('; ')}.`);
  }
  if (top.length >= 2) {
    lines.push(`- ${points(Number(top[0].score) - Number(top[1].score))} between first and second.`);
  }
  const leaderBefore = [...standingsBefore].sort((a, b) => Number(b.score) - Number(a.score))[0];
  if (leaderBefore && top[0] && leaderBefore.name !== top[0].name && Number(leaderBefore.score) < Number(top[0].score)) {
    lines.push(`- ${top[0].name} took the lead from ${leaderBefore.name} this round.`);
  }
  lines.push('Call it what these numbers show — a runaway, a close race, a lead change or a comeback — and nothing they do not.');
  return lines.join('\n');
}

/*
  THE PLACE AND THE CONTENT, NOT A WISH. Measured 2026-09-24 (Haiku 4.5, the
  draft-5 default Workie, the real worker): asked to "tie the answers to what
  this session is for", the event angle landed 1/4; handed the host's own words
  and a place — the first discussion question — it landed 4/4. Asked for "a
  well-known fact", the fact angle produced truisms ("status updates are a
  classic meeting tax") 4/4; asked for NAMED history in that same place it
  produced a named event, person or company 4/4. The race already worked for
  the same reason: its block carries its own numbers.

  THE PLACE IS NAMED FOR WORKIES THAT HAVE IT. A Workie that declares its own
  sections may have no "Discussion topics"; the fallback is its first question
  to the room.
*/
const FIRST_QUESTION = 'Your FIRST discussion question (or, if this read-back has none, its first question to the room)';
const EVENT_WORDS_MAX = 400;

/** The host's own description, cut at a word if it would be pasted at length a third time. */
function clipEventWords(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (t.length <= EVENT_WORDS_MAX) return t;
  const cut = t.slice(0, EVENT_WORDS_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' ')).trim()}…`;
}

function eventBlock({ eventWords } = {}) {
  const words = clipEventWords(eventWords);
  const lines = [];
  if (words) lines.push(`What this session is for, in the host's own words: "${words}"`);
  lines.push(
    `${FIRST_QUESTION} must put ${words ? 'that purpose' : 'what this session is for'} to the room: name it` +
    `${words ? ' in the host\'s words' : ', using what this prompt already says about the session'}, and ask which answer ` +
    'does the most for it. Anywhere else, tie an answer to it only where it genuinely fits, and never present the ' +
    'purpose as something the room said.',
  );
  return lines.join('\n');
}

const BODIES = {
  question: () =>
    'Keep this read-back on the question and the answers: no standings, no scoreboard talk, no recap of the event.',
  race: raceBlock,
  event: eventBlock,
  fact: () =>
    `${FIRST_QUESTION} must open with one piece of real history that connects to one of the answers: a named ` +
    'event, invention, person, company or origin story, with its name attached, in a single sentence. Then ask the ' +
    'room about it. Not a general observation about how teams or meetings usually work: something with a name on it. ' +
    `${GENERAL_KNOWLEDGE} Leave out any detail you are unsure of.`,
};
const TITLES = { question: 'the question itself', race: 'the race', event: 'the event', fact: 'a fact' };

/*
  THE SELF-CHECK, LAST. Measured 2026-09-24 on Haiku 4.5 with the live default
  Workie, three runs each: the race block (concrete numbers) was heard 3/3, but
  the fact block was heard 0/3 and the event block 1/3 without this line — the
  same gap the voice's required addition closed for The Historian, whose block
  ends the same way. A requirement the model can check is one it keeps.
*/
const MALFORMED = 'exactly as a misspelled heading would be. Before you reply, re-read it and confirm';
const CHECKS = {
  question: 'Before you reply, re-read it and confirm it says nothing about the standings.',
  race: `A reply without the race is malformed, ${MALFORMED} the race is there and every number matches the list above.`,
  event: `A reply that never ties the round to what this session is for is malformed, ${MALFORMED} the tie is there.`,
  fact: `A reply without the fact is malformed, ${MALFORMED} the fact is there.`,
};

/** The block for one angle, or '' for an angle this file does not know. */
function buildAngleDirective(angle, data = {}) {
  if (!BODIES[angle]) return '';
  const turnout = turnoutLine(data.turnout);
  return [HEAD(TITLES[angle]), BODIES[angle](data), turnout, CHECKS[angle]].filter(Boolean).join('\n');
}

module.exports = {
  ANGLES,
  HOUSE_ANGLE_WEIGHTS,
  houseWeightsFor,
  availableAngles,
  pickAngle,
  buildAngleDirective,
};
