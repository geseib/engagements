/**
 * THE QUEUE, AS ARITHMETIC. No storage, no fetch, no React.
 *
 * The owner's request, verbatim:
 *
 *   "the session\questions has a option to 'Ask next' this is great, but
 *    currently no matter where you are it forward to that question. I want to
 *    think through a really nice way to queue up multiple questions but they
 *    are not triggered until the end of the round is selected by the host...
 *    state needs to show locally, and stored in the backend (DynamoDB?)"
 *
 * "show locally AND stored in the backend" is the whole reason this file has no
 * imports worth speaking of. The same ordering runs in three places that cannot
 * share a runtime:
 *
 *   - the stage panel, which reorders optimistically so the list moves under
 *     the host's finger rather than 200ms after it;
 *   - the phone remote, which is a SECOND host surface holding its own copy and
 *     polling `/state` every 2s (HostRemote.jsx) — it is routinely a beat
 *     behind the stage;
 *   - the Lambda, which is the only writer that matters.
 *
 * If those three disagree about what "move it up" means, the host sees the row
 * jump and then jump back. So the rules are written ONCE, here, and mirrored
 * byte-for-byte into `lambda-functions/game/queue-order.js` because a Lambda
 * bundle cannot import ESM out of `src/`. `tests/question-queue-order.js` runs
 * one fixture table through BOTH copies and fails if they ever disagree — the
 * same deal `set-version.js` has across its three homes.
 *
 * ── WHY OPERATIONS AND NOT AN ARRAY ────────────────────────────────────────
 *
 * Every function here takes a queue and returns a queue. None of them takes
 * "the new queue the client thinks it should be", and that is deliberate: two
 * host surfaces are live at once and the phone is by construction stale. A
 * surface that posts its whole array posts a snapshot from two seconds ago, and
 * the other surface's edit is gone with no error anywhere. `applyQueueOp` is
 * what the endpoint replays against whatever it just read.
 *
 * ── IDENTITY IS PART OF THE CONTRACT ───────────────────────────────────────
 *
 * A change returns a NEW array; a no-op returns the array it was given. The
 * server's retry loop uses that to decide whether it has anything to write, so
 * "the host pressed a button that could not do anything" costs zero writes and
 * still answers 200. React's `===` bailout gets the same benefit for free.
 */

import { questionKey } from './setupPanel';

/**
 * The cap, and it is the SAME 24 as the host masks.
 *
 * Not an arbitrary round number: a host can only ever toggle 24 categories
 * because that is how many bits `HostMask1-8`/`9-16`/`17-24` hold, and
 * `utils/questionCategories.js` refuses the 25th category WITH ITS REASON for
 * exactly that mechanism. A queue is a running order for one session; past two
 * dozen it is a question set, not a queue. Refusing loudly beats a list that
 * scrolls forever and silently outlives the session it was built for.
 */
export const QUEUE_MAX = 24;

/**
 * A CLOSED enum, and the closure is the feature.
 *
 * `stage-beat.js` carries the same note for the same incident shape: an open
 * enum's worst failure is that everything succeeds — the write lands, the frame
 * goes out, every client compares the value against the four it knows, and the
 * host watches a button do nothing with no error anywhere in the system.
 */
export const QUEUE_OPS = ['add', 'remove', 'earlier', 'later'];

/**
 * ONE spelling of a question id, borrowed rather than rebuilt.
 *
 * `QUESTION#c005#001` and `c005#001` are the same question under two names, and
 * both are on the wire today: the browsing endpoint publishes the bare form,
 * `get-question.js` returns the prefixed one. `setupPanel.js:154` records what
 * that cost — the "Unasked only" filter compared the two spellings and was dead
 * for as long as it existed, in both halves, one of which merely looked subtle.
 *
 * A queue holding both spellings of one question would let a host queue the
 * same round twice and then be unable to remove either copy from the surface
 * that spells it the other way. Trimmed BEFORE the prefix strip, because a key
 * arriving as ` QUESTION#c005#001` from a hand-edited fixture would otherwise
 * keep its prefix and become a third spelling.
 */
const canonical = (id) => questionKey(String(id ?? '').trim());

const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const refuse = (queue, refused) => ({ queue, changed: false, refused });
const accept = (queue) => ({ queue, changed: true, refused: null });

/**
 * Whatever was stored, as a clean list of canonical keys.
 *
 * DOES NOT TRUNCATE to QUEUE_MAX, and that asymmetry is on purpose. The cap
 * belongs on the gate that adds; applying it on READ would mean a queue that
 * somehow grew past two dozen silently loses the host's last choices the next
 * time anything looks at it, with nothing to tell them and no way back. Junk —
 * blanks, nulls, a duplicate written by an older client — is dropped, because
 * none of those name a question anybody can be served.
 *
 * Returns the caller's own array when there was nothing to clean, so the
 * identity contract survives a normalise on the way in.
 */
