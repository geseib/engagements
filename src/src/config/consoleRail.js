/**
 * THE CONSOLE'S RAIL (spec §3.3): four collapsible sections; the one that
 * matters for the moment opens by itself. Pure, so the host's own open/close
 * choice can hold until the moment changes (ConsoleRail keeps that state).
 */
import { waitingRoster } from './anonymity';
export const CONSOLE_SECTIONS = Object.freeze(['queue', 'people', 'late', 'tools']);

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

/** The People header: the one count for the moment. */
export function peopleSummary({ moment, players = 0, answered = 0, voted = 0 } = {}) {
  if (moment === 'ANSWERING') return `${answered} of ${players} answered`;
  if (moment === 'VOTING' || moment === 'VOTE_RESPONSES') return `${voted} of ${players} voted`;
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
 */
export function consolePeopleFor({
  moment, players = [], answeredNames = [], answeredCount = 0, votedNames = [], votedCount = 0,
  gameType, anonymousUntilReveal, authorsRevealed,
} = {}) {
  const names = (players || []).map((p) => (p && (p.name || p.playerName)) || '').filter(Boolean);
  const answering = moment === 'ANSWERING';
  const voting = moment === 'VOTING' || moment === 'VOTE_RESPONSES';
  if (!answering && !voting) return names.map((name) => ({ name, state: 'here' }));
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
