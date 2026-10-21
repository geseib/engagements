/**
 * WORKIE'S READ CHECK, FOR THE HOST ONLY.
 *
 * get-ai-summary.js checks Workie's reply after it is written
 * (lambda-functions/game/read-check.js): numbers the material never gave it,
 * claims about the room the vote does not show ("strongest", "unanimous"),
 * next steps written as already decided. A reply with issues is rewritten
 * once; what is still left is stored as `ReadCheck` on the round's read and
 * returned ONLY on the host's door, `GET /games/{id}/ai-summary/host`. The
 * public read the phones, the wall and /present make never carries it.
 *
 * `fetchFn` is the caller's `authFetch`: the host route carries the Cognito
 * authorizer. Any failure is "nothing to say": the note is an aid, and a
 * missing note must never cost the host the read itself.
 */
export async function fetchReadCheck({ fetchFn, apiBase = '', gameId, questionId = '' }) {
  if (!gameId || typeof fetchFn !== 'function') return null;
  try {
    const q = questionId ? `?questionId=${encodeURIComponent(questionId)}` : '';
    const res = await fetchFn(`${apiBase}games/${gameId}/ai-summary/host${q}`);
    if (!res || !res.ok) return null;
    const data = await res.json();
    return (data && data.readCheck) || null;
  } catch (e) {
    return null;
  }
}

/**
 * The one small line, or null when there is nothing to say. Tokens are the
 * read's own words (never a participant's name — the server strips those).
 */
export function readCheckNote(readCheck) {
  const issues = readCheck && Array.isArray(readCheck.issues) ? readCheck.issues : [];
  const words = [...new Set(issues.map((i) => String((i && i.token) || '').trim()).filter(Boolean))];
  if (!words.length) return null;
  const shown = words.slice(0, 4).map((w) => `“${w}”`).join(', ');
  const more = words.length > 4 ? ` and ${words.length - 4} more` : '';
  return `Workie used words the room’s answers don’t support: ${shown}${more}. Redo or edit before it goes up.`;
}
