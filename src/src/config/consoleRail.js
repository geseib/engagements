/**
 * THE CONSOLE'S RAIL (spec §3.3): four collapsible sections; the one that
 * matters for the moment opens by itself. Pure, so the host's own open/close
 * choice can hold until the moment changes (ConsoleRail keeps that state).
 */
import { waitingRoster } from './anonymity';
// No 'tools' (experience plan 2a): the connection is the top bar's, only when
// broken, and the settings are the Session menu's, top right.
export const CONSOLE_SECTIONS = Object.freeze(['queue', 'people', 'late']);

const OPENS = Object.freeze({
  LOBBY: 'queue',
  ANSWERING: 'people',
  VOTING: 'people',
  VOTE_RESPONSES: 'people',
  RESULTS: 'people',
  RESPONSES: 'people',
  READ: 'late',
  FEEDBACK: 'late',
  ROOM_QUESTION: 'people',
  ROOM_RESULTS: 'queue',
  ENDED: 'queue',
});

export function consoleRailFor(moment) {
  return OPENS[moment] || null;
}

/**
 * The People header's count, "N here" (session-start D3: the answered and
 * voted count is the pulse's, config/consolePulse.js, so the console says it
 * once). railSummaries builds every header from it.
 */
export function peopleSummary({ players = 0 } = {}) {
  return `${players} here`;
}

/*
  THE HEADERS, OPEN AND CLOSED (docs/design/console-rail README D1, D3, D7;
  owner, 3 Nov 2026, "Looks good", every fork at its recommendation).

  A closed header says one thing worth reading that the rest of the screen
  does not; never a fact the room tile already states in the same viewport
  (hard rule 5). Who is still out is the room tile's since 5 Nov (cut 5), so
  People says "6 here" while the room answers or votes.
*/
export const RAIL_WORDS = Object.freeze({
  rounds: (n) => (n === 1 ? '1 round' : `${n} rounds`),
  nextRound: (title) => `next: ${title}`,
  firstRound: (title) => `first: ${title}`,
  ended: 'done',
  tookPart: (n) => `${n} took part`,
  waitingOn: (who) => `waiting on ${who}`,
  top: (name, score) => `top: ${name}, ${score}`,
  needsYou: (names) => (names.length === 1 ? `${names[0]} needs you`
    : names.length === 2 ? `${names[0]}, ${names[1]} need you` : `${names.length} need you`),
  toReview: (n) => `${n} to review`,
  none: 'none',
  // The long forms, for the summary's accessible name and title= (review A2).
  stillOut: Object.freeze({ ANSWERING: 'Still writing', VOTING: 'Not voted yet', VOTE_RESPONSES: 'Not voted yet' }),
  stillAnswering: 'Still answering',
  wantsName: 'wants their name on a new device',
  roundOf: (n, of) => `Round ${n} of ${of}`,
});

/** Past this many people still out, "waiting on 14" rather than names (review H2). */
export const RAIL_NAMES_MAX = 12;

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || String(name || '');

/**
 * "waiting on Marcus"; "Marcus, Ana" in full for two; "Marcus, Ana +3" for
 * three to twelve; past twelve the count, "waiting on 14". Empty or unknown
 * says nothing rather than something wrong.
 */
export function waitingClause(names) {
  if (!Array.isArray(names) || names.length === 0) return '';
  if (names.length > RAIL_NAMES_MAX) return RAIL_WORDS.waitingOn(names.length);
  const short = names.map(firstName);
  if (short.length <= 2) return RAIL_WORDS.waitingOn(short.join(', '));
  return RAIL_WORDS.waitingOn(`${short[0]}, ${short[1]} +${short.length - 2}`);
}

/** The leader by the rows' own scores; null with no score above zero. Ties: the first in roster order. */
export function leaderOf(people = []) {
  let best = null;
  (people || []).forEach((p) => {
    const s = p && p.fact ? Number(p.fact.score) : NaN;
    if (!Number.isFinite(s) || s <= 0) return;
    if (!best || s > best.score) best = { name: p.name, score: s };
  });
  return best;
}

const ROUNDING = new Set(['ANSWERING', 'VOTING', 'VOTE_RESPONSES']);

/**
 * Scores read in text colour from Results on, muted while the room answers
 * or votes (a score cannot change mid-round) and in the lobby (README D6).
 */
export function scoresLive(moment) {
  return !ROUNDING.has(moment) && moment !== 'LOBBY';
}

