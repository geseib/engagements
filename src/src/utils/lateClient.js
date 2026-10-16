/**
 * THE HOST'S LATE LIST, over the wire (lambda-functions/game/late-list.js).
 *
 *     GET  /games/{id}/late          { rounds, counts: { notReviewed }, commentsClosedAt, includeNotReviewed }
 *     POST /games/{id}/late/review   { kind, round, ref, how: 'shown'|'read' }
 *                                    { kind: 'comments', how: 'close' }   (ENDED only)
 *                                    { kind: 'report', how: 'include'|'leave-out' }   (any time)
 *
 * Both are the host's (Cognito), so the caller hands in `authFetch`. Nothing
 * here throws: every call resolves `{ ok, status, body, error }`.
 */
async function call(fetchFn, url, init) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    return { ok: false, status: 0, body: null, error: 'That did not reach the server.' };
  }
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { ok: res.ok, status: res.status, body, error: res.ok ? null : ((body && body.error) || 'That did not work.') };
}

const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const base = (apiBase, gameId) => `${apiBase}games/${encodeURIComponent(gameId)}/late`;

export async function fetchLate({ fetchFn, apiBase, gameId }) {
  const r = await call(fetchFn, base(apiBase, gameId));
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const body = r.body || {};
  return {
    ok: true,
    rounds: Array.isArray(body.rounds) ? body.rounds : [],
    counts: { notReviewed: Number(body.counts && body.counts.notReviewed) || 0 },
    commentsClosedAt: body.commentsClosedAt || null,
    // "Include items not reviewed": on unless the server says it is off.
    includeNotReviewed: body.includeNotReviewed !== false,
  };
}

export function reviewLateItem({ fetchFn, apiBase, gameId, item, how }) {
  return call(fetchFn, `${base(apiBase, gameId)}/review`, post({ kind: item.kind, round: item.round, ref: item.ref, how }));
}

export function closeComments({ fetchFn, apiBase, gameId }) {
  return call(fetchFn, `${base(apiBase, gameId)}/review`, post({ kind: 'comments', how: 'close' }));
}

/** The report setting "Include items not reviewed" (late items Task 5). */
export function setIncludeNotReviewed({ fetchFn, apiBase, gameId, include }) {
  return call(fetchFn, `${base(apiBase, gameId)}/review`, post({ kind: 'report', how: include ? 'include' : 'leave-out' }));
}

/** Every item, flat, in the list's order (round, then arrival). */
export function lateItemsOf(rounds) {
  return (Array.isArray(rounds) ? rounds : []).flatMap((r) => (Array.isArray(r.items) ? r.items : [])
    .map((it) => ({ ...it, roundNoun: it.roundNoun || r.roundNoun || null })));
}

/**
 * What the status line needs: how many wait, and whether every one of them is
 * an answer (so the line can say "1 late answer kept").
 */
export function lateStatusOf(rounds) {
  const waiting = lateItemsOf(rounds).filter((it) => !it.reviewed);
  const answers = waiting.filter((it) => it.kind === 'answer' || it.kind === 'askAnswer').length;
  return { notReviewed: waiting.length, answers };
}

/**
 * Can this item go on the wall NOW? Only where the wall would really show it,
 * because putting it up also records "Reviewed with the room" (review fix,
 * controller ruling 16 Oct): a press that changes nothing on the wall would be
 * a false record in the report.
 *
 *   comment     the wall is on that round's feedback beat (the wall reads the
 *               featured comment of the round on screen, and only there:
 *               present/usePresentation.js, the stage's scopedRoundComments)
 *   askAnswer   a late Idea, when the wall is on that round's ask beat with
 *               that same question up (the wall reads the round's shown ask)
 *   answer      never: a late round answer has no wall view
 *
 * `wall` is `{ round: '003', beat, askId }`: the round on the wall (its
 * results), the results beat, and the question for the room on screen.
 */
export function canShowOnWall(item, wall) {
  if (!item || item.reviewed === 'shown') return false;
  if (!wall || !wall.round || String(wall.round) !== String(item.round)) return false;
  if (item.kind === 'comment') return wall.beat === 'feedback';
  return item.kind === 'askAnswer' && item.askKind === 'ideas' && Boolean(item.askId && item.id)
    && wall.beat === 'ask' && wall.askId === item.askId;
}
