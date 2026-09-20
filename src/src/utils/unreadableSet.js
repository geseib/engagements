/**
 * A SET WHOSE CONTENT COULD NOT BE DECRYPTED — one vocabulary, every surface.
 *
 * ── WHERE THIS ROW COMES FROM ─────────────────────────────────────────────
 *
 * An organisation's set metadata is encrypted at rest (shared/tenant-crypto.js),
 * and `decryptValue` THROWS on a failed tag check rather than returning
 * something — a rotated key, a torn write, a half-written row. Both list
 * handlers used to let that throw escape into the Promise.all over the caller's
 * scopes, so ONE unreadable row 500d the entire library: the readable org sets
 * beside it, Engage's shared library and the public one, none of which are even
 * encrypted.
 *
 * They now degrade per row instead (`admin/get-question-sets.js`,
 * `game/get-question-sets.js`). The bad row stays LISTED — a row nobody can see
 * is a row nobody restores — with every encrypted field nulled and
 * `decryptFailed: true` saying why. Never the raw envelope, which would render
 * `{v,iv,tag,ct}` as though the author had typed it, and never a fabricated
 * title, which the reader could not tell from a real one.
 *
 * ── WHY THE WORDING LIVES IN ONE PLACE ────────────────────────────────────
 *
 * Four surfaces render a set's name from those two handlers: the console
 * library, the host's shelf, the create-engagement picker and the quickstart
 * menu. The state they have to convey is a distinction — "nobody NAMED this"
 * against "nobody can READ this" — and a distinction drawn in four different
 * words on four screens is not a distinction anybody learns. Same argument, and
 * the same shape, as utils/setOwnerTag.js.
 */

/**
 * Did the server fail to decrypt this row?
 *
 * The flag is present ONLY when true (both handlers spread it conditionally),
 * so absence means the row decrypted — which is every row in a healthy library,
 * and every row written before the cipher existed.
 */
export function isUnreadableSet(set) {
  return !!(set && set.decryptFailed);
}

/** The chip. One word, because it is scanned in a column of other chips. */
export const UNREADABLE_LABEL = 'Unreadable';

/**
 * The chip's `title`, and the picker's. The word alone is not an action: it
 * does not say whether the reader broke it, whether it is coming back, or
 * whether to stop trying to use it. This says all three.
 */
export const UNREADABLE_REASON =
  'This set could not be decrypted, so its name and description cannot be shown. '
  + 'It cannot be played until it is restored.';

/** The line that replaces the description, which is unreadable for the same reason. */
export const UNREADABLE_SUB = 'Its name and description could not be decrypted.';

/**
 * What to show where the name would go.
 *
 * The set id is the one field that was never encrypted — it is half the
 * DynamoDB key — so it is the only handle left on the row, and the thing
 * somebody quotes when they report it. `HostQuestionSetsDialog` already fell
 * back to it for a nameless row before any of this existed.
 */
export function unreadableSetName(set) {
  return (set && set.id) || 'Unreadable set';
}
