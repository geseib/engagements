/**
 * Whether this round's answers may carry their authors, and how to strip them.
 *
 * WHY THIS IS NOT AN ACCESS-CONTROL CHECK. `role` is a client-supplied query
 * parameter (get-answers.js:11), not derived from auth. A player can ask for
 * role=host. So "show names to the host, hide them from players" is not
 * something this system can enforce, and a guarantee the API cannot keep is a
 * label on a leak. Anonymity here has exactly one meaning: the server does not
 * send the names, to anybody, until the host reveals. There is deliberately no
 * host branch in this file.
 *
 * DEFAULT ON, including for games that predate the feature. A game created
 * before HostPreferences carried this flag has no opinion recorded, and the
 * owner's requirement is that the safe state is the default. So only an
 * explicit `false` turns it off.
 *
 * THIS FILE EXISTS TWICE — lambda-functions/game/ and lambda-functions/websocket/.
 * Lambda CodeUri is per-directory, there are no layers, and build.sh copies no
 * shared code, so cross-directory require() is impossible; broadcastToGame is
 * already duplicated four times for the same reason. tests/anonymity-contract.js
 * asserts the two copies are byte-identical. EDIT BOTH.
 */

/** The three fields that carry authorship in answer payloads. */
const ANON_FIELDS = ['playerId', 'playerName', 'name'];

/**
 * @param {object} metadata the GAME#id / METADATA item
 * @param {object} round    the round record carrying AuthorsRevealed
 * @returns {boolean} true when attribution must be withheld
 */
function isHidden(metadata, round) {
  const prefs = (metadata && metadata.HostPreferences) || {};
  const anonymous = prefs.anonymousUntilReveal !== false; // default ON
  const revealed = !!(round && round.AuthorsRevealed);
  return anonymous && !revealed;
}

/**
 * Strip authorship from one answer row.
 *
 * Omits rather than nulls: a client that forgets to handle anonymity renders
 * nothing instead of the string "null", and the redaction shows up in a payload
 * diff. Returns a new object; callers pass rows they do not own.
 */
function redactAnswer(answer) {
  const out = { ...(answer || {}) };
  for (const field of ANON_FIELDS) delete out[field];
  return out;
}

/**
 * Strip authorship from a list, preserving order and length EXACTLY.
 *
 * The ballot is positional — submit-vote stores {"0": 1, "1": 2} and
 * get-results tallies vote index against answers[index]. Reordering or
 * filtering here would land votes on the wrong answers with no error at all.
 */
function redactAnswers(answers) {
  if (!Array.isArray(answers)) return [];
  return answers.map(redactAnswer);
}

module.exports = { isHidden, redactAnswer, redactAnswers, ANON_FIELDS };
