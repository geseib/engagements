/**
 * IS THE SESSION STILL TAKING LATE ITEMS? (session flow v3 §4.4; owner, Q4)
 *
 * A late answer to a question for the room, and a comment after its round,
 * are accepted while the session runs and for 24 hours after it ENDED, unless
 * the host pressed "Close comments" (METADATA `CommentsClosedAt`). Late ROUND
 * answers follow a stricter rule (websocket/late-answer.js: running only).
 *
 * When the session ended is STATE's `UpdatedAt`, which session-end.js stamps
 * as it writes ENDED (survey-host.js also writes `EndedAt`; either is read).
 * An ENDED session with neither is not guessed open.
 *
 * Pure: `now` is injectable, and nothing is read here.
 */
const LATE_WINDOW_HOURS = 24;

const CLOSED = {
  COMMENTS_CLOSED: 'Comments are closed for this session.',
  WINDOW_CLOSED: 'This session has closed. Nothing more can be added.',
};

/**
 * @param {{meta: object, state: object, now?: number}} args
 * @returns {{open: true} | {open: false, code: 'COMMENTS_CLOSED'|'WINDOW_CLOSED', error: string}}
 */
function lateWindow({ meta, state, now = Date.now() }) {
  if (meta && meta.CommentsClosedAt) return { open: false, code: 'COMMENTS_CLOSED', error: CLOSED.COMMENTS_CLOSED };
  if (!state || state.State !== 'ENDED') return { open: true };
  const ended = Date.parse((state && (state.EndedAt || state.UpdatedAt)) || '');
  if (Number.isFinite(ended) && now - ended <= LATE_WINDOW_HOURS * 60 * 60 * 1000) return { open: true };
  return { open: false, code: 'WINDOW_CLOSED', error: CLOSED.WINDOW_CLOSED };
}

module.exports = { lateWindow, LATE_WINDOW_HOURS, CLOSED };
