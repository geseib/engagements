/**
 * THE FOLLOW-UP SORT KEYS, and nothing else (docs/design/ca-followup-asks
 * SPEC §5). Pure, so the key format can be tested without a table.
 *
 *     PK  GAME#{gameId}
 *     SK  FOLLOWUP#{nnn}#SUGGESTED                     the checked suggestions for the round's read
 *         FOLLOWUP#{nnn}#ASK#{askId}                   one sent ask
 *         FOLLOWUP#{nnn}#ASK#{askId}#A#{playerName}    one person's answer to it
 *         FOLLOWUP#{nnn}#ASK#{askId}#LATE#{playerName} one person's LATE answer (after the
 *                                                      results or the round moved on; never counted)
 *         FOLLOWUP#LIVE                                the session's one live ask, a pointer
 *
 * The round comes first, so "every follow-up of round 3" is one begins_with,
 * and EVERY PREFIX ENDS IN '#', so round 3 never matches round 30 and ask
 * `k1` never matches ask `k10` (comment-keys.js has the history of that bug).
 *
 * THE LIVE POINTER is how "one live ask at a time, per session" is enforced
 * without reading every row: sending writes it with attribute_not_exists, so
 * two sends racing cannot both win; closing or cancelling deletes it.
 *
 * Every builder returns null for a segment it cannot vouch for, so a handler
 * answers 400 instead of writing a row nothing will read.
 */
const ROOT = 'FOLLOWUP#';
const LIVE_SK = 'FOLLOWUP#LIVE';

const roundOf = (n) => {
  const s = String(n === undefined || n === null ? '' : n).trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const padded = s.padStart(3, '0');
  return padded === '000' ? null : padded;
};
const isAskId = (id) => typeof id === 'string' && /^[a-z0-9]{6,40}$/.test(id);
const isName = (name) => typeof name === 'string' && name.trim().length > 0 && name.length <= 200;

/** A new ask id: time first (base36, fixed width) so asks sort in the order they were sent. */
function newAskId(nowMs = Date.now(), randomHex = require('crypto').randomBytes(3).toString('hex')) {
  return Math.floor(nowMs).toString(36).padStart(9, '0') + String(randomHex).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const roundPrefix = (round) => { const r = roundOf(round); return r ? `${ROOT}${r}#` : null; };
const suggestedSk = (round) => { const r = roundOf(round); return r ? `${ROOT}${r}#SUGGESTED` : null; };
const asksPrefix = (round) => { const r = roundOf(round); return r ? `${ROOT}${r}#ASK#` : null; };
const askSk = (round, askId) => {
  const p = asksPrefix(round);
  return p && isAskId(askId) ? `${p}${askId}` : null;
};
const answersPrefix = (round, askId) => { const sk = askSk(round, askId); return sk ? `${sk}#A#` : null; };
const answerSk = (round, askId, playerName) => {
  const p = answersPrefix(round, askId);
  return p && isName(playerName) ? `${p}${playerName}` : null;
};
const latePrefix = (round, askId) => { const sk = askSk(round, askId); return sk ? `${sk}#LATE#` : null; };
const lateSk = (round, askId, playerName) => {
  const p = latePrefix(round, askId);
  return p && isName(playerName) ? `${p}${playerName}` : null;
};

/**
 * What a FOLLOWUP# key is: { kind: 'suggested'|'ask'|'answer'|'late'|'live', round, askId, playerName }
 * or null for anything else.
 */
function parseFollowUpSk(sk) {
  const s = String(sk || '');
  if (s === LIVE_SK) return { kind: 'live' };
  const m = /^FOLLOWUP#(\d{3})#(SUGGESTED|ASK#([a-z0-9]+)(?:#(A|LATE)#(.+))?)$/.exec(s);
  if (!m) return null;
  if (m[2] === 'SUGGESTED') return { kind: 'suggested', round: m[1] };
  if (m[5] !== undefined) return { kind: m[4] === 'LATE' ? 'late' : 'answer', round: m[1], askId: m[3], playerName: m[5] };
  return { kind: 'ask', round: m[1], askId: m[3] };
}

module.exports = {
  ROOT,
  LIVE_SK,
  roundOf,
  isAskId,
  newAskId,
  roundPrefix,
  suggestedSk,
  asksPrefix,
  askSk,
  answersPrefix,
  answerSk,
  latePrefix,
  lateSk,
  parseFollowUpSk,
};
