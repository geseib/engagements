/**
 * READY QUESTIONS FOR A BUILD ROOM (step 7b; owner, 2026-10-05: "yes
 * build-room tag and ship the starter set").
 *
 * Two optional per-question columns, read by the importer, written by the
 * download and by the console's own CSV (utils/questionRows.js), and used only
 * when a Build Room asks the question:
 *
 *   ClaudeGets  what Claude gets when the room decides: do-now, keep, later
 *               or ask. The same four keys as the Build Room's CLAUDE_GETS
 *               (game/build-store.js). A closed vocabulary, so plaintext.
 *   ClaudeNote  how Claude should use the decided answer. Never shown to the
 *               room; sealed for a team's set like the question's own text
 *               (tenant-crypto ENCRYPTED_FIELDS.question).
 *
 * A set becomes Build Room ready with the ordinary set tag `build-room`.
 */
const CLAUDE_GETS = Object.freeze(['do-now', 'keep', 'later', 'ask']);
const BUILD_ROOM_TAG = 'build-room';
const CLAUDE_NOTE_MAX = 1000;

/** A cell's ClaudeGets: '' when blank, the key when known, null when not. */
function normalizeClaudeGets(cell) {
  const v = String(cell || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!v) return '';
  const alias = { 'do-now': 'do-now', donow: 'do-now', now: 'do-now', keep: 'keep', 'keep-in-mind': 'keep', later: 'later', ask: 'ask', 'ask-claude': 'ask' };
  return alias[v] || null;
}

const clampClaudeNote = (text) => String(text || '').trim().slice(0, CLAUDE_NOTE_MAX);

module.exports = { CLAUDE_GETS, BUILD_ROOM_TAG, CLAUDE_NOTE_MAX, normalizeClaudeGets, clampClaudeNote };
