/**
 * A QUESTION-SET REFERENCE IS A PAIR: `{scope, id}`.
 *
 * `lambda-functions/game/tenant.js` states it — a setId is a slug, and
 * `teamretro` names a different set in each of platform, org and public. Every
 * backend seam already carries both halves: `GET /question-sets` returns
 * `scope` beside `id` ("the pair has to survive the round trip or the session
 * would later read whichever library it happened to hit first"), `POST /games`
 * names `questionSetScope` in its destructure, and schema-compliant-manager
 * pins `QuestionSetScope` onto the session's METADATA.
 *
 * The frontend was the only place that collapsed the pair to the id, and it did
 * it in the picker: `<option value={set.id}>`. From there the scope was simply
 * gone, so `createGameBody` had none to send, `create-game.js` fell back to its
 * documented default of `platform`, and a session built from an ORG's set went
 * looking for that id in Engage's library. It is not there. `resolveSetPartition`
 * returns no metadata, `resolvePartitionFromMeta` falls through to its legacy
 * branch, and the session pins a partition key holding no categories and no
 * questions — created, listed, joinable, and unplayable.
 *
 * This module exists because a `<select>`'s value can only be a string. It is
 * the one definition of how the pair is encoded into one, so the encoding
 * cannot drift between the picker that writes it and the handler that reads it.
 */

/**
 * What a set with no scope is. Not a guess — it is what `create-game.js`
 * already means by a payload that says nothing, and every set that existed
 * before tenancy lives there.
 */
export const DEFAULT_SCOPE = 'platform';

const scopeOf = (set) => (set && typeof set.scope === 'string' && set.scope.trim()) || DEFAULT_SCOPE;

/** `{id, scope}` → `"org:teamretro"`. An empty id encodes as `''`, the empty choice. */
export function setRefKey(set) {
  const id = (set && set.id) || '';
  if (!id) return '';
  return `${scopeOf(set)}:${id}`;
}

/**
 * `"org:teamretro"` → `{id: 'teamretro', scope: 'org'}`.
 *
 * Splits ONCE. A slug may contain a colon and nothing forbids it, so the scope
 * is the first segment and the id is everything after it — `key.split(':')`
 * destructured into two would silently truncate `org:weird:id` to `weird`.
 *
 * A key with no colon is a bare id: an older stored value, or an edit seeded
 * from a session created before the scope was pinned. Those are platform sets,
 * by the same rule as above.
 */
export function parseSetRefKey(key) {
  const raw = typeof key === 'string' ? key : '';
  const at = raw.indexOf(':');
  if (at < 0) return { id: raw, scope: DEFAULT_SCOPE };
  return { id: raw.slice(at + 1), scope: raw.slice(0, at) || DEFAULT_SCOPE };
}

/**
 * Are these the same set? Compares the PAIR.
 *
 * The whole family of bugs this module addresses is one level up from here:
 * `sets.find((s) => s.id === setId)` and `new Map(sets.map((s) => [s.id, s]))`
 * both treat two different sets as one whenever they share a slug.
 */
export function sameSetRef(a, b) {
  return ((a && a.id) || '') === ((b && b.id) || '') && scopeOf(a) === scopeOf(b);
}

export default { DEFAULT_SCOPE, setRefKey, parseSetRefKey, sameSetRef };
