/**
 * THE IMPROMPTU ASK, AS PURE RULES (docs/design/impromptu-ask README D4, D5,
 * R1). No React, no fetch: what the host surfaces decide about a question the
 * host wrote, held in one place so the console, the stage, the Session menu
 * and the Remote cannot disagree.
 */
import { ownQuestionWords as OQ } from './consoleWords';

/** The words, re-exported for surfaces that read nothing else of the console's. */
export { OQ as ownQuestionWords };

export const OWN_KEY_PREFIX = 'own:';
export const isOwnKey = (key) => String(key ?? '').startsWith(OWN_KEY_PREFIX) && String(key).length > OWN_KEY_PREFIX.length;

/** The two main-button intents that start the next round (Your part now, R1). */
const ADVANCING = new Set(['next', 'start']);

/**
 * "Now" is offered only BETWEEN rounds (F2): before round 1, or once a round
 * is at its results (the read and the comments live there). Never while
 * answers or votes are coming in.
 */
export function ownNowAllowed(gameState) {
  const s = String(gameState || '');
  return s === 'CREATED' || s === 'STARTED' || s === 'LOBBY' || s === '' || s.startsWith('RESULTS#');
}

/** Before round 1: Now starts the session's first round. */
export const ownNowIsFirst = (gameState) => {
  const s = String(gameState || '');
  return s === 'CREATED' || s === 'STARTED' || s === 'LOBBY' || s === '';
};

/**
 * THE SESSION'S ROUND TOTAL, WITH THE HOST'S OWN (README risk 5): the set's
 * count plus every own question still queued or already asked, so "Round 3 of
 * 12" reads 13 while one is queued and 12 again once it is removed. An unknown
 * total stays unknown.
 */
export function withOwnRounds(total, own = []) {
  const n = Number(total);
  if (!(n > 0)) return total;
  return n + (own || []).filter((o) => o && (o.status === 'queued' || o.status === 'asked')).length;
}

/** A long question shortened for a status line, with its whole text kept for title=. */
export function shortTitle(title, max = 34) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The first queued entry the serve will take, when it is a question the host
 * wrote and still waits: { key, title } — else null. `queue` is the canonical
 * list; `own` the queue route's ownQuestions; `blocked` the keys the server
 * will pass over.
 */
export function ownAtHead(queue = [], own = [], blocked = []) {
  const skip = new Set((blocked || []).map((b) => (b && b.key) || b));
  const byKey = new Map((own || []).filter((o) => o && o.key).map((o) => [o.key, o]));
  for (const key of queue || []) {
    if (skip.has(key)) continue;
    if (!isOwnKey(key)) return null;
    const row = byKey.get(key);
    if (row && row.status && row.status !== 'queued') continue;
    return { key, title: (row && row.title) || '' };
  }
  return null;
}

/**
 * YOUR PART NOW NAMES IT (reviews F-2, R1): when the main button starts the
 * next round and the next round is the host's own question, the line becomes
 * "<first sentence> Next round asks your question: "…"". Anything else is
 * returned untouched.
 */
export function withOwnNext(part, head, primaryIntent) {
  if (!part || !head || !ADVANCING.has(primaryIntent) || !part.action) return part;
  const before = String(part.before || '');
  const dot = before.indexOf('. ');
  const lead = dot >= 0 ? before.slice(0, dot + 2) : '';
  return {
    before: lead,
    action: part.action,
    after: ` ${OQ.nextAsks} "${shortTitle(head.title, 48)}"`,
    ownTitle: head.title,
  };
}

/**
 * The rounds Later can follow, from the console's planned running order:
 * every planned row from the head, each with the automatic keys from the head
 * of the walk through it (`through`), so "after round 5" queues what comes
 * before it (queue-order.js queueAfter). `rows` is [{ key, n, title, source }].
 */
export function laterAnchors(rows = []) {
  const out = [];
  const autos = [];
  for (const r of rows || []) {
    if (!r || !r.key) continue;
    if (r.source === 'auto') autos.push(r.key);
    out.push({ key: r.key, round: r.n, title: r.title || '', through: r.source === 'auto' ? autos.slice() : [] });
  }
  return out;
}

/** The report's source line for an own round (D9): "Written by the host during the session, 10:42 · put next after round 3". */
export function ownSourceLine(own, { timeOf = null } = {}) {
  if (!own) return '';
  const at = own.createdAt && typeof timeOf === 'function' ? timeOf(own.createdAt) : '';
  let placed = '';
  if (own.placement === 'later' && own.placedAfterRound) placed = OQ.placedLater(own.placedAfterRound);
  else if (own.placement === 'now') placed = OQ.placedNow(own.placedAtRound || 0);
  else if (own.placement) placed = OQ.placedNext(own.placedAtRound || 0);
  return OQ.sourceLine({ who: own.createdByName || 'the host', at, placed });
}
