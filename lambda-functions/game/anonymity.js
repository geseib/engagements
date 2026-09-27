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
 * Formats whose round never opens a vote.
 *
 * INLINED ON PURPOSE. The canonical vocabulary lives in game-types.js, and the
 * host's runtime answer lives in src/src/config/hostControls.js
 * (`hostRunsVotePhase`) — but this file must stay byte-identical across
 * lambda-functions/game/ and lambda-functions/websocket/, and game-types.js
 * exists only in the former. A require() that resolves in one bundle and not
 * the other is worse than a duplicated four-element set.
 * tests/anonymity-contract.js asserts this set still agrees with game-types.js
 * for every spelling the table can hold, aliases included.
 */
// `poll` since typed polls (27 Sep 2026): a poll is a survey question asked
// live, with no vote. It is nameless all the same — see NAMELESS_TYPES.
const TYPES_THAT_SKIP_VOTE = new Set(['trivia', 'wavelength', 'quiz', 'poll', 'polls']);

function skipsVote(gameType) {
  return TYPES_THAT_SKIP_VOTE.has(String(gameType || '').trim().toLowerCase());
}

/**
 * @param {object} metadata the GAME#id / METADATA item
 * @param {object} round    the round record carrying AuthorsRevealed
 * @returns {boolean} true when attribution must be withheld
 */
/**
 * A POLL IS NAMELESS, ALWAYS (typed polls, 27 Sep 2026). It holds no vote, so
 * it is in the skip-set above — but that set exists to spare trivia and
 * wavelength a redaction they have no use for, and a poll's answers are
 * opinions: the wall shows counts, and the phone tells the room "how everyone
 * answered, without names". Letting the skip-set decide sent every poll
 * answer, open words included, with its author into the report and the
 * feedback round (seen in Chromium the same day). Setup sends
 * `anonymousUntilReveal: false` for a poll (it offers no anonymity option),
 * so the preference cannot be read here either. Nothing reveals a poll; the
 * Names setting (docs/design/survey-redesign/PLAN.md Phase 6) is not built.
 */
const NAMELESS_TYPES = new Set(['poll', 'polls']);

function isHidden(metadata, round) {
  if (NAMELESS_TYPES.has(String((metadata && metadata.GameType) || '').trim().toLowerCase())) return true;

  // Anonymity binds only the formats that hold a vote. Trivia's response is a
  // letter, so there is nothing authored to attribute — and redacting it breaks
  // the host's view of who answered what. Wavelength never attributes on stage.
  //
  // This check is not cosmetic. The flag defaults ON, and every game created
  // before this feature has no HostPreferences at all, so without it every
  // legacy trivia and wavelength game is silently redacted.
  if (skipsVote(metadata && metadata.GameType)) return false;

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
