/**
 * WHEN A SESSION ROW EXPIRES — one rule, written once.
 *
 * The owner, 2026-09-21: "the 90 day session needs to be set for unstarted
 * sessions as well, but they get changed to 7 days once started."
 *
 * Until this file the session row carried NO `ttl` at all (CLAUDE.md records
 * the two wrong claims that preceded that finding), so every session ever
 * created was still listed. Contents — players, votes, one results row —
 * already expired at 7 days, which is how a session came to outlive its own
 * players.
 *
 *   created, never started   →  created + 90 days
 *   started                  →  started + 7 days   (game/session-start.js)
 *
 * The table's TTL attribute is `ttl`, epoch SECONDS (template-clean.yaml
 * TimeToLiveSpecification). DynamoDB deletes lazily — up to ~48h late — which
 * is fine for a cleanup and is why no reader may treat `ttl` as "gone".
 *
 * ALL FOUR ROWS OF A SESSION carry it: the GAMES reservation, the org's index
 * row, METADATA and STATE. Expiring the index row alone would leave a
 * METADATA row nobody can list; expiring METADATA alone would leave a listed
 * session that 404s.
 *
 * Copied verbatim into lambda-functions/game/session-ttl.js — the packages
 * cannot import each other. tests/session-ttl.js holds the two identical.
 */
const DAY = 24 * 60 * 60;
const UNSTARTED_DAYS = 90;
const STARTED_DAYS = 7;

/** epoch seconds for `iso` (or now) plus `days`. */
function ttlFrom(iso, days) {
  const ms = iso ? Date.parse(iso) : Date.now();
  return Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000) + days * DAY;
}

const unstartedTtl = (createdIso) => ttlFrom(createdIso, UNSTARTED_DAYS);
const startedTtl = (startedIso) => ttlFrom(startedIso, STARTED_DAYS);

/**
 * A SESSION'S CONTENT DOES NOT FOLLOW THE RULE ABOVE. The rule above is about
 * the session's own four rows; a `ROUND#` record (game/get-results.js's
 * enterResultsState, game/reveal-authors.js, game/stage-beat.js,
 * game/stage-focus.js) is content the session PRODUCES, and until
 * 2026-09-26 it carried no ttl at all — four call sites, each an
 * unconditional UpdateCommand upsert, none of them ever stamping one.
 *
 * Bug sweep Task 2 found the consequence: the "any row still in this
 * partition means the code is taken" rule a fresh draw now applies
 * (websocket/schema-compliant-manager.js) retired a code FOR GOOD the
 * moment a session ever reached results, because its `ROUND#` row never
 * expired to let the code go.
 *
 * `ROUND_RECORD_DAYS` matches the 30-day life already hardcoded onto
 * `PLAYER#x#SCORE` (game/join-game.js) and `QUESTION#nnn#AISummary`
 * (game/get-ai-summary.js) — the other two row kinds that already outlive a
 * session's own ttl, and that the fresh-draw rule above now has to wait out
 * too. All four `ROUND#` writers set it with `if_not_exists(#ttl, :ttl)`, so
 * whichever of them touches a round FIRST stamps the clock and the other
 * three leave it alone — the ttl counts from when the round was first
 * counted, not from the last time anybody touched it.
 *
 * No backfill: a round already resolved before this line existed keeps no
 * ttl, and its code stays out of rotation. That is a known, accepted cost
 * (bug sweep Task 2 ruling) — not an oversight to "finish" here.
 */
const ROUND_RECORD_DAYS = 30;

module.exports = {
  DAY, UNSTARTED_DAYS, STARTED_DAYS, ROUND_RECORD_DAYS, ttlFrom, unstartedTtl, startedTtl
};
