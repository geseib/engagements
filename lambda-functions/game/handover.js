/**
 * ONE EXCHANGE OF A NAME, GRANTED BY THE HOST, CONSUMED ONCE.
 *
 * `join-game.js` refuses a name whose row is owned by a different browser, and
 * that refusal is correct: two people called Chris are more common in a room
 * than one Chris on a second laptop, and guessing wrong silently hands one
 * person's answers and score to another. But the refusal has no way out, and
 * the person who genuinely did swap devices is stuck under a name that is
 * provably theirs.
 *
 * The way out is the host, because the host is the only party who can tell the
 * two cases apart — they can see the room. Owner's framing: *"they need the
 * choice though because they may have just mistakenly picked the same name."*
 * So nothing here is automatic. A grant exists only because a host made one.
 *
 * ── WHY THE GRANT LIVES ON THE PLAYER ROW ──────────────────────────────────
 *
 * The grant is four attributes on `PLAYER#{name}` rather than a row of its own
 * (`HANDOVER#{name}`, say), and that is the whole reason the one-shot rule can
 * be enforced at all.
 *
 * "One exchange" means two claimants racing a single grant must not both get
 * in. The claim writes `ClientId` on the player row; the grant must be spent in
 * the same instant. On ONE item that is a single conditional `UpdateCommand` —
 * DynamoDB serialises the two writers, the first passes
 * `attribute_exists(HandoverExpiresAt)` and REMOVEs it, and the second's
 * condition fails. On TWO items it would take a `TransactWriteItems`, or worse,
 * a read-then-write, which is exactly the shape the header of `join-game.js`'s
 * adopt branch already warns about. Same standard, same mechanism.
 *
 *   HandoverExpiresAt    epoch SECONDS. Presence AND futurity is the grant.
 *   HandoverForClientId  optional. When set, only that browser may spend it.
 *   HandoverRequestedBy  the clientId of whoever asked. NEVER PUBLISHED — see
 *                        below.
 *   HandoverRequestedAt  ISO, so the host can see how stale the ask is.
 *
 * ── WHY IT EXPIRES, AND WHY FIVE MINUTES ───────────────────────────────────
 *
 * A grant nobody claims is a hole in the room's identity: for as long as it
 * stands, anyone who types that name and says "yes, that's me" inherits a
 * stranger's answers and score. A host who unlocks a name and is then pulled
 * into the next round would never think to close it again, so it closes itself.
 *
 * Five minutes because the grant is spoken aloud — the host says "go ahead" and
 * the person taps within seconds. It is a window sized to a sentence, not to a
 * session. Re-granting is one click, which is the owner's stated fallback:
 * *"if they need to do again, same routine."*
 *
 * Expiry is enforced in the ConditionExpression (`HandoverExpiresAt > :now`),
 * not by a sweeper and not by TTL — the player row's own 7-day `ttl` is far too
 * coarse, and a lapsed grant that is merely *ignored* by the condition is
 * indistinguishable from one that was deleted. The attributes are also REMOVEd
 * when a grant is spent, so a spent grant leaves no residue for the next reader
 * to misinterpret.
 *
 * ── THE ONE THING THAT MUST NOT BE PUBLISHED ───────────────────────────────
 *
 * `HandoverRequestedBy` is a clientId, and a clientId is a CAPABILITY, not a
 * label: `get-answers.js:247` returns a player's own answer text to anyone who
 * presents the clientId stamped on that player's row. `GET /games/{id}/players`
 * has no authorizer, so anything this file lets into that projection is public.
 *
 * That is why `grant-handover.js` takes `bindToRequester: true` rather than the
 * requester's id: the host says "the person who asked", the SERVER reads the id
 * off the row it already holds, and the id never crosses the wire in either
 * direction. `publicHandoverState` below is the allow-list that keeps it that
 * way, and it exists as a named function so that "does the roster leak the
 * capability?" is one assertion rather than a review of every call site.
 */

/**
 * Sized to a spoken sentence, not to a session. See the header.
 * Exported so the tests state the window rather than restating the number.
 */
const HANDOVER_WINDOW_SECONDS = 5 * 60;

/** DynamoDB comparisons need a number; the row stores epoch seconds. */
function nowSeconds(now = Date.now()) {
  return Math.floor(now / 1000);
}

/** When a grant made at `now` lapses. */
function handoverExpiryFrom(now = Date.now()) {
  return nowSeconds(now) + HANDOVER_WINDOW_SECONDS;
}

/**
 * What the row says about a handover, read defensively.
 *
 * A missing attribute yields `NaN` and a null one yields `0`; both are refused
 * by the `Number.isFinite` + `> now` pair rather than by a truthiness check,
 * because `HandoverExpiresAt: 0` is falsy AND finite and would otherwise take a
 * different path from `HandoverExpiresAt: undefined` for no reason.
 */
function handoverState(item, now = Date.now()) {
  const expiresAt = Number(item && item.HandoverExpiresAt);
  const open = Number.isFinite(expiresAt) && expiresAt > nowSeconds(now);

  return {
    open,
    // Only meaningful while open. A lapsed grant reports nothing, so no reader
    // can accidentally treat "there was a grant once" as "there is a grant".
    expiresAt: open ? expiresAt : null,
    boundTo: open ? ((item && item.HandoverForClientId) || null) : null,
    requestedBy: (item && item.HandoverRequestedBy) || null,
    requestedAt: (item && item.HandoverRequestedAt) || null,
  };
}

/**
 * May THIS browser spend the grant on this row?
 *
 * ADVISORY ONLY. This reads a `GetCommand` result, so by the time the caller
 * acts on it another claimant may have spent the grant. The authority is the
 * ConditionExpression in `join-game.js`, which re-checks every clause of this
 * function against the item at write time. The same split the adopt branch
 * already makes: classify from the read, decide from the condition.
 *
 * An anonymous caller (no clientId) can never spend a grant — the point of the
 * exchange is that the new browser ends up owning the row, and a row owned by
 * nobody is the `unverified` state this feature is not about.
 */
function handoverOpenFor(item, clientId, now = Date.now()) {
  const state = handoverState(item, now);
  if (!state.open) return false;
  if (!clientId) return false;
  if (state.boundTo && state.boundTo !== clientId) return false;
  return true;
}

/**
 * The half of the handover state that may appear on a PUBLIC endpoint.
 *
 * `GET /games/{gameId}/players` carries no authorizer, so this is an allow-list
 * and not a projection with a couple of fields dropped. `requestedBy` and
 * `boundTo` are clientIds and are therefore capabilities (see the header);
 * publishing either would let any phone in the room read the answer text of the
 * person who asked, which is the exact leak `get-answers.js` is built to stop.
 *
 * The host does not need them. "Somebody asked, at 14:02" plus a button that
 * says "the person who asked" is the whole of the host's decision.
 */
function publicHandoverState(item, now = Date.now()) {
  const state = handoverState(item, now);
  return {
    open: state.open,
    expiresAt: state.expiresAt,
    requested: Boolean(state.requestedBy),
    requestedAt: state.requestedAt,
  };
}

module.exports = {
  HANDOVER_WINDOW_SECONDS,
  nowSeconds,
  handoverExpiryFrom,
  handoverState,
  handoverOpenFor,
  publicHandoverState,
};
