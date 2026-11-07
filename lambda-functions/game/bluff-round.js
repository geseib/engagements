/**
 * THE BLUFF ROUND — one player secretly holds the real answer.
 *
 * docs/design/bluff-round/README.md. A Call & Answer twist: when the ASK opens
 * on a question with a real answer, one connected player is picked at random
 * and only their phone is told it. They type it in their own voice; everyone
 * else invents one. At the vote, a pick for a made-up answer pays its author 2;
 * a pick for the real one pays the holder 1 and the voter who spotted it 1.
 *
 * THE SECRET. The real answer and who holds it reach exactly one payload before
 * RESULTS: `get-question.js` for the holder, proven by the client id on their
 * PLAYER row. Everything else gets `publicBluff` — on or off, and why — and
 * never a name. tests/bluff-round-privacy.js holds that.
 *
 * The pick lives on `GAME#<id> / BLUFF#<nnn>`, outside the QUESTION# and
 * PLAYER# prefixes, so no prefix query over answers, votes or the roster picks
 * it up by accident.
 */
const { normalizeGameType } = require('./game-types');
const { uniquePlayerRecords } = require('./player-rows');
const { isRemoved } = require('./player-presence');

/** Fewer eligible players than this and the round plays normally. */
const BLUFF_MIN_PLAYERS = 3;

/** Owner's scoring, 2026-11. */
const BLUFF_POINTS = Object.freeze({ fooled: 2, holderSpotted: 1, spotter: 1 });

/** What the holder's phone says under the real answer. */
const HOLDER_PROMPT = 'Put it in your own words, so it sounds like you.';

const bluffSk = (paddedRound) => `BLUFF#${String(paddedRound).padStart(3, '0')}`;
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The real answer of a question, or null when it has none to bluff.
 *
 * A `RealAnswer` field wins. For back-compat a reveal that opens with
 * "Real title:" or "Real answer:" (the art set's shape) is read too: the text
 * after the label, up to the next "Trivia:"-style label. `story` is the whole
 * reveal, which is what Workie tells afterwards.
 */
function realAnswerOf(question) {
  if (!question || typeof question !== 'object') return null;
  const story = clean(question.AnswerDetails) || clean(question.answerDetails);
  const explicit = clean(question.RealAnswer) || clean(question.realAnswer);
  if (explicit) return { realAnswer: explicit, story };
  const m = story.match(/^real\s+(?:title|answer)\s*:\s*([\s\S]+)$/i);
  if (!m) return null;
  const rest = m[1];
  const next = rest.search(/\s(?:Trivia|Story|Why|Fun fact|Note|Background)\s*:/i);
  const realAnswer = (next === -1 ? rest : rest.slice(0, next)).trim().replace(/[.;\s]+$/, '');
  return realAnswer ? { realAnswer, story } : null;
}

/** Is the bluff round on for this session? Call & Answer only. */
function sessionBluffOn(metadata) {
  if (!metadata) return false;
  if (normalizeGameType(metadata.GameType || 'call-and-answer') !== 'call-and-answer') return false;
  return Boolean(metadata.HostPreferences && metadata.HostPreferences.bluffRound === true);
}

/**
 * Who may be handed the real answer: joined, not removed, holding a client id
 * (so they can prove it is them), and with a live, named, non-viewer socket.
 * The host has no PLAYER row, so is never among them.
 */
function eligibleHolders(playerRows, connectionRows) {
  const live = new Set();
  (connectionRows || []).forEach((row) => {
    if (row && row.ConnectionType === 'PLAYER' && row.PlayerName && !row.Viewer) live.add(row.PlayerName);
  });
  return uniquePlayerRecords(playerRows)
    .filter((row) => !isRemoved(row) && clean(row.ClientId))
    .map((row) => row.PlayerName || row.playerName)
    .filter((name) => name && live.has(name))
    .sort();
}

/** One of `names`, at random, avoiding `previous` when anyone else is there. */
function pickHolder(names, previous, random = Math.random) {
  const all = (names || []).filter(Boolean);
  if (!all.length) return null;
  const pool = all.length > 1 && previous ? all.filter((n) => n !== previous) : all;
  const from = pool.length ? pool : all;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}

/**
 * The decision for a round about to open, as the BLUFF# row to write, or null
 * when the round has nothing to do with bluffing (session off, no real answer).
 */
function decideBluff({ metadata, question, own = false, eligible, previousHolder, random }) {
  if (!sessionBluffOn(metadata)) return null;
  if (own || !realAnswerOf(question)) return { Status: 'skipped', Reason: 'no-real-answer' };
  const names = eligible || [];
  if (names.length < BLUFF_MIN_PLAYERS) {
    return { Status: 'skipped', Reason: 'too-few-players', Players: names.length };
  }
  return { Status: 'active', HolderName: pickHolder(names, previousHolder, random), Players: names.length };
}

/** What ANY caller may see about a round's bluff. Never a name or the answer. */
function publicBluff(row) {
  if (!row || !row.Status) return null;
  if (row.Status === 'active') return { active: true, minPlayers: BLUFF_MIN_PLAYERS };
  return {
    active: false,
    skipped: row.Reason || 'skipped',
    minPlayers: BLUFF_MIN_PLAYERS,
    ...(Number.isInteger(row.Players) ? { players: row.Players } : {}),
  };
}

/** Is this caller the holder? Name AND the client id on their PLAYER row. */
function isHolder(row, playerRow, playerName, clientId) {
  if (!row || row.Status !== 'active' || !row.HolderName) return false;
  if (!playerName || row.HolderName !== playerName) return false;
  const stored = playerRow && clean(playerRow.ClientId);
  const presented = clean(clientId);
  return Boolean(stored && presented && stored === presented);
}

/** The first-place pick of a canonical ballot, else its best-ranked one. */
function pickOf(ballot) {
  const entries = Object.entries(ballot || {})
    .map(([idx, rank]) => [parseInt(idx, 10), parseInt(rank, 10)])
    .filter(([idx, rank]) => Number.isInteger(idx) && Number.isInteger(rank));
  if (!entries.length) return null;
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0][0];
}

