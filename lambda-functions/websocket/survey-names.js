/**
 * NAMES and the two SURVEY STATES — the server's half.
 *
 * Names decides what a survey WRITES about people (owner, 2026-09-23):
 *   anonymous  answers under a random id the phone makes; no name, no player id
 *   finished   the same nameless answers + a separate SURVEY#DONE#<player> list
 *   named      answers under the player, with their name
 * It is fixed when the survey opens. The browser's half, with every sentence a
 * person reads about each value, is src/src/config/surveyNames.js;
 * tests/survey-names-agree.js holds the ids, the default and these states equal.
 *
 * COPIED BYTE FOR BYTE into lambda-functions/websocket/survey-names.js, because
 * create (websocket/create-game.js → schema-compliant-manager.js) is the one
 * writer of METADATA.Names and a Lambda bundle cannot reach across directories.
 * tests/survey-names-agree.js holds the two copies identical.
 *
 * The states carry no digits after '#', so every round parser in the product
 * (`/#(\d+)/` restores, the remote's parseGamePhase, get-game-state's
 * ASK/VOTE/RESULTS question fetch) treats them as inert.
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md.
 */
const NAMES = Object.freeze(['anonymous', 'finished', 'named']);
const NAMES_DEFAULT = 'anonymous';

const SURVEY_OPEN = 'SURVEY#OPEN';
const SURVEY_CLOSED = 'SURVEY#CLOSED';

/** A stored or sent Names value, folded; anything unknown is the default. */
function normalizeNames(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return NAMES.includes(v) ? v : NAMES_DEFAULT;
}

module.exports = { NAMES, NAMES_DEFAULT, SURVEY_OPEN, SURVEY_CLOSED, normalizeNames };
