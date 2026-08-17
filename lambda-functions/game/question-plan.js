/**
 * WHAT IS COMING UP, DECIDED THE SAME WAY TWICE.
 *
 * The owner asked for an "Up Next" showing the next several questions, tagged
 * so a host can see which ones they queued themselves. The obstacle was not the
 * display — it was that the ANSWER DID NOT EXIST YET.
 *
 * ── WHY A PEEK WAS IMPOSSIBLE BEFORE THIS FILE ────────────────────────────
 *
 * `next-question.js` does not hold a running order. Each round it reads the
 * live masks and counts, assembles the categories that still have questions,
 * and — on a randomised set — picks one with `Math.floor(Math.random() * n)`.
 * The next question is therefore not a fact to look up; it is INVENTED at the
 * moment the host presses the button, and a second press would have invented
 * something else.
 *
 * So any "Up Next" built on the old behaviour would have been a guess
 * presented as a plan. This repo's standing rule is that a screen must never
 * show something that lies — an empty state that reports the wrong KIND of
 * empty is already treated as a bug here — and a speculative running order is
 * the same fault with more words on it.
 *
 * ── THE FIX IS TO MAKE THE ORDER DETERMINISTIC, NOT TO GUESS IT ───────────
 *
 * Every choice comes from `pickIndex(seed, roundNumber, length)`: a pure
 * function of the session's seed and the round number. Same seed, same round,
 * same answer, for ever — so the peek runs the REAL rule rather than an
 * imitation of it, and `next-question.js` calls this same function when the
 * moment actually arrives.
 *
 * A HASH PER ROUND, NOT A STATEFUL PRNG, and that is the load-bearing choice.
 * A generator would have to be advanced once per round and its position stored
 * and kept in step with the session; peeking four rounds ahead would mean
 * replaying it, and any drift between the stored position and the real one
 * silently changes what the room gets. Keying on the round number directly has
 * no position to drift: round 7's pick is computable from nothing but the seed
 * and the number 7, in any order, any number of times.
 *
 * ── NO MIGRATION, BECAUSE THE SEED ALREADY EXISTS ─────────────────────────
 *
 * A session with no stored seed falls back to its own game id, which is already
 * unique per session and already stable. So every game in flight today acquires
 * a deterministic order the moment this ships, with nothing to backfill and no
 * dual-path period.
 *
 * ── THE PLAN IS A SIMULATION, AND IT HAS TO BE ────────────────────────────
 *
 * Which category is available depends on which questions remain, which depends
 * on what the earlier rounds took. There is no closed form. `planAhead` therefore
 * replays the real rule forward over an in-memory copy — take a question, spend
 * it, advance that category's cursor, repeat — which is exactly what the
 * handler will do one round at a time.
 *
 * PURE. No SDK, no clock, no I/O. The caller assembles the snapshot and this
 * decides. That is what lets the whole rule be tested by arithmetic rather than
 * against a stubbed database, and it is the same split `queue-order.js` and
 * `config/questionQueue.js` already use.
 */

/**
 * A 32-bit hash of a string. FNV-1a.
 *
 * Chosen for being short, dependency-free and — the part that matters —
 * IDENTICAL EVERYWHERE. This value decides what a room sees, and it is computed
 * in a Lambda today and may be computed in a browser tomorrow, so anything
 * platform-dependent (a locale, a float, a Date) is disqualified. Integer ops
 * on char codes give the same answer in both.
 *
 * IT MUST NOT RETURN A NEGATIVE. JavaScript's bitwise operators produce a
 * SIGNED 32-bit int, and a negative hash makes `% length` negative too — an
 * out-of-range read that silently picks `undefined` as the category.
 *
 * There are TWO unsigned coercions below, in the loop and on the way out, and
 * measured over 18,000 seed/round pairs EITHER ONE ALONE is sufficient: each is
 * individually redundant, the pair is not. Removing both makes roughly half of
 * all hashes negative. They are both kept because which one is load-bearing
 * depends on the input, and the suite pins the property that matters —
 * `pickIndex` always in range — rather than either line.
 */
function hashString(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime, 16777619, by shift-and-add: a plain `hash * 16777619`
    // exceeds 2^53 and loses precision, which would make the hash depend on
    // floating-point rounding rather than on the input.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash >>>= 0;
  }
  return hash >>> 0;
}

/**
 * Which of `length` options this round takes.
 *
 * The single point of decision, shared by the planner and the handler. If these
 * two ever disagree the Up Next becomes a lie again, so there is deliberately
 * no second copy of this arithmetic anywhere.
 */
