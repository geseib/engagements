/**
 * HOW FAR ALONG IS THE ROOM, AND WHO IS STILL OUT? (docs/design/host-attention
 * PLAN §4.1; owner, 5 Nov 2026: one room tile, names when six or fewer are out,
 * away people apart on a private console, a latecomer during an open step
 * counts.)
 *
 * The one answer every console surface reads for the step that is live now:
 * the room tile (components/console/ConsolePulse.jsx), the People rail's order
 * and marks (config/consoleRail.js) and the room's question. Pure, no React.
 *
 *   live    'answer' | 'vote' | 'ask' | null   the step collecting now
 *   steps   [{ id, verb, done, of, all, closed, known, waiting, away, after }]
 *           this round's steps so far, in order
 *   byName  name → 'done' | 'out' for the live step (absent: not owed)
 *
 * The rules it owns, so nobody re-derives them:
 *   - THE DENOMINATOR is the roster (get-players: deduplicated, removed people
 *     already out). While a step is open everyone in the room is owed it,
 *     latecomers included. Once it has closed, people who joined after it
 *     closed (`closedAt`) are `after`, never in `of`. With no close stamp, a
 *     person who joined after the step opened and did not act is `after`.
 *   - THE NAMES NEVER TRAIL THE COUNT (anonymity.js waitingRoster's guard):
 *     when the names on hand cover fewer people than the count, `known` is
 *     false, the lists are empty and only the count is said.
 *   - AWAY is still out with no page open (`deviceConnected === false`); a
 *     row not read yet counts as here.
 *   - ROSTER ORDER inside every list. (The rail sorts outstanding people
 *     first; it does that itself, stably, from `byName`.)
 */
export const WAITING_NAMES_MAX = 6;

export const PROGRESS_WORDS = Object.freeze({
  answered: 'answered',
  voted: 'voted',
  here: 'here',
  everyoneIn: 'Everyone\'s in',
  nobodyYet: 'Nobody here yet',
  waitingOn: (names) => `Waiting on ${names}`,
  away: (names) => `away: ${names}`,
  awayCount: (n) => `${n} away`,
  still: { writing: 'still writing', answering: 'still answering', voting: 'still voting' },
  joined: (names) => `+${names.length} joined · ${names.join(', ')}`,
});

const msOf = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** The roster as { name, at, away }, blanks dropped, first of each name kept. */
function rosterOf(roster) {
  const seen = new Set();
  const out = [];
  (roster || []).forEach((p) => {
    const name = (p && (p.name || p.playerName)) || '';
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, at: msOf(p.joinedAt), away: p.deviceConnected === false });
  });
  return out;
}

const COLLECTING = Object.freeze({ ANSWERING: 'answer', VOTING: 'vote', VOTE_RESPONSES: 'vote', ROOM_QUESTION: 'ask' });
const PAST_ANSWER = new Set(['VOTING', 'VOTE_RESPONSES', 'RESULTS', 'RESPONSES', 'READ', 'FEEDBACK', 'ROOM_QUESTION', 'ROOM_RESULTS', 'ENDED']);
const PAST_VOTE = new Set(['RESULTS', 'RESPONSES', 'READ', 'FEEDBACK', 'ROOM_QUESTION', 'ROOM_RESULTS', 'ENDED']);

function stepOf(id, verb, people, { names = null, count = 0, openedAt = null, closedAt = null, closed = false } = {}) {
  const acted = new Set((names || []).filter((n) => typeof n === 'string' && n));
  const opened = msOf(openedAt);
  const closes = msOf(closedAt);
  const owed = [];
  const after = [];
  people.forEach((p) => {
    if (!closed || acted.has(p.name) || p.at === null) { owed.push(p); return; }
    const late = closes !== null ? p.at > closes : (opened !== null && p.at > opened);
    (late ? after : owed).push(p);
  });
  const counted = Math.max(0, Number(count) || 0);
  // The names never trail the count; names that are not given at all are unknown too.
  const known = names !== null && acted.size >= counted;
  const done = Math.max(counted, known ? owed.filter((p) => acted.has(p.name)).length : 0);
  const of = Math.max(owed.length, done);
  const out = known ? owed.filter((p) => !acted.has(p.name)) : [];
  return {
    id,
    verb,
    done,
    of,
    all: of > 0 && done >= of,
    closed,
    known,
    waiting: out.filter((p) => !p.away).map((p) => p.name),
    away: out.filter((p) => p.away).map((p) => p.name),
    after: after.map((p) => p.name),
    acted,
  };
}

/**
 * @param moment   roundStep's moment
 * @param roster   get-players rows ({ name, joinedAt, deviceConnected })
 * @param noVote   a format with no vote (Trivia, Poll)
 * @param answer   { names, count, openedAt, closedAt }
 * @param vote     { names, count, openedAt, closedAt }
 * @param ask      the room's question: { n, answeredBy?, sentAt, closed }, or null
 * @param choice   the answers are options: "still answering", not "still writing"
 */
