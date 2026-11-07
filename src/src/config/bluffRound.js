/**
 * THE BLUFF ROUND, as the screens say it (docs/design/bluff-round/README.md).
 *
 * The server (lambda-functions/game/bluff-round.js) decides everything: who
 * holds the real answer, whether a round bluffs at all, the points. These are
 * the words and the few reads of its payloads that the phone, the stage and
 * the remote share, so they cannot say it three ways.
 *
 * `bluff` on a question payload is { active, skipped?, minPlayers, yours? };
 * `yours` exists on the truth-holder's own payload only.
 */

export const BLUFF_MIN_PLAYERS = 3;

export const BLUFF_WORDS = Object.freeze({
  eyebrow: 'Bluff round',
  othersLine: 'One player has the real answer. Make yours up so the room picks it: 2 points for every vote it fools.',
  yoursEyebrow: 'You have the real answer',
  voteCue: 'Which one is real? Pick one.',
  ownLocked: 'This one is yours. In a bluff round you vote for someone else\'s.',
  stageOn: 'Bluff round: one player has the real answer',
  stageTooFew: `Bluff round off this round: it needs ${BLUFF_MIN_PLAYERS} players connected`,
  stageNoAnswer: 'Bluff round off this round: this question has no real answer',
  setupLabel: 'Bluff round: one player secretly gets the real answer',
  setupHelp: 'They type it in their own words; everyone else makes one up. A vote for a made-up answer is 2 points to its author; spotting the real one is 1 point to you and 1 to the player who had it.',
  setOption: 'Bluff round',
  setOptionHelp: 'Sessions on this set start with the bluff round on (the host can switch it off). A question bluffs when it has a real answer: a RealAnswer column, or a reveal that starts "Real answer:" or "Real title:".',
  revealHeading: 'The real answer',
  realLabel: 'The real answer',
  pickLabel: 'Your pick',
  pickThis: 'Pick this one',
  sendVote: 'Send my vote',
  voteIn: 'Your vote is in.',
  fooledLabel: 'Fooled the most',
  ballotNumber: (n) => `Response ${n} on the ballot`,
});

/** Is a bluff in play on this round? */
export function isBluffRound(question) {
  return Boolean(question && question.bluff && question.bluff.active === true);
}

/** The holder's card, or null for everyone else. */
export function bluffHolderCard(question) {
  const yours = question && question.bluff && question.bluff.yours;
  if (!yours || typeof yours.realAnswer !== 'string' || !yours.realAnswer.trim()) return null;
  return { realAnswer: yours.realAnswer, prompt: yours.prompt || 'Put it in your own words, so it sounds like you.' };
}

/** The stage's and remote's one line about this round's bluff, or ''. Never who. */
export function bluffStageLine(question) {
  const b = question && question.bluff;
  if (!b) return '';
  if (b.active) return BLUFF_WORDS.stageOn;
  if (b.skipped === 'too-few-players') return BLUFF_WORDS.stageTooFew;
  if (b.skipped === 'no-real-answer') return BLUFF_WORDS.stageNoAnswer;
  return '';
}

/**
 * How many picks the ballot asks for: three ranked normally; one in a bluff
 * round, from the answers that are not the voter's own.
 */
export function ballotSize(answerCount, bluff, ownIdx) {
  const n = Number(answerCount) || 0;
  if (!bluff) return Math.min(3, n);
  const others = ownIdx === null || ownIdx === undefined || ownIdx < 0 ? n : n - 1;
  return Math.min(1, Math.max(0, others));
}

/** The query string that lets the server recognise the truth-holder. */
export function bluffIdentityQuery(playerName, clientId) {
  if (!playerName || !clientId) return '';
  return `&playerName=${encodeURIComponent(playerName)}&clientId=${encodeURIComponent(clientId)}`;
}

/** The reveal's sentences, from get-results' `bluff` block. */
export function bluffRevealLines(reveal) {
  if (!reveal || !reveal.realAnswer) return null;
  const top = Array.isArray(reveal.topBluffers) ? reveal.topBluffers : [];
  const spotters = Array.isArray(reveal.spotters) ? reveal.spotters : [];
  const votes = (n) => `${n} ${n === 1 ? 'vote' : 'votes'}`;
  return {
    realAnswer: reveal.realAnswer,
    holder: reveal.holderAnswered
      ? `${reveal.holderName} had it${reveal.realBallot ? `: response ${reveal.realBallot}` : ''}.`
      : `${reveal.holderName} had it, and did not answer.`,
    fooled: top.length
      ? `Fooled the most: ${top.map((t) => `${t.name} (${votes(t.fooled)})`).join(', ')}.`
      : 'Nobody was fooled.',
    spotted: spotters.length ? `Spotted it: ${spotters.join(', ')}.` : 'Nobody spotted it.',
  };
}

/**
 * A player's own points for a bluff round, from get-results' `bluff.points`
 * (every part: votes their answer drew and the point for spotting the real
 * one), or null when the round is not a scored bluff round.
 */
export function bluffRoundPoints(results, playerName) {
  const points = results && results.bluff && results.bluff.points;
  if (!points || typeof points !== 'object' || !playerName) return null;
  return Number(points[playerName]) || 0;
}

/** Is this a played bluff round's result (a reveal with a real answer)? */
export function isBluffResult(results) {
  return Boolean(results && results.bluff && results.bluff.realAnswer);
}