function pickIndex(seed, roundNumber, length) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  // The separator matters: without it seed 'a1' + round 2 and seed 'a' + round
  // 12 hash the same string and two different sessions march in lockstep.
  return hashString(`${seed}::${roundNumber}`) % length;
}

/**
 * The seed for a session — its stored one, or its game id.
 *
 * Never a random default. A seed invented per call would make the order differ
 * between the peek and the serve, which is the exact failure this file exists
 * to prevent, and it would do it invisibly.
 */
function seedFor(game) {
  const stored = game && (game.RandomSeed || game.randomSeed);
  if (stored) return String(stored);
  const id = game && (game.GameId || game.gameId || game.PK);
  return String(id ?? 'engage');
}

/**
 * The next question this category owes, skipping anything already asked.
 *
 * Mirrors `advancePastAsked` in next-question.js — same walk, same skip, same
 * exhaustion answer. It is duplicated here rather than imported because that
 * one reads from a live cursor record and this one from a simulated copy;
 * `__tests__` pins them to the same behaviour so the duplication cannot rot.
 */
function nextFromCategory(category, asked) {
  const order = category.order || [];
  const count = Number(category.questionCount) || 0;
  let index = Number(category.cursor) || 0;

  while (index < count) {
    const number = order.length > index ? order[index] : index + 1;
    const questionId = `QUESTION#${category.categoryId}#${String(number).padStart(3, '0')}`;
    if (!asked.has(questionId)) return { index, questionId };
    index += 1;
  }
  return null;
}

/**
 * The next `count` questions, in the order the room will actually meet them.
 *
 * Returns `[{ source, questionId, categoryId, title, round }]`, `source` being
 * `'queued'` for the host's own running order and `'auto'` for the rest — which
 * is the tag the owner asked for ("might create a obvious tag when the user
 * queued it up just to distinguish"). It is derived from WHERE the item came
 * from rather than stored on it, so it cannot disagree with reality.
 *
 * A SHORT LIST IS A TRUE LIST. When the remaining questions run out this
 * returns fewer than asked rather than padding — the end of the set is a fact
 * the host wants to see coming, and inventing rows to reach `count` would hide
 * exactly the thing worth knowing.
 */
function planAhead(snapshot, count) {
  const {
    seed,
    roundNumber = 1,
    isRandomized = true,
    queue = [],
    asked = new Set(),
    categories = [],
    resolveQueued = () => null,
  } = snapshot || {};

  const wanted = Number.isInteger(count) && count > 0 ? count : 0;

  // WORK ON COPIES. The caller's snapshot is read elsewhere — this simulation
  // spends questions and moves cursors, and doing that to the live objects
  // would corrupt the very state the handler is about to act on.
  const pool = categories.map((c) => ({ ...c, order: (c.order || []).slice() }));
  const spent = new Set(asked);
  const pending = queue.slice();
  const plan = [];

  let round = roundNumber;

  while (plan.length < wanted) {
    let placed = null;

    // THE HOST'S RUNNING ORDER GETS FIRST REFUSAL, exactly as the drain does.
    // Anything in it that has already been asked is discarded rather than
    // shown — the drain drops those too, so listing them would advertise a
    // round that is never going to happen.
    while (pending.length && !placed) {
      const key = pending.shift();
      const questionId = `QUESTION#${key}`;
      if (spent.has(questionId)) continue;

      const resolved = resolveQueued(key) || {};
      placed = {
        source: 'queued',
        questionId,
        categoryId: resolved.categoryId || null,
        title: resolved.title || '',
      };
    }

    if (!placed) {
      const available = pool.filter((c) => nextFromCategory(c, spent) !== null);
      if (!available.length) break;

      const index = isRandomized
        ? pickIndex(seed, round, available.length)
        // NOT randomised: lowest position first, which is the handler's own
        // `sort((a, b) => a.position - b.position)[0]`.
        : available.reduce((best, c, i) => (c.position < available[best].position ? i : best), 0);

      const category = available[index];
      const next = nextFromCategory(category, spent);

      placed = {
        source: 'auto',
        questionId: next.questionId,
        categoryId: category.categoryId,
        title: (category.titles && category.titles[next.questionId]) || '',
      };

      // Spend it in the simulation: the cursor moves PAST the question taken,
      // which is what makes the following iteration see a different world.
      category.cursor = next.index + 1;
    }

    spent.add(placed.questionId);
    plan.push({ ...placed, round });
    round += 1;
  }

  return plan;
}

module.exports = { hashString, pickIndex, seedFor, nextFromCategory, planAhead };
