/**
 * THE QUEUE, AS ARITHMETIC — the Lambda's copy.
 *
 * MIRROR OF `src/src/config/questionQueue.js`. Same rules, same names, same
 * order; only the module system and the `questionKey` inlining below differ. A
 * Lambda bundle is per-directory (`CodeUri: lambda-functions/game/`) and the
 * frontend module is ESM importing from `config/setupPanel.js`, so it cannot be
 * required from here — the same constraint that has `set-version.js` living in
 * three directories at once.
 *
 * KEEP THE TWO IN STEP. `tests/question-queue-order.js` runs ONE fixture table
 * through both copies and fails if they disagree on any case, which is what
 * makes the duplication survivable rather than a slow drift nobody notices
 * until the host's phone and the projector reorder differently.
 *
 * Why the rules are shared at all, rather than "the server decides": three
 * surfaces hold a queue — the stage panel, the phone remote (which polls
 * `/state` every 2s and is a beat behind by construction), and this handler. If
 * they disagree about what "move it up" means, the row jumps under the host's
 * finger and then jumps back.
 *
 * ── OPERATIONS, NEVER AN ARRAY ─────────────────────────────────────────────
 *
 * Every function takes a queue and returns a queue. None takes "the new queue
 * the client thinks it should be": two host surfaces are live at once and one
 * of them is always stale, so a whole-array write is a two-second-old snapshot
 * that silently discards the other surface's edit. `applyQueueOp` is what the
 * endpoint replays against whatever it has just read.
 *
 * ── IDENTITY IS PART OF THE CONTRACT ───────────────────────────────────────
 *
 * A change returns a NEW array; a no-op returns the array it was given. The
 * retry loop in `question-queue.js` uses that to decide whether it has anything
 * to write at all.
 */

/**
 * ONE spelling of a question id — a byte-for-byte copy of
 * `src/src/config/setupPanel.js:154`, which is where the reasoning lives.
 *
 * Short version: `QUESTION#c005#001` and `c005#001` are the same question under
 * two names and BOTH are on the wire — the browsing endpoint publishes the bare
 * form, `get-question.js` returns the prefixed one. Comparing the two spellings
 * is what killed the "Unasked only" filter for its entire life. A queue holding
 * both spellings of one question lets a host queue the same round twice and
 * then fail to remove either copy from the surface that spells it the other
 * way.
 */
const questionKey = (id) => String(id ?? '').replace(/^QUESTION#/, '');

/**
 * The cap, and it is the SAME 24 as the host masks — a host can only ever
 * toggle 24 categories because that is how many bits `HostMask1-8`/`9-16`/
 * `17-24` hold. Past two dozen a queue is a question set, not a running order.
 */
const QUEUE_MAX = 24;

/**
 * A CLOSED enum, and the closure is the feature. `stage-beat.js` carries the
 * same note for the same incident shape: an open enum's worst failure is that
 * everything succeeds — the write lands, the frame goes out, and the host
 * watches a button do nothing with no error anywhere in the system.
 */
const QUEUE_OPS = ['add', 'remove', 'earlier', 'later'];

/** Trimmed BEFORE the prefix strip, or ` QUESTION#x` survives as a third spelling. */
const canonical = (id) => questionKey(String(id ?? '').trim());

const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const refuse = (queue, refused) => ({ queue, changed: false, refused });
const accept = (queue) => ({ queue, changed: true, refused: null });

/**
 * Whatever was stored, as a clean list of canonical keys.
 *
 * DOES NOT TRUNCATE to QUEUE_MAX. The cap belongs on the gate that adds;
 * applying it on READ would mean a queue that somehow grew past two dozen
 * silently loses the host's last choices the next time anything looks at it.
 * Junk — blanks, nulls, a duplicate from an older client — is dropped, because
 * none of those name a question anybody can be served.
 *
 * Returns the caller's own array when there was nothing to clean.
 */
function normaliseQueue(value) {
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
 * Add to the TAIL — a host who queues three questions means them in the order
 * they pressed. Duplicates are PREVENTED rather than deduped later: the second
 * copy would sit there until it drained and then be skipped as already-asked,
 * which reads as the queue eating a round.
 */
function queueEnqueue(queue, id) {
  const list = normaliseQueue(queue);
  const key = canonical(id);

  if (!key) return refuse(list, 'no-key');
  // Already there: the press was a no-op, not an error. Same reasoning as
  // stage-beat.js's idempotence — the host is in front of a room, and a
  // double-tap must not be something they have to understand.
  if (list.includes(key)) return refuse(list, 'duplicate');
  if (list.length >= QUEUE_MAX) return refuse(list, 'full');

  return accept([...list, key]);
}

/** The host taking one back off the list. A key that is not queued is a no-op. */
function queueRemove(queue, id) {
  const list = normaliseQueue(queue);
  const key = canonical(id);

  if (!key) return refuse(list, 'no-key');
  const at = list.indexOf(key);
  /*
    A STALE SURFACE MUST NOT RESURRECT WHAT ANOTHER ONE REMOVED.

    The phone polls every 2s, so it draws rows the stage deleted a moment ago.
    Pressing one of those must do nothing. The dangerous alternative is an
    implementation that treats a missing key as something to re-add: then every
    stale tap puts the question back and the host removes it twice.
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
 * So it CLAMPS and never wraps. A wrap would send the question the host is
 * trying to promote to the very bottom of the list, which is the single worst
 * thing this control could do and is what an unguarded modular index does on
 * the first press.
 */
function queueMove(queue, id, direction) {
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
 * The drain in `next-question.js` uses it to pop the head it has just served,
 * and to discard entries that turn out to have been asked already. Both are
 * bookkeeping about what happened, so neither is reachable from a button.
 *
 * Takes several keys because the drain can discard a run of already-asked
 * entries and serve the survivor in one pass — one write is one chance for the
 * conditional to fail rather than four.
 */
function queueDrop(queue, keys) {
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
function applyQueueOp(queue, operation = {}) {
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
 * Where a question sits, 1-based, or 0 when it is not queued — 0 rather than
 * -1 or null so "is this queued?" and "which number is it?" are one expression
 * and cannot drift apart at a call site.
 */
function queuePosition(queue, id) {
  const key = canonical(id);
  if (!key) return 0;
  return normaliseQueue(queue).indexOf(key) + 1;
}

/**
 * The queue as rows, with the edge rules already decided.
 *
 * `canMoveEarlier`/`canMoveLater` are the SAME clamp `queueMove` enforces; a
 * surface that re-derives "is this the first row" is a second implementation
 * that can disagree with the server about whether a button should have done
 * anything. `missing` is honest about a queued key whose question the caller
 * could not supply, rather than dropping a row the server still holds.
 */
function queueRows(queue, { questions = [] } = {}) {
  const list = normaliseQueue(queue);

  const byKey = new Map();
  for (const question of questions) {
    const key = canonical(
      (question && (question.id ?? question.Id ?? question.questionId))
    );
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
function queueSummary(queue) {
  const list = normaliseQueue(queue);
  return {
    count: list.length,
    remaining: Math.max(0, QUEUE_MAX - list.length),
    full: list.length >= QUEUE_MAX,
    // What the next "end of round" will actually serve, which is the only thing
    // about a queue a host reads mid-session.
    nextKey: list[0] || null,
  };
}

module.exports = {
  QUEUE_MAX,
  QUEUE_OPS,
  normaliseQueue,
  queueEnqueue,
  queueRemove,
  queueMove,
  queueDrop,
  applyQueueOp,
  queuePosition,
  queueRows,
  queueSummary,
};