export function roomProgressFor({
  moment, roster = [], noVote = false, answer = {}, vote = {}, ask = null, choice = false,
} = {}) {
  const people = rosterOf(roster);
  const steps = [];
  if (moment === 'ANSWERING' || PAST_ANSWER.has(moment)) {
    const s = stepOf('answer', PROGRESS_WORDS.answered, people, { ...answer, closed: moment !== 'ANSWERING' });
    s.still = choice ? PROGRESS_WORDS.still.answering : PROGRESS_WORDS.still.writing;
    steps.push(s);
  }
  if (!noVote && (COLLECTING[moment] === 'vote' || PAST_VOTE.has(moment))) {
    const s = stepOf('vote', PROGRESS_WORDS.voted, people, { ...vote, closed: COLLECTING[moment] !== 'vote' });
    s.still = PROGRESS_WORDS.still.voting;
    steps.push(s);
  }
  if ((moment === 'ROOM_QUESTION' || moment === 'ROOM_RESULTS') && ask) {
    const s = stepOf('ask', PROGRESS_WORDS.answered, people, {
      names: Array.isArray(ask.answeredBy) ? ask.answeredBy : null,
      count: ask.n,
      openedAt: ask.sentAt,
      closedAt: ask.closedAt,
      closed: moment !== 'ROOM_QUESTION',
    });
    s.still = PROGRESS_WORDS.still.answering;
    steps.push(s);
  }
  const live = COLLECTING[moment] && steps.some((s) => s.id === COLLECTING[moment]) ? COLLECTING[moment] : null;
  const liveStep = live ? steps.find((s) => s.id === live) : null;
  const byName = {};
  if (liveStep && liveStep.known) {
    people.forEach((p) => { byName[p.name] = liveStep.acted.has(p.name) ? 'done' : 'out'; });
  }
  return { live, steps: steps.map(({ acted, ...s }) => s), byName, here: people.length }; // eslint-disable-line no-unused-vars
}

/** The live step, or null. */
export function liveStepOf(progress) {
  if (!progress || !progress.live) return null;
  return progress.steps.find((s) => s.id === progress.live) || null;
}

/** "9/15 answered". */
export function progressWords(step) {
  if (!step) return '';
  return `${step.done}/${step.of} ${step.verb}`;
}

const andJoin = (names) => names.join(', ');

/**
 * THE NUDGE LINE: who to say a word to. { text, title }.
 *   everyone in      "Everyone's in"
 *   1–6 still out    "Waiting on Hannah, Ravi · away: Tom" (away apart, inside the six)
 *   more than six    "9 still writing" (· "2 away"); the whole list in `title`
 *   names lag        the count only
 * `showAway: false` folds away people into the waiting list (a surface that
 * may not say who is away).
 */
export function waitingWords(step, { maxNames = WAITING_NAMES_MAX, showAway = true } = {}) {
  if (!step) return { text: '', title: '' };
  if (step.of === 0) return { text: PROGRESS_WORDS.nobodyYet, title: '' };
  if (step.all) return { text: PROGRESS_WORDS.everyoneIn, title: '' };
  const outN = Math.max(0, step.of - step.done);
  if (!step.known) return { text: `${outN} ${step.still || ''}`.trim(), title: '' };
  const waiting = showAway ? step.waiting : step.waiting.concat(step.away);
  const away = showAway ? step.away : [];
  const total = waiting.length + away.length;
  const long = [
    waiting.length ? PROGRESS_WORDS.waitingOn(andJoin(waiting)) : '',
    away.length ? PROGRESS_WORDS.away(andJoin(away)) : '',
  ].filter(Boolean).join(' · ');
  if (total === 0) return { text: `${outN} ${step.still || ''}`.trim(), title: '' };
  if (total <= maxNames) return { text: long, title: long };
  const text = [
    `${waiting.length || total} ${step.still || ''}`.trim(),
    away.length && waiting.length ? PROGRESS_WORDS.awayCount(away.length) : '',
  ].filter(Boolean).join(' · ');
  return { text, title: long };
}

/** The round's record after it: "15/15 answered · 12/15 voted". A vote count of 0 is not drawn (see below). */
export function recordWords(progress) {
  if (!progress) return '';
  /* A VOTE COUNT THE PAGE CANNOT KNOW (host-attention D3): after a reload at
     Results the vote names are not restored, so "0/15 voted" would be page
     memory, not data. A closed vote with nobody counted is left out. */
  return progress.steps
    .filter((s) => s.id !== 'ask' && !(s.id === 'vote' && s.closed && s.done === 0))
    .map(progressWords)
    .join(' · ');
}

export default roomProgressFor;