export function normaliseQueue(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];

  for (const entry of source) {
    const key = canonical(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return sameOrder(source, out) ? source : out;
}

/**
 * Add to the TAIL. A queue is a running order, and a host who queues three
 * questions means them in the order they pressed.
 *
 * Duplicates are PREVENTED rather than allowed-and-deduped-later: the same
 * question twice in one session is never what the press meant, and the second
 * copy would sit there until it drained and then be skipped as already-asked,
 * which reads as the queue eating a round.
 */
export function queueEnqueue(queue, id) {
  const list = normaliseQueue(queue);
  const key = canonical(id);

  if (!key) return refuse(list, 'no-key');
  // Already there: the press was a no-op, not an error. Same reasoning as
  // stage-beat.js's idempotence — the host is standing in front of a room and a
  // double-tap must not be something they have to understand.
  if (list.includes(key)) return refuse(list, 'duplicate');
  if (list.length >= QUEUE_MAX) return refuse(list, 'full');

  return accept([...list, key]);
}

/** The host taking one back off the list. A key that is not queued is a no-op. */
export function queueRemove(queue, id) {
  const list = normaliseQueue(queue);
  const key = canonical(id);

  if (!key) return refuse(list, 'no-key');
  const at = list.indexOf(key);
  /*
    A STALE SURFACE MUST NOT RESURRECT WHAT ANOTHER ONE REMOVED.

    The phone polls every 2s, so it draws rows that the stage deleted a moment
    ago. Pressing one of those must do nothing. The dangerous alternative is an
    implementation that "helpfully" treats a missing key as something to insert
    or re-add: then every stale tap on a dead row puts the question back, and
    the host removes it twice before it stays gone.
  */
  if (at === -1) return refuse(list, 'not-queued');

  const next = list.slice();
  next.splice(at, 1);
  return accept(next);
}

/**
 * ONE STEP, AS A SWAP WITH THE NEIGHBOUR — never a splice to an index.
 *
 * The owner: *"cant go to 0, cant go greater than the number of queued items"*.
 * So it CLAMPS and never wraps. `earlier` on the head and `later` on the tail
 * are no-ops; a wrap would send the question the host is trying to promote to
 * the very bottom of the list, which is the single worst thing this control
 * could do and is what an unguarded modular index does on the first press.
 *
 * A swap rather than remove-and-reinsert because the two differ once anything
 * else is in flight: splicing to a computed index is written against the list
 * the SURFACE had, and the surface is stale by design here.
 */
export function queueMove(queue, id, direction) {
  const list = normaliseQueue(queue);

  if (direction !== 'earlier' && direction !== 'later') return refuse(list, 'unknown-op');

  const key = canonical(id);
  if (!key) return refuse(list, 'no-key');

  const at = list.indexOf(key);
  if (at === -1) return refuse(list, 'not-queued');

  const to = direction === 'earlier' ? at - 1 : at + 1;
  if (to < 0 || to >= list.length) return refuse(list, 'at-edge');

  const next = list.slice();
  next[at] = next[to];
  next[to] = key;
  return accept(next);
}

/**
 * The SERVER's removal, not the host's — which is why it is not in QUEUE_OPS.
 *
 * The drain in `next-question.js` uses it for two things no host asked for:
 * popping the head it has just served, and discarding an entry that turns out
 * to have been asked already. Both are bookkeeping about what happened, so they
 * are deliberately not reachable from a button; `queueRemove` is the one the
 * host presses.
 *
 * Takes several keys because the drain can discard a run of already-asked
 * entries and serve the survivor in one pass, and one write is one chance for
 * the conditional to fail rather than four.
 */
export function queueDrop(queue, keys) {
  const list = normaliseQueue(queue);
  const doomed = new Set(
    (Array.isArray(keys) ? keys : [keys]).map(canonical).filter(Boolean)
  );

  if (doomed.size === 0) return refuse(list, 'no-key');

  const next = list.filter((key) => !doomed.has(key));
  if (next.length === list.length) return refuse(list, 'not-queued');
  return accept(next);
}

/**
 * THE ONE ENTRY POINT THE ENDPOINT REPLAYS.
 *
 * `question-queue.js` calls this against the list it has JUST read, on every
 * attempt including the retries. That is the entire optimistic-locking design:
 * the loser of a race re-reads and re-applies its OPERATION, so both edits
 * land. Handing the server an array instead would have the loser re-send a
 * stale snapshot and silently discard the winner.
 */
export function applyQueueOp(queue, operation = {}) {
  const id = operation.questionKey ?? operation.questionId ?? operation.key;

  switch (operation.op) {
    case 'add': return queueEnqueue(queue, id);
    case 'remove': return queueRemove(queue, id);
    case 'earlier':
    case 'later': return queueMove(queue, id, operation.op);
    default:
      // Unchanged, named, and 200 — see QUEUE_OPS. A client sending an op this
      // build has never heard of is a client from a different deploy, and the
      // right answer is "I did nothing", said out loud.
      return refuse(normaliseQueue(queue), 'unknown-op');
  }
}

/**
 * MOVING AN AUTO ROW MAKES THE PLAN MANUAL — the ops that do it, in order.
 *
 * The owner, on rearranging the automatic tail of the running order: "if there
 * was Q1 - A Q2 - B and Q3 - C. and i move B to the bottom in a way all of
 * them now are manually adjusted. that may not make a difference." Exactly the
 * semantics implemented here: the automatic rows are a simulation with no
 * stored order to edit, so touching one MATERIALISES the displayed plan into
 * the queue (every shown auto pick becomes a queued row, in plan order) and
 * then applies the requested one-step move.
 *
 * FRONTEND ONLY, deliberately — this is not mirrored into queue-order.js. The
 * server never materialises anything; it receives the result as ordinary
 * `add`/`earlier`/`later` ops from QUEUE_OPS, each replayed against a fresh
 * read, so a phone edit that interleaves with the burst still lands. A bulk
 * "replace the queue" op is exactly the whole-array write the header forbids.
 *
 * Returns `{ ops, queue, refused }`:
 *   ops     what to POST, in order — adds first, the move last. Empty when
 *           nothing needs doing.
 *   queue   the list as it will stand after the ops, for the optimistic render.
 *   refused the simulated move's refusal (`at-edge`, `not-queued`…), so the
 *           caller can decline BEFORE materialising — adds followed by a
 *           refused move would freeze the plan without performing the gesture
 *           the host asked for, which is the worst of both.
 */
export function materializePlanOps(queue, autoKeys, targetKey, direction) {
  const list = normaliseQueue(queue);
  const target = canonical(targetKey);

  const additions = [];
  const seen = new Set(list);
  for (const raw of Array.isArray(autoKeys) ? autoKeys : []) {
    const key = canonical(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    additions.push(key);
  }

  const materialized = [...list, ...additions];
  if (materialized.length > QUEUE_MAX) {
    // Refused whole rather than truncated: a half-materialised plan reorders
    // some rows and silently abandons others, and which ones is invisible.
    return { ops: [], queue: list, refused: 'full' };
  }

  const moved = queueMove(materialized, target, direction);
  if (!moved.changed) return { ops: [], queue: list, refused: moved.refused };

  return {
    ops: [
      ...additions.map((key) => ({ op: 'add', questionKey: key })),
      { op: direction, questionKey: target },
    ],
    queue: moved.queue,
    refused: null,
  };
}

/**
 * Where a question sits, 1-based, or 0 when it is not queued.
 *
 * 0 rather than -1 or null so that "is this queued?" and "which number is it?"
 * are the same expression and cannot drift apart at a call site: `position &&
 * \`#${position}\`` is the whole badge.
 */
export function queuePosition(queue, id) {
  const key = canonical(id);
  if (!key) return 0;
  return normaliseQueue(queue).indexOf(key) + 1;
}

/**
 * The queue as rows, with the edge rules already decided.
 *
 * `canMoveEarlier`/`canMoveLater` are here rather than in a component because
 * they are the SAME clamp `queueMove` enforces, and a surface that re-derives
 * "is this the first row" is a second implementation of R3 that can disagree
 * with the server about whether a button should have done anything.
 *
 * `missing` is honest about a queued key whose question the caller could not
 * hand us — a set replaced mid-session, or simply a page that has not loaded
 * the browser rows yet. Dropping the row instead would make the host's own
 * choice vanish from their list while it is still very much on the server's.
 */
export function queueRows(queue, { questions = [] } = {}) {
  const list = normaliseQueue(queue);

  const byKey = new Map();
  for (const question of questions) {
    const key = canonical(question?.id ?? question?.Id ?? question?.questionId);
    if (key && !byKey.has(key)) byKey.set(key, question);
  }

  return list.map((key, index) => {
    const question = byKey.get(key) || null;
    return {
      key,
      position: index + 1,
      title: (question && (question.title || question.Title)) || '',
      category: (question && (question.category || question.Category)) || '',
      canMoveEarlier: index > 0,
      canMoveLater: index < list.length - 1,
      missing: !question,
    };
  });
}

/** Counts for the header, including the one the cap makes worth saying. */
export function queueSummary(queue) {
  const list = normaliseQueue(queue);
  return {
    count: list.length,
    remaining: Math.max(0, QUEUE_MAX - list.length),
    full: list.length >= QUEUE_MAX,
    // What the next "end of round" will actually serve, which is the only
    // thing about a queue a host reads mid-session.
    nextKey: list[0] || null,
  };
}
