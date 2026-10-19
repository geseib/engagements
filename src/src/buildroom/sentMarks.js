/**
 * THE "SENT TO CLAUDE" MARKS (docs/design/build-room-consider, frames 2, 4, 5;
 * owner, 19 Oct 2026: "we need to mark any ideas, votes, in history as having
 * been sent to claude so when i see the list of ideas, or asks, or history, i
 * at least see them marked as having been sent. this mark could actually link
 * to the history log showing where it went to claude code").
 *
 * One map from a thing the room gave to its mark, read from what the server
 * stamped when it was sent (provenance, H1), never guessed from words:
 *
 *   key                       the thing
 *   idea:<ideaId>             an idea (the queue, Handled, an option made from it)
 *   resp:<askId>:<respId>     a suggestion in an Ideas ask
 *   option:<askId>:<label>    an option of a Choose ask
 *   why:<askId>:<whyId>       a phone's reason with its pick
 *   ask:<askId>               the ask itself (Asks, Decided)
 *
 *   mark      sent | reworded | later | queued
 *   entryId   the History entry it opens at (the log entry that carried it); null for queued
 *
 * Sent beats later beats queued: an item held for later and then sent reads as
 * sent; the newest of two sends wins.
 */
import { W } from './words';

const RANK = Object.freeze({ queued: 1, later: 2, sent: 3, reworded: 3 });

export const MARK_WORDS = Object.freeze({
  sent: W.markSent, reworded: W.markReworded, later: W.markLater, queued: W.markQueued,
});

/** Same key shapes as the server's itemOf (lambda-functions/game/build-store.js). */
export const itemKeys = Object.freeze({
  idea: (ideaId) => `idea:${ideaId}`,
  resp: (askId, respId) => `resp:${askId}:${respId}`,
  option: (askId, label) => `option:${askId}:${label}`,
  why: (askId, whyId) => `why:${askId}:${whyId}`,
  ask: (askId) => `ask:${askId}`,
});

/** The mark one entry (a log row the server stamped) gives the things it names. */
function entryMark(l) {
  if (l.held) return 'later';
  if (l.kind === 'idea') return 'sent';
  return l.asWritten === true ? 'sent' : 'reworded';
}

/** @returns {Map<string, {mark: string, entryId: string|null, at: string}>} */
export function sentMarks(room) {
  const marks = new Map();
  if (!room) return marks;
  const set = (key, m) => {
    const cur = marks.get(key);
    if (!cur || RANK[m.mark] > RANK[cur.mark] || (RANK[m.mark] === RANK[cur.mark] && String(m.at) >= String(cur.at))) marks.set(key, m);
  };
  const log = room.log || [];
  const asks = room.asks || [];
  for (const l of log) {
    if (!l.forAgent && !l.held) continue;
    const m = { mark: entryMark(l), entryId: l.logId, at: l.createdAt || '' };
    if (l.kind === 'idea' && l.ideaId) set(itemKeys.idea(l.ideaId), m);
    if (l.kind === 'direction' && l.from) {
      for (const id of l.from.ideaIds || []) set(itemKeys.idea(id), m);
      for (const k of l.from.items || []) set(k, m);
      for (const id of l.from.askIds || []) set(itemKeys.ask(id), { ...m, mark: m.mark === 'later' ? 'later' : 'reworded' });
    }
  }
  for (const a of asks) {
    const d = a.status === 'decided' ? a.decision : null;
    if (!d || (d.sentToAgent === false && !d.heldForLater)) continue;
    const entry = log.filter((l) => l.kind === 'decision' && l.askId === a.askId).pop();
    const m = { mark: d.heldForLater ? 'later' : d.reworded ? 'reworded' : 'sent', entryId: entry ? entry.logId : `decided:${a.askId}`, at: d.decidedAt || a.decidedAt || '' };
    set(itemKeys.ask(a.askId), m);
    for (const id of d.chosen || []) {
      if (a.kind === 'choice') {
        set(itemKeys.option(a.askId, id), m);
        const o = (a.options || []).find((x) => x.label === id);
        if (o && o.ideaId) set(itemKeys.idea(o.ideaId), m);
      } else if (a.kind === 'suggest') {
        set(itemKeys.resp(a.askId, id), m);
        const r = (a.responses || []).find((x) => x.respId === id);
        if (r && r.ideaId) set(itemKeys.idea(r.ideaId), m);
      }
    }
  }
  // QUEUED FOR THE ROOM: waiting for a vote, or in a waiting ask made on its words.
  const proposed = new Set(asks.filter((a) => a.status === 'proposed').map((a) => a.askId));
  const queued = { mark: 'queued', entryId: null, at: '' };
  for (const i of room.ideas || []) {
    if (i.status === 'queued' || (i.status === 'promoted' && i.promotedTo && proposed.has(i.promotedTo))) {
      set(itemKeys.idea(i.ideaId), queued);
      if (i.fromItem) set(i.fromItem, queued);
    }
  }
  for (const a of asks) if (a.status === 'proposed' && a.fromItem) set(a.fromItem, queued);
  return marks;
}

/** A History item holds an entry when it is that entry, or was carried by it. */
export const storyHolds = (item, target) => Boolean(item && target)
  && (item.id === target || (item.entryIds || []).includes(target));
