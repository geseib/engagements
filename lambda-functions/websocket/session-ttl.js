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
 *   started                  →  started + 7 days   (rewritten by start-game)
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

module.exports = { DAY, UNSTARTED_DAYS, STARTED_DAYS, ttlFrom, unstartedTtl, startedTtl };
