/**
 * THE CONSOLE'S RAIL (spec §3.3): four collapsible sections; the one that
 * matters for the moment opens by itself. Pure, so the host's own open/close
 * choice can hold until the moment changes (ConsoleRail keeps that state).
 */
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