/**
 * Every header's summary, `{ queue, people, late }`, each
 *   { text, strong, who, dot, title, label, level: 'calm'|'soon'|'now' }
 * drawn as [dot][who] · text · <b>strong</b>. `label` is the summary's
 * accessible name without the section title; it never truncates (review A2).
 *
 * `open` is { queue, people, late }: a closed header adds its closing clause,
 * an open one drops it because the list below says it (one fact, once).
 */
export function railSummaries({
  moment, open = {}, players = 0, people = [], askers = [], rounds = [], total = null, late = 0,
} = {}) {
  const join = (...parts) => parts.filter(Boolean).join(' · ');

  // ---- Round queue ----
  const nowRound = rounds.find((r) => r.state === 'now');
  const nextRound = rounds.find((r) => r.state === 'next') || rounds.find((r) => r.state === 'later');
  const of = Number(total) > 0 ? Number(total) : null;
  let queue = { text: '', level: 'calm' };
  if (moment === 'ENDED') {
    const last = rounds.length ? Math.max(...rounds.map((r) => Number(r.n) || 0)) : 0;
    if (last > 0) {
      const base = `${last} of ${of || last}`;
      queue = { text: open.queue ? base : join(base, RAIL_WORDS.ended), level: 'calm' };
    }
  } else if (nowRound) {
    // The session's total is the strip's ("Round 1 of 80"), never the length
    // of the list (walk, 15 Oct). No total known: the round alone.
    const base = of ? `${nowRound.n} of ${of}` : String(nowRound.n);
    const tail = !open.queue && nextRound && nextRound.title ? RAIL_WORDS.nextRound(nextRound.title) : '';
    queue = {
      text: join(base, tail),
      title: tail ? join(of ? RAIL_WORDS.roundOf(nowRound.n, of) : String(nowRound.n), tail) : undefined,
      level: 'calm',
    };
  } else {
    const count = of || rounds.length;
    const first = rounds[0];
    const base = count ? RAIL_WORDS.rounds(count) : '';
    const tail = !open.queue && first && first.title ? RAIL_WORDS.firstRound(first.title) : '';
    queue = { text: join(base, tail), title: tail ? join(base, tail) : undefined, level: 'calm' };
  }
  queue.label = queue.title || queue.text;

  // ---- People ----
  const here = moment === 'ENDED' ? RAIL_WORDS.tookPart(players) : peopleSummary({ players });
  let peopleH;
  const askNames = (askers || []).map((a) => a && a.name).filter(Boolean);
  if (askNames.length && !open.people) {
    // The mark on the thing (README D3): the Needs-you line's own paint.
    const who = RAIL_WORDS.needsYou(askNames.map(firstName));
    const long = askNames.map((n) => `${n} ${RAIL_WORDS.wantsName}`).join('. ');
    peopleH = { who, text: here, dot: true, level: 'now', title: long, label: join(who, here, long) };
  } else if (ROUNDING.has(moment)) {
    // WHO IS STILL OUT IS THE ROOM TILE'S NOW (owner, 5 Nov 2026, cut 5;
    // host-attention PLAN §4.3, Q2): the closed header's "waiting on Marcus"
    // went there, always in view. While the room answers or votes the header
    // is the plain count, and the rows sort the people still out first.
    peopleH = { text: here, strong: '', level: 'calm', label: here };
  } else {
    // Results and after, in a scored format: the leader, light (fork F7).
    const leader = !open.people ? leaderOf(people) : null;
    peopleH = {
      text: here,
      strong: leader ? RAIL_WORDS.top(firstName(leader.name), leader.score) : '',
      level: 'calm',
      label: join(here, leader ? RAIL_WORDS.top(leader.name, leader.score) : ''),
    };
  }

  // ---- Late & not reviewed: a Soon item, a dot, never amber (PLAN §4.1) ----
  const waiting = Number(late) || 0;
  const lateH = waiting > 0
    ? { strong: RAIL_WORDS.toReview(waiting), dot: true, level: 'soon', label: RAIL_WORDS.toReview(waiting) }
    : { text: RAIL_WORDS.none, level: 'calm', label: RAIL_WORDS.none };

  return { queue, people: peopleH, late: lateH };
}