/**
 * The round's points.
 *
 * @param answers  ANSWER rows in SK order ({ PlayerName, Answer })
 * @param votes    VOTE rows ({ VoterName, Votes: canonical {idx: rank} })
 * @param holderName
 * @returns {{ points, votesFor, answerPoints, holderIdx, spotters, fooled, topBluffers }}
 *   points       { name: round points }
 *   votesFor     { idx: picks }
 *   answerPoints { idx: points that answer earned its author }
 *   fooled       { name: voters fooled }
 */
function scoreBluff({ answers, votes, holderName }) {
  const rows = answers || [];
  const holderIdx = rows.findIndex((a) => a && a.PlayerName === holderName);
  const points = {};
  const votesFor = {};
  const answerPoints = {};
  const fooled = {};
  const spotters = [];
  const add = (name, n) => { if (name) points[name] = (points[name] || 0) + n; };
  rows.forEach((_, idx) => { votesFor[idx] = 0; answerPoints[idx] = 0; });

  (votes || []).forEach((vote) => {
    const voter = vote && (vote.VoterName || String(vote.SK || '').split('#VOTE#')[1]);
    const idx = pickOf(vote && vote.Votes);
    if (idx === null || !rows[idx]) return;
    const author = rows[idx].PlayerName;
    if (!author || author === voter) return; // never your own answer
    votesFor[idx] += 1;
    if (idx === holderIdx) {
      answerPoints[idx] += BLUFF_POINTS.holderSpotted;
      add(author, BLUFF_POINTS.holderSpotted);
      add(voter, BLUFF_POINTS.spotter);
      if (voter) spotters.push(voter);
    } else {
      answerPoints[idx] += BLUFF_POINTS.fooled;
      add(author, BLUFF_POINTS.fooled);
      fooled[author] = (fooled[author] || 0) + 1;
    }
  });

  const most = Math.max(0, ...Object.values(fooled));
  const topBluffers = most > 0
    ? Object.entries(fooled).filter(([, n]) => n === most).map(([name, n]) => ({ name, fooled: n })).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return { points, votesFor, answerPoints, holderIdx, spotters: spotters.sort(), fooled, topBluffers };
}

/**
 * The words Workie is given about a bluff round. Names only when the round's
 * authors are not hidden.
 */
function bluffPromptLines(bluff, { story = '', hidden = false } = {}) {
  if (!bluff || !bluff.realAnswer) return '';
  const lines = ['BLUFF ROUND: one player was secretly given the real answer and wrote it in their own words; everyone else made one up to fool the room. A vote for a made-up answer earned its author 2 points; a vote for the real answer earned the truth-holder 1 and the voter who spotted it 1.'];
  lines.push(`The real answer: ${bluff.realAnswer}`);
  if (story && story !== bluff.realAnswer) lines.push(`Its story, to share now: ${story}`);
  if (hidden) {
    lines.push('Authors are hidden this round. Name nobody; say which response was real by its number.');
  } else {
    lines.push(bluff.holderAnswered
      ? `The truth-holder: ${bluff.holderName}, who wrote: "${bluff.holderAnswer}"`
      : `The truth-holder, ${bluff.holderName}, did not answer, so the real answer was not on the ballot.`);
    lines.push(bluff.topBluffers && bluff.topBluffers.length
      ? `Fooled the most: ${bluff.topBluffers.map((b) => `${b.name} (${b.fooled} ${b.fooled === 1 ? 'vote' : 'votes'})`).join(', ')}`
      : 'Nobody was fooled by a made-up answer.');
    lines.push(bluff.spotters && bluff.spotters.length
      ? `Spotted the real one: ${bluff.spotters.join(', ')}`
      : 'Nobody spotted the real answer.');
  }
  if (bluff.realBallot) lines.push(`The real answer was response ${bluff.realBallot} on the ballot.`);
  lines.push('Reveal the real answer and its story, and say who fooled the room.');
  return lines.join('\n');
}

module.exports = {
  BLUFF_MIN_PLAYERS, BLUFF_POINTS, HOLDER_PROMPT,
  bluffSk, realAnswerOf, sessionBluffOn, eligibleHolders, pickHolder, decideBluff,
  publicBluff, isHolder, pickOf, scoreBluff, bluffPromptLines,
};
