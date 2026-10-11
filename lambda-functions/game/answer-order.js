/**
 * THE ORDER A ROUND'S ANSWERS ARE SHOWN IN — a shuffle seeded by the game and
 * the round, the same on every screen.
 *
 * WHY. Answer rows are keyed `QUESTION#nnn#ANSWER#<player name>`, and every
 * reader Queries them, so they came back alphabetical by author. The stage and
 * every phone numbered them in that order, round after round, and anyone who
 * knew the roster could read "Response 1" as the alphabetically first name
 * (relay pilot review, 2026-10-11, finding 14).
 *
 * HOW. Each answer's place is the SHA-256 of `<gameId>#<round>#<author>`, so:
 *   - every reader (the stage, each phone, a reload, the host's remote) draws
 *     the same order and the same numbers for a round, with no state stored;
 *   - the order changes from round to round and does not follow names;
 *   - an answer's place does not depend on the others, so one answer removed
 *     mid-round moves no other answer past another.
 *
 * WHAT IT DOES NOT DO. The seed is not secret: someone holding this source,
 * the game id and the list of who answered could recompute it. It stops the
 * room reading authorship off the numbering; it is not cryptographic
 * anonymity.
 *
 * THE BALLOT STAYS CANONICAL. A ballot is positional (`{"0":1,"2":2}`), and
 * every tally — get-results, get-ai-summary, create-report — reads it against
 * the answers in Query (SK) order, as it always has. A phone votes on what it
 * sees, in DISPLAY positions, and submit-vote.js translates them to canonical
 * positions with `displayToCanonical` before storing. So a ballot stored
 * before this module existed still means what it meant, and no tally changed.
 *
 * DUPLICATED, byte-identical, because Lambda bundles are per-directory:
 *   - lambda-functions/game/answer-order.js
 *   - lambda-functions/websocket/answer-order.js   (start-vote.js)
 * tests/answer-order.js fails if they differ.
 */

const crypto = require('crypto');

/** Round numbers are stored zero-padded to three digits everywhere. */
const roundKey = (round) => {
  const r = String(round == null ? '' : round).trim();
  return /^\d+$/.test(r) ? r.padStart(3, '0') : r;
};

/**
 * Whose answer this is. The SORT KEY first: it is never encrypted, so a reader
 * holding raw rows (submit-vote.js) and one holding decrypted rows
 * (get-answers.js) agree. The name fields are the fallback for a shape that
 * carries no SK.
 */
const authorOf = (answer) => {
  const a = answer || {};
  const sk = typeof a.SK === 'string' ? a.SK : '';
  const at = sk.indexOf('#ANSWER#');
  if (at >= 0) return sk.slice(at + '#ANSWER#'.length);
  const name = a.PlayerName ?? a.playerName ?? a.name;
  return typeof name === 'string' ? name : '';
};

const placeOf = (gameId, round, answer) => crypto
  .createHash('sha256')
  .update(`${gameId}#${roundKey(round)}#${authorOf(answer)}`)
  .digest('hex');

/**
 * The canonical indexes of `answers`, in display order: `order[displayPos]`
 * is the index into `answers` (SK order) shown at that position.
 */
function displayOrder(answers, gameId, round) {
  const list = Array.isArray(answers) ? answers : [];
  return list
    .map((answer, idx) => ({ idx, place: placeOf(gameId, round, answer), author: authorOf(answer) }))
    .sort((a, b) => (a.place < b.place ? -1 : a.place > b.place ? 1 : 0)
      || (a.author < b.author ? -1 : a.author > b.author ? 1 : 0)
      || (a.idx - b.idx))
    .map((e) => e.idx);
}

/** A new array: `answers` (in SK order) as the room sees them. */
function inDisplayOrder(answers, gameId, round) {
  const list = Array.isArray(answers) ? answers : [];
  return displayOrder(list, gameId, round).map((idx) => list[idx]);
}

/**
 * A phone's ballot, keyed by DISPLAY position, as the stored ballot keyed by
 * CANONICAL (SK-order) position. `answers` are the round's rows in SK order.
 * A key that names no answer is dropped and counted, never guessed at.
 */
function displayToCanonical(votes, answers, gameId, round) {
  const order = displayOrder(answers, gameId, round);
  const out = {};
  let dropped = 0;
  for (const [pos, rank] of Object.entries(votes || {})) {
    const p = Number(pos);
    if (!Number.isInteger(p) || p < 0 || p >= order.length) { dropped++; continue; }
    out[String(order[p])] = rank;
  }
  return { votes: out, dropped };
}

module.exports = { roundKey, displayOrder, inDisplayOrder, displayToCanonical };