/**
 * The People rows: each person and whether they have answered / voted.
 *
 * Through `waitingRoster`'s freshness guard (config/anonymity.js): on a hidden
 * round the `playerAnswered` frame carries no name, so the names on hand can
 * lag the count. When they do not cover every response counted, every row
 * keeps its name with the status unknown ('unknown', "—"), never a "still
 * writing" beside someone who has answered. The laptop is private, so the
 * wall's "name the waiters" setting does not apply here.
 *
 * `from` (experience plan §3.2b, 2d): in an event, a latecomer's "from item N"
 * (config/eventAgenda.js latecomersFrom), name → words. It sits in the row's
 * doing-now slot when there is nothing being done (here), the way anyone new
 * shows when they joined; it is never a second fact beside writing or voted.
 */
export function consolePeopleFor(args = {}) {
  const { facts = null } = args;
  const rows = peopleRows(args);
  if (!facts) return rows;
  return rows.map((row) => (facts[row.name] ? { ...row, fact: facts[row.name] } : row));
}

/*
  THE ONE ADDED FACT (experience plan §3.2b, step 2g): a format adds one fact
  at the end of the row and never anything else. Trivia: the running score,
  with ✓ or ✗ in front of it once the answer is out (`marks`, name → true or
  false from the round's results, passed only after the reveal). Call &
  Answer: the running score, never a mark. Poll, Wavelength and Survey add
  none: null, and the slot stays empty.

  CALL & ANSWER WAS LEFT OUT (owner, dev, 3 Nov 2026: "before the scores
  showed up in the hosts screen 2 screen mode in the people list, but not
  now"). The two-screen host read C&A scores in the Session menu's Players
  list ("N pts"); 15022a303 folded that list into a view behind People's
  "All N" and left the rail's People column as the place to read them, but
  this returned null for every format except Trivia.
*/
const SCORED = new Set(['trivia', 'call-and-answer']);
export function personFactsFor({ gameType, players = [], marks = null } = {}) {
  if (!SCORED.has(gameType)) return null;
  const marked = gameType === 'trivia' ? marks : null;
  const out = {};
  (players || []).forEach((p) => {
    const name = (p && (p.name || p.playerName)) || '';
    if (!name) return;
    const score = Number(p.score !== undefined ? p.score : p.totalScore) || 0;
    const mark = marked && Object.prototype.hasOwnProperty.call(marked, name) ? (marked[name] ? 'right' : 'wrong') : null;
    out[name] = { score, mark };
  });
  return out;
}

function peopleRows({
  moment, players = [], answeredNames = [], answeredCount = 0, votedNames = [], votedCount = 0,
  gameType, anonymousUntilReveal, authorsRevealed, from = null,
  // The answers are options (consolePulse answersAreChoices): 'answering', never 'writing'.
  choice = false,
} = {}) {
  const names = (players || []).map((p) => (p && (p.name || p.playerName)) || '').filter(Boolean);
  const answering = moment === 'ANSWERING';
  const voting = moment === 'VOTING' || moment === 'VOTE_RESPONSES';
  // AWAY (host-attention D8): no page open for this person (get-players
  // `deviceConnected`); a row not read yet counts as here.
  const away = new Set((players || []).filter((p) => p && p.deviceConnected === false).map((p) => p.name || p.playerName));
  const mark = (row) => (away.has(row.name) ? { ...row, away: true } : row);
  const here = (name) => mark(from && from[name] ? { name, state: 'here', from: from[name] } : { name, state: 'here' });
  if (!answering && !voting) return names.map(here);
  const waiting = waitingRoster({
    players,
    responded: answering ? answeredNames : votedNames,
    respondedCount: answering ? answeredCount : votedCount,
    gameType,
    anonymousUntilReveal,
    authorsRevealed,
    nameWaitingWhenAnonymous: true,
  });
  // The names lag the count (a hidden round): keep the names and blank only
  // the status ('unknown', drawn "—"), rather than an empty People section,
  // which reads as "everyone left" (console-rail README D7).
  if (!waiting) return names.map((name) => mark({ name, state: 'unknown' }));
  const still = new Set(waiting);
  /* THE PEOPLE STILL OUT FIRST (owner, 5 Nov 2026, cut 6): while the room
     answers or votes, the rows the host may need are at the top. A stable
     sort, roster order inside each group, so a row moves once, when that
     person acts, and never otherwise. */
  const rows = names.map((name) => mark({
    name,
    state: still.has(name) ? (answering ? (choice ? 'answering' : 'writing') : 'not-yet') : (answering ? 'answered' : 'voted'),
  }));
  return rows.filter((r) => still.has(r.name)).concat(rows.filter((r) => !still.has(r.name)));
}
