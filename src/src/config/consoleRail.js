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
 * The People header: "N here" in every phase. The answered and voted count is
 * the pulse's (config/consolePulse.js; session-start D3 "the count leaves the
 * People header"), so the console says it once.
 */
export function peopleSummary({ players = 0 } = {}) {
  return `${players} here`;
}

/**
 * The People rows: each person and whether they have answered / voted.
 *
 * Through `waitingRoster`'s freshness guard (config/anonymity.js): on a hidden
 * round the `playerAnswered` frame carries no name, so the names on hand can
 * lag the count. When they do not cover every response counted, there are no
 * per-person rows at all (the header's count still stands), never a "still
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
  false from the round's results, passed only after the reveal). Poll and
  Wavelength add none: null, and the slot stays empty. (Call & Answer's score
  is its own step; this returns null for it today.)
*/
export function personFactsFor({ gameType, players = [], marks = null } = {}) {
  if (gameType !== 'trivia') return null;
  const out = {};
  (players || []).forEach((p) => {
    const name = (p && (p.name || p.playerName)) || '';
    if (!name) return;
    const score = Number(p.score !== undefined ? p.score : p.totalScore) || 0;
    const mark = marks && Object.prototype.hasOwnProperty.call(marks, name) ? (marks[name] ? 'right' : 'wrong') : null;
    out[name] = { score, mark };
  });
  return out;
}

function peopleRows({
  moment, players = [], answeredNames = [], answeredCount = 0, votedNames = [], votedCount = 0,
  gameType, anonymousUntilReveal, authorsRevealed, from = null,
} = {}) {
  const names = (players || []).map((p) => (p && (p.name || p.playerName)) || '').filter(Boolean);
  const answering = moment === 'ANSWERING';
  const voting = moment === 'VOTING' || moment === 'VOTE_RESPONSES';
  const here = (name) => (from && from[name] ? { name, state: 'here', from: from[name] } : { name, state: 'here' });
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
  if (!waiting) return [];
  const still = new Set(waiting);
  return names.map((name) => ({
    name,
    state: still.has(name) ? (answering ? 'writing' : 'not-yet') : (answering ? 'answered' : 'voted'),
  }));
}
